/**
 * A timing source driven by an SQL profile: runs the profile's queries and maps the rows to
 * the timing SDK model (units, clock, status map, control visit encoding, ext columns).
 */

import type {
  ClassInfo,
  Competition,
  Control,
  Entry,
  EntryStatus,
  LatestPassing,
  Passing,
  SqlRunner,
  TimingSource
} from '../../../../shared/timing-sdk';
import { DEFAULT_COMPETITION_TIMEZONE, zonedWallTimeToEpochMs } from '../../liveTime';
import type { QueryName, SqlProfile, StatusDefault, StatusTarget } from './SqlProfile';
import { namedParameters } from './sqlText';

type Row = Record<string, unknown>;

const UNIT_MS = { ms: 1, hundredths: 10, tenths: 100, seconds: 1000 } as const;

const has = (v: unknown) => v !== undefined && v !== null && v !== '';
const str = (v: unknown): string | undefined => (has(v) ? String(v) : undefined);
const num = (v: unknown): number | undefined => {
  if (!has(v)) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
/** Ids are strings in the SDK; numeric ids go back to the database as numbers */
const dbId = (id: string): unknown => (/^-?\d{1,15}$/.test(id) ? Number(id) : id);

function toDateString(d: unknown): string {
  if (d instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return String(d ?? '').slice(0, 10);
}

/** Columns "ext.<key>" -> { key: value } */
function extOf(row: Row): Record<string, unknown> | undefined {
  let ext: Record<string, unknown> | undefined;
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('ext.') && has(v)) (ext ??= {})[k.slice(4)] = v;
  }
  return ext;
}

export interface SqlProfileSourceOptions {
  /** Event time zone; overrides the profile's */
  timezone?: string;
  /** Values for the profile's options (queries read them as :name) */
  options?: Record<string, unknown>;
  /** Called by close() (e.g. ends the connection pool) */
  onClose?: () => void | Promise<void>;
  /** Check the connection before the first query (e.g. ping) */
  onConnect?: () => Promise<void>;
}

export class SqlProfileSource implements TimingSource {
  private competitionCache = new Map<string, Competition>();
  private classCache = new Map<string, ClassInfo[]>();

  constructor(
    readonly profile: SqlProfile,
    private readonly db: SqlRunner,
    private readonly opts: SqlProfileSourceOptions = {}
  ) {}

  async connect(): Promise<void> {
    await this.opts.onConnect?.();
    await this.competitions();
  }

  close(): void | Promise<void> {
    this.competitionCache.clear();
    this.classCache.clear();
    return this.opts.onClose?.();
  }

  // --- queries ---------------------------------------------------------------------------

  private async run(name: QueryName, params: Record<string, unknown>): Promise<Row[]> {
    const sql = this.profile.queries[name];
    if (!sql) return [];
    const all: Record<string, unknown> = { ...(this.opts.options ?? {}), ...params };
    // Profiles only see the parameters they use
    const used = Object.fromEntries(namedParameters(sql).map(n => [n, all[n]]));
    try {
      return await this.db.query(sql, used);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${this.profile.name}: query "${name}" failed: ${reason}`);
    }
  }

  // --- units -----------------------------------------------------------------------------

  private get timezone(): string {
    return this.opts.timezone || this.profile.timezone || DEFAULT_COMPETITION_TIMEZONE;
  }

  private duration(v: unknown): number | undefined {
    const n = num(v);
    return n !== undefined && n > 0 ? n * UNIT_MS[this.profile.units.time] : undefined;
  }

  private instant(v: unknown, competition: Competition): number | undefined {
    if (!has(v)) return undefined;
    switch (this.profile.units.clock) {
      case 'datetime': {
        const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
        return Number.isFinite(ms) ? ms : undefined;
      }
      case 'epochMs': return num(v);
      case 'epochSeconds': { const n = num(v); return n !== undefined ? n * 1000 : undefined; }
      case 'sinceMidnight': {
        const n = num(v);
        if (n === undefined || n <= 0) return undefined;
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(competition.date);
        const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [1970, 1, 2];
        return zonedWallTimeToEpochMs(y, mo, d, n * UNIT_MS[this.profile.units.time], competition.timezone || this.timezone);
      }
    }
  }

  private status(v: unknown, hasPassings: boolean): { status: EntryStatus; ranked: boolean } {
    const target = (t: StatusTarget) => (typeof t === 'string' ? { status: t, ranked: true } : { status: t.status, ranked: t.ranked !== false });
    const map = this.profile.statusMap;
    if (!map) return target((str(v) ?? 'notStarted') as EntryStatus);
    const hit = str(v) !== undefined ? (map as Record<string, StatusTarget>)[String(v)] : undefined;
    if (hit) return target(hit);
    const d: StatusDefault | undefined = map.default;
    if (!d) return { status: hasPassings ? 'running' : 'notStarted', ranked: true };
    if (typeof d === 'object' && 'ifPassings' in d) return { status: hasPassings ? d.ifPassings : d.else, ranked: true };
    return target(d as StatusTarget);
  }

  private control(row: Row): Control {
    const rawId = str(row.id) ?? '';
    const base = this.profile.transforms?.controlId?.visitEncoding?.base;
    const n = num(row.id);
    const code = num(row.code) ?? (base && n !== undefined ? n % base : n);
    const visit = num(row.visit) ?? (base && n !== undefined ? Math.floor(n / base) + 1 : undefined);
    const ext = extOf(row);
    return {
      id: rawId,
      ...(code !== undefined ? { code } : {}),
      ...(visit !== undefined ? { visit } : {}),
      ...(str(row.name) ? { name: str(row.name) } : {}),
      ...(num(row.leg) !== undefined ? { leg: num(row.leg) } : {}),
      ...(ext ? { ext } : {})
    };
  }

  // --- TimingSource ----------------------------------------------------------------------

  async competitions(): Promise<Competition[]> {
    const rows = await this.run('competitions', {});
    const list = rows.map(r => {
      const ext = extOf(r);
      const c: Competition = {
        id: str(r.id) ?? '',
        name: str(r.name) ?? '',
        date: toDateString(r.date),
        timezone: str(r.timezone) || this.opts.timezone || this.profile.timezone,
        ...(str(r.organiser) ? { organiser: str(r.organiser) } : {}),
        ...(str(r.location) ? { location: str(r.location) } : {}),
        ...(ext ? { ext } : {})
      };
      return c;
    });
    this.competitionCache = new Map(list.map(c => [c.id, c]));
    return list;
  }

  private async competition(competitionId: string): Promise<Competition> {
    let c = this.competitionCache.get(competitionId);
    if (!c) {
      await this.competitions();
      c = this.competitionCache.get(competitionId);
    }
    if (!c) throw new Error(`Unknown competition ${competitionId}`);
    return c;
  }

  async classes(competitionId: string): Promise<ClassInfo[]> {
    const competitionParam = dbId(competitionId);
    const rows = await this.run('classes', { competitionId: competitionParam });
    const perClass = (this.profile.queries.radioControls ?? '').includes(':classId');
    const controlsByClass = new Map<string, Control[]>();
    if (this.profile.queries.radioControls && !perClass) {
      for (const r of await this.run('radioControls', { competitionId: competitionParam })) {
        const key = str(r.classId) ?? '';
        if (!controlsByClass.has(key)) controlsByClass.set(key, []);
        controlsByClass.get(key)!.push(this.control(r));
      }
    }
    const classes: ClassInfo[] = [];
    for (const r of rows) {
      const id = str(r.id) ?? '';
      const legs = num(r.legs) ?? 0;
      const radioControls = perClass
        ? (await this.run('radioControls', { competitionId: competitionParam, classId: dbId(id) })).map(c => this.control(c))
        : controlsByClass.get(id) ?? [];
      const course = {
        lengthM: num(r['course.lengthM']),
        climbM: num(r['course.climbM']),
        controls: num(r['course.controls'])
      };
      const ext = extOf(r);
      classes.push({
        id,
        name: str(r.name) ?? id,
        ...(num(r.order) !== undefined ? { order: num(r.order) } : {}),
        kind: legs > 0 ? 'relay' : 'individual',
        ...(legs > 0 ? { legs } : {}),
        ...(Object.values(course).some(v => v !== undefined) ? { course } : {}),
        radioControls,
        ...(ext ? { ext } : {})
      });
    }
    this.classCache.set(competitionId, classes);
    return classes;
  }

  async entries(competitionId: string, classId: string): Promise<Entry[]> {
    const competition = await this.competition(competitionId);
    let cls = this.classCache.get(competitionId)?.find(c => c.id === classId);
    if (!cls) cls = (await this.classes(competitionId)).find(c => c.id === classId);
    if (!cls) throw new Error(`Class not found: ${classId}`);
    const relay = cls.kind === 'relay' && !!this.profile.queries.relayEntries;
    const params = { competitionId: dbId(competitionId), classId: dbId(classId) };
    const rows = await this.run(relay ? 'relayEntries' : 'entries', params);

    const passingsByEntry = new Map<string, { passing: Passing; hasTime: boolean }[]>();
    if (rows.length && this.profile.queries.passings) {
      const entryIds = [...new Set(rows.map(r => r.id).filter(has))];
      for (const p of await this.run('passings', { ...params, entryIds })) {
        const key = str(p.entryId) ?? '';
        const control = this.control({ id: p.controlId });
        const time = this.duration(p.time);
        const at = this.instant(p.at, competition);
        if (!passingsByEntry.has(key)) passingsByEntry.set(key, []);
        passingsByEntry.get(key)!.push({
          passing: { controlId: control.id, ...(time !== undefined ? { time } : {}), ...(at !== undefined ? { at } : {}) },
          hasTime: time !== undefined || at !== undefined
        });
      }
    }

    return rows.map(r => {
      const id = str(r.id) ?? '';
      const passings = passingsByEntry.get(id) ?? [];
      const s = r.ranked !== undefined && r.ranked !== null
        ? { ...this.status(r.status, passings.length > 0), ranked: !!Number(r.ranked) || r.ranked === true }
        : this.status(r.status, passings.length > 0);
      const full = str(r['name.full']) ?? [str(r['name.given']), str(r['name.family'])].filter(Boolean).join(' ');
      const clubName = str(r['club.name']);
      const ext = extOf(r);
      const teamId = str(r['team.id']);
      const entry: Entry = {
        id,
        classId,
        name: {
          full,
          ...(str(r['name.given']) ? { given: str(r['name.given']) } : {}),
          ...(str(r['name.family']) ? { family: str(r['name.family']) } : {})
        },
        ...(clubName !== undefined || str(r['club.short'])
          ? { club: { name: clubName ?? '', ...(str(r['club.short']) ? { short: str(r['club.short']) } : {}), ...(str(r['club.country']) ? { country: str(r['club.country']) } : {}) } }
          : {}),
        ...(str(r.bib) ? { bib: str(r.bib) } : {}),
        ...(str(r.country) ? { country: str(r.country) } : {}),
        status: s.status,
        ranked: s.ranked,
        start: this.instant(r.start, competition),
        finish: this.instant(r.finish, competition),
        time: this.duration(r.time),
        passings: passings.filter(p => p.hasTime).map(p => p.passing),
        ...(this.instant(r.changedAt, competition) !== undefined ? { changedAt: this.instant(r.changedAt, competition) } : {}),
        ...(ext ? { ext } : {})
      };
      if (teamId !== undefined) {
        entry.team = {
          id: teamId,
          name: str(r['team.name']) ?? '',
          leg: num(r['team.leg']) ?? 1,
          ...(str(r['team.bib']) ? { bib: str(r['team.bib']) } : {}),
          ...(this.instant(r['team.start'], competition) !== undefined ? { start: this.instant(r['team.start'], competition) } : {}),
          ...(this.duration(r['team.time']) !== undefined ? { time: this.duration(r['team.time']) } : {})
        };
      }
      return entry;
    });
  }

  async passings(competitionId: string, limit: number): Promise<LatestPassing[]> {
    const competition = await this.competition(competitionId);
    const rows = await this.run('latestPassings', { competitionId: dbId(competitionId), limit });
    const out: LatestPassing[] = [];
    for (const r of rows) {
      const at = this.instant(r.at, competition);
      if (at === undefined) continue;
      out.push({
        entryId: str(r.entryId) ?? '',
        classId: str(r.classId) ?? '',
        controlId: this.control({ id: r.controlId }).id,
        at
      });
    }
    return out;
  }
}

/** Only expose passings() when the profile has a latestPassings query */
export function createSqlProfileSource(profile: SqlProfile, db: SqlRunner, opts: SqlProfileSourceOptions = {}): TimingSource {
  const source = new SqlProfileSource(profile, db, opts);
  if (!profile.queries.latestPassings) {
    return {
      connect: () => source.connect(),
      close: () => source.close(),
      competitions: () => source.competitions(),
      classes: id => source.classes(id),
      entries: (c, k) => source.entries(c, k)
    };
  }
  return source;
}

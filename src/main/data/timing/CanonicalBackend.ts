/**
 * Timing plugin -> Split Control core
 *
 * A plugin reports facts in the timing SDK model (src/shared/timing-sdk). This backend turns
 * them into the results the core works with: it ranks runners, works out time behind, split
 * places and progress (resultBuilder), relay team times, and the per-leg relay classes
 * ("<Class>-<leg>") the desk and templates use. LiveResultsClient keeps doing the caching,
 * change detection and polling on top of it.
 */

import type { LiveResultsBackend } from '../LiveResultsClient';
import type {
  LiveResultsClass,
  LiveResultsClassResult,
  LiveResultsCompetition,
  LiveResultsCompetitionInfo,
  LiveResultsPassing,
  LiveResultsSplitControl
} from '../../../shared/types/liveresults';
import type {
  ClassInfo,
  Competition,
  Control,
  Entry,
  EntryStatus,
  TimingSource
} from '../../../shared/timing-sdk';
import { buildClassResult, ResultRow } from '../sources/resultBuilder';
import { DEFAULT_COMPETITION_TIMEZONE, timeZoneOffsetMs } from '../liveTime';

/** SDK status -> the core's status code. notCompeting is left out of every list. */
export const STATUS_CODES: Record<EntryStatus, number | null> = {
  ok: 0,
  dns: 1,
  dnf: 2,
  mispunch: 3,
  dsq: 4,
  overtime: 5,
  notStarted: 9,
  running: 10,
  cancelled: 11,
  okNoTime: 20,
  notCompeting: null
};

/**
 * The core's split code for a radio control: visit * 1000 + code for codes below 1000
 * (1050 = first visit to 50, 2050 = second), otherwise code + 100000 per extra visit.
 */
export function splitCode(control: Pick<Control, 'id' | 'code' | 'visit'>): number {
  const code = control.code ?? parseInt(control.id, 10);
  const visit = Math.max(1, control.visit ?? 1);
  if (!Number.isFinite(code)) return 0;
  return code < 1000 ? visit * 1000 + code : code + (visit - 1) * 100000;
}

/** Numeric competition id the core uses for a plugin's string id (stable across restarts) */
export function numericCompetitionId(id: string): number {
  if (/^\d{1,9}$/.test(id)) return Number(id);
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Above every plausible numeric id, below 2^31
  return 1_000_000_000 + ((h >>> 0) % 1_000_000_000);
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatDuration(hundredths: number): string {
  const total = Math.floor(hundredths / 100);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = pad(total % 60);
  return h > 0 ? `${h}:${pad(m)}:${s}` : `${m}:${s}`;
}

interface ClassCache { at: number; classes: ClassInfo[] }

export class CanonicalBackend implements LiveResultsBackend {
  readonly name: string;
  readonly minPollIntervalMs: number;
  fetchLastPassings?: (competitionId: number, count: number) => Promise<LiveResultsPassing[]>;

  private competitionsById = new Map<number, Competition>();
  private classCache = new Map<string, ClassCache>();
  private listeners: ((competitionId: number, className?: string) => void)[] = [];

  constructor(
    readonly source: TimingSource,
    readonly pluginId: string,
    options: { minPollIntervalMs?: number } = {}
  ) {
    this.name = pluginId;
    this.minPollIntervalMs = Math.max(500, options.minPollIntervalMs ?? 2000);
    if (typeof source.passings === 'function') {
      this.fetchLastPassings = (competitionId, count) => this.lastPassings(competitionId, count);
    }
  }

  // --- push ------------------------------------------------------------------------------

  onChange(listener: (competitionId: number, className?: string) => void): void {
    this.listeners.push(listener);
  }

  /** Called through the plugin context when the plugin reports a change */
  notifyChanged(competitionId: string, classId?: string): void {
    const n = numericCompetitionId(competitionId);
    // A class we have not seen yet: refetch the whole competition
    const className = classId === undefined
      ? undefined
      : this.classCache.get(competitionId)?.classes.find(c => c.id === classId)?.name;
    if (className === undefined) this.classCache.delete(competitionId);
    for (const l of this.listeners) l(n, className);
  }

  // --- LiveResultsBackend ----------------------------------------------------------------

  async fetchCompetitions(): Promise<LiveResultsCompetition[]> {
    const list = await this.source.competitions();
    this.competitionsById.clear();
    for (const c of list) this.competitionsById.set(numericCompetitionId(c.id), c);
    return list.map(c => ({
      id: numericCompetitionId(c.id),
      name: c.name,
      organizer: c.organiser ?? '',
      date: c.date,
      timediff: 0
    }));
  }

  async fetchCompetitionInfo(competitionId: number): Promise<LiveResultsCompetitionInfo> {
    const c = await this.competition(competitionId);
    return {
      id: competitionId,
      name: c.name,
      organizer: c.organiser ?? '',
      date: c.date,
      timediff: 0,
      timezone: c.timezone
    };
  }

  async fetchClasses(competitionId: number): Promise<LiveResultsClass[]> {
    const c = await this.competition(competitionId);
    const classes = await this.loadClasses(c.id, 0);
    const out: LiveResultsClass[] = [];
    for (const cls of classes) {
      if (cls.kind === 'relay' && (cls.legs ?? 0) > 0) {
        for (let leg = 1; leg <= cls.legs!; leg++) out.push({ className: `${cls.name}-${leg}` });
      } else {
        out.push({ className: cls.name });
      }
    }
    return out;
  }

  async fetchClassResults(competitionId: number, className: string): Promise<LiveResultsClassResult> {
    const competition = await this.competition(competitionId);
    const { cls, leg } = await this.resolveClass(competition.id, className);
    const entries = (await this.source.entries(competition.id, cls.id))
      .filter(e => (leg ? e.team?.leg === leg : true));
    const result = this.buildResult(competition, cls, leg, className, entries);
    return result;
  }

  // --- conversion ------------------------------------------------------------------------

  private buildResult(
    competition: Competition,
    cls: ClassInfo,
    leg: number | undefined,
    className: string,
    entries: Entry[]
  ): LiveResultsClassResult {
    const toCs = this.clock(competition);
    const controls: LiveResultsSplitControl[] = [];
    const codeById = new Map<string, number>();
    for (const c of cls.radioControls ?? []) {
      if (c.leg !== undefined && c.leg !== (leg ?? 1)) continue;
      const code = splitCode(c);
      if (!code) continue;
      codeById.set(c.id, code);
      if (!controls.some(x => x.code === code)) {
        controls.push({ code, name: c.name || `Control ${c.code ?? c.id}` });
      }
    }

    const rows: ResultRow[] = [];
    for (const e of entries) {
      const status = STATUS_CODES[e.status];
      if (status === null || status === undefined) continue;
      const start = toCs(e.start ?? e.team?.start);
      const teamStart = e.team ? toCs(e.team.start) : 0;
      // Relays count from the team's start (team perspective)
      const offset = teamStart && start ? Math.max(0, start - teamStart) : 0;
      const ownMs = e.time ?? (e.finish !== undefined && e.start !== undefined ? e.finish - e.start : undefined);
      const own = ownMs && ownMs > 0 ? Math.round(ownMs / 10) : 0;
      const teamTime = e.team?.time && e.team.time > 0 ? Math.round(e.team.time / 10) : 0;
      const result = status === 0 ? (teamTime || (own ? own + offset : 0)) : 0;

      const splits = new Map<number, number>();
      for (const p of e.passings ?? []) {
        const code = codeById.get(p.controlId);
        if (!code) continue;
        const ms = p.time ?? (p.at !== undefined && e.start !== undefined ? p.at - e.start : undefined);
        if (ms === undefined || ms <= 0) continue;
        splits.set(code, Math.round(ms / 10) + offset);
      }

      const ext = e.ext && Object.keys(e.ext).length ? { [this.pluginId]: e.ext } : undefined;
      rows.push({
        key: e.id,
        name: e.name?.full ?? [e.name?.given, e.name?.family].filter(Boolean).join(' '),
        club: e.team ? e.team.name : (e.club?.short || e.club?.name || ''),
        bib: e.bib || e.team?.bib || undefined,
        country: e.country || e.club?.country || undefined,
        status,
        ranked: e.ranked !== false,
        start,
        ...(teamStart ? { teamStart } : {}),
        result,
        splits,
        ...(ext ? { ext } : {})
      });
    }

    const built = buildClassResult(className, controls, rows);
    const out: LiveResultsClassResult = { ...built };
    if (cls.course && cls.kind !== 'relay') {
      out.course = { length: cls.course.lengthM, climb: cls.course.climbM, controls: cls.course.controls };
    }
    // Competition and class fields share x.<plugin>; a class field wins over a competition field
    const ext = { ...(competition.ext ?? {}), ...(cls.ext ?? {}) };
    if (Object.keys(ext).length) out.ext = { [this.pluginId]: ext };
    return out;
  }

  /**
   * Epoch ms -> hundredths since local midnight of the competition day (0 = none). Wall-clock
   * time, as the core expects: 10:00 is 3600000 even on a daylight saving change day, and a
   * start after midnight counts on past 24:00.
   */
  private clock(c: Competition): (ms: number | undefined) => number {
    const tz = c.timezone || DEFAULT_COMPETITION_TIMEZONE;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.date ?? '');
    const day = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
    return (ms) => {
      if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return 0;
      const local = ms + timeZoneOffsetMs(ms, tz);
      if (day !== undefined) return Math.max(0, Math.round((local - day) / 10));
      return Math.round((((local % 86400000) + 86400000) % 86400000) / 10);
    };
  }

  // --- lookups ---------------------------------------------------------------------------

  private async competition(competitionId: number): Promise<Competition> {
    let c = this.competitionsById.get(competitionId);
    if (!c) {
      await this.fetchCompetitions();
      c = this.competitionsById.get(competitionId);
    }
    if (!c) throw new Error(`Unknown competition ${competitionId}`);
    return c;
  }

  /** Classes of a competition, reused for up to maxAgeMs */
  private async loadClasses(competitionId: string, maxAgeMs: number): Promise<ClassInfo[]> {
    const cached = this.classCache.get(competitionId);
    if (cached && Date.now() - cached.at <= maxAgeMs) return cached.classes;
    const raw = await this.source.classes(competitionId);
    const classes = raw
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (a.c.order ?? Infinity) - (b.c.order ?? Infinity) || a.i - b.i)
      .map(x => x.c);
    this.classCache.set(competitionId, { at: Date.now(), classes });
    return classes;
  }

  private async resolveClass(competitionId: string, className: string): Promise<{ cls: ClassInfo; leg?: number }> {
    const find = (classes: ClassInfo[]) => {
      const exact = classes.find(c => c.name === className && c.kind !== 'relay');
      if (exact) return { cls: exact };
      const m = /^(.*)-(\d+)$/.exec(className);
      if (m) {
        const relay = classes.find(c => c.name === m[1] && c.kind === 'relay');
        if (relay) return { cls: relay, leg: Number(m[2]) };
      }
      return undefined;
    };
    // Reuse the class list while polling; reload once when the class is new
    return find(await this.loadClasses(competitionId, this.minPollIntervalMs * 5))
      ?? find(await this.loadClasses(competitionId, 0))
      ?? (() => { throw new Error(`Class not found: ${className}`); })();
  }

  private async lastPassings(competitionId: number, count: number): Promise<LiveResultsPassing[]> {
    const competition = await this.competition(competitionId);
    const passings = await this.source.passings!(competition.id, count);
    const tz = competition.timezone || DEFAULT_COMPETITION_TIMEZONE;
    const classes = await this.loadClasses(competition.id, this.minPollIntervalMs * 5);
    const entriesByClass = new Map<string, Promise<Entry[]>>();
    const resultsByName = new Map<string, LiveResultsClassResult>();
    const out: LiveResultsPassing[] = [];

    for (const p of passings.slice(0, count)) {
      const cls = classes.find(c => c.id === p.classId);
      if (!cls) continue;
      if (!entriesByClass.has(cls.id)) entriesByClass.set(cls.id, this.source.entries(competition.id, cls.id));
      const entries = await entriesByClass.get(cls.id)!;
      const entry = entries.find(e => e.id === p.entryId);
      if (!entry || STATUS_CODES[entry.status] === null) continue;
      const leg = cls.kind === 'relay' ? entry.team?.leg : undefined;
      const className = leg ? `${cls.name}-${leg}` : cls.name;
      let result = resultsByName.get(className);
      if (!result) {
        result = this.buildResult(competition, cls, leg, className, entries.filter(e => (leg ? e.team?.leg === leg : true)));
        resultsByName.set(className, result);
      }
      const control = cls.radioControls.find(c => c.id === p.controlId);
      if (!control) continue;
      const code = splitCode(control);
      const name = entry.name?.full ?? '';
      const club = entry.team ? entry.team.name : (entry.club?.short || entry.club?.name || '');
      const row = result.results.find(r => r.name === name && r.club === club);
      const time = Number(row?.splits?.[String(code)]) || 0;
      const local = p.at + timeZoneOffsetMs(p.at, tz);
      const d = new Date(local);
      out.push({
        passtime: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
        runnerName: name,
        club,
        class: className,
        control: String(code),
        controlName: control.name || `Control ${control.code ?? control.id}`,
        time: time ? formatDuration(time) : '',
        place: Number(row?.splits?.[`${code}_place`]) || 0,
        ...(entry.bib ? { bib: entry.bib } : {}),
        ...(row?.splits?.[`${code}_timeplus`] !== undefined ? { timeplus: Number(row.splits[`${code}_timeplus`]) } : {})
      });
    }
    return out;
  }
}

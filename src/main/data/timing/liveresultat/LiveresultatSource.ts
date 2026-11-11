/**
 * Liveresultat as a timing source.
 *
 * Liveresultat is an official results service: its places, ties, time behind, split standings
 * and order are what the public sees, so they are passed on as the source's standings and
 * Split Control shows them unchanged.
 *
 * - Times: hundredths -> ms. Start times: hundredths since local midnight of the competition
 *   day (zone, or Swedish time + timediff) -> epoch ms.
 * - Relays: Liveresultat lists every leg as its own class ("Mixed-1", "Mixed-2" …) with times
 *   from the team's start. Legs 1..N of the same name become one relay class; the team is
 *   the club column. A team's start is its runner's changeover minus the team's time at the
 *   end of the previous leg (start times can differ between leg classes: the JWOC 2026 Sprint
 *   Relay has legs 1–2 nine hours off legs 3–4, but agree within a leg); a team without a
 *   previous-leg time (a restart) falls back to its start on leg 1.
 * - Push (REST): the classes Split Control polls are subscribed to; a change refetches the
 *   class at once, bypassing the CDN cache.
 */

import type { ClassInfo, Competition, Control, Entry, Passing, PluginContext, TimingSource } from '../../../../shared/timing-sdk';
import { instantOfWallClock, statusFromCode, type CompetitionInfo } from '../model';
import { LiveresultatApi, type LiveresultatApiOptions } from './api';
import type { LrClassResult, LrCompetition, LrResult } from './wire';

const LEG = /^(.*\S)\s*-(\d+)$/;

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Relay classes: base name -> leg class names in order (legs 1..N all present) */
export function groupRelayLegs(names: string[]): Map<string, string[]> {
  const byBase = new Map<string, Map<number, string>>();
  for (const name of names) {
    const m = LEG.exec(name);
    if (!m || name !== `${m[1]}-${m[2]}`) continue;
    if (!byBase.has(m[1])) byBase.set(m[1], new Map());
    byBase.get(m[1])!.set(Number(m[2]), name);
  }
  const out = new Map<string, string[]>();
  for (const [base, legs] of byBase) {
    const n = Math.max(...legs.keys());
    if (n >= 1 && [...Array(n)].every((_, i) => legs.has(i + 1)) && !names.includes(base)) {
      out.set(base, [...Array(n)].map((_, i) => legs.get(i + 1)!));
    }
  }
  return out;
}

export class LiveresultatSource implements TimingSource {
  readonly api: LiveresultatApi;
  private info = new Map<string, CompetitionInfo>();
  private relays = new Map<string, Map<string, string[]>>();
  private lastRaw = new Map<string, LrClassResult[]>();
  private pushVer = new Map<string, number>();
  /** Relay legs fetched recently: polls of the other legs reuse them for one poll interval */
  private legCache = new Map<string, { at: number; data: LrClassResult }>();

  constructor(options: LiveresultatApiOptions, private readonly ctx?: PluginContext) {
    this.api = new LiveresultatApi(options);
  }

  // --- TimingSource ----------------------------------------------------------------------

  async connect(): Promise<void> {
    await this.api.competitions();
  }

  close(): void {
    this.api.close();
  }

  minPollMs(): number {
    return this.api.minPollMs();
  }

  clockOffsetMs(): Promise<number> {
    return this.api.clockOffsetMs();
  }

  describe(competitionId?: string) {
    return { api: this.api.flavor, pushConnected: competitionId ? this.api.isPushConnected(Number(competitionId)) : false };
  }

  private competitionOf(c: LrCompetition): Competition {
    const competition: Competition = {
      id: String(c.id),
      name: c.name ?? '',
      date: c.date ?? '',
      organiser: c.organizer ?? '',
      ...(c.timezone ? { timezone: c.timezone } : {}),
      ...(Number(c.timediff) ? { clockShiftHours: Number(c.timediff) } : {})
    };
    this.info.set(competition.id, {
      id: c.id, sourceId: competition.id, name: competition.name, organiser: competition.organiser ?? '',
      date: competition.date, timezone: competition.timezone, timediffHours: competition.clockShiftHours ?? 0
    });
    return competition;
  }

  async competitions(): Promise<Competition[]> {
    return (await this.api.competitions()).map(c => this.competitionOf(c));
  }

  async competition(competitionId: string): Promise<Competition> {
    return this.competitionOf(await this.api.competitionInfo(Number(competitionId)));
  }

  private async clockOf(competitionId: string): Promise<CompetitionInfo> {
    return this.info.get(competitionId) ?? (await this.competition(competitionId), this.info.get(competitionId)!);
  }

  async classes(competitionId: string): Promise<ClassInfo[]> {
    const names = await this.api.classes(Number(competitionId));
    const relays = groupRelayLegs(names);
    this.relays.set(competitionId, relays);
    const legOf = new Map<string, string>();
    for (const [base, legs] of relays) for (const l of legs) legOf.set(l, base);
    const out: ClassInfo[] = [];
    for (const name of names) {
      const base = legOf.get(name);
      if (base === undefined) out.push({ id: name, name, kind: 'individual', radioControls: [] });
      else if (relays.get(base)![0] === name) out.push({ id: base, name: base, kind: 'relay', legs: relays.get(base)!.length, radioControls: [] });
    }
    return out;
  }

  private async raw(competitionId: string, className: string): Promise<LrClassResult> {
    const key = `${competitionId}|${className}`;
    const ver = this.pushVer.get(key);
    this.pushVer.delete(key);
    return this.api.classResult(Number(competitionId), className, ver);
  }

  async entries(competitionId: string, classId: string): Promise<Entry[]> {
    const info = await this.clockOf(competitionId);
    const legs = this.relays.get(competitionId)?.get(classId);
    if (!legs) {
      const raw = await this.raw(competitionId, classId);
      this.lastRaw.set(`${competitionId}|${classId}`, [raw]);
      return this.individual(info, classId, raw);
    }
    const raws: LrClassResult[] = [];
    for (const leg of legs) {
      const key = `${competitionId}|${leg}`;
      const cached = this.legCache.get(key);
      if (cached && !this.pushVer.has(key) && Date.now() - cached.at < this.api.minPollMs()) {
        raws.push(cached.data);
        continue;
      }
      const data = await this.raw(competitionId, leg);
      this.legCache.set(key, { at: Date.now(), data });
      raws.push(data);
    }
    this.lastRaw.set(`${competitionId}|${classId}`, raws);
    return this.relay(info, classId, raws);
  }

  async classDetails(competitionId: string, classId: string) {
    const raws = this.lastRaw.get(`${competitionId}|${classId}`) ?? [];
    const relay = this.relays.get(competitionId)?.has(classId);
    const radioControls: Control[] = raws.flatMap((raw, i) => (raw.splitcontrols ?? []).map(c => {
      const key = Number(typeof c === 'object' ? c.code : c);
      return {
        id: String(key),
        ...(key >= 1000 ? { code: key % 1000, visit: Math.floor(key / 1000) } : { code: key }),
        name: typeof c === 'object' && c.name ? String(c.name) : `Control ${key}`,
        ...(relay ? { leg: i + 1 } : {})
      };
    }));
    return { radioControls };
  }

  watch(competitionId: string, classIds: string[]): void {
    const relays = this.relays.get(competitionId);
    const tabs = classIds.flatMap(id => relays?.get(id) ?? [id]);
    const classOf = (tab: string) => {
      for (const [base, legs] of relays ?? []) if (legs.includes(tab)) return base;
      return tab;
    };
    this.api.subscribe(Number(competitionId), tabs, (changed, ver) => {
      for (const tab of changed) {
        this.pushVer.set(`${competitionId}|${tab}`, ver);
        this.ctx?.changed(competitionId, classOf(tab));
      }
    });
  }

  // --- conversion ------------------------------------------------------------------------

  /** Places as Liveresultat publishes them: "1", "=" (same as the one before), "-" / "" */
  private standings(rows: LrResult[]) {
    let last: number | undefined;
    return rows.map(r => {
      const p = String(r.place ?? '');
      if (/^\d+$/.test(p)) { last = Number(p); return { place: last, tied: false }; }
      if (p === '=') return { place: last, tied: true };
      return { place: undefined, tied: false };
    });
  }

  private passingsOf(r: LrResult, controls: LrClassResult['splitcontrols'], team: boolean): Passing[] {
    const out: Passing[] = [];
    for (const c of controls ?? []) {
      const key = Number(typeof c === 'object' ? c.code : c);
      const t = num(r.splits?.[String(key)]);
      if (t === undefined || t <= 0) continue;
      const status = num(r.splits?.[`${key}_status`]);
      const place = num(r.splits?.[`${key}_place`]);
      const behind = num(r.splits?.[`${key}_timeplus`]);
      out.push({
        controlId: String(key),
        ...(team ? { teamTime: t * 10 } : { time: t * 10 }),
        standing: {
          ...(status !== undefined ? { status: statusFromCode(status) } : {}),
          ...(place !== undefined ? { place } : {}),
          ...(behind !== undefined ? { behind: behind * 10 } : {})
        }
      });
    }
    return out;
  }

  private entry(info: CompetitionInfo, classId: string, r: LrResult, i: number, standing: { place?: number; tied: boolean }, team?: { leg: number; start?: number }): Entry {
    const result = num(r.result);
    const behind = num(r.timeplus);
    const start = num(r.start);
    const club = String(r.club ?? '');
    return {
      id: r.dbId !== undefined ? `${team ? team.leg + ':' : ''}${r.dbId}` : `${team ? team.leg + ':' : ''}${i}:${r.name}|${club}`,
      classId,
      name: { full: String(r.name ?? '') },
      club: { name: club },
      ...(r.bib ? { bib: String(r.bib) } : {}),
      ...(r.country ? { country: String(r.country) } : {}),
      status: statusFromCode(Number(r.status)),
      ...(start && start > 0 ? { start: instantOfWallClock(info, start) } : {}),
      ...(!team && result !== undefined ? { time: result * 10 } : {}),
      passings: this.passingsOf(r, [], !!team),
      ...(team ? {
        team: {
          id: club,
          name: club,
          leg: team.leg,
          ...(team.start ? { start: team.start } : {}),
          ...(result !== undefined ? { time: result * 10 } : {})
        }
      } : {}),
      standing: {
        ...(standing.place !== undefined ? { place: standing.place } : {}),
        ...(standing.tied ? { tied: true } : {}),
        ...(behind !== undefined ? { behind: behind * 10 } : {}),
        progress: Number(r.progress) || 0
      }
    };
  }

  private individual(info: CompetitionInfo, classId: string, raw: LrClassResult): Entry[] {
    const rows = raw.results ?? [];
    const places = this.standings(rows);
    return rows.map((r, i) => ({ ...this.entry(info, classId, r, i, places[i]), passings: this.passingsOf(r, raw.splitcontrols, false) }));
  }

  /** Every leg; team starts worked out leg by leg (hundredths since midnight) */
  private relay(info: CompetitionInfo, classId: string, raws: LrClassResult[]): Entry[] {
    const out: Entry[] = [];
    raws.forEach((raw, i) => {
      const leg = i + 1;
      const rows = raw.results ?? [];
      const starts = teamStartsOfLeg(raws, i);
      const places = this.standings(rows);
      rows.forEach((r, j) => {
        const cs = starts.get(String(r.club ?? ''));
        const teamStart = cs !== undefined ? instantOfWallClock(info, cs) : undefined;
        out.push({
          ...this.entry(info, classId, r, j, places[j], { leg, start: teamStart }),
          passings: this.passingsOf(r, raw.splitcontrols, true)
        });
      });
    });
    return out;
  }
}

/**
 * Relays: each team's start on leg i+1 (hundredths since midnight), by team (club column).
 * A runner's changeover minus the team's time at the end of the previous leg; teams without
 * one fall back to their start on leg 1. A team start after the runner's own start can't be
 * right and is left out. Empty on leg 1 (the runner's own start is the team's).
 */
export function teamStartsOfLeg(raws: Pick<LrClassResult, 'results'>[], i: number): Map<string, number> {
  const starts = new Map<string, number>();
  if (i < 1) return starts;
  const rows = raws[i]?.results ?? [];
  const before = new Map<string, number>();
  for (const r of raws[i - 1]?.results ?? []) {
    if (r.club && Number(r.status) === 0 && Number(r.result) > 0) before.set(String(r.club), Number(r.result));
  }
  const missing: string[] = [];
  for (const r of rows) {
    const club = String(r.club ?? ''), start = Number(r.start), b = before.get(club);
    if (!club) continue;
    if (start > 0 && b) starts.set(club, start - b);
    else missing.push(club);
  }
  for (const r of raws[0]?.results ?? []) {
    const club = String(r.club ?? '');
    if (missing.includes(club) && Number(r.start) > 0) starts.set(club, Number(r.start));
  }
  for (const r of rows) {
    const t = starts.get(String(r.club ?? ''));
    if (t && Number(r.start) > 0 && t > Number(r.start)) starts.delete(String(r.club));
  }
  return starts;
}

export function createLiveresultatSource(config: Record<string, unknown>, ctx?: PluginContext): LiveresultatSource {
  return new LiveresultatSource({
    baseUrl: String(config.baseUrl ?? 'https://api.orienteering.services'),
    timeout: num(config.timeout),
    api: (config.api as LiveresultatApiOptions['api']) ?? 'auto',
    localPollFloorMs: num(config.localPollFloorMs),
    push: config.push as boolean | undefined,
    pushUrl: config.pushUrl as string | undefined,
    retryAttempts: num(config.retryAttempts)
  }, ctx);
}

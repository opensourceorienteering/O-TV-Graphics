/**
 * MeOS Online Protocol (MOP) database backend
 *
 * Reads the MySQL/MariaDB schema written by a MOP receiver (MeOS "Result online" with
 * "MeOS Online Protocol XML 2.0" posted to a receiver that stores mopCompetition,
 * mopClass, mopCompetitor, mopRadio, mopTeam, ...) and returns LiveResults-shaped data,
 * so templates, the transformer and the live update loop work exactly as with Liveresultat.
 *
 * MOP conventions (MeOS source, code/oBase.h and the MOP spec):
 *  - Times are tenths of a second. Start times count from 00:00:00 of the competition day.
 *    LiveResults uses hundredths, so every time is multiplied by 10.
 *  - Runner status: 0 unknown, 1 OK, 2 no timing, 3 MP, 4 DNF, 5 DQ, 6 overtime (MAX),
 *    15 out of competition, 20 DNS, 21 cancelled, 99 not competing.
 *  - Relays: mopTeam (team start/time/status) + mopTeamMember (leg, ord, runner id).
 *    Like Liveresultat, each relay leg becomes its own class "<Class>-<leg>" with
 *    team-perspective times (time since the team's start) and the team name as club.
 *  - Radio controls: mopClassControl lists a class's radio controls per leg, in order;
 *    mopRadio holds each runner's running time at a control.
 *    Split codes follow LiveResults: 1000 + control id for the first passing.
 */

import type { LiveResultsBackend } from '../LiveResultsClient';
import type {
  LiveResultsClass,
  LiveResultsClassResult,
  LiveResultsCompetition,
  LiveResultsCompetitionInfo,
  LiveResultsSplitControl
} from '../../../shared/types/liveresults';
import { buildClassResult, ResultRow } from './resultBuilder';

export type MopQuery = (sql: string, params?: unknown[]) => Promise<any[]>;

/** MeOS runner status -> LiveResults status code. null = leave the row out. */
export function mopStatusToLiveResults(stat: number, hasPassings: boolean): number | null {
  switch (stat) {
    case 1: return 0;    // OK
    case 2: return 20;   // no timing -> approved without time
    case 3: return 3;    // mispunch
    case 4: return 2;    // DNF
    case 5: return 4;    // disqualified
    case 6: return 5;    // overtime
    case 15: return 0;   // out of competition: shown, but never ranked
    case 20: return 1;   // DNS
    case 21: return 11;  // cancelled ("återbud" / walkover in LiveResults)
    case 99: return null; // not competing
    default: return hasPassings ? 10 : 9; // unknown: running if punched anywhere, else not started
  }
}

/**
 * LiveResults split code for a MOP control id. MeOS numbers the n-th visit to a control
 * as control + 100000 * (n - 1); LiveResults uses n * 1000 + control.
 */
export function mopSplitCode(ctrl: number): number {
  const control = ctrl % 100000;
  const visit = Math.floor(ctrl / 100000) + 1;
  return control < 1000 ? visit * 1000 + control : ctrl;
}

const tenthsToHundredths = (t: number | null | undefined): number => (t && t > 0 ? t * 10 : 0);


export class MopBackend implements LiveResultsBackend {
  readonly name = 'mop';
  readonly minPollIntervalMs: number;

  constructor(
    private readonly query: MopQuery,
    private readonly options: { timezone?: string; minPollIntervalMs?: number } = {}
  ) {
    this.minPollIntervalMs = Math.max(1000, options.minPollIntervalMs ?? 2000);
  }

  async fetchCompetitions(): Promise<LiveResultsCompetition[]> {
    const rows = await this.query(
      'SELECT cid, name, date, organizer FROM mopCompetition WHERE id = 1 ORDER BY date DESC'
    );
    return rows.map(r => ({
      id: Number(r.cid),
      name: r.name,
      organizer: r.organizer || '',
      date: toDateString(r.date),
      timediff: 0
    }));
  }

  async fetchCompetitionInfo(competitionId: number): Promise<LiveResultsCompetitionInfo> {
    const rows = await this.query(
      'SELECT cid, name, date, organizer FROM mopCompetition WHERE cid = ? AND id = 1',
      [competitionId]
    );
    if (!rows.length) throw new Error(`MOP competition ${competitionId} not found`);
    return {
      id: competitionId,
      name: rows[0].name,
      organizer: rows[0].organizer || '',
      date: toDateString(rows[0].date),
      timediff: 0,
      timezone: this.options.timezone
    };
  }

  async fetchClasses(competitionId: number): Promise<LiveResultsClass[]> {
    const classes = await this.query('SELECT id, name, ord FROM mopClass WHERE cid = ? ORDER BY ord, name', [competitionId]);
    const legs = await this.query(
      `SELECT t.cls AS cls, MAX(m.leg) AS legs
         FROM mopTeam t JOIN mopTeamMember m ON m.cid = t.cid AND m.id = t.id
        WHERE t.cid = ? GROUP BY t.cls`,
      [competitionId]
    );
    const legsByClass = new Map(legs.map(l => [Number(l.cls), Number(l.legs)]));
    const out: LiveResultsClass[] = [];
    for (const c of classes) {
      const n = legsByClass.get(Number(c.id));
      if (n && n > 0) {
        for (let leg = 1; leg <= n; leg++) out.push({ className: `${c.name}-${leg}` });
      } else {
        out.push({ className: c.name });
      }
    }
    return out;
  }

  async fetchClassResults(competitionId: number, className: string): Promise<LiveResultsClassResult> {
    const { classId, leg } = await this.resolveClass(competitionId, className);
    const controls = await this.radioControls(competitionId, classId, leg ?? 1);
    const rows = leg
      ? await this.relayLegRows(competitionId, classId, leg)
      : await this.individualRows(competitionId, classId);
    return buildClassResult(className, controls, rows);
  }

  // --- internals -------------------------------------------------------------

  private async resolveClass(competitionId: number, className: string): Promise<{ classId: number; leg?: number }> {
    const exact = await this.query('SELECT id FROM mopClass WHERE cid = ? AND name = ?', [competitionId, className]);
    if (exact.length) return { classId: Number(exact[0].id) };
    const m = /^(.*)-(\d+)$/.exec(className);
    if (m) {
      const base = await this.query('SELECT id FROM mopClass WHERE cid = ? AND name = ?', [competitionId, m[1]]);
      if (base.length) return { classId: Number(base[0].id), leg: Number(m[2]) };
    }
    throw new Error(`MOP class not found: ${className}`);
  }

  private async radioControls(competitionId: number, classId: number, leg: number): Promise<LiveResultsSplitControl[]> {
    const rows = await this.query(
      `SELECT cc.ctrl AS ctrl, c.name AS name
         FROM mopClassControl cc
         LEFT JOIN mopControl c ON c.cid = cc.cid AND c.id = cc.ctrl
        WHERE cc.cid = ? AND cc.id = ? AND cc.leg = ?
        ORDER BY cc.ord`,
      [competitionId, classId, leg]
    );
    return rows.map(r => ({ code: mopSplitCode(Number(r.ctrl)), name: r.name || `Control ${r.ctrl}` }));
  }

  private async radiosFor(competitionId: number, runnerIds: number[]): Promise<Map<number, Map<number, number>>> {
    const byRunner = new Map<number, Map<number, number>>();
    if (!runnerIds.length) return byRunner;
    const placeholders = runnerIds.map(() => '?').join(',');
    const radios = await this.query(
      `SELECT id, ctrl, rt FROM mopRadio WHERE cid = ? AND id IN (${placeholders})`,
      [competitionId, ...runnerIds]
    );
    for (const r of radios) {
      const id = Number(r.id);
      if (!byRunner.has(id)) byRunner.set(id, new Map());
      byRunner.get(id)!.set(mopSplitCode(Number(r.ctrl)), tenthsToHundredths(Number(r.rt)));
    }
    return byRunner;
  }

  private async individualRows(competitionId: number, classId: number): Promise<ResultRow[]> {
    const competitors = await this.query(
      `SELECT c.id, c.name, c.bib, c.stat, c.st, c.rt, o.name AS club
         FROM mopCompetitor c
         LEFT JOIN mopOrganization o ON o.cid = c.cid AND o.id = c.org
        WHERE c.cid = ? AND c.cls = ?`,
      [competitionId, classId]
    );
    const radios = await this.radiosFor(competitionId, competitors.map(c => Number(c.id)));
    const rows: ResultRow[] = [];
    for (const c of competitors) {
      const splits = radios.get(Number(c.id)) ?? new Map();
      const status = mopStatusToLiveResults(Number(c.stat), splits.size > 0);
      if (status === null) continue;
      rows.push({
        key: `r${c.id}`,
        name: c.name,
        club: c.club || '',
        bib: c.bib || undefined,
        status,
        ranked: Number(c.stat) !== 15,
        start: tenthsToHundredths(Number(c.st)),
        result: status === 0 ? tenthsToHundredths(Number(c.rt)) : 0,
        splits
      });
    }
    return rows;
  }

  /** Leg L of a relay class, timed from the team's start (team perspective) */
  private async relayLegRows(competitionId: number, classId: number, leg: number): Promise<ResultRow[]> {
    const members = await this.query(
      `SELECT t.id AS team, t.name AS teamName, t.bib AS teamBib, t.st AS teamStart,
              c.id AS rid, c.name, c.stat, c.st, c.rt, c.bib
         FROM mopTeam t
         JOIN mopTeamMember m ON m.cid = t.cid AND m.id = t.id AND m.leg = ? AND m.ord = 0
         JOIN mopCompetitor c ON c.cid = t.cid AND c.id = m.rid
        WHERE t.cid = ? AND t.cls = ?`,
      [leg, competitionId, classId]
    );
    const radios = await this.radiosFor(competitionId, members.map(m => Number(m.rid)));
    const rows: ResultRow[] = [];
    for (const m of members) {
      const teamStart = tenthsToHundredths(Number(m.teamStart));
      const runnerStart = tenthsToHundredths(Number(m.st)) || teamStart;
      const offset = Math.max(0, runnerStart - teamStart); // time the team had used before this leg
      const own = radios.get(Number(m.rid)) ?? new Map<number, number>();
      const status = mopStatusToLiveResults(Number(m.stat), own.size > 0);
      if (status === null) continue;
      const splits = new Map<number, number>();
      for (const [code, t] of own) if (t > 0) splits.set(code, t + offset);
      const runnerTime = tenthsToHundredths(Number(m.rt));
      rows.push({
        key: `t${m.team}`,
        name: m.name,
        club: m.teamName,
        bib: m.bib || m.teamBib || undefined,
        status,
        ranked: Number(m.stat) !== 15,
        start: runnerStart,
        ...(teamStart ? { teamStart } : {}),
        result: status === 0 && runnerTime > 0 ? runnerTime + offset : 0,
        splits
      });
    }
    return rows;
  }


}

function toDateString(d: unknown): string {
  if (d instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return String(d ?? '').slice(0, 10);
}

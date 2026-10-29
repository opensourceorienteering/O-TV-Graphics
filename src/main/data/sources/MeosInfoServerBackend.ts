/**
 * MeOS information server backend
 *
 * Reads live data straight from MeOS: enable the information server in MeOS
 * (Services > Information server, default port 2009) and point this backend at it.
 * No MOP receiver or database is needed.
 *
 * Protocol (MeOS source, code/restserver.cpp and code/infoserver.cpp):
 *  - GET /meos?difference=zero returns <MOPComplete nextdifference="N">; afterwards
 *    GET /meos?difference=N returns <MOPDiff nextdifference="M"> with only what changed.
 *    Asking for the same N again returns the same diff, so a failed request can be retried.
 *    An unknown N returns an "Error (MeOS): Unknown difference state" text; start over at zero.
 *  - Elements: competition, ctrl, cls (radio="31,32;33" = radio controls per relay leg),
 *    org, tm (base + r="12,13;14" = runner ids per leg) and cmp (base + radio="31,3450;..."
 *    + input). Deleted items arrive as <cmp id="5" delete="true"/>.
 *  - Times are tenths of a second; start times count from 00:00:00. st=-1 means no start time.
 *  - A repeated control's id is control + 100000 * repeat (see mopSplitCode).
 *
 * The data is kept in memory and turned into LiveResults-shaped results with the same rules
 * as the MOP database backend, so templates and the live loop behave identically.
 */

import { XMLParser } from 'fast-xml-parser';
import type { LiveResultsBackend } from '../LiveResultsClient';
import type {
  LiveResultsClass,
  LiveResultsClassResult,
  LiveResultsCompetition,
  LiveResultsCompetitionInfo,
  LiveResultsSplitControl
} from '../../../shared/types/liveresults';
import { buildClassResult, ResultRow } from './resultBuilder';
import { mopSplitCode, mopStatusToLiveResults } from './MopBackend';

export interface MeosInfoServerBackendOptions {
  /** Competition id Split Control uses for this MeOS event (default 1) */
  competitionId?: number;
  /** IANA time zone of the event (default Europe/Stockholm) */
  timezone?: string;
  /** Minimum poll interval (ms, default 1000) */
  minPollIntervalMs?: number;
  /** Request timeout (ms, default 5000) */
  timeoutMs?: number;
  /** For tests */
  fetchImpl?: typeof fetch;
}

interface MeosClass { name: string; ord: number; radio: number[][] }
interface MeosBase { org: number; cls: number; stat: number; st: number; rt: number; bib: string; nat: string; name: string }
interface MeosCompetitor extends MeosBase { card: number; radio: Map<number, number> }
interface MeosTeam extends MeosBase { legs: number[][] }

const ARRAY_TAGS = new Set(['ctrl', 'cls', 'org', 'cmp', 'tm']);

const text = (v: any): string => (v === undefined || v === null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const int = (v: any, fallback = 0): number => {
  const n = parseInt(text(v), 10);
  return Number.isFinite(n) ? n : fallback;
};
const tenthsToHundredths = (t: number): number => (t > 0 ? t * 10 : 0);

/** "31,32;33" -> [[31, 32], [33]] */
function packedIntInt(s: string): number[][] {
  if (!s) return [];
  return s.split(';').map(group => group.split(',').map(v => parseInt(v, 10)).filter(Number.isFinite));
}

export class MeosInfoServerBackend implements LiveResultsBackend {
  readonly name = 'meos';
  readonly minPollIntervalMs: number;
  private readonly competitionId: number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: name => ARRAY_TAGS.has(name)
  });

  private difference = 'zero';
  private lastSync = 0;
  private syncing: Promise<void> | null = null;
  private hasData = false;

  private competition = { name: '', date: '', organizer: '', zeroTime: '' };
  private controls = new Map<number, string>();
  private classes = new Map<number, MeosClass>();
  private orgs = new Map<number, { name: string; nat: string }>();
  private competitors = new Map<number, MeosCompetitor>();
  private teams = new Map<number, MeosTeam>();

  constructor(private readonly url: string, private readonly options: MeosInfoServerBackendOptions = {}) {
    this.competitionId = options.competitionId ?? 1;
    this.minPollIntervalMs = Math.max(500, options.minPollIntervalMs ?? 1000);
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Base URL plus /meos, accepting "localhost:2009", "http://host:2009" or ".../meos" */
  get endpoint(): string {
    let base = this.url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
    return /\/meos$/i.test(base) ? base : `${base}/meos`;
  }

  async fetchCompetitions(): Promise<LiveResultsCompetition[]> {
    await this.sync();
    const c = this.competition;
    return [{ id: this.competitionId, name: c.name || 'MeOS', organizer: c.organizer, date: c.date, timediff: 0 }];
  }

  async fetchCompetitionInfo(competitionId: number): Promise<LiveResultsCompetitionInfo> {
    this.assertCompetition(competitionId);
    await this.sync();
    const c = this.competition;
    return { id: competitionId, name: c.name || 'MeOS', organizer: c.organizer, date: c.date, timediff: 0, timezone: this.options.timezone };
  }

  async fetchClasses(competitionId: number): Promise<LiveResultsClass[]> {
    this.assertCompetition(competitionId);
    await this.sync();
    const legsByClass = this.relayLegCounts();
    const out: LiveResultsClass[] = [];
    const sorted = [...this.classes].sort((a, b) => a[1].ord - b[1].ord || a[1].name.localeCompare(b[1].name));
    for (const [id, cls] of sorted) {
      const legs = legsByClass.get(id);
      if (legs) for (let leg = 1; leg <= legs; leg++) out.push({ className: `${cls.name}-${leg}` });
      else out.push({ className: cls.name });
    }
    return out;
  }

  async fetchClassResults(competitionId: number, className: string): Promise<LiveResultsClassResult> {
    this.assertCompetition(competitionId);
    await this.sync();
    const { classId, leg } = this.resolveClass(className);
    const cls = this.classes.get(classId)!;
    const radio = cls.radio[(leg ?? 1) - 1] ?? cls.radio[0] ?? [];
    const controls: LiveResultsSplitControl[] = radio.map(id => ({
      code: mopSplitCode(id),
      name: this.controls.get(id) || `Control ${id % 100000}`
    }));
    const rows = leg ? this.relayLegRows(classId, leg) : this.individualRows(classId);
    return buildClassResult(className, controls, rows);
  }

  // --- sync ------------------------------------------------------------------------------

  /**
   * Bring the in-memory copy up to date. Calls made while a request is running share it,
   * and calls shortly after one reuse it, so polling several classes costs one request.
   */
  private sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    if (this.hasData && Date.now() - this.lastSync < this.minPollIntervalMs / 2) return Promise.resolve();
    this.syncing = this.pull().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async pull(): Promise<void> {
    let body = await this.get(this.difference);
    if (/^\s*Error/i.test(body) && this.difference !== 'zero') {
      // MeOS restarted or forgot our state: start over with a complete copy
      this.difference = 'zero';
      body = await this.get('zero');
    }
    this.apply(body);
    this.lastSync = Date.now();
  }

  private async get(difference: string): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.endpoint}?difference=${encodeURIComponent(difference)}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`MeOS information server: HTTP ${res.status}`);
      return await res.text();
    } catch (error) {
      if (ctrl.signal.aborted) throw new Error(`MeOS information server did not answer within ${this.timeoutMs} ms (${this.endpoint})`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Apply a MOPComplete or MOPDiff document */
  apply(xml: string): void {
    const doc = this.parser.parse(xml);
    const complete = doc.MOPComplete;
    const root = complete ?? doc.MOPDiff;
    if (root === undefined) {
      throw new Error(/^\s*Error/i.test(xml) ? xml.trim() : 'Not a MeOS MOP document (expected MOPComplete or MOPDiff)');
    }
    const node = typeof root === 'object' ? root : {};
    if (complete !== undefined) {
      this.controls.clear();
      this.classes.clear();
      this.orgs.clear();
      this.competitors.clear();
      this.teams.clear();
    }

    if (node.competition !== undefined) {
      const c = node.competition;
      this.competition = {
        name: text(c),
        date: text(c['@_date']),
        organizer: text(c['@_organizer']),
        zeroTime: text(c['@_zerotime'])
      };
    }

    for (const e of node.ctrl ?? []) {
      const id = int(e['@_id']);
      if (e['@_delete'] === 'true') this.controls.delete(id);
      else this.controls.set(id, text(e));
    }
    for (const e of node.cls ?? []) {
      const id = int(e['@_id']);
      if (e['@_delete'] === 'true') this.classes.delete(id);
      else this.classes.set(id, { name: text(e), ord: int(e['@_ord']), radio: packedIntInt(text(e['@_radio'])) });
    }
    for (const e of node.org ?? []) {
      const id = int(e['@_id']);
      if (e['@_delete'] === 'true') this.orgs.delete(id);
      else this.orgs.set(id, { name: text(e), nat: text(e['@_nat']) });
    }
    for (const e of node.tm ?? []) {
      const id = int(e['@_id']);
      if (e['@_delete'] === 'true') { this.teams.delete(id); continue; }
      this.teams.set(id, { ...this.base(e.base), legs: packedIntInt(text(e.r)) });
    }
    for (const e of node.cmp ?? []) {
      const id = int(e['@_id']);
      if (e['@_delete'] === 'true') { this.competitors.delete(id); continue; }
      const previous = this.competitors.get(id);
      const radio = new Map<number, number>();
      // A diff always carries the full radio list when there is one, so a missing list means none
      for (const [ctrl, rt] of packedIntInt(text(e.radio))) {
        if (Number.isFinite(ctrl) && rt > 0) radio.set(ctrl, rt);
      }
      this.competitors.set(id, {
        ...this.base(e.base),
        card: e['@_card'] !== undefined ? int(e['@_card']) : previous?.card ?? 0,
        radio
      });
    }

    this.difference = text(node['@_nextdifference']) || this.difference;
    this.hasData = true;
  }

  private base(b: any): MeosBase {
    return {
      org: int(b?.['@_org']),
      cls: int(b?.['@_cls']),
      stat: int(b?.['@_stat']),
      st: int(b?.['@_st'], -1),
      rt: int(b?.['@_rt']),
      bib: text(b?.['@_bib']),
      nat: text(b?.['@_nat']),
      name: text(b)
    };
  }

  // --- results ---------------------------------------------------------------------------

  private assertCompetition(competitionId: number) {
    if (competitionId !== this.competitionId) {
      throw new Error(`Unknown competition ${competitionId} (this MeOS source is ${this.competitionId})`);
    }
  }

  private relayLegCounts(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const t of this.teams.values()) {
      if (t.legs.length) counts.set(t.cls, Math.max(counts.get(t.cls) ?? 0, t.legs.length));
    }
    return counts;
  }

  private resolveClass(className: string): { classId: number; leg?: number } {
    const byName = (name: string) => [...this.classes].find(([, c]) => c.name === name)?.[0];
    const exact = byName(className);
    if (exact !== undefined && !this.relayLegCounts().has(exact)) return { classId: exact };
    const m = /^(.*)-(\d+)$/.exec(className);
    if (m) {
      const base = byName(m[1]);
      if (base !== undefined) return { classId: base, leg: Number(m[2]) };
    }
    if (exact !== undefined) return { classId: exact };
    throw new Error(`MeOS class not found: ${className}`);
  }

  private splitsOf(c: MeosCompetitor, offset = 0): Map<number, number> {
    const splits = new Map<number, number>();
    for (const [ctrl, rt] of c.radio) splits.set(mopSplitCode(ctrl), tenthsToHundredths(rt) + offset);
    return splits;
  }

  private individualRows(classId: number): ResultRow[] {
    const rows: ResultRow[] = [];
    for (const [id, c] of this.competitors) {
      if (c.cls !== classId) continue;
      const status = mopStatusToLiveResults(c.stat, c.radio.size > 0);
      if (status === null) continue;
      rows.push({
        key: `r${id}`,
        name: c.name,
        club: this.orgs.get(c.org)?.name ?? '',
        bib: c.bib || undefined,
        country: c.nat || this.orgs.get(c.org)?.nat || undefined,
        status,
        ranked: c.stat !== 15,
        start: tenthsToHundredths(c.st),
        result: status === 0 ? tenthsToHundredths(c.rt) : 0,
        splits: this.splitsOf(c)
      });
    }
    return rows;
  }

  /** Leg L of a relay class, timed from the team's start (team perspective) */
  private relayLegRows(classId: number, leg: number): ResultRow[] {
    const rows: ResultRow[] = [];
    for (const [teamId, t] of this.teams) {
      if (t.cls !== classId) continue;
      const runnerId = t.legs[leg - 1]?.[0];
      const c = runnerId ? this.competitors.get(runnerId) : undefined;
      if (!c) continue;
      const status = mopStatusToLiveResults(c.stat, c.radio.size > 0);
      if (status === null) continue;
      const teamStart = tenthsToHundredths(t.st);
      const runnerStart = tenthsToHundredths(c.st) || teamStart;
      const offset = teamStart ? Math.max(0, runnerStart - teamStart) : 0;
      const runnerTime = tenthsToHundredths(c.rt);
      rows.push({
        key: `t${teamId}`,
        name: c.name,
        club: t.name,
        bib: c.bib || t.bib || undefined,
        country: t.nat || this.orgs.get(t.org)?.nat || c.nat || undefined,
        status,
        ranked: c.stat !== 15,
        start: runnerStart,
        result: status === 0 && runnerTime > 0 ? runnerTime + offset : 0,
        splits: this.splitsOf(c, offset)
      });
    }
    return rows;
  }
}

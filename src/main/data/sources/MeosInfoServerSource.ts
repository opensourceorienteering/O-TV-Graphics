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
 * The data is kept in memory and reported as timing SDK facts with the same rules as the MOP
 * SQL profile; the core ranks them like every other source.
 */

import { XMLParser } from 'fast-xml-parser';
import type { ClassInfo, Competition, Control, Entry, TimingSource } from '../../../shared/timing-sdk';
import { meosClock, meosControl, meosStatus } from './meosCodes';

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

/** "31,32;33" -> [[31, 32], [33]] */
function packedIntInt(s: string): number[][] {
  if (!s) return [];
  return s.split(';').map(group => group.split(',').map(v => parseInt(v, 10)).filter(Number.isFinite));
}

/** The MeOS information server as a timing source */
export class MeosInfoServerSource implements TimingSource {
  readonly minPollIntervalMs: number;
  private readonly competitionId: string;
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

  private competitionInfo = { name: '', date: '', organizer: '', zeroTime: '' };
  private controls = new Map<number, string>();
  private classMap = new Map<number, MeosClass>();
  private orgs = new Map<number, { name: string; nat: string }>();
  private competitors = new Map<number, MeosCompetitor>();
  private teams = new Map<number, MeosTeam>();

  constructor(private readonly url: string, private readonly options: MeosInfoServerBackendOptions = {}) {
    this.competitionId = String(options.competitionId ?? 1);
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

  async connect(): Promise<void> {
    try {
      await this.sync(); // first complete download; fails early if MeOS is not reachable
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach the MeOS information server at ${this.endpoint}: ${reason}. ` +
        'In MeOS, start Services > Information server and check the port.');
    }
  }

  close(): void {
    this.hasData = false;
    this.difference = 'zero';
  }

  async competitions(): Promise<Competition[]> {
    await this.sync();
    const c = this.competitionInfo;
    return [{ id: this.competitionId, name: c.name || 'MeOS', organiser: c.organizer, date: c.date, timezone: this.options.timezone }];
  }

  async classes(competitionId: string): Promise<ClassInfo[]> {
    this.assertCompetition(competitionId);
    await this.sync();
    const legsByClass = this.relayLegCounts();
    const sorted = [...this.classMap].sort((a, b) => a[1].ord - b[1].ord || a[1].name.localeCompare(b[1].name));
    return sorted.map(([id, cls]) => {
      const legs = legsByClass.get(id);
      const radioControls: Control[] = [];
      if (legs) {
        for (let leg = 1; leg <= legs; leg++) {
          const radio = cls.radio[leg - 1] ?? cls.radio[0] ?? [];
          for (const ctrl of radio) radioControls.push(meosControl(ctrl, this.controls.get(ctrl), leg));
        }
      } else {
        for (const ctrl of cls.radio[0] ?? []) radioControls.push(meosControl(ctrl, this.controls.get(ctrl)));
      }
      return legs
        ? { id: String(id), name: cls.name, kind: 'relay' as const, legs, radioControls }
        : { id: String(id), name: cls.name, kind: 'individual' as const, radioControls };
    });
  }

  async entries(competitionId: string, classId: string): Promise<Entry[]> {
    this.assertCompetition(competitionId);
    await this.sync();
    const id = Number(classId);
    return this.relayLegCounts().has(id) ? this.relayEntries(id) : this.individualEntries(id);
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
      this.classMap.clear();
      this.orgs.clear();
      this.competitors.clear();
      this.teams.clear();
    }

    if (node.competition !== undefined) {
      const c = node.competition;
      this.competitionInfo = {
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
      if (e['@_delete'] === 'true') this.classMap.delete(id);
      else this.classMap.set(id, { name: text(e), ord: int(e['@_ord']), radio: packedIntInt(text(e['@_radio'])) });
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

  // --- entries ---------------------------------------------------------------------------

  private assertCompetition(competitionId: string) {
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

  private passingsOf(c: MeosCompetitor): Entry['passings'] {
    return [...c.radio].map(([ctrl, rt]) => ({ controlId: String(ctrl), time: rt * 100 }));
  }

  private individualEntries(classId: number): Entry[] {
    const clock = meosClock(this.competitionInfo.date, this.options.timezone);
    const out: Entry[] = [];
    for (const [id, c] of this.competitors) {
      if (c.cls !== classId) continue;
      const s = meosStatus(c.stat, c.radio.size > 0);
      const org = this.orgs.get(c.org);
      out.push({
        id: String(id),
        classId: String(classId),
        name: { full: c.name },
        club: { name: org?.name ?? '' },
        bib: c.bib || undefined,
        country: c.nat || org?.nat || undefined,
        status: s.status,
        ranked: s.ranked,
        start: clock(c.st),
        time: c.rt > 0 ? c.rt * 100 : undefined,
        passings: this.passingsOf(c)
      });
    }
    return out;
  }

  /** Every leg of a relay class; the core times them from the team's start */
  private relayEntries(classId: number): Entry[] {
    const clock = meosClock(this.competitionInfo.date, this.options.timezone);
    const out: Entry[] = [];
    for (const [teamId, t] of this.teams) {
      if (t.cls !== classId) continue;
      t.legs.forEach((runners, i) => {
        const runnerId = runners[0];
        const c = runnerId ? this.competitors.get(runnerId) : undefined;
        if (!c) return;
        const s = meosStatus(c.stat, c.radio.size > 0);
        out.push({
          id: String(runnerId),
          classId: String(classId),
          name: { full: c.name },
          bib: c.bib || undefined,
          country: t.nat || this.orgs.get(t.org)?.nat || c.nat || undefined,
          status: s.status,
          ranked: s.ranked,
          start: clock(c.st),
          time: c.rt > 0 ? c.rt * 100 : undefined,
          passings: this.passingsOf(c),
          team: { id: String(teamId), name: t.name, bib: t.bib || undefined, start: clock(t.st), leg: i + 1 }
        });
      });
    }
    return out;
  }
}

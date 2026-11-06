/**
 * IOF XML 3.0 file backend
 *
 * Reads an IOF XML 3.0 ResultList (or StartList) that timing software exports to disk, e.g.
 * OE/OS (SportSoftware), OLA, MeOS or Helga with "export every N seconds". Results come out
 * in the LiveResults shape, so templates, the transformer and the live loop work unchanged.
 *
 *  - The file is re-parsed only when its modification time or size changes.
 *  - Times: IOF <Time> is seconds (may have decimals); converted to hundredths.
 *  - Start times are ISO date-times with offsets; converted to hundredths since local
 *    midnight in the event time zone (option, default Europe/Stockholm).
 *  - Relays (TeamResult) become per-leg classes "<Class>-<leg>", like Liveresultat, with
 *    team-perspective times: OverallResult/Time when present, else leg time + leg start offset.
 *  - Split codes follow LiveResults: 1000 + code for the first passing of a control,
 *    2000 + code for the second, and so on.
 *  - Radio controls: the `radioControls` option (control codes) if set; otherwise every
 *    control in the class, in course order.
 */

import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import type { LiveResultsBackend } from '../LiveResultsClient';
import type {
  ClassCourse,
  LiveResultsClass,
  LiveResultsClassResult,
  LiveResultsCompetition,
  LiveResultsCompetitionInfo,
  LiveResultsSplitControl
} from '../../../shared/types/liveresults';
import { buildClassResult, ResultRow } from './resultBuilder';
import { DEFAULT_COMPETITION_TIMEZONE, timeZoneOffsetMs } from '../liveTime';

export interface IofXmlBackendOptions {
  /** Competition id Split Control uses for this file (default 1) */
  competitionId?: number;
  /** IANA time zone of the event (default Europe/Stockholm) */
  timezone?: string;
  /** Only these control codes become split columns (default: all) */
  radioControls?: number[];
  /** Minimum poll interval (ms, default 2000) */
  minPollIntervalMs?: number;
}

/** IOF ResultStatus -> LiveResults status. null = leave the row out. */
export function iofStatusToLiveResults(status: string | undefined, hasTime: boolean): number | null {
  switch (status) {
    case 'OK': return 0;
    case 'Finished': return hasTime ? 0 : 10;
    case 'MissingPunch': return 3;
    case 'Disqualified': return 4;
    case 'DidNotFinish': return 2;
    case 'SportingWithdrawal': return 2;
    case 'OverTime': return 5;
    case 'DidNotStart': return 1;
    case 'Cancelled': return 11;
    case 'Active': return 10;
    case 'Inactive': return 9;
    case 'NotCompeting': return 0; // shown, not ranked (see ranked flag)
    case 'DidNotEnter': return null;
    default: return hasTime ? 0 : 9;
  }
}

const ARRAY_TAGS = new Set([
  'ClassResult', 'PersonResult', 'TeamResult', 'TeamMemberResult', 'SplitTime',
  'ClassStart', 'PersonStart', 'TeamStart', 'TeamMemberStart', 'Result', 'Start'
]);

interface ParsedFile {
  key: string;
  eventName: string;
  eventDate: string;
  organiser: string;
  classes: Map<string, { controls: LiveResultsSplitControl[]; rows: ResultRow[]; course?: ClassCourse }>;
}

const text = (v: any): string => (v === undefined || v === null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const seconds = (v: any): number => {
  const n = parseFloat(text(v));
  return Number.isFinite(n) ? n : 0;
};

function personName(person: any): string {
  const n = person?.Name;
  if (!n) return '';
  return [text(n.Given), text(n.Family)].filter(Boolean).join(' ');
}

export class IofXmlBackend implements LiveResultsBackend {
  readonly name = 'iofxml';
  readonly minPollIntervalMs: number;
  private readonly competitionId: number;
  private readonly timezone: string;
  private parsed: ParsedFile | null = null;
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => ARRAY_TAGS.has(name)
  });

  constructor(private readonly filePath: string, private readonly options: IofXmlBackendOptions = {}) {
    this.competitionId = options.competitionId ?? 1;
    this.timezone = options.timezone || DEFAULT_COMPETITION_TIMEZONE;
    this.minPollIntervalMs = Math.max(1000, options.minPollIntervalMs ?? 2000);
  }

  async fetchCompetitions(): Promise<LiveResultsCompetition[]> {
    const f = this.load();
    return [{ id: this.competitionId, name: f.eventName, organizer: f.organiser, date: f.eventDate, timediff: 0 }];
  }

  async fetchCompetitionInfo(competitionId: number): Promise<LiveResultsCompetitionInfo> {
    this.assertCompetition(competitionId);
    const f = this.load();
    return { id: competitionId, name: f.eventName, organizer: f.organiser, date: f.eventDate, timediff: 0, timezone: this.timezone };
  }

  async fetchClasses(competitionId: number): Promise<LiveResultsClass[]> {
    this.assertCompetition(competitionId);
    return [...this.load().classes.keys()].map(className => ({ className }));
  }

  async fetchClassResults(competitionId: number, className: string): Promise<LiveResultsClassResult> {
    this.assertCompetition(competitionId);
    const cls = this.load().classes.get(className);
    if (!cls) throw new Error(`IOF XML class not found: ${className}`);
    const result = buildClassResult(className, cls.controls, cls.rows);
    return cls.course ? { ...result, course: cls.course } : result;
  }

  // --- parsing ---------------------------------------------------------------------------

  private assertCompetition(competitionId: number) {
    if (competitionId !== this.competitionId) throw new Error(`Unknown competition ${competitionId} (this IOF XML source is ${this.competitionId})`);
  }

  private load(): ParsedFile {
    const stat = fs.statSync(this.filePath);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (this.parsed?.key === key) return this.parsed;
    const xml = fs.readFileSync(this.filePath, 'utf8');
    try {
      this.parsed = this.parse(xml, key);
    } catch (error) {
      // A half-written export: keep serving the last good parse
      if (this.parsed) return this.parsed;
      throw error;
    }
    return this.parsed;
  }

  /** Hundredths since local midnight (event time zone) for an ISO date-time */
  private localHundredths(iso: string): number {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return 0;
    const local = ms + timeZoneOffsetMs(ms, this.timezone);
    return Math.round((((local % 86400000) + 86400000) % 86400000) / 10);
  }

  private localDate(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms + timeZoneOffsetMs(ms, this.timezone)).toISOString().slice(0, 10);
  }

  /** Split codes with repeat numbering (1000+code first passing, 2000+code second, ...) */
  private splitsOf(splitTimes: any[] | undefined, offsetCs = 0): { codes: number[]; splits: Map<number, number> } {
    const seen = new Map<number, number>();
    const codes: number[] = [];
    const splits = new Map<number, number>();
    for (const st of splitTimes ?? []) {
      const control = parseInt(text(st.ControlCode), 10);
      if (!Number.isFinite(control)) continue;
      if (this.options.radioControls && !this.options.radioControls.includes(control)) continue;
      const n = (seen.get(control) ?? 0) + 1;
      seen.set(control, n);
      const code = n * 1000 + control;
      codes.push(code);
      const status = st['@_status'];
      const t = seconds(st.Time);
      if (t > 0 && status !== 'Missing' && status !== 'Additional') splits.set(code, Math.round(t * 100) + offsetCs);
    }
    return { codes, splits };
  }

  private parse(xml: string, key: string): ParsedFile {
    const doc = this.parser.parse(xml);
    const root = doc.ResultList ?? doc.StartList;
    if (!root) throw new Error('Not an IOF XML 3.0 ResultList or StartList');
    const isStartList = !doc.ResultList;

    const event = root.Event ?? {};
    const eventDate = text(event.StartTime?.Date) ||
      (text(event.StartTime?.DateTime) ? this.localDate(text(event.StartTime.DateTime)) : '');
    const file: ParsedFile = {
      key,
      eventName: text(event.Name) || 'IOF XML',
      eventDate,
      organiser: text(event.Organiser?.Name),
      classes: new Map()
    };

    const classNodes: any[] = (isStartList ? root.ClassStart : root.ClassResult) ?? [];
    for (const cr of classNodes) {
      const baseName = text(cr.Class?.Name) || 'Class';
      // Course facts (IOF 3.0: ClassResult/Course or ClassStart/Course): Length, Climb in metres
      const courseNode = Array.isArray(cr.Course) ? cr.Course[0] : cr.Course;
      const num = (v: any) => { const n = parseFloat(text(v)); return Number.isFinite(n) && n > 0 ? n : undefined; };
      const course: ClassCourse | undefined = courseNode
        ? { length: num(courseNode.Length), climb: num(courseNode.Climb), controls: num(courseNode.NumberOfControls) }
        : undefined;
      // Individual
      const persons: any[] = (isStartList ? cr.PersonStart : cr.PersonResult) ?? [];
      if (persons.length) {
        const order: number[] = [];
        const rows: ResultRow[] = [];
        persons.forEach((pr, i) => {
          const res = (isStartList ? pr.Start : pr.Result)?.[0] ?? {};
          const { codes, splits } = this.splitsOf(res.SplitTime);
          for (const c of codes) if (!order.includes(c)) order.push(c);
          const timeCs = Math.round(seconds(res.Time) * 100);
          const status = isStartList ? 9 : iofStatusToLiveResults(text(res.Status), timeCs > 0);
          if (status === null) return;
          rows.push({
            key: `p${i}`,
            name: personName(pr.Person),
            club: text(pr.Organisation?.ShortName) || text(pr.Organisation?.Name),
            bib: text(res.BibNumber) || undefined,
            country: text(pr.Person?.Nationality?.['@_code']) || text(pr.Organisation?.Country?.['@_code']) || undefined,
            status,
            ranked: text(res.Status) !== 'NotCompeting',
            start: res.StartTime ? this.localHundredths(text(res.StartTime)) : 0,
            result: status === 0 ? timeCs : 0,
            splits
          });
        });
        file.classes.set(baseName, { controls: order.map(code => ({ code, name: `${code % 1000}` })), rows, course });
      }

      // Relay: one class per leg
      const teams: any[] = (isStartList ? cr.TeamStart : cr.TeamResult) ?? [];
      const legs = new Map<number, { order: number[]; rows: ResultRow[] }>();
      teams.forEach((tr, ti) => {
        const teamName = text(tr.Name);
        const members: any[] = (isStartList ? tr.TeamMemberStart : tr.TeamMemberResult) ?? [];
        // The team starts when its first-leg runner starts
        let teamStartCs = 0;
        for (const m of members) {
          const res = (isStartList ? m.Start : m.Result)?.[0] ?? {};
          const legNo = parseInt(text(res.Leg), 10) || 1;
          if (legNo === 1 && res.StartTime) teamStartCs = this.localHundredths(text(res.StartTime));
        }
        for (const m of members) {
          const res = (isStartList ? m.Start : m.Result)?.[0] ?? {};
          const legNo = parseInt(text(res.Leg), 10) || 1;
          const legStart = res.StartTime ? this.localHundredths(text(res.StartTime)) : 0;
          const offset = teamStartCs && legStart ? Math.max(0, legStart - teamStartCs) : 0;
          const { codes, splits } = this.splitsOf(res.SplitTime, offset);
          const legTimeCs = Math.round(seconds(res.Time) * 100);
          const overallCs = Math.round(seconds(res.OverallResult?.Time) * 100);
          const status = isStartList ? 9 : iofStatusToLiveResults(text(res.Status), legTimeCs > 0);
          if (status === null) continue;
          const entry = legs.get(legNo) ?? { order: [], rows: [] };
          for (const c of codes) if (!entry.order.includes(c)) entry.order.push(c);
          entry.rows.push({
            key: `t${ti}`,
            name: personName(m.Person),
            club: teamName,
            bib: text(tr.BibNumber) || text(res.BibNumber) || undefined,
            country: text(tr.Organisation?.Country?.['@_code']) || text(m.Person?.Nationality?.['@_code']) || undefined,
            status,
            ranked: text(res.Status) !== 'NotCompeting',
            start: legStart,
            ...(teamStartCs ? { teamStart: teamStartCs } : {}),
            result: status === 0 ? (overallCs || (legTimeCs ? legTimeCs + offset : 0)) : 0,
            splits
          });
          legs.set(legNo, entry);
        }
      });
      for (const [legNo, entry] of [...legs].sort((a, b) => a[0] - b[0])) {
        file.classes.set(`${baseName}-${legNo}`, {
          controls: entry.order.map(code => ({ code, name: `${code % 1000}` })),
          rows: entry.rows
        });
      }
    }
    return file;
  }
}

/**
 * IOF XML 3.0 file backend
 *
 * Reads an IOF XML 3.0 ResultList (or StartList) that timing software exports to disk, e.g.
 * OE/OS (SportSoftware), OLA, MeOS or Helga with "export every N seconds". Results come out
 * as timing SDK facts; the core ranks them like every other source.
 *
 *  - The file is re-parsed only when its modification time or size changes.
 *  - Times: IOF <Time> is seconds (may have decimals); converted to hundredths.
 *  - Start times are ISO date-times with offsets (epoch ms in the SDK model); the event
 *    time zone (option, default Europe/Stockholm) is the competition's zone.
 *  - Relays (TeamResult) are relay classes; the core shows them per leg "<Class>-<leg>" with
 *    team-perspective times: OverallResult/Time when present, else leg time + leg start offset.
 *  - Repeated controls are separate radio controls (visit 1, 2, ...).
 *  - Radio controls: the `radioControls` option (control codes) if set; otherwise every
 *    control in the class, in course order.
 */

import fs from 'fs';
import { XMLParser } from 'fast-xml-parser';
import type { ClassInfo, Competition, Control, Entry, EntryStatus, TimingSource } from '../../../shared/timing-sdk';
import { STATUS_CODES } from '../timing/model';
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

/** IOF ResultStatus -> SDK status */
export function iofStatus(status: string | undefined, hasTime: boolean): { status: EntryStatus; ranked: boolean } {
  switch (status) {
    case 'OK': return { status: 'ok', ranked: true };
    case 'Finished': return { status: hasTime ? 'ok' : 'running', ranked: true };
    case 'MissingPunch': return { status: 'mispunch', ranked: true };
    case 'Disqualified': return { status: 'dsq', ranked: true };
    case 'DidNotFinish': return { status: 'dnf', ranked: true };
    case 'SportingWithdrawal': return { status: 'dnf', ranked: true };
    case 'OverTime': return { status: 'overtime', ranked: true };
    case 'DidNotStart': return { status: 'dns', ranked: true };
    case 'Cancelled': return { status: 'cancelled', ranked: true };
    case 'Active': return { status: 'running', ranked: true };
    case 'Inactive': return { status: 'notStarted', ranked: true };
    case 'NotCompeting': return { status: 'ok', ranked: false }; // shown, not ranked
    case 'DidNotEnter': return { status: 'notCompeting', ranked: false };
    default: return { status: hasTime ? 'ok' : 'notStarted', ranked: true };
  }
}

/** IOF ResultStatus -> the core's status code. null = leave the row out. */
export function iofStatusToLiveResults(status: string | undefined, hasTime: boolean): number | null {
  return STATUS_CODES[iofStatus(status, hasTime).status];
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
  classes: { info: ClassInfo; entries: Entry[] }[];
}

const text = (v: any): string => (v === undefined || v === null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const seconds = (v: any): number => {
  const n = parseFloat(text(v));
  return Number.isFinite(n) ? n : 0;
};
const instant = (iso: string): number | undefined => {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
};

function personName(person: any): Entry['name'] {
  const n = person?.Name;
  const given = text(n?.Given);
  const family = text(n?.Family);
  return { given: given || undefined, family: family || undefined, full: [given, family].filter(Boolean).join(' ') };
}

/** The IOF XML file as a timing source */
export class IofXmlSource implements TimingSource {
  private readonly competitionId: string;
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
    this.competitionId = String(options.competitionId ?? 1);
    this.timezone = options.timezone || DEFAULT_COMPETITION_TIMEZONE;
  }

  async connect(): Promise<void> {
    if (!this.filePath || !fs.existsSync(this.filePath)) {
      throw new Error(`IOF XML file not found: ${this.filePath || '(no path set)'}`);
    }
    this.load(); // fails early on a bad file
  }

  close(): void {
    this.parsed = null;
  }

  async competitions(): Promise<Competition[]> {
    const f = this.load();
    return [{ id: this.competitionId, name: f.eventName, organiser: f.organiser, date: f.eventDate, timezone: this.timezone }];
  }

  async classes(competitionId: string): Promise<ClassInfo[]> {
    this.assertCompetition(competitionId);
    return this.load().classes.map(c => c.info);
  }

  async entries(competitionId: string, classId: string): Promise<Entry[]> {
    this.assertCompetition(competitionId);
    const cls = this.load().classes.find(c => c.info.id === classId);
    if (!cls) throw new Error(`IOF XML class not found: ${classId}`);
    return cls.entries;
  }

  // --- parsing ---------------------------------------------------------------------------

  private assertCompetition(competitionId: string) {
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

  private localDate(iso: string): string {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    return new Date(ms + timeZoneOffsetMs(ms, this.timezone)).toISOString().slice(0, 10);
  }

  /** Radio controls with repeat numbering (visit 1, 2, ...) and the runner's passings */
  private splitsOf(splitTimes: any[] | undefined, leg?: number): { controls: Control[]; passings: Entry['passings'] } {
    const seen = new Map<number, number>();
    const controls: Control[] = [];
    const passings: Entry['passings'] = [];
    for (const st of splitTimes ?? []) {
      const code = parseInt(text(st.ControlCode), 10);
      if (!Number.isFinite(code)) continue;
      if (this.options.radioControls && !this.options.radioControls.includes(code)) continue;
      const visit = (seen.get(code) ?? 0) + 1;
      seen.set(code, visit);
      const id = `${code}#${visit}`;
      controls.push({ id, code, visit, name: String(code), ...(leg ? { leg } : {}) });
      const status = st['@_status'];
      const t = seconds(st.Time);
      if (t > 0 && status !== 'Missing' && status !== 'Additional') passings.push({ controlId: id, time: Math.round(t * 1000) });
    }
    return { controls, passings };
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
      classes: []
    };

    const addControls = (list: Control[], add: Control[]) => {
      for (const c of add) if (!list.some(x => x.id === c.id && x.leg === c.leg)) list.push(c);
    };
    const num = (v: any) => { const n = parseFloat(text(v)); return Number.isFinite(n) && n > 0 ? n : undefined; };

    const classNodes: any[] = (isStartList ? root.ClassStart : root.ClassResult) ?? [];
    for (const cr of classNodes) {
      const baseName = text(cr.Class?.Name) || 'Class';
      // Course facts (IOF 3.0: ClassResult/Course or ClassStart/Course): Length, Climb in metres
      const courseNode = Array.isArray(cr.Course) ? cr.Course[0] : cr.Course;
      const course = courseNode
        ? { lengthM: num(courseNode.Length), climbM: num(courseNode.Climb), controls: num(courseNode.NumberOfControls) }
        : undefined;

      // Individual
      const persons: any[] = (isStartList ? cr.PersonStart : cr.PersonResult) ?? [];
      if (persons.length) {
        const controls: Control[] = [];
        const entries: Entry[] = [];
        persons.forEach((pr, i) => {
          const res = (isStartList ? pr.Start : pr.Result)?.[0] ?? {};
          const split = this.splitsOf(res.SplitTime);
          addControls(controls, split.controls);
          const timeMs = Math.round(seconds(res.Time) * 100) * 10;
          const s = isStartList ? { status: 'notStarted' as EntryStatus, ranked: true } : iofStatus(text(res.Status), timeMs > 0);
          const country = text(pr.Person?.Nationality?.['@_code']) || text(pr.Organisation?.Country?.['@_code']);
          entries.push({
            id: `p${i}`,
            classId: baseName,
            name: personName(pr.Person),
            club: { name: text(pr.Organisation?.Name), short: text(pr.Organisation?.ShortName) || undefined },
            bib: text(res.BibNumber) || undefined,
            country: country || undefined,
            status: s.status,
            ranked: s.ranked,
            start: res.StartTime ? instant(text(res.StartTime)) : undefined,
            time: timeMs || undefined,
            passings: split.passings
          });
        });
        file.classes.push({ info: { id: baseName, name: baseName, kind: 'individual', radioControls: controls, ...(course ? { course } : {}) }, entries });
      }

      // Relay
      const teams: any[] = (isStartList ? cr.TeamStart : cr.TeamResult) ?? [];
      if (!teams.length) continue;
      const controls: Control[] = [];
      const entries: Entry[] = [];
      let legs = 0;
      teams.forEach((tr, ti) => {
        const teamName = text(tr.Name);
        const members: any[] = (isStartList ? tr.TeamMemberStart : tr.TeamMemberResult) ?? [];
        // The team starts when its first-leg runner starts
        let teamStart: number | undefined;
        for (const m of members) {
          const res = (isStartList ? m.Start : m.Result)?.[0] ?? {};
          const legNo = parseInt(text(res.Leg), 10) || 1;
          if (legNo === 1 && res.StartTime) teamStart = instant(text(res.StartTime));
        }
        for (const [mi, m] of members.entries()) {
          const res = (isStartList ? m.Start : m.Result)?.[0] ?? {};
          const legNo = parseInt(text(res.Leg), 10) || 1;
          legs = Math.max(legs, legNo);
          const split = this.splitsOf(res.SplitTime, legNo);
          addControls(controls, split.controls);
          const legTimeMs = Math.round(seconds(res.Time) * 100) * 10;
          const overallMs = Math.round(seconds(res.OverallResult?.Time) * 100) * 10;
          const s = isStartList ? { status: 'notStarted' as EntryStatus, ranked: true } : iofStatus(text(res.Status), legTimeMs > 0);
          const country = text(tr.Organisation?.Country?.['@_code']) || text(m.Person?.Nationality?.['@_code']);
          entries.push({
            id: `t${ti}-${mi}`,
            classId: baseName,
            name: personName(m.Person),
            bib: text(tr.BibNumber) || text(res.BibNumber) || undefined,
            country: country || undefined,
            status: s.status,
            ranked: s.ranked,
            start: res.StartTime ? instant(text(res.StartTime)) : undefined,
            time: legTimeMs || undefined,
            passings: split.passings,
            team: {
              id: `t${ti}`,
              name: teamName,
              leg: legNo,
              ...(teamStart ? { start: teamStart } : {}),
              ...(overallMs ? { time: overallMs } : {})
            }
          });
        }
      });
      file.classes.push({ info: { id: baseName, name: baseName, kind: 'relay', legs, radioControls: controls }, entries });
    }
    return file;
  }
}

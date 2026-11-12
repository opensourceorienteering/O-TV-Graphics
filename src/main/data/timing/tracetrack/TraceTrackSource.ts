/**
 * Trace / Track (GPS tracking for orienteering TV) as a timing source.
 *
 * Meant as an event's additional source next to its official timing: it adds each runner's
 * heart rate, pace, speed, position, signal and battery, and optionally Trace / Track's
 * experimental virtual standings, under results[].x.trace-track. Runners, places, times and
 * statuses always come from the timing source; GPS passings are estimates and are never used
 * as results (docs/integrations/DATA-API.md in the Trace / Track repository).
 *
 * API: GET /api/v1/events/<event>/runners (one request for every class), …/classes/<class>/
 * virtual-standings (per class, only when switched on) and …/stream (Server-Sent Events: the
 * runners answer every interval, so push needs no extra requests). A per-event read key
 * (ttr_…) is sent as Authorization: Bearer.
 */

import type { ClassInfo, Competition, Entry, PluginContext, TimingSource } from '../../../../shared/timing-sdk';

export const DEFAULT_TRACE_TRACK_URL = 'https://tracetrack.openorienteering.com';

/** One runner in GET …/runners (Trace / Track data API, version 1) */
export interface TtRunner {
  id: string; name: string; shortName?: string; club?: string; bib?: string | null;
  classId: string; className?: string; color?: string; startTime?: number;
  team?: { name: string; bib?: string | null; leg: number } | null;
  onProgram?: boolean; lowerThird?: boolean; time?: number;
  position?: { lat: number; lon: number; time: number } | null;
  signal?: 'live' | 'lost' | 'none'; age?: number | null;
  heartRate?: number | null; maxHeartRate?: number | null; averageHeartRate?: number | null;
  speed?: number | null; pace?: number | null; heading?: number | null;
  battery?: number | null; accuracy?: number | null;
}
export interface TtRunners { version: number; eventId: string; serverTime: number; timeline?: string; runners: TtRunner[] }

/** One row of GET …/classes/<class>/virtual-standings (experimental) */
export interface TtStandingRow {
  id: string;
  progress?: { state?: string; reason?: string | null; lastControl?: number; nextControl?: number | null; percent?: number | null; distance?: number | null; totalDistance?: number | null } | null;
  rank?: number | null; gap?: number | null; fieldSize?: number; comparisonFieldSize?: number; comparisonReason?: string | null;
  pacing?: { current?: number | null; recent?: number | null; previous?: number | null; change?: number | null; leg?: number | null } | null;
  arrival?: { controlIndex: number; time: number; remaining: number } | null;
  mistakes?: { leg: number; lost: number }[];
}

export interface TraceTrackOptions {
  url?: string;
  eventId: string;
  key: string;
  /** 'program' (default): each runner as Trace / Track's Program shows them; 'live': the live time */
  timeline?: 'program' | 'live';
  /** Add the experimental virtual standings (one request per class) */
  virtualStandings?: boolean;
  /** Follow the stream (default true); the stream's interval follows the poll interval */
  push?: boolean;
  pollIntervalMs?: number;
  /** A name for the event in Split Control (Trace / Track's API does not give one) */
  eventName?: string;
  /** For tests */
  fetchImpl?: typeof fetch;
}

/** Fields Trace / Track adds (results[].x.trace-track.<key>); see the plugin manifest */
export const TRACE_TRACK_FIELDS: { key: string; type: 'number' | 'string' | 'boolean'; label: string; unit?: string; standings?: boolean }[] = [
  { key: 'heartRate', type: 'number', label: 'Heart rate', unit: 'bpm' },
  { key: 'maxHeartRate', type: 'number', label: 'Highest heart rate since the start', unit: 'bpm' },
  { key: 'averageHeartRate', type: 'number', label: 'Average heart rate since the start', unit: 'bpm' },
  { key: 'speed', type: 'number', label: 'Speed', unit: 'm/s' },
  { key: 'speedKmh', type: 'number', label: 'Speed', unit: 'km/h' },
  { key: 'pace', type: 'number', label: 'Pace', unit: 's/km' },
  { key: 'paceText', type: 'string', label: 'Pace as min:ss per km' },
  { key: 'heading', type: 'number', label: 'Direction of travel', unit: '° from north' },
  { key: 'lat', type: 'number', label: 'Latitude' },
  { key: 'lon', type: 'number', label: 'Longitude' },
  { key: 'positionTime', type: 'number', label: 'Time of the position', unit: 'epoch ms' },
  { key: 'signal', type: 'string', label: 'GPS signal: live, lost or none' },
  { key: 'signalAge', type: 'number', label: 'Seconds since the last position', unit: 's' },
  { key: 'battery', type: 'number', label: 'Tracker battery', unit: '%' },
  { key: 'accuracy', type: 'number', label: 'GPS accuracy', unit: 'm' },
  { key: 'onProgram', type: 'boolean', label: 'Shown on Trace / Track\'s Program map now' },
  { key: 'lowerThird', type: 'boolean', label: 'In Trace / Track\'s lower third now' },
  { key: 'color', type: 'string', label: 'The runner\'s colour on the map' },
  { key: 'time', type: 'number', label: 'The moment the values describe', unit: 'epoch ms' },
  // Experimental virtual standings: estimates from GPS, never results
  { key: 'virtualRank', type: 'number', label: 'Estimated rank at a common course point (experimental)', standings: true },
  { key: 'virtualGap', type: 'number', label: 'Estimated time behind at that point (experimental)', unit: 'ms', standings: true },
  { key: 'virtualFieldSize', type: 'number', label: 'Runners compared for the estimated rank', standings: true },
  { key: 'progressPercent', type: 'number', label: 'Course progress, straight control to control (experimental)', unit: '%', standings: true },
  { key: 'progressState', type: 'string', label: 'tracking, gps-finished, timing-finished or unavailable', standings: true },
  { key: 'lastControl', type: 'number', label: 'Last control passed by GPS (course index)', standings: true },
  { key: 'nextControl', type: 'number', label: 'Next control (course index)', standings: true },
  { key: 'arrivalTime', type: 'number', label: 'Estimated arrival at the next control (experimental)', unit: 'epoch ms', standings: true },
  { key: 'arrivalIn', type: 'number', label: 'Time to the estimated arrival', unit: 'ms', standings: true },
  { key: 'paceRecent', type: 'number', label: 'Pace over the last minute', unit: 's/km', standings: true },
  { key: 'paceChange', type: 'number', label: 'Change from the minute before (negative: faster)', unit: 's/km', standings: true },
  { key: 'legPace', type: 'number', label: 'Pace on the current leg', unit: 's/km', standings: true },
  { key: 'timeLost', type: 'number', label: 'Estimated time lost on completed legs (experimental)', unit: 'ms', standings: true }
];

const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const set = (out: Record<string, unknown>, key: string, v: unknown) => {
  if (v !== null && v !== undefined && !(typeof v === 'number' && !Number.isFinite(v))) out[key] = v;
};

/** The fields of one runner (values Trace / Track does not have are left out) */
export function runnerFields(r: TtRunner, standing?: TtStandingRow): Record<string, unknown> {
  const x: Record<string, unknown> = {};
  set(x, 'heartRate', r.heartRate);
  set(x, 'maxHeartRate', r.maxHeartRate);
  set(x, 'averageHeartRate', r.averageHeartRate);
  set(x, 'speed', r.speed);
  if (typeof r.speed === 'number') set(x, 'speedKmh', Math.round(r.speed * 36) / 10);
  set(x, 'pace', r.pace);
  if (typeof r.pace === 'number' && r.pace > 0) set(x, 'paceText', pace(r.pace));
  set(x, 'heading', r.heading);
  set(x, 'lat', r.position?.lat);
  set(x, 'lon', r.position?.lon);
  set(x, 'positionTime', r.position?.time);
  set(x, 'signal', r.signal);
  set(x, 'signalAge', r.age);
  set(x, 'battery', r.battery);
  set(x, 'accuracy', r.accuracy);
  set(x, 'onProgram', r.onProgram);
  set(x, 'lowerThird', r.lowerThird);
  set(x, 'color', r.color);
  set(x, 'time', r.time);
  if (standing) {
    set(x, 'virtualRank', standing.rank);
    set(x, 'virtualGap', standing.gap);
    set(x, 'virtualFieldSize', standing.comparisonFieldSize);
    set(x, 'progressPercent', standing.progress?.percent);
    set(x, 'progressState', standing.progress?.state);
    set(x, 'lastControl', standing.progress?.lastControl);
    set(x, 'nextControl', standing.progress?.nextControl);
    set(x, 'arrivalTime', standing.arrival?.time);
    set(x, 'arrivalIn', standing.arrival?.remaining);
    set(x, 'paceRecent', standing.pacing?.recent);
    set(x, 'paceChange', standing.pacing?.change);
    set(x, 'legPace', standing.pacing?.leg);
    if (standing.mistakes?.length) set(x, 'timeLost', standing.mistakes.reduce((sum, m) => sum + (m.lost || 0), 0));
  }
  return x;
}

/** Local date (YYYY-MM-DD) of an instant, for the competition's date */
function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class TraceTrackSource implements TimingSource {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private runners: { at: number; data: TtRunners } | null = null;
  private loading: Promise<TtRunners> | null = null;
  private stream: { abort: AbortController; connected: boolean } | null = null;
  private streamRetry = 0;
  private streamTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly options: TraceTrackOptions, private readonly ctx?: PluginContext) {
    this.base = `${(options.url || DEFAULT_TRACE_TRACK_URL).trim().replace(/\/+$/, '')}/api/v1/events/${encodeURIComponent(options.eventId)}`;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  private get timeline(): 'program' | 'live' {
    return this.options.timeline === 'live' ? 'live' : 'program';
  }

  /** Stream and reuse interval: the poll interval, 1–10 s */
  private get intervalS(): number {
    return Math.max(1, Math.min(10, Math.round((this.options.pollIntervalMs ?? 2000) / 1000)));
  }

  private async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams({ timeline: this.timeline, ...query }).toString();
    const res = await this.fetchImpl(`${this.base}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${this.options.key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (res.status === 401) throw new Error('Trace / Track refused the read key: create one in Trace / Track Admin › event › Overview › Data for other software, and paste it here');
    if (res.status === 403) throw new Error('This Trace / Track read key is for another event: check the event ID');
    if (res.status === 404) throw new Error(`Trace / Track has no event "${this.options.eventId}" (or no such class): check the event ID`);
    if (!res.ok) throw new Error(`Trace / Track answered HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Every runner, shared by all classes; reused for one interval (the stream refreshes it) */
  private async allRunners(): Promise<TtRunners> {
    if (this.runners && Date.now() - this.runners.at < this.intervalS * 1000) return this.runners.data;
    this.loading ??= this.get<TtRunners>('/runners')
      .then(data => { this.runners = { at: Date.now(), data }; return data; })
      .finally(() => { this.loading = null; });
    return this.loading;
  }

  async connect(): Promise<void> {
    if (!this.options.eventId) throw new Error('Enter the Trace / Track event ID');
    if (!this.options.key) throw new Error('Enter the event\'s Trace / Track read key');
    this.runners = null;
    await this.allRunners();
  }

  close(): void {
    this.closed = true;
    this.stopStream();
  }

  async competitions(): Promise<Competition[]> {
    const data = await this.allRunners();
    return [{
      id: this.options.eventId,
      name: this.options.eventName || `Trace / Track ${this.options.eventId}`,
      date: localDate(data.serverTime || Date.now())
    }];
  }

  async classes(): Promise<ClassInfo[]> {
    const seen = new Map<string, string>();
    for (const r of (await this.allRunners()).runners) if (!seen.has(r.classId)) seen.set(r.classId, r.className || r.classId);
    return [...seen].map(([id, name]) => ({ id, name, kind: 'individual', radioControls: [] }));
  }

  async entries(_competitionId: string, classId: string): Promise<Entry[]> {
    const runners = (await this.allRunners()).runners.filter(r => r.classId === classId);
    let standings = new Map<string, TtStandingRow>();
    if (this.options.virtualStandings && runners.length) {
      try {
        const res = await this.get<{ rows?: TtStandingRow[] }>(`/classes/${encodeURIComponent(classId)}/virtual-standings`);
        standings = new Map((res.rows ?? []).map(row => [row.id, row]));
      } catch (error) {
        // The standings are an extra: runner metrics still go out without them
        this.ctx?.log.warn('Trace / Track virtual standings unavailable', { classId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return runners.map(r => ({
      id: r.id,
      classId,
      name: { full: r.name },
      // Relays: the team is the club, as in the timing source's relay rows
      club: { name: r.team?.name ?? r.club ?? '' },
      ...(r.bib || r.team?.bib ? { bib: String(r.bib || r.team?.bib) } : {}),
      status: 'running' as const,
      ...(r.startTime ? { start: r.startTime } : {}),
      passings: [],
      ext: runnerFields(r, standings.get(r.id))
    }));
  }

  async clockOffsetMs(): Promise<number> {
    const data = await this.allRunners();
    return data.serverTime ? Math.round(data.serverTime - (this.runners?.at ?? Date.now())) : 0;
  }

  describe() {
    return { api: 'trace-track', pushConnected: !!this.stream?.connected };
  }

  // --- push: Server-Sent Events -----------------------------------------------------------

  watch(_competitionId: string, classIds: string[]): void {
    if (this.options.push === false || this.closed) return;
    if (!classIds.length) this.stopStream();
    else if (!this.stream) this.startStream();
  }

  private stopStream(): void {
    if (this.streamTimer) clearTimeout(this.streamTimer);
    this.streamTimer = null;
    this.stream?.abort.abort();
    this.stream = null;
  }

  private startStream(): void {
    const abort = new AbortController();
    const stream = { abort, connected: false };
    this.stream = stream;
    const qs = new URLSearchParams({ timeline: this.timeline, interval: String(this.intervalS) }).toString();
    void (async () => {
      try {
        const res = await this.fetchImpl(`${this.base}/stream?${qs}`, {
          headers: { Authorization: `Bearer ${this.options.key}`, Accept: 'text/event-stream' },
          signal: abort.signal
        });
        if (!res.ok || !res.body) throw new Error(`stream: HTTP ${res.status}`);
        stream.connected = true;
        this.streamRetry = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let cut: number;
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, cut);
            buffer = buffer.slice(cut + 2);
            if (this.onMessage(block) === 'end') { abort.abort(); return; }
          }
        }
        throw new Error('stream closed');
      } catch (error) {
        stream.connected = false;
        if (abort.signal.aborted || this.closed || this.stream !== stream) return;
        // Polling carries on meanwhile; try the stream again after 1, 2, 5, 10, 30 s
        const delay = [1000, 2000, 5000, 10000, 30000][Math.min(this.streamRetry++, 4)];
        this.ctx?.log.debug('Trace / Track stream interrupted, retrying', { delay, error: error instanceof Error ? error.message : String(error) });
        this.streamTimer = setTimeout(() => { if (this.stream === stream) this.startStream(); }, delay);
      }
    })();
  }

  /** One SSE message: runners refresh the shared data and wake the graphics */
  private onMessage(block: string): 'end' | void {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (event === 'end') {
      this.ctx?.log.warn('Trace / Track ended the stream: the read key was revoked or the event deleted');
      this.stream = null;
      return 'end';
    }
    if (event !== 'runners') return;
    try {
      const parsed = JSON.parse(data.join('\n')) as TtRunners;
      if (!Array.isArray(parsed.runners)) return;
      this.runners = { at: Date.now(), data: parsed };
      this.ctx?.changed(this.options.eventId);
    } catch {
      /* not JSON: ignore */
    }
  }
}

export function createTraceTrackSource(config: Record<string, unknown>, ctx?: PluginContext): TraceTrackSource {
  const num = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  return new TraceTrackSource({
    url: config.url as string | undefined,
    eventId: String(config.eventId ?? '').trim(),
    key: String(config.key ?? '').trim(),
    timeline: config.timeline === 'live' ? 'live' : 'program',
    virtualStandings: config.virtualStandings === true,
    push: config.push !== false,
    pollIntervalMs: num(config.pollIntervalMs),
    eventName: (config.eventName as string | undefined) || undefined
  }, ctx);
}

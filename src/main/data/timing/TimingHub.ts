/**
 * The core's connection to one timing source.
 *
 * Every data source (Liveresultat, MeOS, MOP, IOF XML, plugins) is a TimingSource behind a
 * TimingHub. The hub asks the source for facts, works out standings (ranking.ts) and gives the
 * rest of Split Control ClassResults (model.ts). It caches, detects changes, polls, reacts to
 * push sources, and shares one source request between graphics that need the same class.
 */

import crypto from 'crypto';
import { getLogger } from '../../utils/logger';
import type { ClassInfo, Competition, Entry, TimingSource } from '../../../shared/timing-sdk';
import type { ClassRef, ClassResults, CompetitionInfo } from './model';
import { buildClassResults, splitCode } from './ranking';

const logger = getLogger();

export interface Cached<T> {
  data: T;
  hash: string;
  timestamp: number;
  /** Different from the previous fetch */
  changed: boolean;
}

export interface PollingConfig {
  competitionId: number;
  /** Omit to poll the latest passings */
  className?: string;
  /** Requested interval (ms); never faster than the source allows */
  interval: number;
  onUpdate: (data: any) => void;
  onError?: (error: Error) => void;
  /** After every successful poll: whether it changed, and the interval actually used */
  onPoll?: (changed: boolean, interval: number) => void;
}

/** One row of the latest passings feed */
export interface PassingRow {
  at: number;
  className: string;
  name: string;
  club: string;
  bib?: string;
  controlKey: number;
  controlName: string;
  /** At the control (ms; team time for relays), 0 if unknown */
  time: number;
  place?: number;
  behind?: number;
}

/** The number Split Control uses for a source's competition id (stable across restarts) */
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

export interface TimingHubOptions {
  pluginId: string;
  /** Label for logs (the source's address) */
  label?: string;
  /** Requested poll interval (data source settings) */
  pollIntervalMs?: number;
  /** The source's fastest useful interval (manifest); the source's minPollMs() wins if it has one */
  minPollMs?: number;
}

export class TimingHub {
  readonly pluginId: string;
  readonly label: string;
  private readonly requestedInterval?: number;
  private readonly manifestFloor: number;

  private competitionsById = new Map<number, Competition>();
  private infoCache = new Map<number, { data: CompetitionInfo; at: number }>();
  private classCache = new Map<string, { at: number; classes: ClassInfo[] }>();
  private entriesCache = new Map<string, { at: number; promise: Promise<Entry[]> }>();
  private cache = {
    competitions: undefined as { hash: string } | undefined,
    classes: new Map<number, { hash: string }>(),
    classResults: new Map<string, { data: ClassResults; hash: string; timestamp: number }>(),
    passings: new Map<number, { hash: string }>()
  };
  private pollingTimers = new Map<string, NodeJS.Timeout>();
  private pollTriggers = new Map<string, () => void>();
  private polled = new Map<string, { competitionId: number; className?: string }>();

  constructor(readonly source: TimingSource, options: TimingHubOptions) {
    this.pluginId = options.pluginId;
    this.label = options.label ?? options.pluginId;
    this.requestedInterval = options.pollIntervalMs;
    this.manifestFloor = Math.max(100, options.minPollMs ?? 2000);
  }

  // --- diagnostics -----------------------------------------------------------------------

  /** Which API the source uses ('backend' when it does not say) */
  getApiFlavor(): string {
    return this.source.describe?.().api ?? 'backend';
  }

  isPushConnected(competitionId: number): boolean {
    const c = this.competitionsById.get(competitionId);
    return !!this.source.describe?.(c?.id ?? String(competitionId)).pushConnected;
  }

  /** The interval polls use: the requested one, never faster than the source allows */
  pollInterval(): number {
    const floor = this.source.minPollMs ? Math.max(100, this.source.minPollMs()) : this.manifestFloor;
    return Math.max(this.requestedInterval || floor, floor);
  }

  // --- push ------------------------------------------------------------------------------

  /** The plugin context's changed(): refetch the matching polls now */
  notifyChanged(competitionId: string, classId?: string): void {
    const n = numericCompetitionId(competitionId);
    const classes = this.classCache.get(competitionId)?.classes;
    const cls = classId === undefined ? undefined : classes?.find(c => c.id === classId);
    // A class we have not seen yet: refetch the whole competition
    if (classId !== undefined && !cls) this.classCache.delete(competitionId);
    for (const key of [...this.entriesCache.keys()]) {
      if (key.startsWith(`${competitionId}|`) && (!cls || key === `${competitionId}|${cls.id}`)) this.entriesCache.delete(key);
    }
    for (const [pollId, p] of this.polled) {
      if (p.competitionId !== n) continue;
      const match = !cls || !p.className || p.className === cls.name || p.className.startsWith(`${cls.name}-`);
      if (match) this.pollTriggers.get(pollId)?.();
    }
  }

  /** Tell a push source which classes are polled now */
  private updateWatch(competitionId: number): void {
    if (!this.source.watch) return;
    const c = this.competitionsById.get(competitionId);
    if (!c) return;
    const classes = this.classCache.get(c.id)?.classes ?? [];
    const ids = new Set<string>();
    for (const p of this.polled.values()) {
      if (p.competitionId !== competitionId || !p.className) continue;
      const ref = this.resolveCached(classes, p.className);
      if (ref) ids.add(ref.cls.id);
    }
    try {
      this.source.watch(c.id, [...ids]);
    } catch (error) {
      logger.warn('Timing source watch failed', { source: this.label, error: String(error) });
    }
  }

  // --- data ------------------------------------------------------------------------------

  private hash(data: unknown): string {
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  private info(c: Competition): CompetitionInfo {
    return {
      id: numericCompetitionId(c.id),
      sourceId: c.id,
      name: c.name ?? '',
      organiser: c.organiser ?? '',
      date: c.date ?? '',
      ...(c.timezone ? { timezone: c.timezone } : {}),
      timediffHours: Number(c.clockShiftHours ?? 0) || 0,
      ...(c.location ? { location: c.location } : {}),
      ...(c.ext ? { ext: c.ext } : {})
    };
  }

  async getCompetitions(): Promise<Cached<CompetitionInfo[]>> {
    const list = await this.source.competitions();
    this.competitionsById.clear();
    for (const c of list) this.competitionsById.set(numericCompetitionId(c.id), c);
    const data = list.map(c => this.info(c));
    const hash = this.hash(data);
    const changed = this.cache.competitions?.hash !== hash;
    this.cache.competitions = { hash };
    return { data, hash, timestamp: Date.now(), changed };
  }

  private async competition(competitionId: number): Promise<Competition> {
    let c = this.competitionsById.get(competitionId);
    if (!c && this.source.competition && competitionId < 1_000_000_000) {
      // The source's own (numeric) id: ask for just this one; the full list if that fails
      try {
        c = await this.source.competition(String(competitionId));
        if (c) this.competitionsById.set(competitionId, c);
      } catch (error) {
        logger.warn('Competition info failed, falling back to the competition list', { source: this.label, competitionId, error: String(error) });
      }
    }
    if (!c) {
      await this.getCompetitions();
      c = this.competitionsById.get(competitionId);
    }
    if (!c) throw new Error(`Unknown competition ${competitionId}`);
    return c;
  }

  /** Name, date and time zone of a competition (reused for maxAgeMs) */
  async getCompetitionInfo(competitionId: number, maxAgeMs = 60_000): Promise<CompetitionInfo> {
    const cached = this.infoCache.get(competitionId);
    if (cached && Date.now() - cached.at < maxAgeMs) return cached.data;
    if (cached || maxAgeMs === 0) this.competitionsById.delete(competitionId); // fetch it again
    const data = this.info(await this.competition(competitionId));
    this.infoCache.set(competitionId, { data, at: Date.now() });
    return data;
  }

  /** Source clock minus this computer's (ms) */
  async getServerClockOffsetMs(): Promise<number> {
    if (!this.source.clockOffsetMs) return 0;
    try {
      return await this.source.clockOffsetMs();
    } catch (error) {
      logger.warn('Could not measure the source clock', { source: this.label, error: String(error) });
      return 0;
    }
  }

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

  /** Classes as the desk lists them: relays once per leg ("Mixed-1", "Mixed-2" …) */
  async getClasses(competitionId: number): Promise<Cached<ClassRef[]>> {
    const c = await this.competition(competitionId);
    const classes = await this.loadClasses(c.id, 0);
    const data: ClassRef[] = [];
    for (const cls of classes) {
      if (cls.kind === 'relay' && (cls.legs ?? 0) > 0) {
        for (let leg = 1; leg <= cls.legs!; leg++) data.push({ className: `${cls.name}-${leg}`, classId: cls.id, leg, legs: cls.legs });
      } else {
        data.push({ className: cls.name, classId: cls.id });
      }
    }
    const hash = this.hash(data);
    const changed = this.cache.classes.get(competitionId)?.hash !== hash;
    this.cache.classes.set(competitionId, { hash });
    return { data, hash, timestamp: Date.now(), changed };
  }

  private resolveCached(classes: ClassInfo[], className: string): { cls: ClassInfo; leg?: number } | undefined {
    const exact = classes.find(c => c.name === className && c.kind !== 'relay');
    if (exact) return { cls: exact };
    const m = /^(.*)-(\d+)$/.exec(className);
    if (m) {
      const relay = classes.find(c => c.name === m[1] && c.kind === 'relay');
      if (relay) return { cls: relay, leg: Number(m[2]) };
    }
    return undefined;
  }

  private async resolveClass(competitionId: string, className: string): Promise<{ cls: ClassInfo; leg?: number }> {
    // Reuse the class list while polling; reload once when the class is new
    return this.resolveCached(await this.loadClasses(competitionId, this.pollInterval() * 5), className)
      ?? this.resolveCached(await this.loadClasses(competitionId, 0), className)
      ?? (() => { throw new Error(`Class not found: ${className}`); })();
  }

  /** One source request per class at a time: callers asking meanwhile share it */
  private entries(competitionId: string, classId: string): Promise<Entry[]> {
    const key = `${competitionId}|${classId}`;
    const pending = this.entriesCache.get(key);
    if (pending) return pending.promise;
    const promise = this.source.entries(competitionId, classId);
    this.entriesCache.set(key, { at: Date.now(), promise });
    const done = () => { if (this.entriesCache.get(key)?.promise === promise) this.entriesCache.delete(key); };
    promise.then(done, done);
    return promise;
  }

  /**
   * Standings of a class ("H21", relay leg "Mixed-2"). maxAgeMs reuses a fetch that recent
   * (e.g. the poll that just detected the change); force skips every cache.
   */
  async getClassResults(
    competitionId: number,
    className: string,
    opts: { maxAgeMs?: number; force?: boolean } = {}
  ): Promise<Cached<ClassResults>> {
    const key = `${competitionId}_${className}`;
    if (opts.maxAgeMs && !opts.force) {
      const recent = this.cache.classResults.get(key);
      if (recent && Date.now() - recent.timestamp <= opts.maxAgeMs) {
        return { data: recent.data, hash: recent.hash, timestamp: recent.timestamp, changed: false };
      }
    }
    const c = await this.competition(competitionId);
    const resolved = await this.resolveClass(c.id, className);
    const leg = resolved.leg;
    let cls = resolved.cls;
    if (opts.force) this.entriesCache.delete(`${c.id}|${cls.id}`);
    const all = await this.entries(c.id, cls.id);
    if (this.source.classDetails) cls = { ...cls, ...(await this.source.classDetails(c.id, cls.id)) };
    const data = buildClassResults({
      competitionId,
      className,
      cls,
      leg,
      entries: leg ? all.filter(e => e.team?.leg === leg) : all,
      pluginId: this.pluginId,
      competitionExt: c.ext
    });
    const hash = this.hash(data);
    const changed = this.cache.classResults.get(key)?.hash !== hash;
    const timestamp = Date.now();
    this.cache.classResults.set(key, { data, hash, timestamp });
    return { data, hash, timestamp, changed };
  }

  /** The latest passings (newest first) when the source has a passings feed */
  async getLastPassings(competitionId: number, count = 20): Promise<Cached<PassingRow[]>> {
    let data: PassingRow[] = [];
    if (this.source.passings) {
      const c = await this.competition(competitionId);
      const classes = await this.loadClasses(c.id, this.pollInterval() * 5);
      const results = new Map<string, ClassResults>();
      for (const p of (await this.source.passings(c.id, count)).slice(0, count)) {
        const cls = classes.find(x => x.id === p.classId);
        if (!cls) continue;
        const entry = (await this.entries(c.id, cls.id)).find(e => e.id === p.entryId);
        if (!entry) continue;
        const leg = cls.kind === 'relay' ? entry.team?.leg : undefined;
        const className = leg ? `${cls.name}-${leg}` : cls.name;
        let res = results.get(className);
        if (!res) {
          res = (await this.getClassResults(competitionId, className, { maxAgeMs: 1000 })).data;
          results.set(className, res);
        }
        const control = cls.radioControls.find(x => x.id === p.controlId);
        if (!control) continue;
        const key = splitCode(control);
        const row = res.rows.find(r => r.entryId === entry.id);
        if (!row) continue;
        const split = row.splits[key];
        data.push({
          at: p.at,
          className,
          name: row.name,
          club: row.club,
          ...(row.bib ? { bib: row.bib } : {}),
          controlKey: key,
          controlName: control.name || `Control ${control.code ?? control.id}`,
          time: split?.time ?? 0,
          ...(split?.place !== undefined ? { place: split.place } : {}),
          ...(split?.behind !== undefined ? { behind: split.behind } : {})
        });
      }
    }
    data = data.slice(0, count);
    const hash = this.hash(data);
    const changed = this.cache.passings.get(competitionId)?.hash !== hash;
    this.cache.passings.set(competitionId, { hash });
    return { data, hash, timestamp: Date.now(), changed };
  }

  // --- polling ---------------------------------------------------------------------------

  startPolling(config: PollingConfig): string {
    const pollId = config.className ? `${config.competitionId}_${config.className}` : `${config.competitionId}_passings`;
    this.stopPolling(pollId);
    const interval = Math.max(config.interval, this.pollInterval());
    logger.info('Starting polling', { source: this.label, pollId, interval });

    // Never overlap polls: during an outage a request can outlast the interval, and stacking
    // more requests on a struggling source only makes things worse
    let inFlight = false;
    let queued = false;
    const poll = async (pushed = false) => {
      if (inFlight) {
        if (pushed) queued = true; // a push during a running poll is replayed right after it
        return;
      }
      inFlight = true;
      try {
        const result: Cached<any> = config.className
          ? await this.getClassResults(config.competitionId, config.className, { force: pushed })
          : await this.getLastPassings(config.competitionId);
        config.onPoll?.(result.changed, interval);
        if (result.changed) config.onUpdate(result.data);
      } catch (error) {
        logger.error('Polling error', { source: this.label, pollId, error: (error as Error).message });
        config.onError?.(error as Error);
      } finally {
        inFlight = false;
        if (queued && this.pollingTimers.has(pollId)) {
          queued = false;
          void poll(true);
        }
      }
    };

    this.pollingTimers.set(pollId, setInterval(() => void poll(), interval));
    this.pollTriggers.set(pollId, () => void poll(true));
    this.polled.set(pollId, { competitionId: config.competitionId, className: config.className });
    void poll();
    void this.competition(config.competitionId)
      .then(c => this.loadClasses(c.id, this.pollInterval() * 5))
      .then(() => this.updateWatch(config.competitionId))
      .catch(() => undefined);
    return pollId;
  }

  stopPolling(pollId: string): void {
    const timer = this.pollingTimers.get(pollId);
    if (!timer) return;
    clearInterval(timer);
    this.pollingTimers.delete(pollId);
    this.pollTriggers.delete(pollId);
    const p = this.polled.get(pollId);
    this.polled.delete(pollId);
    if (p) this.updateWatch(p.competitionId);
    logger.info('Stopped polling', { source: this.label, pollId });
  }

  stopAllPolling(): void {
    for (const pollId of [...this.pollingTimers.keys()]) this.stopPolling(pollId);
  }

  clearCache(): void {
    this.cache.classResults.clear();
    this.cache.classes.clear();
    this.cache.passings.clear();
    this.cache.competitions = undefined;
    this.entriesCache.clear();
    this.classCache.clear();
    this.infoCache.clear();
  }

  getCacheStats() {
    return {
      competitions: this.competitionsById.size,
      classes: this.cache.classes.size,
      classResults: this.cache.classResults.size,
      polls: this.pollingTimers.size
    };
  }

  destroy(): void {
    this.stopAllPolling();
    this.clearCache();
  }
}

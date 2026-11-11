/**
 * The timing data the core works with: what every source's facts become once Split Control
 * has worked out the standings. Times are milliseconds, instants epoch ms (UTC), statuses the
 * SDK's. Base tags for graphics (centiseconds, "m:ss" strings ...) are made from this at the
 * edge (ResultsTransformer, DataSourceFieldMapper), never stored in it.
 */

import type { EntryStatus, Ext } from '../../../shared/timing-sdk';
import { DEFAULT_COMPETITION_TIMEZONE, timeZoneOffsetMs, zonedWallTimeToEpochMs } from '../liveTime';

/** The number graphics know a status by (base tag statusCode) */
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
  movedUp: 12,
  okNoTime: 20,
  notCompeting: null
};

const STATUS_BY_CODE = new Map(Object.entries(STATUS_CODES).filter(([, c]) => c !== null).map(([s, c]) => [c as number, s as EntryStatus]));

/** A status code from a source that uses the same numbers (Liveresultat) */
export function statusFromCode(code: number): EntryStatus {
  return STATUS_BY_CODE.get(code) ?? (code === 0 ? 'ok' : 'notStarted');
}

export interface CompetitionInfo {
  /** The number Split Control knows the competition by (saved in events) */
  id: number;
  /** The source's id */
  sourceId: string;
  name: string;
  organiser: string;
  /** YYYY-MM-DD */
  date: string;
  /** IANA zone, when the source gives one */
  timezone?: string;
  /** Hours added to the zone's clock (Liveresultat legacy timediff), usually 0 */
  timediffHours: number;
  location?: string;
  ext?: Ext;
}

/** A class as the desk and graphics choose it: relays per leg ("Mixed-2") */
export interface ClassRef {
  className: string;
  classId: string;
  /** Relays: this leg, and the number of legs */
  leg?: number;
  legs?: number;
}

export interface ResultControl {
  /** The number graphics and saved settings know the control by (1050 = first visit to 50) */
  key: number;
  /** The source's id for it */
  id: string;
  code?: number;
  name: string;
}

export interface SplitResult {
  /** At the control: own time, or the team's time for relays (ms) */
  time: number;
  /** Status code at the control (0 = passed normally) */
  status: number;
  place?: number;
  behind?: number;
}

export interface ResultRow {
  entryId: string;
  name: string;
  /** Club as shown (short name if any); the team for relays */
  club: string;
  bib?: string;
  country?: string;
  status: EntryStatus;
  statusCode: number;
  ranked: boolean;
  place?: number;
  /** Same place as the runner before ("=") */
  tied: boolean;
  /** Result (ms): from the team's start for relays */
  time?: number;
  behind?: number;
  start?: number;
  /** Relays: the team's start (epoch ms) */
  teamStart?: number;
  progress: number;
  /** By control key */
  splits: Record<number, SplitResult>;
  team?: { id: string; name: string; bib?: string; leg: number };
  /** Keyed by plugin id */
  ext?: Record<string, Ext>;
}

export interface ClassResults {
  competitionId: number;
  className: string;
  classId: string;
  leg?: number;
  controls: ResultControl[];
  /** In display order: placed, running, then the rest (or the source's order) */
  rows: ResultRow[];
  course?: { lengthM?: number; climbM?: number; controls?: number };
  /** Class and competition fields, keyed by plugin id */
  ext?: Record<string, Ext>;
}

/** Hundredths since local midnight of the competition day (wall clock), 0 for none */
export function wallClockCs(info: Pick<CompetitionInfo, 'date' | 'timezone' | 'timediffHours'>, ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return 0;
  const tz = info.timezone || DEFAULT_COMPETITION_TIMEZONE;
  const shifted = ms + (info.timediffHours || 0) * 3600_000;
  const local = shifted + timeZoneOffsetMs(shifted, tz);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(info.date ?? '');
  if (m) return Math.max(0, Math.round((local - Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) / 10));
  return Math.round((((local % 86400000) + 86400000) % 86400000) / 10);
}

/** The instant of a wall-clock time on the competition day (inverse of wallClockCs) */
export function instantOfWallClock(info: Pick<CompetitionInfo, 'date' | 'timezone' | 'timediffHours'>, cs: number): number | undefined {
  if (!Number.isFinite(cs) || cs <= 0) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(info.date ?? '');
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [1970, 1, 2];
  return zonedWallTimeToEpochMs(y, mo, d, cs * 10, info.timezone || DEFAULT_COMPETITION_TIMEZONE) - (info.timediffHours || 0) * 3600_000;
}

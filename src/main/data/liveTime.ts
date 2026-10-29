/**
 * Live time helpers
 *
 * Liveresultat start times are hundredths of a second since local midnight of the
 * competition day. Templates that show a running clock need an absolute instant,
 * independent of the time zone and clock of the machine that renders the graphic.
 *
 * Competition local time:
 *  - REST API: `timezone` (IANA) when set. Its `timediff` is derived from it.
 *  - Otherwise: Swedish time (Europe/Stockholm, CET/CEST) shifted by `timediff` hours,
 *    which is how the legacy API documents `timediff` ("offset from CET").
 */

export const DEFAULT_COMPETITION_TIMEZONE = 'Europe/Stockholm';

/**
 * Offset (ms) of `timeZone` from UTC at the given UTC instant.
 * Positive east of Greenwich, e.g. +7200000 for CEST.
 */
export function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * UTC epoch ms of the given local wall-clock time in `timeZone`.
 * Handles DST by re-checking the offset at the resulting instant.
 */
export function zonedWallTimeToEpochMs(
  year: number, month: number, day: number, msSinceMidnight: number, timeZone: string
): number {
  const naive = Date.UTC(year, month - 1, day) + msSinceMidnight;
  let epoch = naive - timeZoneOffsetMs(naive, timeZone);
  const corrected = naive - timeZoneOffsetMs(epoch, timeZone);
  if (corrected !== epoch) epoch = corrected;
  return epoch;
}

function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface CompetitionClock {
  /** YYYY-MM-DD */
  date: string;
  /** IANA zone used to interpret start times */
  timeZone: string;
  /** Extra hours added on top of timeZone (legacy timediff); 0 when an explicit IANA zone is used */
  timediffHours: number;
}

export function competitionClock(info: { date?: string; timezone?: string; timediff?: number }): CompetitionClock | null {
  if (!info.date || !/^\d{4}-\d{2}-\d{2}$/.test(info.date)) return null;
  if (isValidTimeZone(info.timezone)) {
    return { date: info.date, timeZone: info.timezone, timediffHours: 0 };
  }
  return {
    date: info.date,
    timeZone: DEFAULT_COMPETITION_TIMEZONE,
    timediffHours: Number.isFinite(info.timediff) ? Number(info.timediff) : 0
  };
}

/**
 * Absolute start instant (UTC epoch ms) for a start time in hundredths since local midnight.
 * Returns undefined for missing / non-positive start times.
 */
export function startTimeEpochMs(clock: CompetitionClock, startHundredths: number | string | undefined): number | undefined {
  const cs = typeof startHundredths === 'string' ? parseInt(startHundredths, 10) : startHundredths;
  if (cs === undefined || !Number.isFinite(cs) || cs <= 0) return undefined;
  const [y, m, d] = clock.date.split('-').map(Number);
  return zonedWallTimeToEpochMs(y, m, d, cs * 10, clock.timeZone) - clock.timediffHours * 3600_000;
}

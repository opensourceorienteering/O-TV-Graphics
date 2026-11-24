/**
 * MeOS conventions shared by the MeOS information server source and the MOP SQL profile
 * (MeOS source, code/oBase.h and the MOP spec).
 *
 *  - Runner status: 0 unknown, 1 OK, 2 no timing, 3 MP, 4 DNF, 5 DQ, 6 overtime (MAX),
 *    15 out of competition, 20 DNS, 21 cancelled, 99 not competing.
 *  - A repeated control's id is control + 100000 * (visit - 1).
 *  - Times are tenths of a second; start times count from 00:00:00 of the competition day.
 */

import type { Control, EntryStatus } from '../../../shared/timing-sdk';
import { STATUS_CODES } from '../timing/model';
import { splitCode } from '../timing/ranking';
import { DEFAULT_COMPETITION_TIMEZONE, zonedWallTimeToEpochMs } from '../liveTime';

/** MeOS runner status -> SDK status */
export function meosStatus(stat: number, hasPassings: boolean): { status: EntryStatus; ranked: boolean } {
  switch (stat) {
    case 1: return { status: 'ok', ranked: true };
    case 2: return { status: 'okNoTime', ranked: true };
    case 3: return { status: 'mispunch', ranked: true };
    case 4: return { status: 'dnf', ranked: true };
    case 5: return { status: 'dsq', ranked: true };
    case 6: return { status: 'overtime', ranked: true };
    case 15: return { status: 'ok', ranked: false }; // out of competition: shown, never ranked
    case 20: return { status: 'dns', ranked: true };
    case 21: return { status: 'cancelled', ranked: true };
    case 99: return { status: 'notCompeting', ranked: false };
    default: return { status: hasPassings ? 'running' : 'notStarted', ranked: true };
  }
}

/** MeOS runner status -> the core's status code. null = leave the row out. */
export function mopStatusToLiveResults(stat: number, hasPassings: boolean): number | null {
  return STATUS_CODES[meosStatus(stat, hasPassings).status];
}

/** SDK control for a MeOS control id (visit encoded as control + 100000 * repeat) */
export function meosControl(ctrl: number, name?: string, leg?: number): Control {
  return {
    id: String(ctrl),
    code: ctrl % 100000,
    visit: Math.floor(ctrl / 100000) + 1,
    ...(name ? { name } : {}),
    ...(leg ? { leg } : {})
  };
}

/** The core's split code for a MeOS control id (1000 + control for the first visit) */
export function mopSplitCode(ctrl: number): number {
  return splitCode(meosControl(ctrl));
}

/** Tenths since local midnight of `date` -> epoch ms (undefined for none) */
export function meosClock(date: string, timezone?: string): (tenths: number) => number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  // Without a date, any day gives the right time of day
  const [y, mo, d] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [1970, 1, 2];
  const tz = timezone || DEFAULT_COMPETITION_TIMEZONE;
  return (tenths) => (tenths > 0 ? zonedWallTimeToEpochMs(y, mo, d, tenths * 100, tz) : undefined);
}

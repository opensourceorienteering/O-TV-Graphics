/**
 * Liveresultat's data as its APIs send it (only inside the Liveresultat plugin).
 * Docs: https://liveresultat.orientering.se/beta/docs
 *
 * Times are hundredths of a second; start times hundredths since local midnight of the
 * competition day. Split keys: "<code>" (time), "<code>_status", "<code>_place",
 * "<code>_timeplus". Relay legs are separate classes ("Mixed-1", "Mixed-2" …) with times
 * from the team's start.
 */

export interface LrCompetition {
  id: number;
  name: string;
  organizer: string;
  date: string;
  timediff: number;
  /** REST: IANA zone when the organiser set one ("" otherwise) */
  timezone?: string;
  multiDayStage?: number;
  multiDayFirstDay?: number;
}

export interface LrSplitControl {
  code: number;
  name: string;
}

export interface LrResult {
  place: string;
  name: string;
  club: string;
  /** Hundredths ("" when none) */
  result: string | number;
  status: number;
  timeplus: string | number;
  progress: number;
  start: number;
  splits?: Record<string, number | string>;
  bib?: string;
  dbId?: number;
  country?: string;
  changed?: number;
}

/** getclassresults (legacy) / classresults (REST, mapped to the legacy shape) */
export interface LrClassResult {
  className: string;
  splitcontrols: LrSplitControl[];
  results: LrResult[];
  hash?: string;
}

/** REST /classresults body */
export interface LrRestClassResult {
  className: string;
  splitControls?: LrSplitControl[];
  results?: (Omit<LrResult, 'result' | 'timeplus'> & { result?: number | string | null; timeplus?: number | string | null })[];
  [extra: string]: unknown;
}

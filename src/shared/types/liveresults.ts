/**
 * LiveResults API Type Definitions
 * Based on LiveResults API documentation
 */

export interface LiveResultsConfig {
  baseUrl: string;
  cacheInterval: number; // milliseconds (minimum 15000)
  timeout: number;
}

export interface LiveResultsCompetition {
  id: number;
  name: string;
  organizer: string;
  date: string;
  timediff: number;
  // REST API extras
  multiDayStage?: number;
  multiDayFirstDay?: number;
  country?: string;
  hasResults?: boolean;
}

/** One competition's details (getcompetitioninfo / GET /competitions/{id}) */
export interface LiveResultsCompetitionInfo {
  id: number;
  name: string;
  organizer: string;
  date: string;          // YYYY-MM-DD
  timediff: number;      // hours relative to Swedish time
  timezone?: string;     // IANA zone (REST API, when the organizer set one)
  multiDayStage?: number;
  multiDayFirstDay?: number;
}

export interface LiveResultsClass {
  className: string;
}

/**
 * Split control definition from the API
 * Example: { code: 1124, name: "[124] Radio 1" }
 */
export interface LiveResultsSplitControl {
  code: number;
  name: string;
}

/**
 * Split times object from the API
 * Structure: {
 *   "1124": 52200,              // Split time in centiseconds
 *   "1124_status": 0,           // Status at this control
 *   "1124_place": 4,            // Position at this control
 *   "1124_timeplus": 2300       // Time behind leader in centiseconds
 * }
 */
export type LiveResultsSplitsObject = Record<string, number | string>;

export interface LiveResultsResult {
  place: string;
  name: string;
  club: string;
  result: string;
  status: number; // 0=OK, 1=DNS, 2=DNF, 3=MP, 4=DSQ, 5=OT
  timeplus: string;
  progress: number;
  start: number;
  /**
   * Relays: hundredths since midnight when the team started. Leg results and splits count from
   * it (team perspective), while `start` is this runner's own start (the changeover).
   */
  teamstart?: number;
  splits?: LiveResultsSplitsObject; // Split times object with dynamic keys
  // REST API extras
  bib?: string;
  changed?: number;      // UNIX seconds of last change
  startChanged?: number; // UNIX seconds
}

export interface LiveResultsClassResult {
  className: string;
  splitcontrols: LiveResultsSplitControl[];
  results: LiveResultsResult[];
  hash: string;
  /** Course facts when the source has them (IOF XML ClassResult/Course) */
  course?: ClassCourse;
}

export interface ClassCourse {
  /** metres */
  length?: number;
  /** metres */
  climb?: number;
  controls?: number;
}

export interface LiveResultsPassing {
  passtime: string;
  runnerName: string;
  club: string;
  class: string;
  control: string;
  controlName: string;
  time: string;
  place: number;
  // Only present when fetched from the REST API (api.orienteering.services)
  bib?: string;
  timeplus?: number; // hundredths behind at this control
  changed?: number;  // UNIX seconds
}

export interface LiveResultsRadioControl {
  code: string;
  name: string;
}

export interface LiveResultsCache {
  competitions?: {
    data: LiveResultsCompetition[];
    hash: string;
    timestamp: number;
  };
  classes?: {
    [competitionId: number]: {
      data: LiveResultsClass[];
      hash: string;
      timestamp: number;
    };
  };
  classResults?: {
    [key: string]: { // key: `${competitionId}_${className}`
      data: LiveResultsClassResult;
      hash: string;
      timestamp: number;
    };
  };
  lastPassings?: {
    [competitionId: number]: {
      data: LiveResultsPassing[];
      hash: string;
      timestamp: number;
    };
  };
}

export type RunnerStatus =
  | 0   // OK
  | 1   // DNS (Did Not Start)
  | 2   // DNF (Did Not Finish)
  | 3   // MP (Missing Punch)
  | 4   // DSQ (Disqualified)
  | 5   // OT (Over Time)
  | 9   // Not started yet
  | 10  // Running
  | 11  // Walkover
  | 12  // Moved up
  | 20; // Approved without time (REST API)

export const RunnerStatusText: Record<RunnerStatus, string> = {
  0: 'OK',
  1: 'DNS',
  2: 'DNF',
  3: 'MP',
  4: 'DSQ',
  5: 'OT',
  9: '',
  10: '',
  11: 'WO',
  12: 'Moved up',
  20: 'OK'
};


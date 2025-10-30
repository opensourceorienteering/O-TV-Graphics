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
  splits?: LiveResultsSplitsObject; // Split times object with dynamic keys
}

export interface LiveResultsClassResult {
  className: string;
  splitcontrols: LiveResultsSplitControl[];
  results: LiveResultsResult[];
  hash: string;
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
  | 0  // OK
  | 1  // DNS (Did Not Start)
  | 2  // DNF (Did Not Finish)
  | 3  // MP (Missing Punch)
  | 4  // DSQ (Disqualified)
  | 5; // OT (Over Time)

export const RunnerStatusText: Record<RunnerStatus, string> = {
  0: 'OK',
  1: 'DNS',
  2: 'DNF',
  3: 'MP',
  4: 'DSQ',
  5: 'OT'
};


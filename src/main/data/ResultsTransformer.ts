/**
 * Results base tags for graphics: a class's standings (timing/model.ts) as the rows results,
 * split and start list graphics show (position, name, club, time, diff, status …).
 *
 * The rules here are what graphics have always shown; times are formatted from hundredths of
 * a second, as before.
 */

import type { ClassResults, CompetitionInfo, ResultRow } from './timing/model';
import { wallClockCs } from './timing/model';

/** Status text graphics show, by status code */
export const STATUS_TEXT: Record<number, string> = {
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

/** One runner in a results / split / start list (base tags) */
export interface OGrafRunner {
  position: number | string;
  name: string;
  club: string;
  time: string;
  diff: string;
  status: string;
  statusCode: number;
  progress: number;
  country?: string;
  bib?: string;
  /** Start time of day (h:mm:ss or m:ss) */
  startTime?: string;
}

export interface OGrafResultsData {
  title: string;
  results: OGrafRunner[];
  maxRows?: number;
  className?: string;
  competitionName?: string;
  timestamp: number;
}

export interface TransformOptions {
  maxRows?: number;
  competitionName?: string;
  /** A radio control key ("1062"), "Start"/"S" for start times, "F"/"finish" for the finish */
  controlCode?: string;
  /** The competition, for start times of day */
  clock?: Pick<CompetitionInfo, 'date' | 'timezone' | 'timediffHours'>;
}

const cs = (ms: number) => Math.round(ms / 10);

export class ResultsTransformer {
  /** Seconds as h:mm:ss or m:ss; "--:--" for none */
  static formatTime(seconds: number | string): string {
    if (typeof seconds === 'string') return seconds;
    if (!seconds || seconds <= 0) return '--:--';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /** Seconds behind as "+1:23"; "" for none */
  static formatTimeDiff(seconds: number | string): string {
    if (typeof seconds === 'string') {
      if (seconds.startsWith('+')) return seconds;
      const parsed = parseInt(seconds, 10);
      if (isNaN(parsed)) return seconds;
      seconds = parsed;
    }
    if (!seconds || seconds <= 0) return '';
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `+${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  static getStatusText(statusCode: number): string {
    return STATUS_TEXT[statusCode] ?? 'OK';
  }

  /** Time of day of a runner's start (h:mm:ss / m:ss); "0:00" when unknown */
  private static startOfDay(row: ResultRow, options: TransformOptions): { text: string; seconds: number } {
    const startCs = options.clock ? wallClockCs(options.clock, row.start) : 0;
    const seconds = startCs / 100;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const text = hours > 0
      ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      : `${minutes}:${secs.toString().padStart(2, '0')}`;
    return { text, seconds };
  }

  /** The position a list shows for a placed runner: "=" for a tie, the place, or its row number */
  private static placeText(row: ResultRow, index: number): string | number {
    if (row.tied) return '=';
    return row.place !== undefined ? String(row.place) : index + 1;
  }

  private static transformRunner(row: ResultRow, index: number, leaderTime: number | undefined, options: TransformOptions): OGrafRunner {
    const timeSeconds = row.time !== undefined ? cs(row.time) / 100 : 0;
    let diff = '';
    if (row.statusCode === 0 && timeSeconds > 0 && leaderTime && leaderTime > 0) {
      const diffSeconds = timeSeconds - leaderTime;
      if (diffSeconds > 0) diff = this.formatTimeDiff(diffSeconds);
    }
    if (!diff && row.behind !== undefined && cs(row.behind) > 0) diff = this.formatTimeDiff(cs(row.behind) / 100);
    return {
      position: row.statusCode === 0 ? this.placeText(row, index) : '',
      name: row.name || 'Unknown',
      club: row.club || '',
      time: row.statusCode === 0 ? this.formatTime(timeSeconds) : '--:--',
      diff,
      status: this.getStatusText(row.statusCode),
      statusCode: row.statusCode,
      progress: row.progress || 0,
      country: undefined,
      startTime: this.startOfDay(row, options).text
    };
  }

  static transformClassResults(classResult: ClassResults, options: TransformOptions = {}): OGrafResultsData {
    if (options.controlCode === 'Start' || options.controlCode === 'S') {
      return this.transformStartTimes(classResult, options);
    }
    if (options.controlCode && options.controlCode !== 'F' && options.controlCode !== 'finish') {
      return this.transformSplitTimes(classResult, { ...options, controlCode: options.controlCode });
    }

    const leader = classResult.rows.find(r => r.statusCode === 0);
    const leaderTime = leader?.time !== undefined ? cs(leader.time) / 100 : undefined;
    const rows = options.maxRows ? classResult.rows.slice(0, options.maxRows) : classResult.rows;
    return {
      title: classResult.className || 'Results',
      results: rows.map((row, index) => this.transformRunner(row, index, leaderTime, options)),
      maxRows: options.maxRows,
      className: classResult.className,
      competitionName: options.competitionName,
      timestamp: Date.now()
    };
  }

  /**
   * Standings at a radio control: a runner who has passed it is ranked there (status OK at the
   * control) whatever their race status now. Runners who have not reached it are not ranked;
   * runners who are out keep their status (MP, DNF …). Sorted by the place at the control.
   */
  private static transformSplitTimes(classResult: ClassResults, options: TransformOptions & { controlCode: string }): OGrafResultsData {
    const { controlCode } = options;
    const keyOf = (row: ResultRow) => Object.keys(row.splits).find(k => k === controlCode);
    // Some runner has a time at this control, so it is a real radio control in the data
    const controlKnown = classResult.rows.some(r => keyOf(r) !== undefined);
    const rows = options.maxRows ? classResult.rows.slice(0, options.maxRows) : classResult.rows;

    const results = rows.map(row => {
      let splitTime: string;
      let splitDiff = '';
      let splitPlace = '';
      const key = keyOf(row);
      const split = key !== undefined ? row.splits[Number(key)] : undefined;
      if (split) {
        if (split.status !== 0) {
          splitTime = '--:--';
        } else {
          splitTime = this.formatTime(cs(split.time) / 100);
          if (split.behind !== undefined && cs(split.behind) > 0) splitDiff = this.formatTimeDiff(cs(split.behind) / 100);
        }
        if (split.place !== undefined) splitPlace = String(split.place);
      } else {
        // Not at this control: the finish result instead
        splitTime = row.time !== undefined ? this.formatTime(cs(row.time) / 100) : '';
        if (row.behind !== undefined) splitDiff = cs(row.behind) > 0 ? this.formatTimeDiff(cs(row.behind) / 100) : String(cs(row.behind));
      }
      const startTime = this.startOfDay(row, options).text || undefined;

      if (controlKnown) {
        const passed = splitTime !== '--:--' && split !== undefined;
        const out = [1, 2, 3, 4, 5, 11].includes(row.statusCode);
        const atControl = passed ? 0 : out ? row.statusCode : row.statusCode === 9 ? 9 : 10;
        return {
          position: passed ? splitPlace : '',
          name: row.name,
          club: row.club,
          time: passed ? splitTime : '--:--',
          diff: passed ? splitDiff : '',
          status: this.getStatusText(atControl),
          statusCode: atControl,
          progress: row.progress,
          startTime
        };
      }
      return {
        position: splitPlace || (row.tied ? '=' : row.place !== undefined ? String(row.place) : ''),
        name: row.name,
        club: row.club,
        time: splitTime,
        diff: splitDiff,
        status: this.getStatusText(row.statusCode),
        statusCode: row.statusCode,
        progress: row.progress,
        startTime
      };
    });

    const sorted = results.sort((a, b) => {
      const posA = parseInt(a.position as string, 10);
      const posB = parseInt(b.position as string, 10);
      if (isNaN(posA) && isNaN(posB)) return 0;
      if (isNaN(posA)) return 1;
      if (isNaN(posB)) return -1;
      return posA - posB;
    });

    return {
      title: `${classResult.className} - Control ${controlCode}`,
      results: sorted,
      maxRows: options.maxRows,
      className: classResult.className,
      competitionName: options.competitionName,
      timestamp: Date.now()
    };
  }

  /** Start list: everyone by start time (no start time last), numbered in start order */
  private static transformStartTimes(classResult: ClassResults, options: TransformOptions): OGrafResultsData {
    const results = classResult.rows
      .map(row => {
        const start = this.startOfDay(row, options);
        return {
          position: '',
          name: row.name,
          club: row.club,
          time: start.text,
          diff: '',
          status: this.getStatusText(row.statusCode),
          statusCode: row.statusCode,
          progress: row.progress,
          seconds: start.seconds
        };
      })
      .sort((a, b) => {
        if (a.seconds === 0 && b.seconds === 0) return 0;
        if (a.seconds === 0) return 1;
        if (b.seconds === 0) return -1;
        return a.seconds - b.seconds;
      })
      .map(({ seconds: _seconds, ...rest }, i) => ({ ...rest, position: (i + 1).toString() }));

    return {
      title: `${classResult.className} - Start Times`,
      results,
      maxRows: options.maxRows,
      className: classResult.className,
      competitionName: options.competitionName,
      timestamp: Date.now()
    };
  }
}

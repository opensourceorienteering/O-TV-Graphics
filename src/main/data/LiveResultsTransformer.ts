/**
 * LiveResults Data Transformer
 * Transforms LiveResults API responses into OGRAF-compatible data formats
 */

import { getLogger } from '../utils/logger';
import {
  LiveResultsResult,
  LiveResultsClassResult,
  LiveResultsCompetition,
  RunnerStatus,
  RunnerStatusText
} from '../../shared/types/liveresults';

const logger = getLogger();

/**
 * OGRAF-compatible runner data for results list
 */
export interface OGrafRunner {
  position: number | string;
  name: string;
  club: string;
  time: string;
  diff: string;
  status: string;
  statusCode: RunnerStatus;
  progress: number;
  country?: string;
  bib?: string; // Bib number (if available)
  startTime?: string; // Start time (formatted as HH:MM:SS or MM:SS)
}

/**
 * OGRAF-compatible results data
 */
export interface OGrafResultsData {
  title: string;
  results: OGrafRunner[];
  maxRows?: number;
  className?: string;
  competitionName?: string;
  timestamp: number;
}

/**
 * OGRAF-compatible runner spotlight data
 */
export interface OGrafRunnerSpotlight {
  name: string;
  club: string;
  country?: string;
  position: number | string;
  time: string;
  diff: string;
  status: string;
  statusCode: RunnerStatus;
  photo?: string;
}

/**
 * OGRAF-compatible competition info data
 */
export interface OGrafCompetitionInfo {
  eventName: string;
  className: string;
  location?: string;
  date: string;
  distance?: string;
  controls?: number;
}

/**
 * LiveResults Data Transformer
 */
export class LiveResultsTransformer {
  /**
   * Format time from seconds to HH:MM:SS or MM:SS
   */
  static formatTime(seconds: number | string): string {
    if (typeof seconds === 'string') {
      // Already formatted or invalid
      return seconds;
    }

    if (!seconds || seconds <= 0) {
      return '--:--';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Format time difference (e.g., "+1:23" or "+0:45")
   */
  static formatTimeDiff(seconds: number | string): string {
    if (typeof seconds === 'string') {
      // Check if already formatted
      if (seconds.startsWith('+')) {
        return seconds;
      }
      // Try to parse
      const parsed = parseInt(seconds, 10);
      if (isNaN(parsed)) {
        return seconds;
      }
      seconds = parsed;
    }

    if (!seconds || seconds <= 0) {
      return '';
    }

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);

    return `+${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Parse time string to seconds
   */
  static parseTime(timeStr: string): number {
    if (!timeStr || timeStr === '--:--') {
      return 0;
    }

    const parts = timeStr.split(':').map(p => parseInt(p, 10));
    
    if (parts.length === 3) {
      // HH:MM:SS
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // MM:SS
      return parts[0] * 60 + parts[1];
    }

    return 0;
  }

  /**
   * Get status text from status code
   */
  static getStatusText(statusCode: RunnerStatus): string {
    return RunnerStatusText[statusCode] || 'OK';
  }

  /**
   * Transform LiveResults runner to OGRAF runner
   */
  static transformRunner(
    result: LiveResultsResult,
    index: number,
    leaderTime?: number
  ): OGrafRunner {
    const statusCode = result.status as RunnerStatus;
    const status = this.getStatusText(statusCode);

    logger.debug(`[transformRunner] Processing runner ${index + 1}: ${result.name}`, {
      rawResult: result.result,
      rawResultType: typeof result.result,
      rawTimeplus: result.timeplus,
      rawTimeplusType: typeof result.timeplus,
      statusCode,
      leaderTime
    });

    // Parse result time
    // When unformattedTimes=true, result.result is a string containing centiseconds
    // When unformattedTimes=false, result.result is a formatted time string like "15:52"
    let timeSeconds = 0;
    if (typeof result.result === 'number') {
      // If it's a number, it's in centiseconds
      timeSeconds = result.result / 100;
      logger.debug(`[transformRunner] ${result.name}: Converted number centiseconds`, {
        centiseconds: result.result,
        seconds: timeSeconds
      });
    } else if (typeof result.result === 'string') {
      // Check if it's a numeric string (centiseconds) or formatted time
      const numericValue = parseInt(result.result, 10);
      if (!isNaN(numericValue) && !result.result.includes(':')) {
        // Numeric string without colon = centiseconds
        timeSeconds = numericValue / 100;
        logger.debug(`[transformRunner] ${result.name}: Converted string centiseconds`, {
          centisecondsStr: result.result,
          centiseconds: numericValue,
          seconds: timeSeconds
        });
      } else {
        // Formatted time string like "15:52"
        timeSeconds = this.parseTime(result.result);
        logger.debug(`[transformRunner] ${result.name}: Parsed formatted time`, {
          formattedTime: result.result,
          seconds: timeSeconds
        });
      }
    }

    // Calculate time difference from leader
    let diff = '';
    if (statusCode === 0 && timeSeconds > 0 && leaderTime && leaderTime > 0) {
      const diffSeconds = timeSeconds - leaderTime;
      if (diffSeconds > 0) {
        diff = this.formatTimeDiff(diffSeconds);
        logger.debug(`[transformRunner] ${result.name}: Calculated diff from leader`, {
          timeSeconds,
          leaderTime,
          diffSeconds,
          formattedDiff: diff
        });
      }
    }

    // Parse timeplus if available
    // When unformattedTimes=true, timeplus is a string containing centiseconds
    if (!diff && result.timeplus) {
      if (typeof result.timeplus === 'number') {
        diff = this.formatTimeDiff(result.timeplus / 100);
        logger.debug(`[transformRunner] ${result.name}: Using timeplus (number)`, {
          timeplusCentiseconds: result.timeplus,
          timeplusSeconds: result.timeplus / 100,
          formattedDiff: diff
        });
      } else if (typeof result.timeplus === 'string') {
        const timeplusNum = parseInt(result.timeplus, 10);
        if (!isNaN(timeplusNum) && timeplusNum > 0) {
          diff = this.formatTimeDiff(timeplusNum / 100);
          logger.debug(`[transformRunner] ${result.name}: Using timeplus (string centiseconds)`, {
            timeplusStr: result.timeplus,
            timeplusCentiseconds: timeplusNum,
            timeplusSeconds: timeplusNum / 100,
            formattedDiff: diff
          });
        } else if (result.timeplus.startsWith('+')) {
          // Already formatted
          diff = result.timeplus;
          logger.debug(`[transformRunner] ${result.name}: Using timeplus (already formatted)`, {
            timeplus: result.timeplus
          });
        }
      }
    }

    const formattedTime = statusCode === 0 ? this.formatTime(timeSeconds) : '--:--';

    logger.info(`[transformRunner] ${result.name}: Final output`, {
      position: result.place || index + 1,
      time: formattedTime,
      diff,
      statusCode,
      timeSeconds
    });

    return {
      position: result.place || index + 1,
      name: result.name || 'Unknown',
      club: result.club || '',
      time: formattedTime,
      diff,
      status,
      statusCode,
      progress: result.progress || 0,
      country: undefined // Not provided by LiveResults API
    };
  }

  /**
   * Transform class results to OGRAF results list data
   */
  static transformClassResults(
    classResult: LiveResultsClassResult,
    options?: {
      maxRows?: number;
      competitionName?: string;
      controlCode?: string; // If specified, transform split time results for this control
    }
  ): OGrafResultsData {
    logger.info('=== transformClassResults CALLED ===', {
      className: classResult.className,
      totalRunners: classResult.results?.length || 0,
      maxRows: options?.maxRows,
      controlCode: options?.controlCode,
      willLimitResults: !!options?.maxRows
    });

    // Log first 3 runners' raw data
    if (classResult.results && classResult.results.length > 0) {
      for (let i = 0; i < Math.min(3, classResult.results.length); i++) {
        const runner = classResult.results[i];
        logger.info(`[transformClassResults] Raw runner ${i + 1} data`, {
          name: runner.name,
          place: runner.place,
          result: runner.result,
          resultType: typeof runner.result,
          timeplus: runner.timeplus,
          timeplusType: typeof runner.timeplus,
          status: runner.status
        });
      }
    }

    // If controlCode is "Start", transform start time results
    if (options?.controlCode && (options.controlCode === 'Start' || options.controlCode === 'S')) {
      return this.transformStartTimeResults(classResult, {
        maxRows: options.maxRows,
        competitionName: options.competitionName
      });
    }

    // If controlCode is specified (and not Finish or Start), transform split time results
    if (options?.controlCode && options.controlCode !== 'F' && options.controlCode !== 'finish') {
      // TypeScript: We've checked that controlCode is defined above
      return this.transformSplitTimeResults(classResult, {
        ...options,
        controlCode: options.controlCode
      });
    }

    // Find leader time (first runner with status OK)
    let leaderTime: number | undefined;
    const leaderResult = classResult.results?.find(r => r.status === 0);
    if (leaderResult) {
      logger.info('[transformClassResults] Leader found', {
        name: leaderResult.name,
        result: leaderResult.result,
        resultType: typeof leaderResult.result
      });

      if (typeof leaderResult.result === 'number') {
        // If it's a number, it's in centiseconds
        leaderTime = leaderResult.result / 100;
        logger.info('[transformClassResults] Leader time from number', {
          centiseconds: leaderResult.result,
          seconds: leaderTime
        });
      } else if (typeof leaderResult.result === 'string') {
        // Check if it's a numeric string (centiseconds) or formatted time
        const numericValue = parseInt(leaderResult.result, 10);
        if (!isNaN(numericValue) && !leaderResult.result.includes(':')) {
          // Numeric string without colon = centiseconds
          leaderTime = numericValue / 100;
          logger.info('[transformClassResults] Leader time from string centiseconds', {
            centisecondsStr: leaderResult.result,
            centiseconds: numericValue,
            seconds: leaderTime
          });
        } else {
          // Formatted time string like "15:52"
          leaderTime = this.parseTime(leaderResult.result);
          logger.info('[transformClassResults] Leader time from formatted string', {
            formattedTime: leaderResult.result,
            seconds: leaderTime
          });
        }
      }
    }

    // Transform runners
    // If maxRows is specified, limit the results; otherwise return all runners
    const allResults = classResult.results || [];
    const resultsToTransform = options?.maxRows
      ? allResults.slice(0, options.maxRows)
      : allResults;

    const results = resultsToTransform.map((result, index) => {
      const runner = this.transformRunner(result, index, leaderTime);

      // Add start time if available (needed for live timing in templates)
      if (result.start !== undefined && result.start !== null) {
        const startTimeSeconds = result.start / 100; // Convert centiseconds to seconds
        const hours = Math.floor(startTimeSeconds / 3600);
        const minutes = Math.floor((startTimeSeconds % 3600) / 60);
        const seconds = Math.floor(startTimeSeconds % 60);

        let startTimeFormatted = '';
        if (hours > 0) {
          startTimeFormatted = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
          startTimeFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        return {
          ...runner,
          startTime: startTimeFormatted
        };
      }

      return runner;
    });

    logger.info('=== Class results transformed ===', {
      className: classResult.className,
      totalRunners: allResults.length,
      transformedRunners: results.length,
      maxRows: options?.maxRows,
      limited: !!options?.maxRows,
      leaderTime
    });

    // Log first 3 transformed runners
    if (results.length > 0) {
      for (let i = 0; i < Math.min(3, results.length); i++) {
        logger.info(`[transformClassResults] Transformed runner ${i + 1}`, {
          position: results[i].position,
          name: results[i].name,
          time: results[i].time,
          diff: results[i].diff,
          statusCode: results[i].statusCode
        });
      }
    }

    return {
      title: classResult.className || 'Results',
      results,
      maxRows: options?.maxRows,
      className: classResult.className,
      competitionName: options?.competitionName,
      timestamp: Date.now()
    };
  }

  /**
   * Transform class results to show split times for a specific control point
   *
   * The LiveResults API returns splits as an object with dynamic keys:
   * - "{code}": split time in centiseconds
   * - "{code}_status": status at this control
   * - "{code}_place": position at this control
   * - "{code}_timeplus": time behind leader in centiseconds
   */
  private static transformSplitTimeResults(
    classResult: LiveResultsClassResult,
    options: {
      maxRows?: number;
      competitionName?: string;
      controlCode: string;
    }
  ): OGrafResultsData {
    logger.info('=== SPLIT TIME TRANSFORMATION START ===', {
      className: classResult.className,
      controlCode: options.controlCode,
      controlCodeType: typeof options.controlCode,
      totalRunners: classResult.results?.length || 0
    });

    const controlCode = options.controlCode;
    const allResults = classResult.results || [];

    // Convert control code to the format used by the API (string key in splits object)
    // The API uses numeric codes like 1124 for control 124
    const splitKey = controlCode;

    logger.info('Split key being searched', {
      splitKey,
      splitKeyType: typeof splitKey
    });

    // Log available split keys for debugging
    const availableSplitKeys = new Set<string>();
    let firstRunnerSplitsObject: any = null;

    for (const result of allResults) {
      if (result.splits && typeof result.splits === 'object') {
        if (!firstRunnerSplitsObject) {
          firstRunnerSplitsObject = result.splits;
        }
        Object.keys(result.splits).forEach(key => {
          if (!key.endsWith('_status') && !key.endsWith('_place') && !key.endsWith('_timeplus')) {
            availableSplitKeys.add(key);
          }
        });
      }
    }

    logger.info('Available split keys in results', {
      keys: Array.from(availableSplitKeys),
      searchingFor: splitKey,
      firstRunnerSplitsKeys: firstRunnerSplitsObject ? Object.keys(firstRunnerSplitsObject) : 'NO SPLITS FOUND',
      firstRunnerSplitsObject: firstRunnerSplitsObject ? JSON.stringify(firstRunnerSplitsObject).substring(0, 500) : 'NO SPLITS'
    });

    // Find leader split time for this control
    let leaderSplitTime: number | undefined;
    for (const result of allResults) {
      if (result.status === 0 && result.splits && typeof result.splits === 'object') {
        const splitTimeValue = result.splits[splitKey];
        if (splitTimeValue !== undefined) {
          // Convert from centiseconds to seconds
          if (typeof splitTimeValue === 'number') {
            leaderSplitTime = splitTimeValue / 100;
          } else if (typeof splitTimeValue === 'string') {
            leaderSplitTime = parseInt(splitTimeValue, 10) / 100;
          }
          logger.debug('Found leader split time', {
            controlCode: splitKey,
            leaderName: result.name,
            splitTimeCentiseconds: splitTimeValue,
            leaderSplitTimeSeconds: leaderSplitTime
          });
          break;
        }
      }
    }

    // Transform runners with split time data
    const resultsToTransform = options.maxRows
      ? allResults.slice(0, options.maxRows)
      : allResults;

    const results = resultsToTransform.map((result, index) => {
      const statusCode = result.status as RunnerStatus;
      const status = this.getStatusText(statusCode);

      // Find split time for this control
      let splitTime = '--:--';
      let splitDiff = '';
      let splitPlace = '';

      if (result.splits && typeof result.splits === 'object') {
        // Extract split time from the splits object
        const splitTimeCentiseconds = result.splits[splitKey];
        const splitStatusKey = `${splitKey}_status`;
        const splitPlaceKey = `${splitKey}_place`;
        const splitTimeplusKey = `${splitKey}_timeplus`;

        logger.info(`[Runner ${index + 1}: ${result.name}] Extracting split data`, {
          splitKey,
          splitTimeCentiseconds,
          splitTimeCentisecondsType: typeof splitTimeCentiseconds,
          splitStatusKey,
          splitPlaceKey,
          splitTimeplusKey,
          availableKeys: Object.keys(result.splits).slice(0, 20) // First 20 keys
        });

        if (splitTimeCentiseconds !== undefined) {
          // Convert from centiseconds to seconds
          let splitTimeSeconds = 0;
          if (typeof splitTimeCentiseconds === 'number') {
            splitTimeSeconds = splitTimeCentiseconds / 100;
            logger.info(`[Runner ${index + 1}: ${result.name}] Converting centiseconds to seconds`, {
              centiseconds: splitTimeCentiseconds,
              seconds: splitTimeSeconds
            });
          } else if (typeof splitTimeCentiseconds === 'string') {
            splitTimeSeconds = parseInt(splitTimeCentiseconds, 10) / 100;
            logger.info(`[Runner ${index + 1}: ${result.name}] Parsing string centiseconds`, {
              centisecondsStr: splitTimeCentiseconds,
              seconds: splitTimeSeconds
            });
          }

          // Check if runner has a status at this control
          const splitStatus = result.splits[splitStatusKey];
          if (splitStatus !== undefined && splitStatus !== 0) {
            // Runner has a non-OK status at this control (DNS, DNF, MP, etc.)
            logger.info(`[Runner ${index + 1}: ${result.name}] Non-OK status at control`, {
              splitStatus,
              statusText: this.getStatusText(splitStatus as RunnerStatus)
            });
            splitTime = '--:--';
            splitDiff = '';
          } else {
            // Runner has OK status at this control
            splitTime = this.formatTime(splitTimeSeconds);
            logger.info(`[Runner ${index + 1}: ${result.name}] Formatted split time`, {
              seconds: splitTimeSeconds,
              formattedTime: splitTime
            });

            // Extract time difference from leader
            const splitTimeplusCentiseconds = result.splits[splitTimeplusKey];
            if (splitTimeplusCentiseconds !== undefined && splitTimeplusCentiseconds !== 0) {
              let splitTimeplusSeconds = 0;
              if (typeof splitTimeplusCentiseconds === 'number') {
                splitTimeplusSeconds = splitTimeplusCentiseconds / 100;
              } else if (typeof splitTimeplusCentiseconds === 'string') {
                splitTimeplusSeconds = parseInt(splitTimeplusCentiseconds, 10) / 100;
              }

              logger.info(`[Runner ${index + 1}: ${result.name}] Time difference`, {
                centiseconds: splitTimeplusCentiseconds,
                seconds: splitTimeplusSeconds
              });

              if (splitTimeplusSeconds > 0) {
                splitDiff = this.formatTimeDiff(splitTimeplusSeconds);
                logger.info(`[Runner ${index + 1}: ${result.name}] Formatted time diff`, {
                  seconds: splitTimeplusSeconds,
                  formattedDiff: splitDiff
                });
              }
            }
          }

          // Extract position at this control
          const splitPlaceValue = result.splits[splitPlaceKey];
          if (splitPlaceValue !== undefined) {
            splitPlace = splitPlaceValue.toString();
          }

          logger.info(`[Runner ${index + 1}: ${result.name}] FINAL RESULT`, {
            splitTime,
            splitDiff,
            splitPlace
          });
        } else {
          logger.warn(`[Runner ${index + 1}: ${result.name}] No split data for this control`, {
            controlCode: splitKey,
            availableSplitKeys: Object.keys(result.splits).filter(k => !k.endsWith('_status') && !k.endsWith('_place') && !k.endsWith('_timeplus'))
          });
          // FALLBACK: Use finish time data if split not found
          logger.info(`[Runner ${index + 1}: ${result.name}] Using finish time as fallback`, {
            finishTime: result.result,
            finishTimeplus: result.timeplus
          });
          if (typeof result.result === 'number') {
            splitTime = this.formatTime(result.result / 100); // Convert centiseconds to seconds
          } else if (typeof result.result === 'string') {
            // Check if it's a numeric string (centiseconds) or formatted time
            const numericValue = parseInt(result.result, 10);
            if (!isNaN(numericValue) && !result.result.includes(':')) {
              // Numeric string without colon = centiseconds
              splitTime = this.formatTime(numericValue / 100);
            } else {
              // Already formatted time string
              splitTime = result.result;
            }
          }
          if (result.timeplus) {
            if (typeof result.timeplus === 'number') {
              splitDiff = this.formatTimeDiff(result.timeplus / 100); // Convert centiseconds to seconds
            } else if (typeof result.timeplus === 'string') {
              const timeplusNum = parseInt(result.timeplus, 10);
              if (!isNaN(timeplusNum) && timeplusNum > 0) {
                splitDiff = this.formatTimeDiff(timeplusNum / 100);
              } else {
                splitDiff = result.timeplus;
              }
            }
          }
        }
      } else {
        logger.warn(`[Runner ${index + 1}: ${result.name}] No splits object available`, {
          hasSplits: !!result.splits,
          splitsType: typeof result.splits
        });
        // FALLBACK: Use finish time data if no splits object
        logger.info(`[Runner ${index + 1}: ${result.name}] Using finish time as fallback (no splits object)`, {
          finishTime: result.result,
          finishTimeplus: result.timeplus
        });
        if (typeof result.result === 'number') {
          splitTime = this.formatTime(result.result / 100); // Convert centiseconds to seconds
        } else if (typeof result.result === 'string') {
          // Check if it's a numeric string (centiseconds) or formatted time
          const numericValue = parseInt(result.result, 10);
          if (!isNaN(numericValue) && !result.result.includes(':')) {
            // Numeric string without colon = centiseconds
            splitTime = this.formatTime(numericValue / 100);
          } else {
            // Already formatted time string
            splitTime = result.result;
          }
        }
        if (result.timeplus) {
          if (typeof result.timeplus === 'number') {
            splitDiff = this.formatTimeDiff(result.timeplus / 100); // Convert centiseconds to seconds
          } else if (typeof result.timeplus === 'string') {
            const timeplusNum = parseInt(result.timeplus, 10);
            if (!isNaN(timeplusNum) && timeplusNum > 0) {
              splitDiff = this.formatTimeDiff(timeplusNum / 100);
            } else {
              splitDiff = result.timeplus;
            }
          }
        }
      }

      // Format start time if available
      let startTimeFormatted = '';
      if (result.start !== undefined && result.start !== null) {
        const startTimeSeconds = result.start / 100; // Convert centiseconds to seconds
        const hours = Math.floor(startTimeSeconds / 3600);
        const minutes = Math.floor((startTimeSeconds % 3600) / 60);
        const seconds = Math.floor(startTimeSeconds % 60);

        if (hours > 0) {
          startTimeFormatted = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
          startTimeFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }
      }

      return {
        position: splitPlace || result.place,
        name: result.name,
        club: result.club,
        time: splitTime,
        diff: splitDiff,
        status,
        statusCode,
        progress: result.progress,
        startTime: startTimeFormatted || undefined
      };
    });

    // Sort results by split position (not finish position)
    // The position field contains the runner's position at the selected split
    const sortedResults = results.sort((a, b) => {
      // Parse positions as numbers for proper sorting
      const posA = parseInt(a.position as string, 10);
      const posB = parseInt(b.position as string, 10);

      // Handle invalid positions (NaN) by putting them at the end
      if (isNaN(posA) && isNaN(posB)) return 0;
      if (isNaN(posA)) return 1;
      if (isNaN(posB)) return -1;

      return posA - posB;
    });

    logger.info('Split time results transformed and sorted', {
      className: classResult.className,
      controlCode,
      totalRunners: allResults.length,
      transformedRunners: sortedResults.length,
      leaderSplitTime,
      firstThreePositions: sortedResults.slice(0, 3).map(r => ({
        name: r.name,
        position: r.position,
        time: r.time
      }))
    });

    return {
      title: `${classResult.className} - Control ${controlCode}`,
      results: sortedResults,
      maxRows: options.maxRows,
      className: classResult.className,
      competitionName: options.competitionName,
      timestamp: Date.now()
    };
  }

  /**
   * Transform class results to show start times
   *
   * The LiveResults API returns start time in the 'start' field (in centiseconds since midnight)
   * This method transforms the data to show start times and orders runners by their start time
   */
  private static transformStartTimeResults(
    classResult: LiveResultsClassResult,
    options: {
      maxRows?: number;
      competitionName?: string;
    }
  ): OGrafResultsData {
    logger.info('=== START TIME TRANSFORMATION START ===', {
      className: classResult.className,
      totalRunners: classResult.results?.length || 0
    });

    const allResults = classResult.results || [];

    // Transform all runners with start time data
    const results = allResults.map((result, index) => {
      const statusCode = result.status as RunnerStatus;
      const status = this.getStatusText(statusCode);

      // Extract start time (in centiseconds since midnight)
      let startTimeFormatted = '--:--';
      let startTimeSeconds = 0;

      if (result.start !== undefined && result.start !== null) {
        // Convert centiseconds to seconds
        startTimeSeconds = result.start / 100;

        // Format as HH:MM:SS or MM:SS
        const hours = Math.floor(startTimeSeconds / 3600);
        const minutes = Math.floor((startTimeSeconds % 3600) / 60);
        const seconds = Math.floor(startTimeSeconds % 60);

        if (hours > 0) {
          startTimeFormatted = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
          startTimeFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        logger.debug(`[Runner ${index + 1}: ${result.name}] Start time`, {
          startCentiseconds: result.start,
          startSeconds: startTimeSeconds,
          formatted: startTimeFormatted
        });
      } else {
        logger.warn(`[Runner ${index + 1}: ${result.name}] No start time available`);
      }

      return {
        position: '', // Will be set after sorting
        name: result.name,
        club: result.club,
        time: startTimeFormatted,
        diff: '', // No diff for start times
        status,
        statusCode,
        progress: result.progress,
        startTimeSeconds // Temporary field for sorting
      };
    });

    // Sort results by start time (earliest first)
    const sortedResults = results.sort((a, b) => {
      const timeA = (a as any).startTimeSeconds || 0;
      const timeB = (b as any).startTimeSeconds || 0;

      // Handle runners without start times (put them at the end)
      if (timeA === 0 && timeB === 0) return 0;
      if (timeA === 0) return 1;
      if (timeB === 0) return -1;

      return timeA - timeB;
    });

    // Assign positions based on start order and remove temporary field
    const finalResults = sortedResults.map((result, index) => {
      const { startTimeSeconds, ...rest } = result as any;
      return {
        ...rest,
        position: (index + 1).toString()
      };
    });

    logger.info('Start time results transformed and sorted', {
      className: classResult.className,
      totalRunners: allResults.length,
      transformedRunners: finalResults.length,
      firstThreeStartTimes: finalResults.slice(0, 3).map(r => ({
        name: r.name,
        position: r.position,
        startTime: r.time
      }))
    });

    return {
      title: `${classResult.className} - Start Times`,
      results: finalResults,
      maxRows: options.maxRows,
      className: classResult.className,
      competitionName: options.competitionName,
      timestamp: Date.now()
    };
  }

  /**
   * Transform single runner to spotlight data
   */
  static transformRunnerSpotlight(
    result: LiveResultsResult,
    options?: {
      leaderTime?: number;
      photo?: string;
    }
  ): OGrafRunnerSpotlight {
    const statusCode = result.status as RunnerStatus;
    const status = this.getStatusText(statusCode);

    // Parse result time
    // When unformattedTimes=true, result.result is a string containing centiseconds
    // When unformattedTimes=false, result.result is a formatted time string like "15:52"
    let timeSeconds = 0;
    if (typeof result.result === 'number') {
      // If it's a number, it's in centiseconds
      timeSeconds = result.result / 100;
    } else if (typeof result.result === 'string') {
      // Check if it's a numeric string (centiseconds) or formatted time
      const numericValue = parseInt(result.result, 10);
      if (!isNaN(numericValue) && !result.result.includes(':')) {
        // Numeric string without colon = centiseconds
        timeSeconds = numericValue / 100;
      } else {
        // Formatted time string like "15:52"
        timeSeconds = this.parseTime(result.result);
      }
    }

    // Calculate time difference from leader
    let diff = '';
    if (statusCode === 0 && timeSeconds > 0 && options?.leaderTime && options.leaderTime > 0) {
      const diffSeconds = timeSeconds - options.leaderTime;
      if (diffSeconds > 0) {
        diff = this.formatTimeDiff(diffSeconds);
      } else if (diffSeconds === 0) {
        diff = 'Leader';
      }
    }

    // Use timeplus if available
    // When unformattedTimes=true, timeplus is a string containing centiseconds
    if (!diff && result.timeplus) {
      if (typeof result.timeplus === 'number') {
        diff = this.formatTimeDiff(result.timeplus / 100);
      } else if (typeof result.timeplus === 'string') {
        const timeplusNum = parseInt(result.timeplus, 10);
        if (!isNaN(timeplusNum) && timeplusNum > 0) {
          diff = this.formatTimeDiff(timeplusNum / 100);
        } else if (result.timeplus.startsWith('+')) {
          // Already formatted
          diff = result.timeplus;
        }
      }
    }

    return {
      name: result.name || 'Unknown',
      club: result.club || '',
      country: undefined, // Not provided by LiveResults API
      position: result.place || '?',
      time: statusCode === 0 ? this.formatTime(timeSeconds) : '--:--',
      diff,
      status,
      statusCode,
      photo: options?.photo
    };
  }

  /**
   * Transform competition to OGRAF competition info data
   */
  static transformCompetitionInfo(
    competition: LiveResultsCompetition,
    className?: string,
    options?: {
      distance?: string;
      controls?: number;
    }
  ): OGrafCompetitionInfo {
    return {
      eventName: competition.name || 'Competition',
      className: className || '',
      location: competition.organizer || undefined,
      date: competition.date || new Date().toISOString().split('T')[0],
      distance: options?.distance,
      controls: options?.controls
    };
  }

  /**
   * Extract top N runners from results
   */
  static getTopRunners(
    classResult: LiveResultsClassResult,
    count: number = 3
  ): OGrafRunner[] {
    const leaderResult = classResult.results?.find(r => r.status === 0);
    let leaderTime: number | undefined;

    if (leaderResult) {
      if (typeof leaderResult.result === 'number') {
        // If it's a number, it's in centiseconds
        leaderTime = leaderResult.result / 100;
      } else if (typeof leaderResult.result === 'string') {
        // Check if it's a numeric string (centiseconds) or formatted time
        const numericValue = parseInt(leaderResult.result, 10);
        if (!isNaN(numericValue) && !leaderResult.result.includes(':')) {
          // Numeric string without colon = centiseconds
          leaderTime = numericValue / 100;
        } else {
          // Formatted time string like "15:52"
          leaderTime = this.parseTime(leaderResult.result);
        }
      }
    }

    return (classResult.results || [])
      .slice(0, count)
      .map((result, index) => this.transformRunner(result, index, leaderTime));
  }

  /**
   * Get runner by position
   */
  static getRunnerByPosition(
    classResult: LiveResultsClassResult,
    position: number
  ): OGrafRunner | null {
    const result = classResult.results?.find(r => r.place === position.toString());

    if (!result) {
      return null;
    }

    const leaderResult = classResult.results?.find(r => r.status === 0);
    let leaderTime: number | undefined;

    if (leaderResult) {
      if (typeof leaderResult.result === 'number') {
        // If it's a number, it's in centiseconds
        leaderTime = leaderResult.result / 100;
      } else if (typeof leaderResult.result === 'string') {
        // Check if it's a numeric string (centiseconds) or formatted time
        const numericValue = parseInt(leaderResult.result, 10);
        if (!isNaN(numericValue) && !leaderResult.result.includes(':')) {
          // Numeric string without colon = centiseconds
          leaderTime = numericValue / 100;
        } else {
          // Formatted time string like "15:52"
          leaderTime = this.parseTime(leaderResult.result);
        }
      }
    }

    return this.transformRunner(result, position - 1, leaderTime);
  }

  /**
   * Get runner by name
   */
  static getRunnerByName(
    classResult: LiveResultsClassResult,
    name: string
  ): OGrafRunner | null {
    const result = classResult.results?.find(r =>
      r.name.toLowerCase().includes(name.toLowerCase())
    );

    if (!result) {
      return null;
    }

    const index = classResult.results?.indexOf(result) || 0;
    const leaderResult = classResult.results?.find(r => r.status === 0);
    let leaderTime: number | undefined;

    if (leaderResult) {
      if (typeof leaderResult.result === 'number') {
        // If it's a number, it's in centiseconds
        leaderTime = leaderResult.result / 100;
      } else if (typeof leaderResult.result === 'string') {
        // Check if it's a numeric string (centiseconds) or formatted time
        const numericValue = parseInt(leaderResult.result, 10);
        if (!isNaN(numericValue) && !leaderResult.result.includes(':')) {
          // Numeric string without colon = centiseconds
          leaderTime = numericValue / 100;
        } else {
          // Formatted time string like "15:52"
          leaderTime = this.parseTime(leaderResult.result);
        }
      }
    }

    return this.transformRunner(result, index, leaderTime);
  }
}


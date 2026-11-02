import { CLASSIC_MODERN_CSS, classicHeadingHtml, updateClassicHeading, fitClassicHeading } from '../modern.js';
import { broadcastControlLabel } from '../../_core/labels.js';
import { livePatch, FLASH_CSS, applyThemeColors } from '../../_core/live.js';

// The set's bundled Inter: @font-face does not work inside shadow roots, so it goes into the document once
const CLASSIC_FONTS = new URL('../fonts/fonts.css', import.meta.url).href;
if (typeof document !== 'undefined' && !document.querySelector(`link[href="${CLASSIC_FONTS}"]`)) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CLASSIC_FONTS;
  document.head.appendChild(link);
}
/**
 * Split Time Lower Third (Runner) Template
 * Tracks a specific runner's progress at a selected control point with dynamic positioning
 * and live timing before split time is received.
 */

export default class SplitTimeLowerThirdRunner extends HTMLElement {
  // event theme colours follow the data (Settings → theme colours)
  get data() { return this._data; }
  set data(value) { this._data = value; applyThemeColors(this, value, ['--red', '--teal', '--mint']); }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    // Template data
    this.data = {
      className: '',
      controlCode: '',
      controlName: '',
      runnerId: '',
      runnerName: '',
      runnerBib: '',
      runnerClub: '',
      results: [],
      competitionDate: '' // Competition date in YYYY-MM-DD format
    };

    // State management
    this.selectedRunner = null; // The runner being tracked
    this.leader = null; // Current leader at this control
    this.displayRunners = []; // The 5 runners to display
    this.liveTimingActive = false; // Whether we're showing live timing
    this.liveTimingInterval = null; // Interval for live timing updates
    this.selectedRunnerStartTime = null; // Start time in seconds
    this.selectedRunnerSplitTime = null; // Confirmed split time (null if not received)
    this.isStartControl = false; // Whether this is the Start control
  }

  connectedCallback() {
    this.render();
  }

  /**
   * OGRAF Lifecycle: Load
   * Initialize the graphic with data
   */
  async load(options = {}) {
    try {
      console.log('[SplitTimeLowerThirdRunner] Load called', { options });

      if (options.data) {
        this.data = { ...this.data, ...options.data };
      }

      // Check if this is the Start control
      this.isStartControl = this.data.controlCode === 'Start' || 
                           this.data.controlCode === 'S' || 
                           this.data.controlName === 'Start';

      console.log('[SplitTimeLowerThirdRunner] Control type', {
        controlCode: this.data.controlCode,
        controlName: this.data.controlName,
        isStartControl: this.isStartControl
      });

      // Process the data
      this.processData();

      // Render the template
      this.render();

      return {
        statusCode: 200,
        message: 'Load completed'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThirdRunner] Load failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Load failed'
      };
    }
  }

  /**
   * Check if a runner has a valid time at the selected control point
   * Filters out runners who haven't passed the control yet
   */
  hasValidTime(runner) {
    if (!runner || !runner.time) {
      return false;
    }

    // Filter out runners with no time or placeholder times
    const time = runner.time;
    if (time === '--:--' || time === '' || time === null || time === undefined) {
      return false;
    }

    return true;
  }

  /**
   * Recalculate positions based on actual times
   * This fixes issues where the API provides incorrect or stale position data
   */
  recalculatePositions(results) {
    console.log('[SplitTimeLowerThirdRunner] Recalculating positions based on times');

    // Separate runners with valid times from those without
    const runnersWithTimes = [];
    const runnersWithoutTimes = [];

    for (const runner of results) {
      if (this.hasValidTime(runner)) {
        runnersWithTimes.push(runner);
      } else {
        runnersWithoutTimes.push(runner);
      }
    }

    // Find the leader's absolute time (time without "+" prefix)
    let leaderTime = 0;
    for (const runner of runnersWithTimes) {
      if (!runner.time.startsWith('+')) {
        leaderTime = this.parseTimeToSeconds(runner.time);
        console.log('[SplitTimeLowerThirdRunner] Found leader time', {
          name: runner.name,
          time: runner.time,
          seconds: leaderTime
        });
        break;
      }
    }

    // Calculate absolute time for each runner
    const runnersWithAbsoluteTimes = runnersWithTimes.map(runner => {
      let absoluteTime;
      if (runner.time.startsWith('+')) {
        // Time difference - add to leader time
        const diff = this.parseTimeToSeconds(runner.time);
        absoluteTime = leaderTime + diff;
      } else {
        // Absolute time
        absoluteTime = this.parseTimeToSeconds(runner.time);
      }

      return {
        runner,
        absoluteTime
      };
    });

    // Sort by absolute time (ascending = fastest first)
    runnersWithAbsoluteTimes.sort((a, b) => a.absoluteTime - b.absoluteTime);

    // Assign positions based on sorted order
    runnersWithAbsoluteTimes.forEach(({ runner }, index) => {
      const oldPosition = runner.position;
      runner.position = (index + 1).toString();

      if (oldPosition !== runner.position) {
        console.log('[SplitTimeLowerThirdRunner] Position corrected', {
          name: runner.name,
          time: runner.time,
          oldPosition,
          newPosition: runner.position
        });
      }
    });

    // Runners without times don't get a position (or keep their existing one)
    // This is fine - they'll be filtered out later anyway

    console.log('[SplitTimeLowerThirdRunner] Positions recalculated', {
      runnersWithTimes: runnersWithTimes.length,
      runnersWithoutTimes: runnersWithoutTimes.length,
      topThree: runnersWithAbsoluteTimes.slice(0, 3).map(({ runner }) => ({
        name: runner.name,
        position: runner.position,
        time: runner.time
      }))
    });
  }

  /**
   * Process data and set up runner tracking
   */
  processData() {
    const { results, runnerId, runnerName, runnerBib } = this.data;

    console.log('[SplitTimeLowerThirdRunner] Processing data', {
      resultsCount: results?.length || 0,
      runnerId,
      runnerName,
      runnerBib,
      hasResults: !!results,
      results: results
    });

    if (!results || results.length === 0) {
      console.warn('[SplitTimeLowerThirdRunner] No results available');
      this.displayRunners = [];
      return;
    }

    // CRITICAL FIX: Recalculate positions based on actual times
    // The API's position field may be stale or incorrect
    this.recalculatePositions(results);

    // Find the selected runner FIRST in the full results list (before filtering)
    // This ensures we can track them even if they haven't passed the control yet
    // Match by name (primary) or bib number (fallback)
    this.selectedRunner = results.find(r => {
      const nameMatch = r.name === runnerName;
      const bibMatch = runnerBib && r.bib === runnerBib;
      console.log('[SplitTimeLowerThirdRunner] Checking runner for selection', {
        runnerName: r.name,
        runnerBib: r.bib,
        searchName: runnerName,
        searchBib: runnerBib,
        nameMatch,
        bibMatch,
        hasTime: !!r.time,
        time: r.time,
        hasStartTime: !!r.startTime,
        startTime: r.startTime
      });
      return nameMatch || bibMatch;
    });

    if (!this.selectedRunner) {
      console.warn('[SplitTimeLowerThirdRunner] Selected runner not found in results', {
        runnerName,
        runnerBib,
        availableRunners: results.map(r => ({ name: r.name, bib: r.bib, time: r.time, startTime: r.startTime }))
      });

      // Fallback: Filter and show top 5 runners with valid times
      const runnersWithTimes = results.filter(r => this.hasValidTime(r));
      this.displayRunners = runnersWithTimes.slice(0, 5);
      console.log('[SplitTimeLowerThirdRunner] Showing top 5 runners with valid times as fallback', {
        count: this.displayRunners.length
      });
      return;
    }

    console.log('[SplitTimeLowerThirdRunner] Selected runner found', {
      name: this.selectedRunner.name,
      position: this.selectedRunner.position,
      time: this.selectedRunner.time,
      startTime: this.selectedRunner.startTime
    });

    // Filter out runners who haven't passed the control point yet
    // BUT keep the selected runner even if they don't have a confirmed time yet
    const runnersWithTimes = results.filter(r => {
      // Always include the selected runner (for live timing)
      if (r.name === this.selectedRunner.name && r.club === this.selectedRunner.club) {
        return true;
      }
      // For other runners, only include if they have a valid time
      return this.hasValidTime(r);
    });

    console.log('[SplitTimeLowerThirdRunner] Filtered runners with valid times', {
      totalRunners: results.length,
      runnersWithTimes: runnersWithTimes.length,
      filteredOut: results.length - runnersWithTimes.length,
      selectedRunnerIncluded: runnersWithTimes.some(r => r.name === this.selectedRunner.name)
    });

    // Store filtered results for use in calculateDisplayRunners
    this.runnersWithTimes = runnersWithTimes;

    // Store ALL results (unfiltered) for position calculations during live timing
    // We need the full list to properly calculate positions and find runners around the selected runner
    this.allRunners = results;

    if (runnersWithTimes.length === 0) {
      console.warn('[SplitTimeLowerThirdRunner] No runners with valid times yet');
      this.displayRunners = [];
      return;
    }

    // Find the leader (position 1) among runners with valid times
    this.leader = runnersWithTimes.find(r => r.position === '1' || r.position === 1);
    console.log('[SplitTimeLowerThirdRunner] Leader found', this.leader);

    console.log('[SplitTimeLowerThirdRunner] Selected runner found', {
      name: this.selectedRunner.name,
      position: this.selectedRunner.position,
      time: this.selectedRunner.time,
      startTime: this.selectedRunner.startTime
    });

    // Get the selected runner's start time.
    // Prefer startTimeMs: an absolute instant computed by OL-Grafik from the competition date and
    // time zone, so the clock is right whatever time zone this renderer runs in.
    if (Number.isFinite(this.selectedRunner.startTimeMs) && this.selectedRunner.startTimeMs > 0) {
      this.selectedRunnerStartTime = this.selectedRunner.startTimeMs / 1000;
    } else if (this.selectedRunner.startTime) {
      this.selectedRunnerStartTime = this.parseStartTimeToUnixTimestamp(this.selectedRunner.startTime);
      console.log('[SplitTimeLowerThirdRunner] Parsed start time', {
        startTimeString: this.selectedRunner.startTime,
        startTimeUnix: this.selectedRunnerStartTime,
        startTimeDate: new Date(this.selectedRunnerStartTime * 1000).toISOString()
      });
    } else {
      console.warn('[SplitTimeLowerThirdRunner] ⚠️  NO START TIME AVAILABLE', {
        runnerName: this.selectedRunner.name,
        runnerData: this.selectedRunner
      });
    }

    // SPECIAL CASE: For Start control, ALWAYS activate live timing
    // We always want to show countdown/count-up timer for Start control
    if (this.isStartControl) {
      this.selectedRunnerSplitTime = null;

      if (!this.liveTimingActive) {
        this.liveTimingActive = true;
        console.log('[SplitTimeLowerThirdRunner] ⏱️  START CONTROL - ACTIVATING LIVE TIMING (countdown/countup)', {
          runnerName: this.selectedRunner.name,
          startTime: this.selectedRunner.startTime
        });
      }
    } else {
      // For other controls (splits/finish), check if we have a confirmed split time
      // If time is "--:--" or empty, we don't have a split time yet
      const hasConfirmedTime = this.selectedRunner.time &&
                              this.selectedRunner.time !== '--:--' &&
                              this.selectedRunner.time !== '';

      console.log('[SplitTimeLowerThirdRunner] Checking for confirmed time', {
        runnerName: this.selectedRunner.name,
        time: this.selectedRunner.time,
        hasConfirmedTime,
        wasLiveTimingActive: this.liveTimingActive
      });

      if (hasConfirmedTime) {
        this.selectedRunnerSplitTime = this.parseTimeToSeconds(this.selectedRunner.time);

        // Stop live timing if it was active
        if (this.liveTimingActive) {
          console.log('[SplitTimeLowerThirdRunner] ✅ CONFIRMED TIME RECEIVED - STOPPING LIVE TIMING', {
            time: this.selectedRunner.time,
            seconds: this.selectedRunnerSplitTime,
            runnerName: this.selectedRunner.name
          });
          this.liveTimingActive = false;
          this.stopLiveTiming();
        } else {
          console.log('[SplitTimeLowerThirdRunner] Confirmed time already processed (live timing already stopped)', {
            time: this.selectedRunner.time
          });
        }
      } else {
        this.selectedRunnerSplitTime = null;

        // Only activate live timing if it wasn't already active
        if (!this.liveTimingActive) {
          this.liveTimingActive = true;
          console.log('[SplitTimeLowerThirdRunner] ⏱️  NO SPLIT TIME YET - ACTIVATING LIVE TIMING', {
            runnerName: this.selectedRunner.name,
            startTime: this.selectedRunner.startTime
          });
        }
      }
    }

    // Calculate display runners based on selected runner's position
    this.calculateDisplayRunners();
  }

  /**
   * Calculate which 5 runners to display based on selected runner's position
   * SPECIAL CASE: For Start control, show ONLY the selected runner
   */
  calculateDisplayRunners() {
    // SPECIAL CASE: For Start control, show ONLY the selected runner
    if (this.isStartControl) {
      if (this.selectedRunner) {
        this.displayRunners = [this.selectedRunner];
        console.log('[SplitTimeLowerThirdRunner] Start control - showing only selected runner', {
          name: this.selectedRunner.name,
          startTime: this.selectedRunner.startTime
        });
      } else {
        this.displayRunners = [];
        console.warn('[SplitTimeLowerThirdRunner] Start control - no selected runner found');
      }
      return;
    }

    // Use ALL results (not filtered) to find runners around the selected runner's position
    // This ensures we can display runners who haven't passed the control yet but are ranked near the selected runner
    const allResults = this.allRunners || [];
    const resultsWithTimes = this.runnersWithTimes || [];

    // If we don't have a selected runner, show top 5 with valid times
    if (!this.selectedRunner) {
      this.displayRunners = resultsWithTimes.slice(0, 5);
      console.log('[SplitTimeLowerThirdRunner] No selected runner - showing top 5 with valid times');
      return;
    }

    // Get selected runner's current position
    // If live timing is active, calculate their estimated position
    let selectedRunnerPosition;

    if (this.liveTimingActive && this.selectedRunnerStartTime) {
      // Calculate estimated position based on current time
      selectedRunnerPosition = this.calculateEstimatedPosition();
      console.log('[SplitTimeLowerThirdRunner] Using estimated position (live timing)', {
        position: selectedRunnerPosition
      });
    } else {
      // Use confirmed position
      selectedRunnerPosition = parseInt(this.selectedRunner.position) || 999;
      console.log('[SplitTimeLowerThirdRunner] Using confirmed position', {
        position: selectedRunnerPosition,
        rawPosition: this.selectedRunner.position,
        positionType: typeof this.selectedRunner.position
      });
    }

    console.log('[SplitTimeLowerThirdRunner] Selected runner details', {
      name: this.selectedRunner.name,
      position: selectedRunnerPosition,
      isLiveTiming: this.liveTimingActive,
      allPositions: allResults.map(r => ({ name: r.name, position: r.position, positionInt: parseInt(r.position), time: r.time }))
    });

    // Case 1: Selected runner is the leader (position 1)
    if (selectedRunnerPosition === 1) {
      // Show: Selected runner, previous leader (if different), positions 2-4
      const runners = [this.selectedRunner];

      // Add other runners (positions 2-5) from the filtered list (only those with valid times)
      const otherRunners = resultsWithTimes
        .filter(r => r.name !== this.selectedRunner.name)
        .slice(0, 4);

      runners.push(...otherRunners);
      this.displayRunners = runners.slice(0, 5);
    }
    // Case 2: Selected runner is not the leader
    else {
      console.log('[SplitTimeLowerThirdRunner] Case 2: Selected runner is NOT the leader');

      // Show: Leader, Selected runner, next 3 runners behind selected runner
      const runners = [];

      // Add leader first (if exists and is different from selected runner)
      if (this.leader && this.leader.name !== this.selectedRunner.name) {
        runners.push(this.leader);
        console.log('[SplitTimeLowerThirdRunner] Added leader', {
          name: this.leader.name,
          position: this.leader.position
        });
      }

      // Add selected runner
      runners.push(this.selectedRunner);
      console.log('[SplitTimeLowerThirdRunner] Added selected runner', {
        name: this.selectedRunner.name,
        position: this.selectedRunner.position
      });

      // Add the next 3 runners to display
      // Priority: Show runners BEHIND (worse positions) the selected runner
      // Fallback: If fewer than 3 runners behind, fill with runners AHEAD (better positions)
      let runnersToShow = [];

      console.log('[SplitTimeLowerThirdRunner] Finding runners to display', {
        selectedRunnerPosition,
        isLiveTiming: this.liveTimingActive
      });

      // Step 1: Find runners BEHIND the selected runner (positions > selectedRunnerPosition)
      const runnersBehind = allResults
        .filter(r => {
          const isDifferentRunner = r.name !== this.selectedRunner.name;
          const hasValidTime = this.hasValidTime(r);
          const pos = parseInt(r.position) || 999;
          const hasValidPosition = !isNaN(pos) && pos < 999;
          const isBehind = pos > selectedRunnerPosition;

          const include = isDifferentRunner && hasValidTime && hasValidPosition && isBehind;

          console.log('[SplitTimeLowerThirdRunner] Checking runner for "behind" list', {
            name: r.name,
            position: r.position,
            positionInt: pos,
            selectedPosition: selectedRunnerPosition,
            isDifferentRunner,
            hasValidTime,
            hasValidPosition,
            isBehind,
            time: r.time,
            willInclude: include
          });

          return include;
        })
        .sort((a, b) => {
          // Sort by position (ascending) to get positions 9, 10, 11... in order
          const posA = parseInt(a.position) || 999;
          const posB = parseInt(b.position) || 999;
          return posA - posB;
        })
        .slice(0, 3); // Take up to 3 runners behind

      runnersToShow.push(...runnersBehind);

      console.log('[SplitTimeLowerThirdRunner] Runners behind selected runner', {
        count: runnersBehind.length,
        runners: runnersBehind.map(r => ({ name: r.name, position: r.position }))
      });

      // Step 2: If we have fewer than 3 runners, fill with runners AHEAD (positions < selectedRunnerPosition)
      // Exclude the leader if they're already shown
      if (runnersToShow.length < 3) {
        const needed = 3 - runnersToShow.length;

        console.log('[SplitTimeLowerThirdRunner] Need to fill with runners ahead', {
          needed,
          currentCount: runnersToShow.length
        });

        const runnersAhead = allResults
          .filter(r => {
            const isDifferentRunner = r.name !== this.selectedRunner.name;
            const hasValidTime = this.hasValidTime(r);
            const pos = parseInt(r.position) || 999;
            const hasValidPosition = !isNaN(pos) && pos < 999;
            const isAhead = pos < selectedRunnerPosition;
            // Exclude the leader if they're already in the display
            const isNotLeader = !this.leader || r.name !== this.leader.name;

            const include = isDifferentRunner && hasValidTime && hasValidPosition && isAhead && isNotLeader;

            console.log('[SplitTimeLowerThirdRunner] Checking runner for "ahead" list', {
              name: r.name,
              position: r.position,
              positionInt: pos,
              selectedPosition: selectedRunnerPosition,
              isDifferentRunner,
              hasValidTime,
              hasValidPosition,
              isAhead,
              isNotLeader,
              time: r.time,
              willInclude: include
            });

            return include;
          })
          .sort((a, b) => {
            // Sort by position (descending) to get positions closest to selected runner first
            // e.g., if selected is 8, get 7, 6, 5...
            const posA = parseInt(a.position) || 999;
            const posB = parseInt(b.position) || 999;
            return posB - posA;
          })
          .slice(0, needed);

        runnersToShow.push(...runnersAhead);

        console.log('[SplitTimeLowerThirdRunner] Runners ahead of selected runner (fallback)', {
          count: runnersAhead.length,
          runners: runnersAhead.map(r => ({ name: r.name, position: r.position }))
        });
      }

      console.log('[SplitTimeLowerThirdRunner] Final runners to show (after selected runner)', {
        count: runnersToShow.length,
        runners: runnersToShow.map(r => ({ name: r.name, position: r.position, time: r.time }))
      });

      runners.push(...runnersToShow);

      // If we don't have enough runners (less than 5 total), fill with additional runners who have valid times
      // This handles the case where the selected runner is in live timing mode at Finish control
      // and very few runners have finished yet
      if (runners.length < 5) {
        console.log('[SplitTimeLowerThirdRunner] Not enough runners - filling with additional runners', {
          currentCount: runners.length,
          needed: 5 - runners.length
        });

        // Get runners with valid times that aren't already in the display list
        const existingNames = new Set(runners.map(r => r.name));
        const additionalRunners = resultsWithTimes
          .filter(r => !existingNames.has(r.name))
          .slice(0, 5 - runners.length);

        console.log('[SplitTimeLowerThirdRunner] Adding additional runners', {
          count: additionalRunners.length,
          runners: additionalRunners.map(r => ({ name: r.name, position: r.position, time: r.time }))
        });

        runners.push(...additionalRunners);
      }

      this.displayRunners = runners.slice(0, 5);
    }

    console.log('[SplitTimeLowerThirdRunner] Display runners calculated', {
      count: this.displayRunners.length,
      runners: this.displayRunners.map(r => ({ name: r.name, position: r.position }))
    });
  }

  /**
   * Current time in seconds, corrected to the Liveresultat server clock when OL-Grafik
   * measured an offset (data.clockOffsetMs). Keeps the running clock in step with the
   * official timing even if this machine's clock drifts.
   */
  nowSeconds() {
    const offset = Number(this.data?.clockOffsetMs) || 0;
    return (Date.now() + offset) / 1000;
  }

  /**
   * Calculate estimated position for selected runner during live timing
   */
  calculateEstimatedPosition() {
    if (!this.selectedRunnerStartTime) return 999;

    const currentTime = this.nowSeconds(); // Server-corrected current time in seconds
    const elapsedTime = currentTime - this.selectedRunnerStartTime;

    console.log('[SplitTimeLowerThirdRunner] Calculating estimated position', {
      selectedRunner: this.selectedRunner.name,
      elapsedTime,
      elapsedTimeFormatted: this.formatTime(elapsedTime)
    });

    // Count how many runners have faster times than the estimated time
    // Lower time = faster = better position (lower number)
    // If another runner's time is LESS than our elapsed time, they are FASTER
    // and we should be ranked BEHIND them (higher position number)
    let position = 1;
    for (const runner of this.data.results) {
      if (runner.name === this.selectedRunner.name) continue;

      const runnerTime = this.parseTimeToSeconds(runner.time);
      if (runnerTime > 0 && runnerTime < elapsedTime) {
        position++;
        console.log('[SplitTimeLowerThirdRunner] Runner is faster', {
          runner: runner.name,
          runnerTime,
          runnerTimeFormatted: runner.time,
          elapsedTime,
          currentPosition: position
        });
      }
    }

    console.log('[SplitTimeLowerThirdRunner] Final estimated position', {
      position,
      elapsedTime,
      elapsedTimeFormatted: this.formatTime(elapsedTime)
    });

    return position;
  }

  /**
   * Parse time string to seconds (for split times, NOT start times)
   * Handles formats: "MM:SS", "HH:MM:SS", "+MM:SS", "+HH:MM:SS"
   */
  parseTimeToSeconds(timeStr) {
    if (!timeStr || timeStr === '--:--') return 0;

    // Remove leading "+" if present (time difference format)
    const cleanTimeStr = timeStr.startsWith('+') ? timeStr.substring(1) : timeStr;

    const parts = cleanTimeStr.split(':');
    if (parts.length === 2) {
      // MM:SS
      return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      // HH:MM:SS
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }

    return 0;
  }

  /**
   * Parse start time string (HH:MM:SS or MM:SS) to Unix timestamp
   * Start times from the API are "seconds since midnight" formatted as time strings
   * (e.g., "10:28:00" = 10 hours 28 minutes since midnight = 37,680 seconds since midnight)
   * We need to convert this to a Unix timestamp for comparison with Date.now()
   */
  parseStartTimeToUnixTimestamp(timeStr) {
    if (!timeStr || timeStr === '--:--') return 0;

    const parts = timeStr.split(':');
    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (parts.length === 2) {
      // MM:SS format
      minutes = parseInt(parts[0]);
      seconds = parseInt(parts[1]);
    } else if (parts.length === 3) {
      // HH:MM:SS format
      hours = parseInt(parts[0]);
      minutes = parseInt(parts[1]);
      seconds = parseInt(parts[2]);
    } else {
      return 0;
    }

    // Calculate seconds since midnight
    const secondsSinceMidnight = hours * 3600 + minutes * 60 + seconds;

    // Get the competition date (YYYY-MM-DD format) or fall back to today
    let competitionDate;
    if (this.data.competitionDate) {
      // Parse competition date (YYYY-MM-DD)
      const dateParts = this.data.competitionDate.split('-');
      if (dateParts.length === 3) {
        const year = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
        const day = parseInt(dateParts[2]);
        competitionDate = new Date(year, month, day, 0, 0, 0, 0);
      } else {
        console.warn('[SplitTimeLowerThirdRunner] Invalid competition date format, using today', {
          competitionDate: this.data.competitionDate
        });
        const now = new Date();
        competitionDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      }
    } else {
      // Fall back to today if no competition date provided
      console.warn('[SplitTimeLowerThirdRunner] No competition date provided, using today');
      const now = new Date();
      competitionDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }

    // Add the seconds since midnight to get the start time
    const startTimeMs = competitionDate.getTime() + (secondsSinceMidnight * 1000);

    // Return Unix timestamp in seconds
    const startTimeUnix = Math.floor(startTimeMs / 1000);

    // Enhanced logging for debugging
    const nowUnix = Math.floor(Date.now() / 1000);
    const elapsedSeconds = nowUnix - startTimeUnix;

    console.log('[SplitTimeLowerThirdRunner] Parsed start time', {
      timeStr,
      hours,
      minutes,
      seconds,
      secondsSinceMidnight,
      competitionDateStr: this.data.competitionDate,
      competitionDateISO: competitionDate.toISOString(),
      competitionDateLocal: competitionDate.toString(),
      competitionDateUnix: Math.floor(competitionDate.getTime() / 1000),
      startTimeMs,
      startTimeUnix,
      startTimeISO: new Date(startTimeMs).toISOString(),
      startTimeLocal: new Date(startTimeMs).toString(),
      nowUnix,
      nowISO: new Date().toISOString(),
      nowLocal: new Date().toString(),
      elapsedSeconds,
      elapsedFormatted: this.formatTime(Math.abs(elapsedSeconds)),
      timezoneOffset: competitionDate.getTimezoneOffset()
    });

    return startTimeUnix;
  }

  /**
   * Format seconds to time string (MM:SS or HH:MM:SS)
   */
  formatTime(seconds) {
    if (seconds <= 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Get live timing display for selected runner
   */
  getLiveTimingDisplay() {
    if (!this.liveTimingActive || !this.selectedRunnerStartTime) {
      console.log('[SplitTimeLowerThirdRunner] ⚠️  Live timing NOT active or no start time', {
        liveTimingActive: this.liveTimingActive,
        selectedRunnerStartTime: this.selectedRunnerStartTime,
        returningStaticTime: this.selectedRunner.time
      });
      return this.selectedRunner.time || '--:--';
    }

    const currentTime = this.nowSeconds();
    const currentTimeDate = new Date(currentTime * 1000);

    // For Start control: countdown or count up
    if (this.isStartControl) {
      const timeUntilStart = this.selectedRunnerStartTime - currentTime;

      if (timeUntilStart > 0) {
        // Countdown to start (show negative)
        const countdown = `-${this.formatTime(Math.abs(timeUntilStart))}`;
        console.log('[SplitTimeLowerThirdRunner] ⏱️  COUNTDOWN', {
          timeUntilStart,
          countdown,
          startTime: new Date(this.selectedRunnerStartTime * 1000).toISOString(),
          currentTime: new Date(currentTime * 1000).toISOString()
        });
        return countdown;
      } else {
        // Count up from start
        const countup = this.formatTime(Math.abs(timeUntilStart));
        console.log('[SplitTimeLowerThirdRunner] ⏱️  COUNTUP', {
          timeUntilStart,
          countup,
          startTime: new Date(this.selectedRunnerStartTime * 1000).toISOString(),
          currentTime: new Date(currentTime * 1000).toISOString()
        });
        return countup;
      }
    }

    // For other controls: count up from start
    const elapsedTime = currentTime - this.selectedRunnerStartTime;
    const formattedTime = this.formatTime(Math.max(0, elapsedTime));

    // Log detailed timing information for debugging
    console.log('[SplitTimeLowerThirdRunner] Live timing calculation', {
      runnerName: this.selectedRunner?.name,
      startTimeUnix: this.selectedRunnerStartTime,
      startTimeDate: new Date(this.selectedRunnerStartTime * 1000).toISOString(),
      startTimeLocal: new Date(this.selectedRunnerStartTime * 1000).toLocaleString(),
      currentTimeUnix: currentTime,
      currentTimeDate: currentTimeDate.toISOString(),
      currentTimeLocal: currentTimeDate.toLocaleString(),
      elapsedSeconds: elapsedTime,
      elapsedMinutes: Math.floor(elapsedTime / 60),
      formattedTime: formattedTime
    });

    return formattedTime;
  }

  /**
   * OGRAF Lifecycle: Update Action
   * Called when data is updated during playout (auto-update)
   */
  async updateAction(options) {
    try {
      console.log('[SplitTimeLowerThirdRunner] Update action called', {
        hasData: !!options.data,
        resultsCount: options.data?.results?.length || 0,
        selectedRunner: this.selectedRunner?.name,
        wasLiveTimingActive: this.liveTimingActive
      });

      if (!options.data) {
        return {
          statusCode: 400,
          message: 'No data provided'
        };
      }

      // CRITICAL: Merge new data with existing data instead of replacing it
      // This preserves runner selection fields (runnerName, runnerBib, runnerClub)
      // that were set during initial load but are not included in auto-update data
      this.data = { ...this.data, ...options.data };

      console.log('[SplitTimeLowerThirdRunner] Data after merge', {
        runnerName: this.data.runnerName,
        runnerBib: this.data.runnerBib,
        runnerClub: this.data.runnerClub,
        resultsCount: this.data.results?.length || 0
      });

      // Reprocess data with new results
      // This will update this.selectedRunner, this.liveTimingActive, etc.
      this.processData();

      console.log('[SplitTimeLowerThirdRunner] After processData in updateAction', {
        selectedRunner: this.selectedRunner?.name,
        selectedRunnerTime: this.selectedRunner?.time,
        selectedRunnerPosition: this.selectedRunner?.position,
        isLiveTimingActive: this.liveTimingActive,
        hasConfirmedTime: this.selectedRunner?.time && this.selectedRunner?.time !== '--:--',
        displayRunnersCount: this.displayRunners?.length || 0
      });

      // Update the display WITHOUT calling render() to preserve animation state
      // This is critical - render() would wipe out all .visible classes
      this.updateRunnersDisplay();

      return {
        statusCode: 200,
        message: 'Update action completed'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThirdRunner] Update action failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Update action failed'
      };
    }
  }

  /**
   * OGRAF Lifecycle: Dispose
   */
  async dispose() {
    try {
      console.log('[SplitTimeLowerThirdRunner] Dispose called');

      // Stop live timing
      if (this.liveTimingInterval) {
        clearInterval(this.liveTimingInterval);
        this.liveTimingInterval = null;
      }

      return {
        statusCode: 200,
        message: 'Dispose completed'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThirdRunner] Dispose failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Dispose failed'
      };
    }
  }

  /**
   * OGRAF Lifecycle: Play Action
   */
  async playAction(options = {}) {
    try {
      console.log('[SplitTimeLowerThirdRunner] Play action called');
      const skipAnimation = options.skipAnimation || false;

      // Start live timing if active
      if (this.liveTimingActive && !this.liveTimingInterval) {
        this.startLiveTiming();
      }

      // Show the container
      const container = this.shadowRoot.querySelector('.container');
      if (container) {
        container.classList.add('visible');
      }

      // Animate in the header
      if (!skipAnimation) await new Promise(resolve => setTimeout(resolve, 80));
      const header = this.shadowRoot.querySelector('.header');
      if (header) {
        header.classList.add('visible');
      }

      // Animate in any existing runners
      if (!skipAnimation) await new Promise(resolve => setTimeout(resolve, 120));
      const runners = this.shadowRoot.querySelectorAll('.runner');
      for (let i = 0; i < runners.length; i++) {
        if (!skipAnimation) await new Promise(resolve => setTimeout(resolve, 40));
        runners[i].classList.add('visible');
      }

      // After all runners have animated in, fade in the drop shadow
      const graphic = this.shadowRoot.querySelector('.graphic');
      if (graphic) {
        graphic.classList.add('shadow-visible');
      }

      return {
        statusCode: 200,
        message: 'Play action completed'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThirdRunner] Play action failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Play action failed'
      };
    }
  }

  /**
   * OGRAF Lifecycle: Stop Action
   */
  async stopAction(options = {}) {
    try {
      console.log('[SplitTimeLowerThirdRunner] Stop action called');
      const skipAnimation = options.skipAnimation || false;

      // Stop live timing
      if (this.liveTimingInterval) {
        clearInterval(this.liveTimingInterval);
        this.liveTimingInterval = null;
      }

      // Fade out the drop shadow first
      const graphic = this.shadowRoot.querySelector('.graphic');
      if (graphic) {
        graphic.classList.remove('shadow-visible');
      }

      // Hide runners
      const runners = this.shadowRoot.querySelectorAll('.runner');
      for (let i = runners.length - 1; i >= 0; i--) {
        runners[i].classList.remove('visible');
        if (!skipAnimation) await new Promise(resolve => setTimeout(resolve, 25));
      }

      // Hide header
      const header = this.shadowRoot.querySelector('.header');
      if (header) {
        header.classList.remove('visible');
      }

      // Hide the container
      if (!skipAnimation) await new Promise(resolve => setTimeout(resolve, 280));
      const container = this.shadowRoot.querySelector('.container');
      if (container) {
        container.classList.remove('visible');
      }

      return {
        statusCode: 200,
        message: 'Stop action completed'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThirdRunner] Stop action failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Stop action failed'
      };
    }
  }

  /**
   * Start live timing updates
   */
  startLiveTiming() {
    console.log('[SplitTimeLowerThirdRunner] Starting live timing', {
      liveTimingActive: this.liveTimingActive,
      selectedRunnerStartTime: this.selectedRunnerStartTime,
      selectedRunnerStartTimeDate: this.selectedRunnerStartTime ? new Date(this.selectedRunnerStartTime * 1000).toISOString() : null,
      isStartControl: this.isStartControl
    });

    // Update immediately to avoid showing stale data
    this.updateLiveTiming();

    // Update every 100ms for smooth countdown/countup
    this.liveTimingInterval = setInterval(() => {
      this.updateLiveTiming();
    }, 100);
  }

  /**
   * Stop live timing updates
   */
  stopLiveTiming() {
    console.log('[SplitTimeLowerThirdRunner] Stopping live timing');

    if (this.liveTimingInterval) {
      clearInterval(this.liveTimingInterval);
      this.liveTimingInterval = null;
    }
  }

  /**
   * Update live timing display
   */
  updateLiveTiming() {
    if (!this.selectedRunner) return;

    // CRITICAL: Check if live timing is still active
    // If a confirmed time has arrived, stop updating the live display
    if (!this.liveTimingActive) {
      console.log('[SplitTimeLowerThirdRunner] Live timing no longer active - stopping updates');
      this.stopLiveTiming();
      return;
    }

    // Find the selected runner's time element
    const runnerKey = `${this.selectedRunner.name}_${this.selectedRunner.club}`;
    const runnerElement = this.shadowRoot.querySelector(`[data-runner-key="${runnerKey}"]`);

    if (runnerElement) {
      const timeElement = runnerElement.querySelector('.time');
      if (timeElement) {
        timeElement.textContent = this.getLiveTimingDisplay();
      }
    }

    // Recalculate position and update display if needed
    const newPosition = this.calculateEstimatedPosition();
    const currentPosition = parseInt(this.selectedRunner.position) || 999;

    if (newPosition !== currentPosition) {
      console.log('[SplitTimeLowerThirdRunner] Position changed during live timing', {
        old: currentPosition,
        new: newPosition
      });

      // Update position and recalculate display
      this.selectedRunner.position = newPosition.toString();
      this.calculateDisplayRunners();

      // Update the display WITHOUT calling render() to preserve animation state
      this.updateRunnersDisplay();
    }
  }

  /**
   * Update the runners display without re-rendering the entire template
   * This preserves animation state (visible classes) during live timing updates
   */
  updateRunnersDisplay() {
    updateClassicHeading(this.shadowRoot, this.data);
    console.log('[SplitTimeLowerThirdRunner] Updating runners display (preserving animation state)', {
      displayRunnersLength: this.displayRunners?.length || 0
    });

    const runnersContainer = this.shadowRoot.querySelector('.runners-container');
    if (!runnersContainer) {
      console.warn('[SplitTimeLowerThirdRunner] Runners container not found');
      return;
    }

    // On air: patch the rows in place, so a runner's row slides to its new place, a new
    // passing slides in and changed times flash (no rebuild, logos do not reload)
    const onAir = this.shadowRoot.querySelector('.container')?.classList.contains('visible');
    if (onAir && runnersContainer.children.length) {
      livePatch(runnersContainer, this.renderRunners(), {
        keyAttr: 'data-runner-key',
        prepare: (f) => f.querySelectorAll('.runner').forEach(r => r.classList.add('visible'))
      });
      return;
    }
    runnersContainer.innerHTML = this.renderRunners();

    // Re-apply visible classes to maintain animation state
    const container = this.shadowRoot.querySelector('.container');
    const header = this.shadowRoot.querySelector('.header');
    const graphic = this.shadowRoot.querySelector('.graphic');
    const runners = this.shadowRoot.querySelectorAll('.runner');

    // Check if we're currently playing (container has visible class)
    const isPlaying = container?.classList.contains('visible');

    if (isPlaying) {
      // Re-apply visible classes to new runner elements
      runners.forEach(runner => {
        runner.classList.add('visible');
      });

      console.log('[SplitTimeLowerThirdRunner] Re-applied visible classes to updated runners');
    }
  }

  /**
   * Render the template
   */
  render() {
    const { className } = this.data;
    const controlName = broadcastControlLabel(this.data);

    this.shadowRoot.innerHTML = `
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        :host {
          display: block;
          width: 100%;
          height: 100%;
        }

        :host {
          font-family: Inter, sans-serif;
          font-size: 28px;
        }

        .container {
          display: flex;
          justify-content: flex-start;
          align-items: flex-end;
          position: absolute;
          bottom: 0;
          left: 0;
          padding: 0 60px 60px 60px;
          width: 50%;
          height: 50%;
          background: radial-gradient(100% 100% at 0% 100%, color-mix(in srgb, var(--teal, #548889) 80%, transparent) 0%, color-mix(in srgb, var(--teal, #548889) 0%, transparent) 100%);
          opacity: 0;
          transition: opacity 180ms cubic-bezier(.2, 0, 0, 1);
        }

        .container.visible {
          opacity: 1;
        }

        .graphic {
          width: 100%;
          max-width: 860px; /* room for broadcast-size type */
          height: fit-content;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .graphic.shadow-visible {
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .header {
          display: flex;
          justify-content: space-between;
          text-align: right;
          align-items: center;
          background-color: var(--red, #B14340);
          font-size: 1.5rem;
          padding-right: 20px;
          color: white;
          font-weight: 600;
          border-bottom: 2px solid var(--red, #B14340);
          opacity: 0;
          transform: translateY(-16px);
          transition: opacity 420ms cubic-bezier(.2, 0, 0, 1), transform 420ms cubic-bezier(.2, 0, 0, 1);
          height: 60px;
        }

        .header.visible {
          opacity: 1;
          transform: translateY(0);
        }

        .logo {
          background-color: white;
          padding: 0 20px;
          text-align: center;
          display: flex;
          justify-content: center;
          align-items: center;
          min-width: 75px;
          height: 60px;
        }

        .logo img {
          width: 35px;
          height: 35px;
        }

        .runner {
          background-color: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 1.125rem;
          color: #301525;
          white-space: nowrap;
          opacity: 0;
          transform: translateX(40px);
          transition: opacity 360ms cubic-bezier(.2, 0, 0, 1), transform 360ms cubic-bezier(.2, 0, 0, 1);
        }

        .runner.visible {
          opacity: 1;
          transform: translateX(0);
        }

        .runner .place {
          font-variant-numeric: tabular-nums;
          font-weight: bold;
          min-width: 60px;
          padding: 1rem 1.25rem;
          text-align: center;
          border-right: 2px solid var(--red, #B14340);
        }

        .runner .name {
          padding: 1rem 1rem;
          font-weight: bold;
          flex-grow: 1;
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .runner .club {
          font-size: 1rem;
          width: 210px;
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
          padding: 1rem 0;
        }

        .runner .time {
          font-variant-numeric: tabular-nums;
          width: 7rem;
          font-weight: bold;
          text-align: right;
          background-color: var(--teal, #548889);
          color: white;
          padding: 1rem 0.625rem;
        }

        .runner.leader {
          border-bottom: 2px solid var(--mint, #89B6A5);
        }

        .runner.leader .time {
          background-color: var(--mint, #89B6A5);
        }

        /* Selected runner with live timing (yellow background on time) */
        .runner.selected-live .time {
          background-color: #F4C430;
          color: #301525;
        }

        /* Start control - single runner display with distinct styling */
        .runner.start-control {
          font-size: 1.25rem;
          padding: 0.5rem 0;
        }

        .runner.start-control .name {
          font-size: 1.375rem;
          font-weight: 700;
        }

        .runner.start-control .time {
          background-color: var(--teal, #548889);
          color: white;
          font-size: 1.5rem;
          font-weight: 700;
          width: 9rem;
        }

        /* Countdown mode - show time in orange/red */
        .runner.start-control.countdown .time {
          background-color: #E67E22;
          color: white;
        }

        /* Count-up mode - show time in green */
        .runner.start-control.countup .time {
          background-color: #27AE60;
          color: white;
        }
        /* exits are shorter and accelerate away */
        .runner:not(.visible), .header:not(.visible) { transition-duration: 240ms; transition-timing-function: cubic-bezier(.4, 0, 1, 1); }
        ${FLASH_CSS}
      ${CLASSIC_MODERN_CSS}
      </style>

      <div class="container">
        <div class="graphic">
          <div class="header">
            <!-- No event logo: in a runner graphic it could be read as a runner's club logo -->
            ${classicHeadingHtml(this.data)}
          </div>
          <div class="runners-container">
            ${this.renderRunners()}
          </div>
        </div>
      </div>
    `;
    fitClassicHeading(this.shadowRoot);
  }

  /**
   * Render runner rows
   */
  renderRunners() {
    console.log('[SplitTimeLowerThirdRunner] renderRunners called', {
      hasDisplayRunners: !!this.displayRunners,
      displayRunnersLength: this.displayRunners?.length || 0,
      displayRunners: this.displayRunners,
      isStartControl: this.isStartControl
    });

    if (!this.displayRunners || this.displayRunners.length === 0) {
      console.warn('[SplitTimeLowerThirdRunner] No display runners to render');
      return '';
    }

    const html = this.displayRunners.map(runner => {
      const isSelectedRunner = runner.name === this.selectedRunner?.name;
      const isLeader = runner.position === '1' || runner.position === 1;

      // Determine styling class
      let rowClass = 'runner';

      // Special styling for Start control
      if (this.isStartControl) {
        rowClass += ' start-control';

        // Add countdown or countup class based on current time vs start time
        if (this.selectedRunnerStartTime) {
          const currentTime = this.nowSeconds();
          const timeUntilStart = this.selectedRunnerStartTime - currentTime;

          if (timeUntilStart > 0) {
            rowClass += ' countdown';
          } else {
            rowClass += ' countup';
          }
        }
      } else if (isSelectedRunner && this.liveTimingActive) {
        rowClass += ' selected-live';
      } else if (isLeader) {
        rowClass += ' leader';
      }

      const runnerKey = `${runner.name}_${runner.club}`;

      // For Start control or selected runner in live timing mode, show live timing display
      const displayTime = (this.isStartControl || (isSelectedRunner && this.liveTimingActive))
        ? this.getLiveTimingDisplay()
        : runner.time || '--:--';

      // For Start control or selected runner in live timing mode, hide position (show dash)
      // Position is only shown when they have a confirmed split time
      const displayPosition = (this.isStartControl || (isSelectedRunner && this.liveTimingActive))
        ? '-'
        : (runner.position || '-');

      return `
        <div class="${rowClass}" data-runner-key="${runnerKey}">
          <div class="place">${displayPosition}</div>
          <div class="name">${runner.name || 'Unknown'}</div>
          <div class="club">${runner.club || ''}</div>
          <div class="time">${displayTime}</div>
        </div>
      `;
    }).join('');

    console.log('[SplitTimeLowerThirdRunner] Rendered HTML length', html.length);
    return html;
  }

  /**
   * OGRAF: Custom actions (none defined in the manifest)
   */
  async customAction() {
    return {
      statusCode: 404,
      message: 'Custom actions not supported'
    };
  }
}

// OGraf v1: the renderer registers the default export as a custom element.


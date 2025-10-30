/**
 * Split Time Lower Third Template
 * Lower third graphic displaying live split time passings with leader tracking
 * Based on EBU OGRAF v1 specification
 */

class SplitTimeLowerThird extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = {
      className: '',
      controlCode: '',
      controlName: '',
      results: []
    };
    
    // Track passings state
    this.leader = null; // Current leader (fastest time at this split)
    this.recentPassings = []; // Up to 4 most recent passings (excluding leader)
    this.seenRunners = new Set(); // Track which runners we've already shown
  }

  connectedCallback() {
    this.render();
  }

  /**
   * OGRAF Lifecycle: Load
   * Initialize the graphic with data
   */
  async load(options) {
    try {
      if (options.data) {
        const previousData = this.data;
        this.data = options.data;

        // If this is an update (not initial load), process new passings
        if (previousData.results && previousData.results.length > 0) {
          this.processUpdate(previousData.results, this.data.results);
        } else {
          // Initial load - process existing results
          this.processInitialResults(this.data.results);
        }
      }

      return {
        statusCode: 200,
        message: 'Loaded successfully'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThird] Load failed', error);
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
   * Process initial results on first load
   */
  processInitialResults(results) {
    console.log('[SplitTimeLowerThird] Processing initial results', {
      count: results.length
    });

    if (!results || results.length === 0) {
      this.render();
      return;
    }

    // Filter out runners who haven't passed the control point yet
    const runnersWithTimes = results.filter(r => this.hasValidTime(r));

    console.log('[SplitTimeLowerThird] Filtered runners with valid times', {
      totalRunners: results.length,
      runnersWithTimes: runnersWithTimes.length,
      filteredOut: results.length - runnersWithTimes.length
    });

    if (runnersWithTimes.length === 0) {
      console.log('[SplitTimeLowerThird] No runners with valid times yet');
      this.render();
      return;
    }

    // Find the leader (position 1) among runners with valid times
    const leader = runnersWithTimes.find(r => r.position === '1' || r.position === 1);
    if (leader) {
      this.leader = leader;
      const leaderKey = `${leader.name}_${leader.club}`;
      this.seenRunners.add(leaderKey);
      console.log('[SplitTimeLowerThird] Initial leader set', { name: leader.name });
    }

    // Get the last 4 runners (bottom 4 positions)
    // Filter out the leader and take the last 4 from the sorted results
    const nonLeaderRunners = runnersWithTimes.filter(r => r.position !== '1' && r.position !== 1);
    const bottomRunners = nonLeaderRunners.slice(-4); // Take last 4

    console.log('[SplitTimeLowerThird] Bottom runners selected', {
      totalNonLeaders: nonLeaderRunners.length,
      bottomRunnersCount: bottomRunners.length,
      bottomRunners: bottomRunners.map(r => ({ name: r.name, position: r.position, time: r.time }))
    });

    // Add them to recent passings
    bottomRunners.forEach(runner => {
      this.recentPassings.push(runner);
      const runnerKey = `${runner.name}_${runner.club}`;
      this.seenRunners.add(runnerKey);
    });

    console.log('[SplitTimeLowerThird] Initial state populated', {
      hasLeader: !!this.leader,
      recentPassingsCount: this.recentPassings.length,
      seenRunnersCount: this.seenRunners.size
    });

    // Render the template with initial data
    this.render();
  }

  /**
   * Process data update and refresh display
   */
  processUpdate(previousResults, currentResults) {
    console.log('[SplitTimeLowerThird] Processing update', {
      previousCount: previousResults.length,
      currentCount: currentResults.length
    });

    // Filter out runners who haven't passed the control point yet
    const runnersWithTimes = currentResults.filter(r => this.hasValidTime(r));

    console.log('[SplitTimeLowerThird] Filtered runners with valid times (update)', {
      totalRunners: currentResults.length,
      runnersWithTimes: runnersWithTimes.length,
      filteredOut: currentResults.length - runnersWithTimes.length
    });

    if (runnersWithTimes.length === 0) {
      console.log('[SplitTimeLowerThird] No runners with valid times yet (update)');
      return;
    }

    // Update the leader (among runners with valid times)
    const currentLeader = runnersWithTimes.find(r => r.position === '1' || r.position === 1);
    if (currentLeader) {
      const previousLeader = this.leader;
      this.leader = currentLeader;
      const leaderKey = `${currentLeader.name}_${currentLeader.club}`;

      // If this is a NEW leader (different from previous), log it
      if (!previousLeader || previousLeader.name !== currentLeader.name) {
        console.log('[SplitTimeLowerThird] 🏆 NEW LEADER', {
          name: currentLeader.name,
          time: currentLeader.time,
          previousLeader: previousLeader?.name
        });
      }

      this.seenRunners.add(leaderKey);
    }

    // Detect NEW passings - runners who NOW have a valid time but DIDN'T before
    const newPassings = [];

    for (const currentRunner of runnersWithTimes) {
      const runnerKey = `${currentRunner.name}_${currentRunner.club}`;

      // Skip if we've already seen this runner
      if (this.seenRunners.has(runnerKey)) {
        continue;
      }

      // Find this runner in previous results
      const previousRunner = previousResults.find(
        r => r.name === currentRunner.name && r.club === currentRunner.club
      );

      // This is a NEW passing if:
      // 1. Runner wasn't in previous results, OR
      // 2. Runner was in previous results but didn't have a valid time
      const isNewPassing = !previousRunner || !this.hasValidTime(previousRunner);

      if (isNewPassing) {
        newPassings.push(currentRunner);
        this.seenRunners.add(runnerKey);

        console.log('[SplitTimeLowerThird] 🆕 NEW PASSING DETECTED', {
          name: currentRunner.name,
          position: currentRunner.position,
          time: currentRunner.time,
          wasInPreviousResults: !!previousRunner,
          previousTime: previousRunner?.time
        });
      }
    }

    // Add new passings to the recent passings list
    if (newPassings.length > 0) {
      // Filter out the leader from new passings
      const newNonLeaderPassings = newPassings.filter(r => r.position !== '1' && r.position !== 1);

      // Add to recent passings
      this.recentPassings.push(...newNonLeaderPassings);

      // Keep only the most recent 4 passings
      if (this.recentPassings.length > 4) {
        this.recentPassings = this.recentPassings.slice(-4);
      }

      console.log('[SplitTimeLowerThird] Added new passings', {
        newPassingsCount: newNonLeaderPassings.length,
        totalRecentPassings: this.recentPassings.length,
        recentPassings: this.recentPassings.map(r => ({ name: r.name, position: r.position, time: r.time }))
      });
    }

    // Update the display WITHOUT calling render() to preserve animation state
    // This is critical - render() would wipe out all .visible classes
    this.updateRunnersDisplay();
  }

  /**
   * Update the runners display without re-rendering the entire template
   * This preserves animation state (visible classes) during auto-updates
   */
  updateRunnersDisplay() {
    console.log('[SplitTimeLowerThird] Updating runners display (preserving animation state)', {
      hasLeader: !!this.leader,
      recentPassingsCount: this.recentPassings.length
    });

    const runnersContainer = this.shadowRoot.querySelector('.runners-container');
    if (!runnersContainer) {
      console.warn('[SplitTimeLowerThird] Runners container not found - template may not be rendered yet');
      return;
    }

    // Update the runners HTML
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

      console.log('[SplitTimeLowerThird] Re-applied visible classes to updated runners', {
        runnersCount: runners.length
      });
    }
  }



  /**
   * OGRAF Lifecycle: Update Action
   * Called when data is updated during playout (auto-update)
   */
  async updateAction(options) {
    try {
      if (!options.data) {
        return {
          statusCode: 400,
          message: 'No data provided'
        };
      }

      const previousData = this.data;
      this.data = options.data;

      // Process the update
      if (previousData.results && previousData.results.length > 0) {
        this.processUpdate(previousData.results, this.data.results);
      } else {
        // First update - process as initial results
        this.processInitialResults(this.data.results);
      }

      return {
        statusCode: 200,
        message: 'Update action completed'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThird] Update action failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Update action failed'
      };
    }
  }

  /**
   * OGRAF Lifecycle: Dispose
   * Clean up the graphic
   */
  async dispose() {
    try {
      // Reset state
      this.leader = null;
      this.recentPassings = [];
      this.seenRunners.clear();
      this.data = {
        className: '',
        controlCode: '',
        controlName: '',
        results: []
      };

      return {
        statusCode: 200,
        message: 'Disposed successfully'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThird] Dispose failed', error);
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
      console.log('[SplitTimeLowerThird] Play action called');

      // Show the container
      const container = this.shadowRoot.querySelector('.container');
      if (container) {
        container.classList.add('visible');
      }

      // Animate in the header
      await new Promise(resolve => setTimeout(resolve, 100));
      const header = this.shadowRoot.querySelector('.header');
      if (header) {
        header.classList.add('visible');
      }

      // Animate in any existing runners
      await new Promise(resolve => setTimeout(resolve, 200));
      const runners = this.shadowRoot.querySelectorAll('.runner');
      for (let i = 0; i < runners.length; i++) {
        await new Promise(resolve => setTimeout(resolve, 50));
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
      console.error('[SplitTimeLowerThird] Play action failed', error);
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
      console.log('[SplitTimeLowerThird] Stop action called');

      // Remove drop shadow before animating out
      const graphic = this.shadowRoot.querySelector('.graphic');
      if (graphic) {
        graphic.classList.remove('shadow-visible');
      }

      // Animate out all runners
      const runners = this.shadowRoot.querySelectorAll('.runner');
      for (let i = runners.length - 1; i >= 0; i--) {
        runners[i].classList.remove('visible');
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Hide the header
      const header = this.shadowRoot.querySelector('.header');
      if (header) {
        header.classList.remove('visible');
      }

      // Hide the container
      await new Promise(resolve => setTimeout(resolve, 200));
      const container = this.shadowRoot.querySelector('.container');
      if (container) {
        container.classList.remove('visible');
      }

      return {
        statusCode: 200,
        message: 'Stop action completed'
      };
    } catch (error) {
      console.error('[SplitTimeLowerThird] Stop action failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Stop action failed'
      };
    }
  }



  /**
   * Render the template
   */
  render() {
    const { className, controlName } = this.data;

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

        body {
          font-family: Inter, sans-serif;
          font-size: 24px;
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
          background: radial-gradient(100% 100% at 0% 100%, rgba(84, 136, 137, 0.8) 0%, rgba(84, 136, 137, 0) 100%);
          opacity: 0;
          transition: opacity 0.4s ease;
        }

        .container.visible {
          opacity: 1;
        }

        .graphic {
          width: 100%;
          max-width: 40rem;
          height: fit-content;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0);
          transition: box-shadow 0.5s ease;
        }

        .graphic.shadow-visible {
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }

        .header {
          display: flex;
          justify-content: space-between;
          text-align: right;
          align-items: center;
          background-color: #B14340;
          font-size: 1.5rem;
          padding-right: 20px;
          color: white;
          font-weight: 600;
          border-bottom: 2px solid #B14340;
          opacity: 0;
          transform: translateY(20px);
          transition: all 0.5s ease;
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
          transform: translateX(100px);
          transition: all 0.4s ease;
        }

        .runner.visible {
          opacity: 1;
          transform: translateX(0);
        }

        .runner .place {
          font-weight: bold;
          min-width: 60px;
          padding: 0 1.25rem;
          text-align: center;
          border-right: 2px solid #B14340;
        }

        .runner .name {
          
          padding: 0.625rem 1rem;
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
          padding: 0.625rem 0;
        }

        .runner .time {
          width: 7rem;
          font-weight: bold;
          text-align: right;
          background-color: #548889;
          color: white;
          padding: 1rem 0.625rem;
        }

        .runner.leader {
          border-bottom: 2px solid #89B6A5;
        }

        .runner.leader .time {
          background-color: #89B6A5;
        }
      </style>

      <div class="container">
        <div class="graphic">
          <div class="header">
            <div class="logo">
              <img src="/templates/SMGraphics-example/images/lok.png" alt="Logo">
            </div>
            <p>${className} - ${controlName}</p>
          </div>
          <div class="runners-container">
            ${this.renderRunners()}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render runner rows
   */
  renderRunners() {
    let html = '';

    // Render leader if exists
    if (this.leader) {
      const runnerKey = `${this.leader.name}_${this.leader.club}`;
      html += `
        <div class="runner leader" data-runner-key="${runnerKey}">
          <div class="place">${this.leader.position}</div>
          <div class="name">${this.leader.name}</div>
          <div class="club">${this.leader.club}</div>
          <div class="time">${this.leader.time}</div>
        </div>
      `;
    }

    // Render recent passings
    this.recentPassings.forEach(runner => {
      const runnerKey = `${runner.name}_${runner.club}`;
      html += `
        <div class="runner" data-runner-key="${runnerKey}">
          <div class="place">${runner.position}</div>
          <div class="name">${runner.name}</div>
          <div class="club">${runner.club}</div>
          <div class="time">${runner.diff || runner.time}</div>
        </div>
      `;
    });

    return html;
  }
}

// Register the custom element
customElements.define('split-time-lower-third', SplitTimeLowerThird);


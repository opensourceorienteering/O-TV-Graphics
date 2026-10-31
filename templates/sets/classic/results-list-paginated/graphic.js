import { CLASSIC_MODERN_CSS, classicHeadingHtml, updateClassicHeading, fitClassicHeading } from '../modern.js';
import { eventLogoHtml, updateEventLogo } from '../../_core/util.js';
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

const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
/**
 * Full Screen Runners List Template
 * Full-screen results list with multi-step pagination (10 runners per page)
 * Based on EBU OGRAF v1 specification
 */

export default class ResultsListPaginated extends HTMLElement {
  // event theme colours follow the data (Settings → theme colours)
  get data() { return this._data; }
  set data(value) { this._data = value; applyThemeColors(this, value, ['--red', '--teal', '--mint']); }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = {
      className: '',
      controlCode: '',
      controlName: 'Finish',
      results: []
    };
    this.currentStep = 0;
    this.totalSteps = 0;
    this.runnersPerPage = 10;
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
      console.log('[ResultsListPaginated] Load called', {
        hasData: !!options.data,
        data: options.data,
        resultsCount: options.data?.results?.length || 0
      });

      if (options.data) {
        this.data = options.data;

        // Log first 3 results to see what data we're receiving
        if (this.data.results && this.data.results.length > 0) {
          console.log('=== TEMPLATE RECEIVED DATA ===');
          for (let i = 0; i < Math.min(3, this.data.results.length); i++) {
            const r = this.data.results[i];
            console.log(`Result ${i + 1}:`, {
              name: r.name,
              position: r.position,
              place: r.place,
              time: r.time,
              diff: r.diff,
              timeplus: r.timeplus,
              timeBehind: r.timeBehind,
              result: r.result,
              statusCode: r.statusCode,
              status: r.status,
              allKeys: Object.keys(r)
            });
          }
        }
      }

      // Calculate steps based on data
      this.calculateSteps();

      console.log('[ResultsListPaginated] After load', {
        currentStep: this.currentStep,
        totalSteps: this.totalSteps,
        resultsCount: this.data.results?.length || 0,
        className: this.data.className,
        controlName: this.data.controlName
      });

      // Render the template
      this.render();

      return {
        statusCode: 200,
        message: 'Loaded successfully'
      };
    } catch (error) {
      console.error('[ResultsListPaginated] Load failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Load failed'
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
      this.currentStep = 0;
      this.totalSteps = 0;
      this.data = {
        className: '',
        controlCode: '',
        controlName: 'Finish',
        results: []
      };

      // Clear shadow DOM
      if (this.shadowRoot) {
        this.shadowRoot.innerHTML = '';
      }

      return {
        statusCode: 200,
        message: 'Disposed successfully'
      };
    } catch (error) {
      console.error('[ResultsListPaginated] Dispose failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Dispose failed'
      };
    }
  }

  /**
   * Calculate total number of steps based on results count
   */
  calculateSteps() {
    const totalRunners = this.data.results?.length || 0;
    this.totalSteps = Math.max(1, Math.ceil(totalRunners / this.runnersPerPage));
    return this.totalSteps;
  }

  /**
   * Get results for a specific page/step
   */
  getPageResults(step) {
    const startIdx = (step - 1) * this.runnersPerPage;
    const endIdx = startIdx + this.runnersPerPage;
    return this.data.results?.slice(startIdx, endIdx) || [];
  }

  /**
   * Format time with intelligent truncation
   * HH:MM:SS -> MM:SS if < 1 hour
   * MM:SS -> SS if < 1 minute
   */
  formatTimeDisplay(timeStr) {
    if (!timeStr || timeStr === '--:--') return '--:--';

    // Handle case where timeStr is not a string
    if (typeof timeStr !== 'string') {
      console.warn('[ResultsListPaginated] formatTimeDisplay received non-string:', {
        type: typeof timeStr,
        value: timeStr
      });
      return String(timeStr);
    }

    const parts = timeStr.split(':').map(p => parseInt(p, 10));

    if (parts.length === 3) {
      const [hours, minutes, seconds] = parts;
      if (hours === 0) {
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
      }
      return timeStr;
    }

    return timeStr;
  }

  /**
   * Get status display text
   * Shows status code if not OK (0), otherwise empty
   */
  getStatusDisplay(statusCode) {
    const statusMap = {
      0: '',      // OK - show nothing
      1: 'DNS',   // Did Not Start
      2: 'DNF',   // Did Not Finish
      3: 'MP',    // Missing Punch
      4: 'DSQ',   // Disqualified
      5: 'OT',    // Over Time
      9: 'NYS',   // Not Started Yet
      10: 'NYS',  // Not Started Yet
      11: 'WO',   // Walk Over
      12: 'MU'    // Moved Up
    };
    return statusMap[statusCode] || '';
  }

  /**
   * Format time display - show total time for 1st place, time behind for others
   * Special handling for Start control: always show start time regardless of status
   */
  formatTime(result, index, step) {
    if (!result) return '';

    const statusCode = result.statusCode || 0;
    const time = result.time || '';
    const diff = result.diff || result.timeBehind || '';

    // Check if we're showing Start times (no leader concept for Start)
    const isStart = this.data.controlCode === 'Start' || this.data.controlCode === 'S' || this.data.controlName === 'Start';

    console.log(`[ResultsListPaginated] formatTime for ${result.name}`, {
      index,
      step,
      isLeader: index === 0 && step === 1 && !isStart,
      isStart,
      time,
      diff,
      timeplus: result.timeplus,
      timeBehind: result.timeBehind,
      statusCode
    });

    // SPECIAL CASE: For Start control, always show start time regardless of status
    if (isStart) {
      const formatted = this.formatTimeDisplay(time);
      console.log('[ResultsListPaginated] Start time (ignoring status)', {
        name: result.name,
        rawTime: time,
        formatted,
        statusCode
      });
      return formatted;
    }

    // For other controls (splits/finish), check status
    // If not OK status, show status code instead of time
    if (statusCode !== 0) {
      return this.getStatusDisplay(statusCode);
    }

    // For first runner on step 1, show total time (this is the leader)
    if (index === 0 && step === 1) {
      const formatted = this.formatTimeDisplay(time);
      console.log('[ResultsListPaginated] Leader time', {
        index,
        step,
        rawTime: time,
        formatted
      });
      return formatted;
    }

    // For others, show time behind (prefer diff field)
    if (diff) {
      // Ensure + prefix for positive differences
      if (!diff.startsWith('+') && !diff.startsWith('-')) {
        const withPrefix = `+${this.formatTimeDisplay(diff)}`;
        console.log(`[ResultsListPaginated] Adding + prefix to diff`, {
          name: result.name,
          diff,
          withPrefix
        });
        return withPrefix;
      }
      const formatted = this.formatTimeDisplay(diff);
      console.log(`[ResultsListPaginated] Using diff as-is`, {
        name: result.name,
        diff,
        formatted
      });
      return formatted;
    }

    return this.formatTimeDisplay(time);
  }

  render() {
    const controlName = broadcastControlLabel(this.data);
    const className = this.data.className || '';

    this.shadowRoot.innerHTML = `
      <style>
        * {
          box-sizing: border-box;
        }
        

        :host {
          display: block;
          width: 1920px;
          height: 1080px;
          font-family: Inter, sans-serif;
          font-size: 28px;
        }

        .container {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          position: absolute;
          padding: 40px 300px;
          width: 100%;
          height: 100%;
          background: radial-gradient(100% 100% at 0% 100%, color-mix(in srgb, var(--teal, #548889) 80%, transparent) 0%, color-mix(in srgb, var(--teal, #548889) 0%, transparent) 100%);
          opacity: 0;
          transition: opacity 180ms cubic-bezier(.2, 0, 0, 1);
        }

        .container.visible {
          opacity: 1;
        }

        .graphic {
          width: 100%;
          height: fit-content;
          margin: 40px;
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
          height: 60px;
          opacity: 0;
          transform: translateY(-16px);
          transition: opacity 420ms cubic-bezier(.2, 0, 0, 1), transform 420ms cubic-bezier(.2, 0, 0, 1);
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
          height: 100%;
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
          transform: translateX(-40px);
          transition: opacity 360ms cubic-bezier(.2, 0, 0, 1), transform 360ms cubic-bezier(.2, 0, 0, 1);
        }

        .runner.visible {
          opacity: 1;
          transform: translateX(0);
        }

        @media (prefers-reduced-motion: reduce) {
          .container, .header, .runner { transition: opacity 150ms linear; }
          .header, .runner { transform: none; }
        }

        .runner .place {
          font-variant-numeric: tabular-nums;
          font-weight: bold;
          min-width: 60px;
          padding: 0 1.25rem;
          text-align: center;
          border-right: 2px solid var(--red, #B14340);
        }

        .runner .name {
          width: 12.5rem;
          padding: 0.625rem 1rem;
          font-weight: bold;
          flex-grow: 1;
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .runner .club {
          font-size: 1rem;
          width: 400px;
          text-align: left;
          flex-grow: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          padding: 0.625rem 0;
        }

        .runner .time {
          font-variant-numeric: tabular-nums;
          width: 8rem;
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
        /* exits are shorter and accelerate away; entries keep the decelerating curve above */
        .runner:not(.visible), .header:not(.visible) { transition-duration: 240ms; transition-timing-function: cubic-bezier(.4, 0, 1, 1); }
        .runner { will-change: transform, opacity; }
        ${FLASH_CSS}
      ${CLASSIC_MODERN_CSS}
      </style>

      <div class="container">
        <div class="graphic">
          <div class="header">
            <div class="logo">
              ${eventLogoHtml(this.data)}
            </div>
            ${classicHeadingHtml(this.data)}
          </div>
          <div class="runners-container"></div>
        </div>
      </div>
    `;
    fitClassicHeading(this.shadowRoot);
  }

  /**
   * Render runners for the current step
   */
  renderRunners(step, animate = true, live = false) {
    const runnersContainer = this.shadowRoot.querySelector('.runners-container');
    if (!runnersContainer) return;

    const pageResults = this.getPageResults(step);

    // On air: patch the rows in place (rows slide to new places, changed times flash)
    if (live && runnersContainer.children.length) {
      livePatch(runnersContainer, this.runnersHtml(pageResults, step), {
        prepare: (f) => f.querySelectorAll('.runner').forEach(r => r.classList.add('visible'))
      });
      return;
    }

    console.log('[ResultsListPaginated] renderRunners', {
      step,
      pageResultsCount: pageResults.length,
      firstResult: pageResults[0]
    });

    // Clear existing runners
    runnersContainer.innerHTML = '';

    // Add runner rows
    pageResults.forEach((result, index) => {
      const runnerDiv = document.createElement('div');
      // Leader styling only applies to first row of step 1, page 1
      // AND only if we're not showing Start times (Start has no leader)
      const isStart = this.data.controlCode === 'Start' || this.data.controlCode === 'S' || this.data.controlName === 'Start';
      const isLeader = index === 0 && step === 1 && !isStart;
      runnerDiv.className = `runner${isLeader ? ' leader' : ''}`;
      runnerDiv.dataset.key = `${result.name || ''}|${result.club || ''}`;

      // Support both OGRAF format (position) and custom format (place)
      // Runners who are out (DNS, DNF, MP, DSQ, OT, WO) never get a place
      const out = [1, 2, 3, 4, 5, 11].includes(Number(result.statusCode));
      const position = out ? '' : (result.position || result.place || (index + 1));
      const time = this.formatTime(result, index, step);

      runnerDiv.innerHTML = `
        <div class="place">${position}</div>
        <div class="name">${result.name || ''}</div>
        <div class="club">${result.club || ''}</div>
        <div class="time">${time}</div>
      `;

      runnersContainer.appendChild(runnerDiv);
    });

    // Animate runners in if requested
    if (animate) {
      this.animateRunnersIn();
    } else {
      // Show immediately
      const runners = runnersContainer.querySelectorAll('.runner');
      runners.forEach(runner => runner.classList.add('visible'));
    }
  }

  /** The same rows as renderRunners builds, as markup (for live patching) */
  runnersHtml(pageResults, step) {
    const isStart = this.data.controlCode === 'Start' || this.data.controlCode === 'S' || this.data.controlName === 'Start';
    return pageResults.map((result, index) => {
      const isLeader = index === 0 && step === 1 && !isStart;
      const out = [1, 2, 3, 4, 5, 11].includes(Number(result.statusCode));
      const position = out ? '' : (result.position || result.place || (index + 1));
      return `<div class="runner${isLeader ? ' leader' : ''}" data-key="${escHtml(`${result.name || ''}|${result.club || ''}`)}">` +
        `<div class="place">${position}</div><div class="name">${result.name || ''}</div>` +
        `<div class="club">${result.club || ''}</div><div class="time">${this.formatTime(result, index, step)}</div></div>`;
    }).join('');
  }

  /**
   * Animate runners in sequentially
   */
  async animateRunnersIn() {
    const runnersContainer = this.shadowRoot.querySelector('.runners-container');
    if (!runnersContainer) return;

    const runners = runnersContainer.querySelectorAll('.runner');

    for (let i = 0; i < runners.length; i++) {
      // stagger capped so long pages do not take seconds to build
      await new Promise(resolve => setTimeout(resolve, i < 10 ? 40 : 0));
      runners[i].classList.add('visible');
    }

    // After all runners have animated in, fade in the drop shadow
    const graphic = this.shadowRoot.querySelector('.graphic');
    if (graphic) {
      graphic.classList.add('shadow-visible');
    }
  }

  /**
   * Animate runners out
   */
  async animateRunnersOut() {
    const runnersContainer = this.shadowRoot.querySelector('.runners-container');
    if (!runnersContainer) return;

    // Remove drop shadow before animating out
    const graphic = this.shadowRoot.querySelector('.graphic');
    if (graphic) {
      graphic.classList.remove('shadow-visible');
    }

    const runners = runnersContainer.querySelectorAll('.runner');

    // Animate out in reverse order
    for (let i = runners.length - 1; i >= 0; i--) {
      runners[i].classList.remove('visible');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  /**
   * OGRAF Lifecycle: Play Action
   */
  async playAction(options = {}) {
    this.animating = true;
    try { return await this.playInner(options); } finally { this.animating = false; this.applyPending(); }
  }

  /** Data that arrived during an animation is applied when it ends */
  applyPending() {
    if (!this.pendingUpdate || this.currentStep === 0) return;
    this.pendingUpdate = false;
    this.renderRunners(this.currentStep, false, true);
  }

  async playInner(options = {}) {
    const skipAnimation = options.skipAnimation || false;
    const delta = options.delta || 0;
    const goto = options.goto;

    // Calculate total steps
    this.calculateSteps();

    // Determine target step
    let targetStep;
    if (goto !== undefined) {
      // Absolute step number
      targetStep = goto;
    } else if (delta !== 0) {
      // Relative step change (for multi-step navigation)
      targetStep = this.currentStep + delta;
    } else {
      // Initial play - go to step 1
      targetStep = this.currentStep === 0 ? 1 : this.currentStep;
    }

    // Clamp to valid range
    targetStep = Math.max(1, Math.min(targetStep, this.totalSteps));

    const container = this.shadowRoot.querySelector('.container');
    const header = this.shadowRoot.querySelector('.header');

    if (!container) {
      return {
        statusCode: 500,
        message: 'Container not found',
        currentStep: this.currentStep
      };
    }

    // First play - show container and header
    if (this.currentStep === 0) {
      container.classList.add('visible');

      if (header) {
        if (skipAnimation) {
          header.classList.add('visible');
        } else {
          await new Promise(resolve => setTimeout(resolve, 80));
          header.classList.add('visible');
          await new Promise(resolve => setTimeout(resolve, 120));
        }
      }

      // Render and animate first page
      this.renderRunners(targetStep, !skipAnimation);
    } else if (targetStep !== this.currentStep) {
      // Page change - animate out old runners, then animate in new ones
      if (!skipAnimation) {
        await this.animateRunnersOut();
        await new Promise(resolve => setTimeout(resolve, 180));
      }

      this.renderRunners(targetStep, !skipAnimation);
    }

    this.currentStep = targetStep;

    return {
      statusCode: 200,
      message: 'Play action completed',
      currentStep: this.currentStep,
      totalSteps: this.totalSteps
    };
  }

  /**
   * OGRAF Lifecycle: Stop Action
   */
  async stopAction(options = {}) {
    this.animating = true;
    this.pendingUpdate = false;
    try { return await this.stopInner(options); } finally { this.animating = false; }
  }

  async stopInner(options = {}) {
    const skipAnimation = options.skipAnimation || false;

    const container = this.shadowRoot.querySelector('.container');
    const header = this.shadowRoot.querySelector('.header');

    if (!container) {
      return {
        statusCode: 500,
        message: 'Container not found'
      };
    }

    if (skipAnimation) {
      container.classList.remove('visible');
      if (header) header.classList.remove('visible');
      const runnersContainer = this.shadowRoot.querySelector('.runners-container');
      if (runnersContainer) runnersContainer.innerHTML = '';
    } else {
      // Animate out runners
      await this.animateRunnersOut();
      await new Promise(resolve => setTimeout(resolve, 180));

      // Animate out header
      if (header) {
        header.classList.remove('visible');
        await new Promise(resolve => setTimeout(resolve, 280));
      }

      // Hide container
      container.classList.remove('visible');
    }

    this.currentStep = 0;

    return {
      statusCode: 200,
      message: 'Stop action completed'
    };
  }

  /**
   * OGRAF Lifecycle: Update Action
   */
  async updateAction(options) {
    console.log('[ResultsListPaginated] Update called', {
      hasData: !!options.data,
      data: options.data,
      resultsCount: options.data?.results?.length || 0
    });

    if (!options.data) {
      return {
        statusCode: 400,
        message: 'No data provided'
      };
    }

    this.data = options.data;

    // Recalculate steps
    this.calculateSteps();

    // On air: never rebuild the graphic (no re-entry, logos stay); patch the rows in place
    if (this.currentStep > 0) {
      this.currentStep = Math.min(this.currentStep, this.totalSteps);
      updateClassicHeading(this.shadowRoot, this.data);
      if (this.animating) this.pendingUpdate = true;
      else this.renderRunners(this.currentStep, false, true);
      return { statusCode: 200, message: 'Update action completed', currentStep: this.currentStep, totalSteps: this.totalSteps };
    }

    console.log('[ResultsListPaginated] After update', {
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      resultsCount: this.data.results?.length || 0
    });

    // Re-render the template
    this.render();

    // If currently playing, show the current step
    if (this.currentStep > 0) {
      const container = this.shadowRoot.querySelector('.container');
      const header = this.shadowRoot.querySelector('.header');

      if (container) container.classList.add('visible');
      if (header) header.classList.add('visible');

      // Clamp current step to new total
      this.currentStep = Math.min(this.currentStep, this.totalSteps);

      // Render current page without animation
      this.renderRunners(this.currentStep, false);
    }

    return {
      statusCode: 200,
      message: 'Update action completed',
      currentStep: this.currentStep,
      totalSteps: this.totalSteps
    };
  }

  /**
   * OGRAF Lifecycle: Custom Action
   */
  async customAction() {
    return {
      statusCode: 404,
      message: 'Custom actions not supported'
    };
  }
}

// OGraf v1: the renderer registers the default export as a custom element.


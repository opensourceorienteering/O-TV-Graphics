/**
 * Countdown/Countup Timer Template
 * Upper right corner timer that counts down to a target time, then switches to count up
 * Based on EBU OGRAF v1 specification
 */

class CountdownTimer extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = {
      title: '',
      targetTime: ''
    };
    
    // Timer state
    this.targetDate = null;
    this.timerInterval = null;
    this.isCountdown = true;
  }

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    this.stopTimer();
  }

  /**
   * OGRAF Lifecycle: Load
   * Initialize the graphic with data
   */
  async load(options) {
    try {
      console.log('[CountdownTimer] Load called', {
        hasData: !!options.data,
        title: options.data?.title,
        targetTime: options.data?.targetTime
      });

      if (options.data) {
        this.data = options.data;
        
        // Parse target time and set up timer
        this.parseTargetTime(this.data.targetTime);
        this.updateTimerDisplay();
        this.render();
      }

      return {
        statusCode: 200,
        message: 'Loaded successfully'
      };
    } catch (error) {
      console.error('[CountdownTimer] Load failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Load failed'
      };
    }
  }

  /**
   * Parse target time string (HH:MM:SS) and create target Date object for today
   */
  parseTargetTime(timeString) {
    if (!timeString) {
      console.error('[CountdownTimer] No target time provided');
      return;
    }

    const [hours, minutes, seconds] = timeString.split(':').map(Number);
    
    // Create target date for today
    const now = new Date();
    this.targetDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      hours,
      minutes,
      seconds,
      0
    );

    console.log('[CountdownTimer] Target time parsed', {
      input: timeString,
      targetDate: this.targetDate.toISOString(),
      now: now.toISOString()
    });
  }

  /**
   * Calculate time difference and update display
   */
  updateTimerDisplay() {
    if (!this.targetDate) {
      return;
    }

    const now = new Date();
    const diffMs = this.targetDate - now;

    // Determine if we're in countdown or countup mode
    this.isCountdown = diffMs > 0;

    // Calculate absolute difference
    const absDiffMs = Math.abs(diffMs);
    const hours = Math.floor(absDiffMs / (1000 * 60 * 60));
    const minutes = Math.floor((absDiffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((absDiffMs % (1000 * 60)) / 1000);

    // Format time as HH:MM:SS
    const timeString = [
      String(hours).padStart(2, '0'),
      String(minutes).padStart(2, '0'),
      String(seconds).padStart(2, '0')
    ].join(':');

    // Update the timer display in the DOM
    const timerElement = this.shadowRoot?.querySelector('.timer-value');
    const containerElement = this.shadowRoot?.querySelector('.timer-container');
    
    if (timerElement) {
      timerElement.textContent = timeString;
    }

    if (containerElement) {
      // Update mode class for styling
      if (this.isCountdown) {
        containerElement.classList.remove('countup');
        containerElement.classList.add('countdown');
      } else {
        containerElement.classList.remove('countdown');
        containerElement.classList.add('countup');
      }
    }
  }

  /**
   * Start the timer interval
   */
  startTimer() {
    // Clear any existing interval
    this.stopTimer();

    // Update immediately
    this.updateTimerDisplay();

    // Update every second
    this.timerInterval = setInterval(() => {
      this.updateTimerDisplay();
    }, 1000);

    console.log('[CountdownTimer] Timer started');
  }

  /**
   * Stop the timer interval
   */
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
      console.log('[CountdownTimer] Timer stopped');
    }
  }

  /**
   * OGRAF Lifecycle: Play Action
   * Animate the graphic on-air
   */
  async playAction(options) {
    try {
      console.log('[CountdownTimer] Play action called', { step: options?.step });

      const container = this.shadowRoot?.querySelector('.container');
      if (container) {
        container.classList.add('visible');
      }

      // Start the timer when going on-air
      this.startTimer();

      return {
        statusCode: 200,
        message: 'Play action completed'
      };
    } catch (error) {
      console.error('[CountdownTimer] Play action failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Play action failed'
      };
    }
  }

  /**
   * OGRAF Lifecycle: Stop Action
   * Animate the graphic off-air
   */
  async stopAction(options) {
    try {
      console.log('[CountdownTimer] Stop action called', { step: options?.step });

      const container = this.shadowRoot?.querySelector('.container');
      if (container) {
        container.classList.remove('visible');
      }

      // Stop the timer when going off-air
      this.stopTimer();

      return {
        statusCode: 200,
        message: 'Stop action completed'
      };
    } catch (error) {
      console.error('[CountdownTimer] Stop action failed', error);
      return {
        statusCode: 500,
        message: error instanceof Error ? error.message : 'Stop action failed'
      };
    }
  }

  /**
   * OGRAF Lifecycle: Dispose
   * Clean up resources
   */
  async dispose() {
    console.log('[CountdownTimer] Dispose called');
    this.stopTimer();
    return {
      statusCode: 200,
      message: 'Disposed successfully'
    };
  }

  /**
   * Render the component
   */
  render() {
    const { title } = this.data;

    this.shadowRoot.innerHTML = `
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        :host {
          font-family: Inter, sans-serif;
          font-size: 20px;
        }

        .container {
          position: fixed;
          top: 40px;
          right: 40px;
          opacity: 0;
          transform: translateX(20px);
          transition: opacity 0.4s ease-out, transform 0.4s ease-out;
        }

        .container.visible {
          opacity: 1;
          transform: translateX(0);
        }

        .timer-container {
          background-color: rgba(255, 255, 255, 0.95);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          min-width: 280px;
        }

        .timer-header {
          background-color: #B14340;
          color: white;
          padding: 0.75rem 1.25rem;
          font-size: 1.125rem;
          font-weight: 600;
          text-align: center;
        }

        .timer-display {
          text-align: center;
        }

        .timer-value {
          font-size: 1.125rem;
          font-weight: bold;
          color: white;
          background-color: #F4C430;
          padding: 1rem 1.5rem;
          border-radius: 4px;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.05em;
          transition: background-color 0.3s ease;
        }

        /* Countdown mode - yellow background */
        .timer-container.countdown .timer-value {
          background-color: #F4C430;
        }

        /* Countup mode - green background */
        .timer-container.countup .timer-value {
          background-color: #548889;
        }
      </style>

      <div class="container">
        <div class="timer-container countdown">
          <div class="timer-header">${title}</div>
          <div class="timer-display">
            <div class="timer-value">00:00:00</div>
          </div>
        </div>
      </div>
    `;
  }
}

// Register the custom element
customElements.define('countdown-timer', CountdownTimer);


/**
 * Script to generate remaining relay template graphic.js files
 * Run with: node scripts/generate-relay-templates.js
 */

const fs = require('fs');
const path = require('path');

// Template for relay-split-times-focused
const relaySplitTimesFocused = `/**
 * OGRAF Relay Split Times Focused Graphic
 * Focused view of single control/leg with comparison to leader
 */

class RelaySplitTimesFocused extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.data = null;
  }

  async load(options) {
    this.data = options.data;
    this.render();
    return { statusCode: 200, message: 'Loaded successfully' };
  }

  async dispose() {
    this.shadowRoot.innerHTML = '';
    this.data = null;
    return { statusCode: 200, message: 'Disposed successfully' };
  }

  async playAction(action) { return { statusCode: 200, message: 'Action played successfully' }; }
  async stopAction(action) { return { statusCode: 200, message: 'Action stopped successfully' }; }
  async updateAction(action) {
    if (action.data) {
      this.data = action.data;
      this.render();
    }
    return { statusCode: 200, message: 'Action updated successfully' };
  }
  async customAction(action) { return { statusCode: 200, message: 'Custom action executed successfully' }; }

  async animateIn() {
    const gfx = this.shadowRoot.getElementById('gfx');
    if (gfx) gfx.className = 'fadeIN';
    return { statusCode: 200, message: 'Animated in successfully' };
  }

  async animateOut() {
    const gfx = this.shadowRoot.getElementById('gfx');
    if (gfx) gfx.className = 'fadeOUT';
    return { statusCode: 200, message: 'Animated out successfully' };
  }

  render() {
    if (!this.data) return;
    const { className = '', teamName = '', controlCode = '', legNumber = '', time = '', leaderTeam = '', leaderTime = '', diff = '-', position = 0 } = this.data;
    const isLeader = position === 1;
    const bgColor = isLeader ? 'rgba(137, 182, 165, 0.3)' : 'rgba(84, 136, 137, 0.3)';
    
    this.shadowRoot.innerHTML = \`
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        #gfx {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          width: 1200px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          opacity: 0;
        }
        .split-focused-container {
          background: \${bgColor}; padding: 40px; border-radius: 12px;
          backdrop-filter: blur(10px); border: 2px solid rgba(255, 255, 255, 0.2);
        }
        .header { text-align: center; margin-bottom: 30px; }
        .class-name { font-size: 28px; font-weight: 600; color: #FFFFFF; text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5); }
        .control-info { font-size: 24px; color: #FAAA67; margin-top: 5px; }
        .current-team {
          background: rgba(177, 67, 64, 0.4); padding: 30px; border-radius: 8px;
          margin-bottom: 20px; text-align: center;
        }
        .team-name { font-size: 48px; font-weight: 700; color: #FFFFFF; text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5); margin-bottom: 10px; }
        .team-time { font-size: 36px; font-weight: 600; color: #FAAA67; }
        .leader-comparison {
          background: rgba(137, 182, 165, 0.4); padding: 20px; border-radius: 8px;
          display: flex; justify-content: space-between; align-items: center;
        }
        .leader-info { flex: 1; }
        .leader-label { font-size: 20px; color: rgba(255, 255, 255, 0.8); margin-bottom: 5px; }
        .leader-name { font-size: 28px; font-weight: 600; color: #FFFFFF; }
        .leader-time { font-size: 24px; color: #89B6A5; margin-top: 5px; }
        .diff-container { text-align: right; }
        .diff-label { font-size: 20px; color: rgba(255, 255, 255, 0.8); margin-bottom: 5px; }
        .diff-value { font-size: 36px; font-weight: 700; color: \${isLeader ? '#89B6A5' : '#FAAA67'}; }
        .fadeIN { animation: fadeIn 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        .fadeOUT { animation: fadeOut 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards; }
        @keyframes fadeIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
        @keyframes fadeOut { from { opacity: 1; transform: translate(-50%, -50%) scale(1); } to { opacity: 0; transform: translate(-50%, -50%) scale(0.9); } }
      </style>
      <div id="gfx">
        <div class="split-focused-container">
          <div class="header">
            <div class="class-name">\${this.escapeHtml(className)}</div>
            <div class="control-info">Kontroll \${this.escapeHtml(controlCode)} - Sträcka \${this.escapeHtml(legNumber)}</div>
          </div>
          <div class="current-team">
            <div class="team-name">\${this.escapeHtml(teamName)}</div>
            <div class="team-time">\${this.escapeHtml(time)}</div>
          </div>
          <div class="leader-comparison">
            <div class="leader-info">
              <div class="leader-label">Ledare</div>
              <div class="leader-name">\${this.escapeHtml(leaderTeam)}</div>
              <div class="leader-time">\${this.escapeHtml(leaderTime)}</div>
            </div>
            <div class="diff-container">
              <div class="diff-label">Differens</div>
              <div class="diff-value">\${this.escapeHtml(diff)}</div>
            </div>
          </div>
        </div>
      </div>
    \`;
  }

  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }
}

customElements.define('relay-split-times-focused', RelaySplitTimesFocused);
`;

// Write the file
const outputPath = path.join(__dirname, '../templates/relay-split-times-focused/graphic.js');
fs.writeFileSync(outputPath, relaySplitTimesFocused);
console.log('✅ Created relay-split-times-focused/graphic.js');

console.log('\n✅ Relay template generation complete!');
console.log('\nNote: Remaining templates (start-list, results-finish, results-leg, results-leg-control, split-times)');
console.log('need to be created manually as they are more complex with pagination support.');


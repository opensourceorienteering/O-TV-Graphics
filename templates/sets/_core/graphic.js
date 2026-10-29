/**
 * OGraf v1 Web Component base for Split Control template sets.
 *
 * Each graphic in a set is a tiny module:
 *   import { createGraphic } from '../../_core/graphic.js';
 *   import set from '../set.js';
 *   export default createGraphic('results', set);
 *
 * The class implements load / playAction / stopAction / updateAction / customAction / dispose.
 * Look and motion come from the set's theme.css through a state attribute on the root:
 *   data-state="out" -> "in" (entry animation) -> "on" (steady; updates never re-animate)
 *   -> "step" (page change) -> "on" ... -> "leave" (exit animation) -> "out"
 * Multi-step graphics (paged tables) advance a page per play with delta 1.
 */

import { renderView } from './views.js';
import { clock, now, timeOfDay } from './util.js';
import { livePatch, imagesReady } from './live.js';

const loadedFonts = new Set();

function ensureFonts(href) {
  // @font-face does not work inside shadow roots, so fonts go into the document once
  if (!href || loadedFonts.has(href)) return Promise.resolve();
  loadedFonts.add(href);
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  }).then(() => document.fonts?.ready).catch(() => undefined);
}

function cssLink(root, href) {
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    root.appendChild(link);
  });
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param kind  view name (see views.js)
 * @param set   { id, theme, fonts, durations: { in, out, step }, labels, nameStyle, rowsPerPage, ... }
 */
export function createGraphic(kind, set) {
  return class OLGrafikGraphic extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.data = {};
      this.step = 1;
      this.steps = 1;
      this.visible = false;
      this.viewKey = '';
      this.ticker = null;
    }

    async load(params = {}) {
      this.data = params.data ?? {};
      const shadow = this.shadowRoot;
      shadow.innerHTML = '';
      await Promise.all([ensureFonts(set.fonts), cssLink(shadow, set.theme)]);
      this.stage = document.createElement('div');
      this.stage.className = 'stage';
      this.root = document.createElement('div');
      this.root.className = `gfx gfx--${kind} set--${set.id}`;
      this.root.dataset.state = 'out';
      this.stage.appendChild(this.root);
      shadow.appendChild(this.stage);
      this.fit();
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this);
      this.render();
      return { statusCode: 200, message: 'Loaded' };
    }

    /** Graphics are designed at 1920x1080 and scaled to the output size */
    fit() {
      const w = this.clientWidth || window.innerWidth || 1920;
      const h = this.clientHeight || window.innerHeight || 1080;
      const scale = Math.min(w / 1920, h / 1080) || 1;
      this.stage.style.transform = `scale(${scale})`;
    }

    context() {
      return { ...set, kind, step: this.step };
    }

    /**
     * Draw the view. Off air (or on a page change) the markup is replaced; on air it is
     * patched in place: changed values flash, rows slide to their new place, new rows enter.
     */
    render({ live = false } = {}) {
      if (!this.root) return;
      const colors = Array.isArray(this.data?.presentation?.themeColors) ? this.data.presentation.themeColors : [];
      (set.colorVars || []).forEach((name, index) => {
        const value = colors[index];
        if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) this.root.style.setProperty(name, value);
        else this.root.style.removeProperty(name);
      });
      const view = renderView(kind, this.data, this.context());
      this.steps = Math.max(1, view.steps || 1);
      this.viewKey = view.key ?? '';
      this.rekey = !!view.rekey;
      if (live && this.root.firstChild) this.patch(view.html);
      else this.root.innerHTML = view.html;
      const code = String(this.data?.controlCode ?? '').trim();
      this.root.classList.toggle('is-finish', !code || /^(f|finish|1000)$/i.test(code));
      this.tick();
    }

    patch(html) {
      livePatch(this.root, html);
    }

    tick() {
      if (!this.root) return;
      const t = now(this.data);
      for (const el of this.root.querySelectorAll('[data-tick]')) {
        const mode = el.dataset.tick;
        const ref = Number(el.dataset.t);
        let text = '';
        if (mode === 'tod') text = timeOfDay(t, this.data.competitionTimeZone);
        else if (mode === 'elapsed') text = clock((t - ref) / 1000);
        else if (mode === 'countdown') {
          const left = (ref - t) / 1000;
          // Count down to the moment, then count up from it
          text = left > 0 ? clock(Math.ceil(left) * -1).replace(/^-/, '-') : clock(-left);
          el.classList.toggle('is-up', left <= 0);
        } else if (mode === 'vs') {
          // Virtual time against a reference (the leader at this control): -0:12 ahead, +0:05 behind
          const d = (t - ref) / 1000;
          text = d < 0 ? clock(Math.ceil(d)) : clock(Math.floor(d), { sign: true });
          el.classList.toggle('is-ahead', d < 0);
          el.classList.toggle('is-behind', d >= 0);
        } else if (mode === 'run') {
          // Countdown to the start, then the running time from it
          const left = (ref - t) / 1000;
          text = left > 0 ? clock(-Math.ceil(left)) : clock(-left);
          el.closest('.row')?.classList.toggle('is-counting', left > 0);
          el.closest('.row')?.classList.toggle('is-running', left <= 0);
        } else if (mode === 'start') {
          // Countdown to the start; from the start on, the start time itself
          const left = (ref - t) / 1000;
          text = left > 0 ? clock(-Math.ceil(left)) : timeOfDay(ref, this.data.competitionTimeZone);
          el.classList.toggle('is-counting', left > 0);
        }
        if (el.textContent !== text) el.textContent = text;
      }
      // Views that change with time (next start group, a runner on the way climbing the
      // standings) re-render when their key changes; on air the change is animated in place
      if (this.rekey && !this.animating) {
        const key = renderView(kind, this.data, this.context()).key ?? '';
        if (key !== this.viewKey) this.render({ live: this.visible });
      }
    }

    startTicker() {
      if (this.ticker) return;
      this.ticker = setInterval(() => this.tick(), 250);
    }

    stopTicker() {
      clearInterval(this.ticker);
      this.ticker = null;
    }

    async setState(state, ms) {
      this.root.dataset.state = state;
      if (ms) await wait(ms);
      if (state === 'on' && this.pending) { this.pending = false; this.render({ live: true }); }
    }

    get animating() {
      return ['in', 'step-out', 'step', 'leave'].includes(this.root?.dataset.state);
    }

    async playAction(params = {}) {
      const skip = !!params.skipAnimation;
      const d = set.durations ?? {};
      if (!this.visible) {
        this.step = params.goto ? Math.min(Math.max(1, params.goto), this.steps) : 1;
        this.render();
        this.visible = true;
        this.startTicker();
        await imagesReady(this.root);
        if (skip) await this.setState('on');
        else { await this.setState('in', d.in ?? 800); if (this.visible) await this.setState('on'); }
        return { statusCode: 200, currentStep: this.step, totalSteps: this.steps };
      }
      const target = params.goto ?? this.step + (params.delta ?? 1);
      const next = Math.min(Math.max(1, target), this.steps);
      if (next !== this.step) {
        this.step = next;
        if (skip) { this.render(); await this.setState('on'); }
        else {
          await this.setState('step-out', d.stepOut ?? 250);
          this.render();
          await this.setState('step', d.step ?? 500);
          await this.setState('on');
        }
      }
      return { statusCode: 200, currentStep: this.step, totalSteps: this.steps };
    }

    async stopAction(params = {}) {
      if (this.visible && !params.skipAnimation) await this.setState('leave', set.durations?.out ?? 600);
      this.visible = false;
      this.stopTicker();
      await this.setState('out');
      return { statusCode: 200, currentStep: this.step, totalSteps: this.steps };
    }

    async updateAction(params = {}) {
      this.data = params.data ?? this.data;
      // An update during an entry, page change or exit waits for the animation to finish
      if (this.visible && this.animating) { this.pending = true; return { statusCode: 200, currentStep: this.step }; }
      this.render({ live: this.visible && !params.skipAnimation });
      // Updates of a visible graphic change the content in place (no re-entry)
      if (this.step > this.steps) { this.step = this.steps; this.render({ live: this.visible }); }
      return { statusCode: 200, currentStep: this.step };
    }

    async customAction(params = {}) {
      const id = params.id;
      if (id === 'next-page') return this.playAction({ delta: 1, skipAnimation: params.skipAnimation });
      if (id === 'previous-page') return this.playAction({ delta: -1, skipAnimation: params.skipAnimation });
      if (id === 'first-page') return this.playAction({ goto: 1, skipAnimation: params.skipAnimation });
      return { statusCode: 404, message: `Unknown action: ${id}` };
    }

    async dispose() {
      this.stopTicker();
      this.resizeObserver?.disconnect();
      this.shadowRoot.innerHTML = '';
      return { statusCode: 200 };
    }

    disconnectedCallback() {
      this.stopTicker();
      this.resizeObserver?.disconnect();
    }
  };
}

import { livePatch } from './live.js';
import { createGraphic } from './graphic.js';
import { createFinishWatchView } from './finish-watch.js';

export function createFinishWatchGraphic(set) {
  const Base = createGraphic('finish-watch', set, function(data, ctx) {
    return this.finishWatchView(data, ctx);
  });
  return class FinishWatch extends Base {
    patch(html) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const registered = new Set([...this.root.querySelectorAll('.is-registered')].map(row => row.dataset.key));
      livePatch(this.root, html, { motion: {
        enter: { duration: reduced ? 0 : 240, easing: 'cubic-bezier(.16,1,.3,1)' },
        move: { duration: 0, easing: 'cubic-bezier(.2,0,0,1)' }
      } });
      for (const row of this.root.querySelectorAll('.is-registered')) {
        if (!registered.has(row.dataset.key)) row.querySelector('.c-time')?.animate(
          [{ opacity: .35, transform: reduced ? 'none' : 'translateY(5px)' }, { opacity: 1, transform: 'none' }],
          { duration: reduced ? 100 : 240, easing: 'ease-out' });
      }
    }

    async load(params) {
      this.finishWatchView = createFinishWatchView();
      return super.load(params);
    }
  }
}

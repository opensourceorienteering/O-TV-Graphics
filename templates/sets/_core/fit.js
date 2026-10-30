/**
 * Lower thirds whose text does not fit: the panel first grows, at most 10 % past its design
 * width (--lower-w for straps, the theme's width otherwise). Text that still does not fit is
 * scaled down to its box, like FitText, but no text in it goes below 18 px. Below that the
 * ellipsis stays as the last resort.
 *
 * Runs after every render. Measures layout sizes (scrollWidth/clientWidth), so entry
 * transforms and the stage scale do not disturb it.
 */

export const GROWTH = 1.1;
export const MIN_TEXT_PX = 18;
const TEXT = '.c-name, .c-label, .id-club, .hdr-title, .ftr-label';

const px = (el) => parseFloat(getComputedStyle(el).fontSize) || 0;
// scrollWidth is rounded: text a fraction of a pixel too wide still gets its ellipsis
const overflows = (el) => el.scrollWidth > el.clientWidth;

/** The smallest font size `el` may take so that no text in it (at 18 px or more) drops below 18 px */
function floorFor(el) {
  const own = px(el);
  const sizes = [el, ...el.querySelectorAll('*')].map(px).filter(s => s >= MIN_TEXT_PX);
  if (!sizes.length) return own;
  return Math.min(own, own * MIN_TEXT_PX / Math.min(...sizes));
}

export function fitLowerThird(root) {
  const panel = root?.querySelector('.panel--lower');
  if (!panel) return;

  // Start again from the design size
  panel.style.removeProperty('width');
  for (const el of panel.querySelectorAll('[data-fit]')) {
    el.style.removeProperty('font-size');
    el.removeAttribute('data-fit');
  }
  // Wrapping text (bio lines) never overflows sideways
  const texts = [...panel.querySelectorAll(TEXT)].filter(el => /nowrap|pre/.test(getComputedStyle(el).whiteSpace));
  const overflowing = () => texts.filter(overflows);
  if (!overflowing().length) return;

  // 1. Grow: the narrowest width up to +10 % that fits, or +10 % if nothing does
  const lowerW = parseFloat(getComputedStyle(panel).getPropertyValue('--lower-w'));
  const base = panel.classList.contains('panel--strap') && lowerW > 0 ? lowerW : panel.offsetWidth;
  const max = Math.round(base * GROWTH);
  let lo = panel.offsetWidth;
  if (lo < max) {
    panel.style.width = `${max}px`;
    if (!overflowing().length) {
      let hi = max;
      while (hi - lo > 4) {
        const mid = Math.round((lo + hi) / 2);
        panel.style.width = `${mid}px`;
        if (overflowing().length) lo = mid; else hi = mid;
      }
      panel.style.width = `${hi}px`;
      return;
    }
  }

  // 2. Scale the text that still does not fit. Everything in a line shrinks by the same
  // ratio, so the name and the club keep their designed proportions; a few passes let the
  // line settle (text that reaches 18 px stops, the rest takes up the difference).
  const floors = new Map();
  const lines = new Map();
  for (const el of texts) {
    const line = el.closest('.row, .hdr, .ftr') || el.parentElement;
    if (!lines.has(line)) lines.set(line, []);
    lines.get(line).push(el);
  }
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const items of lines.values()) {
      if (!items.some(overflows)) continue;
      const free = items.filter(el => !(floors.has(el) && px(el) <= floors.get(el) + 0.05));
      const needed = free.reduce((sum, el) => sum + el.scrollWidth, 0);
      const missing = items.reduce((sum, el) => sum + Math.max(0, el.scrollWidth - el.clientWidth), 0);
      if (!free.length || needed <= 0) continue;
      const ratio = Math.max(0, (needed - missing - 2) / needed);
      for (const el of free) {
        if (!floors.has(el)) floors.set(el, floorFor(el));
        const size = px(el);
        const next = Math.max(floors.get(el), Math.floor(size * ratio * 10) / 10);
        if (next < size - 0.05) {
          el.style.fontSize = `${next}px`;
          el.dataset.fit = '';
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
}

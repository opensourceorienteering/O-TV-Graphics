/**
 * Live changes on air, shared by every Split Control graphic (generated sets and the
 * hand-made Classic graphics).
 *
 * What broadcast graphics do when data changes while a graphic is on air:
 *  - never re-run the entry animation and never rebuild the graphic (images would reload)
 *  - patch only what changed; a changed value flashes once
 *  - a row whose place changed slides to its new position; a new row slides in
 *  - only transform and opacity are animated (composited, smooth at 50 fps)
 */

/** One motion language for live changes */
export const MOTION = {
  move: { duration: 520, easing: 'cubic-bezier(.2, 0, 0, 1)' },
  enter: { duration: 420, easing: 'cubic-bezier(.2, 0, 0, 1)', delay: 80, fill: 'backwards' }
};

const FLASH_CELLS = '.row > span, .c-value, .clk-time, .hdr > span, .ftr > span, .pod > span, .runner > div';

function keyOf(n, keyAttr) {
  return n.nodeType === 1 ? n.getAttribute(keyAttr) : null;
}
const sameKind = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);

/**
 * Patch the live children of `from` to match `to` without recreating unchanged nodes.
 * Keyed children (keyAttr) are matched by key, others by position.
 */
export function morphChildren(from, to, onChange, keyAttr = 'data-key') {
  const oldKids = [...from.childNodes];
  const keyed = new Map();
  for (const n of oldKids) { const k = keyOf(n, keyAttr); if (k != null) keyed.set(k, n); }
  const used = new Set();
  let cursor = 0;
  const nextUnkeyed = (like) => {
    while (cursor < oldKids.length) {
      const n = oldKids[cursor++];
      if (used.has(n) || keyOf(n, keyAttr) != null) continue;
      return sameKind(n, like) ? n : null;
    }
    return null;
  };
  [...to.childNodes].forEach((nn, i) => {
    const k = keyOf(nn, keyAttr);
    let match = k != null ? keyed.get(k) : nextUnkeyed(nn);
    if (match && (!sameKind(match, nn) || used.has(match))) match = null;
    let node;
    if (match) {
      used.add(match);
      morphNode(match, nn, onChange, keyAttr);
      node = match;
    } else {
      node = nn;
      if (nn.nodeType === 1 && k != null) node.dataset.entering = '1';
    }
    const at = from.childNodes[i];
    if (at !== node) from.insertBefore(node, at ?? null);
  });
  for (const n of oldKids) if (!used.has(n) && n.parentNode === from) from.removeChild(n);
}

function morphNode(a, b, onChange, keyAttr) {
  if (a.nodeType === 3 || a.nodeType === 8) {
    if (a.data !== b.data) { a.data = b.data; if (a.nodeType === 3) onChange(a.parentElement); }
    return;
  }
  for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
  for (const { name, value } of [...b.attributes]) {
    if (name === 'class') {
      // keep the transient flash class added at runtime
      const next = [value, a.classList.contains('is-changed') ? 'is-changed' : ''].join(' ').trim();
      if (a.getAttribute('class') !== next) a.setAttribute('class', next);
    } else if (a.getAttribute(name) !== value) a.setAttribute(name, value);
  }
  // running clocks are written by the graphic's ticker; never fight it over their text
  if (a.hasAttribute('data-tick')) return;
  morphChildren(a, b, onChange, keyAttr);
}

/**
 * Bring `container`'s content up to `html` in place, animating the change.
 * options.keyAttr  attribute that identifies rows (default data-key)
 * options.prepare  (fragment) => void, e.g. to keep "visible" classes on new rows
 */
export function livePatch(container, html, { keyAttr = 'data-key', prepare } = {}) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  prepare?.(tpl.content);
  const before = new Map();
  for (const el of container.querySelectorAll(`[${keyAttr}]`)) before.set(el.getAttribute(keyAttr), el.offsetTop);
  const changed = new Set();
  morphChildren(container, tpl.content, (el) => {
    const cell = el?.closest(FLASH_CELLS);
    if (cell && !cell.closest('[data-tick]')) changed.add(cell);
  }, keyAttr);
  const hadRows = before.size > 0;
  for (const el of container.querySelectorAll(`[${keyAttr}]`)) {
    if (el.dataset.entering) {
      delete el.dataset.entering;
      if (hadRows) el.animate([{ opacity: 0, transform: 'translateX(-28px)' }, { opacity: 1, transform: 'none' }], MOTION.enter);
      continue;
    }
    const was = before.get(el.getAttribute(keyAttr));
    const dy = was === undefined ? 0 : was - el.offsetTop;
    if (Math.abs(dy) > 1) {
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], MOTION.move);
      // a runner moving up passes over the rows it overtakes
      if (dy > 0) { el.style.zIndex = '2'; setTimeout(() => { el.style.zIndex = ''; }, MOTION.move.duration); }
    }
  }
  for (const cell of changed) {
    cell.classList.remove('is-changed');
    void cell.offsetWidth; // restart the flash
    cell.classList.add('is-changed');
  }
}

/** Wait for images in `root` to decode (first play otherwise stutters), at most `ms` */
export function imagesReady(root, ms = 400) {
  const imgs = [...root.querySelectorAll('img')].filter(i => !i.complete || !i.naturalWidth);
  if (!imgs.length) return Promise.resolve();
  return Promise.race([Promise.all(imgs.map(i => i.decode().catch(() => undefined))), new Promise(r => setTimeout(r, ms))]);
}

/** CSS for the value flash, for graphics that do not use base.css */
export const FLASH_CSS = `@keyframes value-flash { 0%, 50% { filter: brightness(1.35); } 25%, 100% { filter: none; } }
.is-changed { animation: value-flash 1000ms ease-in-out both; }`;

/**
 * Event theme colours for graphics that do not use the shared graphic class (the hand-made
 * Classic graphics). Sets the theme's colour variables on the host; they inherit into the
 * shadow root. Nothing is written until the event has custom colours.
 */
export function applyThemeColors(host, data, names) {
  const colors = Array.isArray(data?.presentation?.themeColors) ? data.presentation.themeColors : [];
  names.forEach((name, i) => {
    const v = colors[i];
    if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) host.style.setProperty(name, v);
    else if (host.hasAttribute('style')) host.style.removeProperty(name);
  });
}

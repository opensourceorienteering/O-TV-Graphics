import { eventLabels, weatherCondition, timingPoint, timingPointHtml } from './labels.js';
/**
 * Views: data -> markup for every graphic kind. All sets share this markup; each set's
 * theme.css decides how it looks and animates. A view returns { html, steps }.
 *
 * Markup vocabulary (styled by themes):
 *   .panel.panel--<kind>   one graphic block       .hdr / .ftr   header / footer bars
 *   .rows > .row           table rows (--i = index for staggered animations)
 *   .c-place .c-name .c-id .c-time .c-bib .c-start .c-label .c-value   cells
 *   .row--leader .row--hl  leader / highlighted runner
 *   [data-tick]            text the base class refreshes every 250 ms (running clocks)
 */

import {
  esc, time, diff, clock, now, isFrozen, timeOfDay, isRanked, placeOf, statusLabel, resultCell,
  nameHtml, identityHtml, findRunner, controlLabel, int, serverUrl, isRelayClass, parseClock, eventLogoHtml
} from './util.js';

const L = (ctx, key, fallback) => ctx.labels?.[key] ?? fallback;

/** Is the shown timing point the finish (no control, or F / finish / 1000)? */
const atFinish = (data) => { const c = String(data?.controlCode ?? '').trim(); return !c || /^(f|finish|1000)$/i.test(c); };

/**
 * Names in lower thirds: the operator's choice (data.nameStyle) or the look's default.
 * "Last name only" adds the first initial when two runners in the class share it ("HUBMANN D.").
 */
const familyOf = (name) => String(name ?? '').trim().split(/\s+/).pop()?.toLowerCase() ?? '';
const dupeCache = new WeakMap();
function sharedFamilies(data) {
  const list = Array.isArray(data?.results) ? data.results : [];
  if (dupeCache.has(list)) return dupeCache.get(list);
  const seen = new Map();
  for (const r of list) { const f = familyOf(r.name); seen.set(f, (seen.get(f) ?? 0) + 1); }
  const dupes = new Set([...seen].filter(([, n]) => n > 1).map(([f]) => f));
  dupeCache.set(list, dupes);
  return dupes;
}
function lowerName(r, data, ctx) {
  if (isRelayClass(data) && ctx.relayNames === 'team') return nameHtml(r?.name, 'team');
  const style = data.nameStyle || nameStyle(ctx, 'lower');
  if (style === 'family') return nameHtml(r?.name, sharedFamilies(data).has(familyOf(r?.name)) ? 'family-initial' : 'family');
  if (style === 'given-initial') return nameHtml(r?.name, 'given-initial');
  return nameHtml(r?.name, style);
}

/** Places gained (+) or lost (-) since the previous radio control; null when unknown */
function placeChange(r, data) {
  const controls = Array.isArray(data?.splitControls) ? data.splitControls : [];
  const code = String(data?.controlCode ?? '').trim();
  const idx = atFinish(data) ? controls.length : controls.findIndex(c => String(c.code) === code);
  if (idx <= 0) return null;
  const prev = (r?.splitTimes ?? []).find(x => String(x.code) === String(controls[idx - 1].code));
  const now = Number(placeOf(r));
  if (!prev?.place || !now) return null;
  return prev.place - now;
}
const changeCell = (r, data) => {
  const c = placeChange(r, data);
  return `<span class="c-change ${c > 0 ? 'up' : c < 0 ? 'down' : ''}">${c ? Math.abs(c) : ''}</span>`;
};

/** Stable row identity so live updates can move a runner's row instead of redrawing it */
const rowKey = (r) => esc(`${r?.name ?? ''}|${r?.club ?? ''}`);

/** "Label: value" lines typed by the operator -> [label, value] rows */
const extraRows = (text) => String(text ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  .map(l => { const i = l.indexOf(':'); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : [l, '']; });

/** A number with its unit, unless the operator already typed one ("3.4" -> "3.4 km", "3.4 km" stays) */
const withUnit = (v, unit) => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return /^[\d.,\s]+$/.test(s) ? `${s} ${unit}` : s;
};

/**
 * IOF split wording for the timing point: "SPLIT 2 - CONTROL 62", "FINISH", and while the
 * selected runner is on the way "TO SPLIT 2" / "TO FINISH" (IOF GFX layout, intermediate GFX)
 */
function splitLabel(data, ctx, onTheWay = false) {
  const code = String(data?.controlCode ?? '').trim();
  const controls = Array.isArray(data?.splitControls) ? data.splitControls : [];
  const idx = controls.findIndex(c => String(c.code) === code);
  if (!code || /^(f|finish|1000)$/i.test(code) || idx < 0) {
    if (code && idx < 0 && !/^(f|finish|1000)$/i.test(code)) return controlLabel(data);
    return onTheWay ? L(ctx, 'toFinish', 'To finish') : L(ctx, 'finish', controlLabel(data));
  }
  if (onTheWay) return `${L(ctx, 'toSplit', 'To split')} ${idx + 1}`;
  const c = controls[idx];
  const name = String(c.name ?? '').trim();
  const where = !name || /^\d+$/.test(name) ? `${L(ctx, 'control', 'Control')} ${name || Number(c.code) % 1000}` : name;
  return `${L(ctx, 'split', 'Split')} ${idx + 1} - ${where}`;
}

/** Time of the leader at the shown timing point, in ms from their start (NaN when unknown) */
function leaderMs(data, leader) {
  if (!leader) return NaN;
  const code = String(data?.controlCode ?? '').trim();
  if (code && !/^(f|finish|1000)$/i.test(code)) {
    const s = (leader.splitTimes ?? []).find(x => String(x.code) === code);
    if (s?.time > 0) return s.time * 10;
  }
  const sec = parseClock(leader.time);
  return Number.isFinite(sec) ? sec * 1000 : NaN;
}

/** Does any runner have a (real) bib? Lists without bibs leave the bib column out */
const hasBibs = (list) => list.some(r => String(r?.bib ?? '').trim() !== '');

function logoBox(data, cls = 'brand') {
  const url = data?.presentation?.logoUrl;
  return url ? `<span class="${cls}">${eventLogoHtml(data)}</span>` : `<span class="${cls} ${cls}--empty"></span>`;
}

function header(title, sub, data, extra = '', cls = '') {
  return `<header class="hdr${cls ? ' ' + cls : ''}"><span class="hdr-mark"></span><span class="hdr-title">${title}</span>` +
    (sub ? `<span class="hdr-sub">${sub}</span>` : '') + extra + logoBox(data, 'hdr-logo') + `</header>`;
}

function footer(label, data, extra = '') {
  return `<footer class="ftr"><span class="ftr-mark"></span><span class="ftr-label">${label}</span>${extra}${logoBox(data, 'ftr-logo')}</footer>`;
}

/** The timing point in the graphic's language, both forms (see labels.js timingPoint) */
const tpHtml = (data, ctx) => timingPointHtml(timingPoint(data, {
  split: L(ctx, 'split', 'Split'), splitShort: L(ctx, 'splitShort', 'Split {n}'),
  control: L(ctx, 'control', 'Control'), finish: L(ctx, 'finish', '')
}), esc);

/** Footer text "H21 – Finish": class and control in separate spans for themes */
const ctlLabel = (data, label) => `<span class="ftr-class">${esc(data.className || '')}</span><span class="ftr-sep"> – </span><span class="ftr-ctrl">${label}</span>`;

const nameStyle = (ctx, where) => ctx.nameStyle?.[where] ?? 'full';
const runnerName = (r, data, ctx, where) => nameHtml(r?.name, isRelayClass(data) && ctx.relayNames === 'team' ? 'team' : nameStyle(ctx, where));

/** Running time against the leader for a runner on the way to the timing point (or '') */
function virtualCell(r, data, leader) {
  if (!r?.startTimeMs || !leader || r === leader || isRanked(r) || statusLabel(r) || data.virtualTime === false) return '';
  const ms = leaderMs(data, leader);
  if (!Number.isFinite(ms)) return '';
  const ref = r.startTimeMs + ms;
  if (r.startTimeMs > now(data)) return '';
  return `<span class="c-vs" data-tick="vs" data-t="${ref}">${esc(clock(Math.floor((now(data) - ref) / 1000), { sign: true }))}</span>`;
}

/**
 * The leader, then the runner at idx with one ahead and one behind; topped up from the list
 * so short lists still show `min` rows.
 */
function around(list, idx, min = 3) {
  const pick = new Set([0, idx - 1, idx, idx + 1].filter(i => i >= 0 && i < list.length));
  for (let i = 0; pick.size < Math.min(min, list.length) && i < list.length; i++) pick.add(i);
  return [...pick].sort((a, b) => a - b).map(i => list[i]);
}

function runnerRow(r, i, data, ctx, { leader, highlight, where = 'table', showDiff = true, virtual = '' } = {}) {
  const cls = ['row', leader ? 'row--leader' : '', highlight ? 'row--hl' : '', statusLabel(r) ? 'row--status' : '', virtual ? 'is-running is-virtual' : '', virtual && isFrozen(data) ? 'is-frozen' : ''].filter(Boolean).join(' ');
  return `<div class="${cls}" style="--i:${i}" data-key="${rowKey(r)}">` +
    `<span class="c-place">${esc(placeOf(r))}</span>` +
    `<span class="c-name">${where === 'lower' ? lowerName(r, data, ctx) : runnerName(r, data, ctx, where)}</span>` +
    (data.positionChange ? changeCell(r, data) : '') +
    `<span class="c-id">${identityHtml(r, data)}</span>` +
    `<span class="c-time">${virtual || esc(showDiff ? resultCell(r, leader) : time(r.time))}</span>` +
    `</div>`;
}

/** Ranked runners first, then everyone with a final status (MP, DNF, DSQ ...) */
function orderedResults(data) {
  const list = Array.isArray(data?.results) ? data.results : [];
  const ranked = list.filter(isRanked);
  // At a radio control only runners through with an OK status are listed; MP, DNF, DNS ... only at the finish
  const other = atFinish(data) ? list.filter(r => !isRanked(r) && statusLabel(r)) : [];
  return { ranked, other, all: [...ranked, ...other] };
}

/** The table at the start: every runner with a start time, in start order, showing the start time */
const atStart = (data) => /^(s|start)$/i.test(String(data?.controlCode ?? '').trim());
function startOrder(data) {
  const tz = data?.competitionTimeZone;
  const list = (Array.isArray(data?.results) ? data.results : [])
    .filter(r => r.startTimeMs || r.startTime || r.time)
    .slice()
    .sort((a, b) => (a.startTimeMs ?? 0) - (b.startTimeMs ?? 0));
  // Runners are still "running" at the start: show them as plain rows with their start time
  const all = list.map(r => ({ ...r, statusCode: 0, position: '', diff: '',
    time: r.startTimeMs ? timeOfDay(r.startTimeMs, tz) : (r.startTime || r.time) }));
  return { ranked: [], other: [], all };
}

function paginate(rows, perPage, step) {
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const page = Math.min(Math.max(1, step), pages);
  return { pages, page, slice: rows.slice((page - 1) * perPage, page * perPage) };
}

function emptyRow(text) {
  return `<div class="row row--empty" style="--i:0"><span class="c-name">${esc(text)}</span></div>`;
}

// --- kinds ------------------------------------------------------------------------------

const views = {
  /** Full results / standings table at finish or a control, paged */
  results(data, ctx) {
    // At the start no one is ranked yet (all are running): list the starters instead of nothing
    const { all, ranked } = atStart(data) ? startOrder(data) : orderedResults(data);
    const per = int(data.rowsPerPage, ctx.rowsPerPage ?? 10);
    const { pages, page, slice } = paginate(all, per, ctx.step);
    const leaderTime = ranked[0];
    const rows = slice.map((r, i) => runnerRow(r, i, data, ctx, { leader: r === leaderTime })).join('') || emptyRow(L(ctx, 'noResults', 'No results yet'));
    const where = controlLabel(data);
    const title = esc(data.title || data.className || '');
    const sub = esc(`${L(ctx, 'standingsAt', 'Standings at')} ${where}`);
    const pageInfo = pages > 1 ? `<span class="ftr-page">${page}/${pages}</span>` : '';
    // IOF, ČO and others: [class] left, the timing point right ("Mellantid 2 Önnestad" / "Mål")
    const head = ctx.timingHeader
      ? header(esc(data.className || data.title || ''), tpHtml(data, ctx), data, '', 'hdr--timing')
      : header(title, sub, data);
    return {
      steps: pages,
      html: `<div class="panel panel--table">${head}<div class="rows">${rows}</div>${footer(esc(where), data, pageInfo)}</div>`
    };
  },

  /** Start list, paged */
  'start-list'(data, ctx) {
    const list = (Array.isArray(data.results) ? data.results : []).slice()
      .sort((a, b) => (a.startTimeMs ?? parseClock(a.startTime) * 1000) - (b.startTimeMs ?? parseClock(b.startTime) * 1000));
    const per = int(data.rowsPerPage, ctx.rowsPerPage ?? 12);
    const { pages, page, slice } = paginate(list, per, ctx.step);
    const tz = data.competitionTimeZone;
    // No runner in the list has a bib: leave the bib column out (decided for the whole list,
    // so the layout does not jump between pages)
    const bibs = hasBibs(list);
    const rows = slice.map((r, i) => `<div class="row" style="--i:${i}" data-key="${rowKey(r)}">` +
      `<span class="c-start">${esc(r.startTimeMs ? timeOfDay(r.startTimeMs, tz) : time(r.startTime))}</span>` +
      (bibs ? `<span class="c-bib">${esc(r.bib ?? '')}</span>` : '') +
      `<span class="c-name">${runnerName(r, data, ctx, 'table')}</span>` +
      `<span class="c-id">${identityHtml(r, data)}</span></div>`).join('') || emptyRow(L(ctx, 'noStarters', 'No start list'));
    const pageInfo = pages > 1 ? `<span class="ftr-page">${page}/${pages}</span>` : '';
    return {
      steps: pages,
      html: `<div class="panel panel--table panel--startlist${bibs ? '' : ' no-bibs'}">${header(esc(data.className || ''), esc(L(ctx, 'startList', 'Start list')), data)}<div class="rows">${rows}</div>${footer(esc(L(ctx, 'startList', 'Start list')), data, pageInfo)}</div>`
    };
  },

  /** Lower-third standings at a control: top N, or the selected runner with neighbours */
  'standings-lower-third'(data, ctx) {
    const { ranked, all } = orderedResults(data);
    const n = int(data.rows, 3);
    // Search everyone: the selected runner may still be on the way to this control
    const focus = findRunner(Array.isArray(data.results) ? data.results : all, data);
    const leader = ranked[0];
    let rows, key = '', virtualPos = -1;
    if (focus && !ranked.includes(focus) && virtualCell(focus, data, leader)) {
      // On the way: slot the runner in where their running time would place them right now,
      // so the row climbs past the runners they are beating
      const elapsed = now(data) - focus.startTimeMs;
      virtualPos = ranked.filter(r => leaderMs(data, r) <= elapsed).length;
      const list = [...ranked.slice(0, virtualPos), focus, ...ranked.slice(virtualPos)];
      rows = around(list, virtualPos, n);
      key = `v${virtualPos}`;
    } else if (focus && ranked.includes(focus)) {
      rows = around(ranked, ranked.indexOf(focus), n);
    } else if (focus) {
      rows = [...ranked.slice(0, Math.max(1, n - 1)), focus];
    } else {
      // No runner picked: the leader, then the latest passings at this point, newest first
      const passedAt = (r) => (r.startTimeMs ?? 0) + leaderMs(data, r);
      const latest = ranked.slice(1).filter(r => r.startTimeMs && Number.isFinite(leaderMs(data, r)))
        .sort((a, b) => passedAt(b) - passedAt(a)).slice(0, Math.max(0, n - 1));
      rows = latest.length ? [ranked[0], ...latest] : ranked.slice(0, n);
    }
    const html = rows.map((r, i) => runnerRow(r, i, data, ctx, { leader: r === leader, highlight: r === focus, where: 'lower',
      virtual: r === focus ? virtualCell(r, data, leader) : '' })).join('')
      || emptyRow(L(ctx, 'noResults', 'No results yet'));
    const label = esc(splitLabel(data, ctx, virtualPos >= 0));
    // IOF, ČO and others: footer [class] left, the timing point right; on the way "Mot mellantid 2"
    const foot = ctx.timingHeader
      ? footer(esc(data.className || ''), data, `<span class="ftr-tp">${virtualPos >= 0 ? `<span class="tp"><span class="tp-full">${label}</span><span class="tp-short">${label}</span></span>` : tpHtml(data, ctx)}</span>`)
      : footer(ctlLabel(data, label), data);
    return {
      steps: 1,
      // the view changes with time while the selected runner is on the way (see graphic.js tick)
      key, rekey: virtualPos >= 0,
      html: `<div class="panel panel--lower">${header(esc(data.className || ''), label, data)}<div class="rows">${html}</div>${foot}</div>`
    };
  },

  /** One runner: place + time at the control, or a running clock until they get there */
  'runner-lower-third'(data, ctx) {
    const { ranked, all } = orderedResults(data);
    const r = findRunner(Array.isArray(data.results) ? data.results : all, data);
    const name = data.runnerName || r?.name || '';
    const leader = ranked[0];
    let value, cls = '';
    if (r && (isRanked(r) || statusLabel(r))) {
      value = esc(resultCell(r, r === leader));
    } else if (r?.startTimeMs && Number.isFinite(leaderMs(data, leader)) && data.virtualTime !== false) {
      // On the way to the control: running time against the leader's time there
      const ref = r.startTimeMs + leaderMs(data, leader);
      value = `<span class="c-vs" data-tick="vs" data-t="${ref}">${esc(clock(Math.floor((now(data) - ref) / 1000), { sign: true }))}</span>`;
      cls = ' is-running is-virtual';
    } else if (r?.startTimeMs) {
      value = `<span data-tick="elapsed" data-t="${r.startTimeMs}">${esc(clock((now(data) - r.startTimeMs) / 1000))}</span>`;
      cls = ' is-running';
    } else {
      value = '';
    }
    if (cls && isFrozen(data)) cls += ' is-frozen';
    const runner = r ?? { name, club: data.runnerClub, bib: data.runnerBib };
    const main = `<div class="row row--hl${cls}" style="--i:0" data-key="focus"><span class="c-place">${esc(r ? placeOf(r) : '')}</span>` +
      `<span class="c-name">${nameHtml(name, nameStyle(ctx, 'lower'))}</span><span class="c-id">${identityHtml(runner, data)}</span>` +
      `<span class="c-time">${value}</span></div>`;
    const ref = leader && leader !== r && data.showLeader !== false
      ? `<div class="row row--ref" style="--i:1" data-key="ref"><span class="c-place">${esc(placeOf(leader))}</span><span class="c-name">${nameHtml(leader.name, nameStyle(ctx, 'lower'))}</span>` +
        `<span class="c-id">${identityHtml(leader, data)}</span><span class="c-time">${esc(time(leader.time))}</span></div>`
      : '';
    const label = esc(controlLabel(data));
    return {
      steps: 1,
      html: `<div class="panel panel--lower panel--runner">${header(esc(data.className || ''), label, data)}<div class="rows">${main}${ref}</div>${footer(ctlLabel(data, label), data)}</div>`
    };
  },

  /** One runner's split-by-split comparison with the best at each radio control */
  'runner-splits'(data, ctx) {
    const list = Array.isArray(data.results) ? data.results : [];
    const r = findRunner(list, data);
    const controls = Array.isArray(data.splitControls) ? data.splitControls : [];
    const splits = new Map((r?.splitTimes ?? []).map(s => [String(s.code), s]));
    const max = int(data.maxControls, 6);
    let prevPlace = null;
    const rows = [];
    controls.forEach((c, idx) => {
      const s = splits.get(String(c.code));
      if (!s || !(s.time > 0)) return;
      const place = Number(s.place) || null;
      const change = prevPlace && place ? prevPlace - place : 0;
      prevPlace = place ?? prevPlace;
      const behind = Number(s.timeplus) > 0 ? clock(s.timeplus / 100, { sign: true }) : clock(s.time / 100);
      rows.push({ idx, key: c.code, html: `<span class="c-label">${esc(c.short || (c.name && !/^control\s/i.test(c.name) ? c.name : `C${c.code % 1000}`))}</span>` +
        `<span class="c-place">${place ?? ''}</span>` +
        `<span class="c-change ${change > 0 ? 'up' : change < 0 ? 'down' : ''}">${change ? Math.abs(change) : ''}</span>` +
        `<span class="c-time ${Number(s.timeplus) > 0 ? 'is-behind' : 'is-best'}">${esc(behind)}</span>` });
    });
    const shown = rows.slice(-max).map((x, i) => `<div class="row" style="--i:${i}" data-key="c${x.key}">${x.html}</div>`).join('')
      || emptyRow(L(ctx, 'noSplits', 'No split times yet'));
    const name = r?.name || data.runnerName || '';
    return {
      steps: 1,
      html: `<div class="panel panel--side panel--splits">${header(nameHtml(name, nameStyle(ctx, 'lower')), esc(data.className || ''), data)}<div class="rows">${shown}</div>${footer(nameHtml(name, 'family'), data)}</div>`
    };
  },

  /**
   * Position history: time behind the leader at every radio control and the finish (SVG chart).
   * The leader at each point runs along the top; the biggest gap at each point is labelled;
   * end labels are pushed apart so they never overlap. Runners: the top N at the finish, or the
   * operator's list (runnerNames, comma separated).
   */
  'position-history'(data, ctx) {
    const list = Array.isArray(data.results) ? data.results : [];
    const controls = (Array.isArray(data.splitControls) ? data.splitControls : []).slice();
    const n = int(data.runners, 8);
    const finishPlace = (r) => (isRanked(r) ? Number(placeOf(r)) || 999 : 999);
    const lastKnown = (r) => {
      const st = (r.splitTimes ?? []).filter(x => x.place > 0);
      return st.length ? st[st.length - 1].place + (controls.length - st.length) * 1000 : 99999;
    };
    const wanted = String(data.runnerNames ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    const top = wanted.length
      ? wanted.map(w => list.find(r => String(r.name ?? '').toLowerCase() === w) || list.find(r => String(r.name ?? '').toLowerCase().includes(w))).filter(Boolean)
      : list.slice().sort((a, b) => finishPlace(a) - finishPlace(b) || lastKnown(a) - lastKnown(b)).slice(0, n);
    const cols = [...controls.map(c => ({ code: String(c.code), label: c.short || `C${c.code % 1000}` })), { code: 'F', label: L(ctx, 'finishShort', 'F') }];
    // Time (s) of a runner at a point, and the best of the whole class there
    const timeAt = (r, col) => {
      if (col.code === 'F') { const t = parseClock(r.time); return isRanked(r) && Number.isFinite(t) ? t : NaN; }
      const x = (r.splitTimes ?? []).find(st => String(st.code) === col.code);
      return x?.time > 0 && Number(x.status ?? 0) === 0 ? x.time / 100 : NaN;
    };
    const best = cols.map(col => Math.min(...list.map(r => timeAt(r, col)).filter(Number.isFinite)));
    const series = top.map(r => cols.map((col, i) => {
      const t = timeAt(r, col);
      return Number.isFinite(t) && Number.isFinite(best[i]) ? Math.max(0, t - best[i]) : null;
    }));
    const maxLoss = Math.max(30, ...series.flat().filter(v => v !== null));
    const W = 1400, H = 540, padL = 70, padR = 400, padT = 40, padB = 90;
    const x = (i) => padL + (cols.length > 1 ? (i * (W - padL - padR)) / (cols.length - 1) : 0);
    const y = (loss) => padT + (loss / maxLoss) * (H - padT - padB);
    const gap = (sec) => (sec > 0 ? clock(sec, { sign: true }) : '0:00');
    const ends = [];
    const lines = top.map((r, k) => {
      const pts = series[k].map((v, i) => (v === null ? null : [x(i), y(v), v])).filter(Boolean);
      if (!pts.length) return '';
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      const last = pts[pts.length - 1];
      ends.push({ k, x: last[0], y: last[1], ly: last[1], label: `${r.name}${last[2] > 0 ? `  ${gap(last[2])}` : ''}` });
      return `<g class="ln ln-${k}" style="--i:${k}"><path pathLength="1" d="${d}"/>${pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="7"/>`).join('')}`;
    });
    // All labels at the right edge, at least 28 px apart; a runner still out on the course gets
    // a dotted lead line from their last point
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 28) ends[i].ly = ends[i - 1].ly + 28;
    const labelX = x(cols.length - 1) + 18;
    const labelOf = new Map(ends.map(e => [e.k, e]));
    const body = lines.map((g, k) => {
      if (!g) return '';
      const e = labelOf.get(k);
      const lead = e.x < labelX - 30 ? `<path class="lead" d="M${(e.x + 9).toFixed(1)},${e.y.toFixed(1)} L${(labelX - 8).toFixed(1)},${e.ly.toFixed(1)}"/>` : '';
      return `${g}${lead}<text class="ln-label" x="${labelX.toFixed(1)}" y="${(e.ly + 8).toFixed(1)}">${esc(e.label)}</text></g>`;
    }).join('');
    // Biggest gap among the drawn runners at each point, under its column
    const worst = cols.map((_, i) => Math.max(0, ...series.map(sr => sr[i] ?? 0)));
    const gaps = cols.map((_, i) => worst[i] > 0 ? `<text class="gap" x="${x(i).toFixed(1)}" y="${H - padB + 40}">${esc(gap(worst[i]))}</text>` : '').join('');
    const axis = cols.map((c, i) => `<text class="ax" x="${x(i).toFixed(1)}" y="${H - 12}">${esc(c.label)}</text>`).join('');
    const grid = cols.map((c, i) => `<line class="grid" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${padT - 16}" y2="${H - padB + 10}"/>`).join('');
    const svg = top.length && series.some(sr => sr.some(v => v !== null))
      ? `<svg class="chart chart--gap" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${grid}${axis}${gaps}${body}</svg>`
      : `<div class="rows">${emptyRow(L(ctx, 'noSplits', 'No split times yet'))}</div>`;
    return {
      steps: 1,
      html: `<div class="panel panel--chart">${header(esc(data.className || ''), esc(L(ctx, 'positionHistory', 'Position history')), data)}<div class="chart-body">${svg}</div>${footer(esc(L(ctx, 'positionHistory', 'Position history')), data)}</div>`
    };
  },

  /** Podium / flower ceremony: three columns in 2-1-3 order (ties share a column) */
  podium(data, ctx) {
    const { ranked } = orderedResults(data);
    const groups = new Map();
    let last = 0;
    for (const r of ranked) {
      const p = placeOf(r) === '=' ? last : Number(placeOf(r));
      last = p;
      if (!p || p > 3) continue;
      if (!groups.has(p)) groups.set(p, []);
      groups.get(p).push(r);
    }
    const col = (p, i) => {
      const rs = groups.get(p) ?? [];
      if (!rs.length) return `<div class="pod pod--${p} pod--empty"></div>`;
      return `<div class="pod pod--${p}" style="--i:${i}"><span class="c-place">${p}</span><div class="pod-names">` +
        rs.map(r => `<div class="row" data-key="${rowKey(r)}"><span class="c-name">${runnerName(r, data, ctx, 'table')}</span><span class="c-id">${identityHtml(r, data)}</span>` +
          (data.showTime ? `<span class="c-time pod-time">${esc(resultCell(r, p === 1))}</span>` : '') + `</div>`).join('') +
        `</div></div>`;
    };
    const body = groups.size ? `<div class="podium">${col(2, 1)}${col(1, 0)}${col(3, 2)}</div>` : `<div class="rows">${emptyRow(L(ctx, 'noResults', 'No results yet'))}</div>`;
    return {
      steps: 1,
      html: `<div class="panel panel--podium">${header(esc(data.title || data.className || ''), esc(L(ctx, 'podium', 'Podium')), data)}${body}${footer(esc(data.title || data.className || ''), data)}</div>`
    };
  },

  /** Next starters: the next start minute and who starts in it, with a countdown */
  'start-group'(data, ctx) {
    const list = (Array.isArray(data.results) ? data.results : []).filter(r => Number.isFinite(r.startTimeMs));
    const t = now(data) - 5000;
    const groups = new Map();
    for (const r of list) {
      if (r.startTimeMs < t) continue;
      const key = Math.floor(r.startTimeMs / 1000);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    const nextKey = [...groups.keys()].sort((a, b) => a - b)[0];
    const runners = nextKey ? groups.get(nextKey) : [];
    const startMs = nextKey ? nextKey * 1000 : NaN;
    const max = int(data.rows, 6);
    const bibs = hasBibs(runners);
    const rows = runners.slice(0, max).map((r, i) => `<div class="row" style="--i:${i}" data-key="${rowKey(r)}">${bibs ? `<span class="c-bib">${esc(r.bib ?? '')}</span>` : ''}` +
      `<span class="c-name">${runnerName(r, data, ctx, 'lower')}</span><span class="c-id">${identityHtml(r, data)}</span></div>`).join('')
      || emptyRow(L(ctx, 'noStarters', 'No more starters'));
    const when = Number.isFinite(startMs)
      ? `<span class="hdr-clock" data-tick="countdown" data-t="${startMs}">${esc(clock((now(data) - startMs) / 1000))}</span>` : '';
    const title = `${esc(L(ctx, 'start', 'Start'))} ${esc(Number.isFinite(startMs) ? timeOfDay(startMs, data.competitionTimeZone) : '')}`;
    return {
      steps: 1,
      key: String(nextKey ?? ''), rekey: true,
      html: `<div class="panel panel--lower panel--startgroup${bibs ? '' : ' no-bibs'}">${header(title, esc(data.className || ''), data, when)}<div class="rows">${rows}</div>${footer(ctlLabel(data, title), data, when)}</div>`
    };
  },

  /** Race clock: countdown to a time (then counts up), elapsed since a time, or time of day */
  clock(data, ctx) {
    const mode = data.mode || 'countdown';
    const target = parseClock(data.time);
    let attr = 'data-tick="tod"';
    if (mode !== 'time-of-day' && Number.isFinite(target)) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const ms = d.getTime() + target * 1000;
      attr = `data-tick="${mode === 'elapsed' ? 'elapsed' : 'countdown'}" data-t="${ms}"`;
    }
    const label = esc(data.label || '');
    return {
      steps: 1,
      html: `<div class="panel panel--clock">${label ? `<span class="clk-label">${label}</span>` : ''}<span class="clk-time" ${attr}></span></div>` // no event logo on the clock
    };
  },

  /** Course facts (IOF "course parameters") */
  'course-info'(data, ctx) {
    const rows = [
      ['length', L(ctx, 'length', 'Length'), withUnit(data.length, 'km')],
      ['climb', L(ctx, 'climb', 'Climb'), withUnit(data.climb, 'm')],
      ['controls', L(ctx, 'controls', 'Controls'), data.controls],
      ['winning', L(ctx, 'winningTime', 'Winning time'), withUnit(data.winningTime, 'min')],
      ['interval', L(ctx, 'startInterval', 'Start interval'), withUnit(data.startInterval, 'min')],
      ...extraRows(data.extra).map(([label, value], i) => [`extra-${i}`, label, value])
    ].filter(r => r[2] !== undefined && r[2] !== '' && r[2] !== null);
    const html = rows.map(([k, label, value], i) => `<div class="row row--${k}" style="--i:${i}"><span class="c-label">${esc(label)}</span><span class="c-value">${esc(value)}</span></div>`).join('');
    const title = esc(data.title || data.className || L(ctx, 'course', 'Course'));
    const sub = esc(data.legs || '');
    return {
      steps: 1,
      html: `<div class="panel panel--side panel--info">${header(title, sub, data)}<div class="rows">${html}</div>${footer(title, data)}</div>`
    };
  },

  /** Weather conditions (text only, no icons, as IOF asks) */
  weather(data, ctx) {
    const rows = [
      ['condition', L(ctx, 'condition', 'Conditions'), weatherCondition(data.condition, data.presentation?.language)],
      ['temperature', L(ctx, 'temperature', 'Temperature'), data.temperature !== undefined && data.temperature !== '' ? `${data.temperature} °C` : ''],
      ['wind', L(ctx, 'wind', 'Wind'), data.wind !== undefined && data.wind !== '' ? `${data.wind} km/h` : ''],
      ['humidity', L(ctx, 'humidity', 'Humidity'), data.humidity !== undefined && data.humidity !== '' ? `${data.humidity} %` : '']
    ].filter(r => r[2]);
    const html = rows.map(([k, label, value], i) => `<div class="row row--${k}" style="--i:${i}"><span class="c-label">${esc(label)}</span><span class="c-value">${esc(value)}</span></div>`).join('');
    const title = esc(data.title || data.event?.location || L(ctx, 'weather', 'Weather'));
    return {
      steps: 1,
      html: `<div class="panel panel--side panel--info panel--weather">${header(title, '', data)}<div class="rows">${html}</div>${footer(title, data)}</div>`
    };
  },

  /** Event title card: series, event, place and date */
  'event-title'(data) {
    const series = esc(data.series || data.event?.series || '');
    const title = esc(data.title || data.event?.name || data.competitionName || '');
    const place = esc(data.place || data.event?.location || data.raceLocation || '');
    const date = esc(data.date || data.event?.date || data.competitionDate || '');
    const line = [place && `<span class="ts-place">${place}</span>`, date && `<span class="ts-date">${date}</span>`].filter(Boolean).join('<span class="sep"> · </span>');
    const sponsors = (data.presentation?.sponsorLogos || []).filter(u => typeof u === 'string' && u.trim()).slice(0, 4);
    const sponsorStrip = sponsors.length ? `<div class="title-sponsors" aria-label="Sponsors">${sponsors.map(u => `<img src="${esc(serverUrl(u))}" alt="Sponsor">`).join('')}</div>` : '';
    return {
      steps: 1,
      html: `<div class="panel panel--title">${series ? `<header class="hdr"><span class="hdr-mark"></span><span class="hdr-title">${series}</span></header>` : ''}` +
        `<div class="title-body">${logoBox(data, 'title-logo')}<div class="title-text"><div class="title-main">${title}</div>${line ? `<div class="title-sub">${line}</div>` : ''}</div></div>${sponsorStrip}</div>`
    };
  },

  /** Name strap: commentator, interview, athlete */
  /** Runner identity: one runner from the competition (bib, name, club/flag, class, detail line) */
  'runner-identity'(data, ctx) {
    const list = Array.isArray(data.results) ? data.results : [];
    const r = findRunner(list, data) || {};
    const runner = { ...r, name: r.name || data.runnerName || '', club: r.club || data.runnerClub || '', country: r.country };
    const bib = data.showBib === false ? '' : String(r.bib || data.runnerBib || '');
    const sub = [data.detail, data.className].filter(Boolean).map(esc).join(' · ');
    // Extended athlete presentation (IOF "008_name_bio"): one fact per line under the name
    const bio = String(data.bio ?? '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(0, 4);
    const bioRows = bio.map((line, i) => `<div class="row row--bio" style="--i:${i + 1}"><span class="c-name c-text">${esc(line)}</span></div>`).join('');
    return {
      steps: 1,
      html: `<div class="panel panel--lower panel--strap panel--identity${bio.length ? ' panel--extended' : ''}"><div class="rows"><div class="row row--hl" style="--i:0">` +
        (bib ? `<span class="c-place">${esc(bib)}</span>` : '') +
        `<span class="c-name">${nameHtml(runner.name, nameStyle(ctx, 'strap'))}</span><span class="c-id">${identityHtml(runner, data, { code: true })}</span></div>${bioRows}</div>` +
        (sub ? footer(sub, data) : '') + `</div>`
    };
  },

  /**
   * Runner focus: one runner followed at the start (default), a radio control or the finish.
   * Before the start a countdown, then the running time; once through the chosen control or
   * the finish, the place and time there. "Start time only" shows the start time instead.
   */
  'runner-start'(data, ctx) {
    const list = Array.isArray(data.results) ? data.results : [];
    const r = findRunner(list, data) || {};
    const runner = { ...r, name: r.name || data.runnerName || '', club: r.club || data.runnerClub || '', country: r.country };
    const bib = data.showBib === false ? '' : String(r.bib || data.runnerBib || '');
    const code = String(data.controlCode ?? '').trim();
    const atStart = !code || /^(s|start)$/i.test(code);
    const { ranked } = orderedResults(data);
    const through = !atStart && (isRanked(r) || !!statusLabel(r));
    const startMs = Number(r.startTimeMs);
    let place = bib, box = '', cls = '';
    if (through) {
      place = placeOf(r) || bib;
      box = `<span class="c-time">${esc(resultCell(r, r === ranked[0]))}</span>`;
      cls = ' is-through';
    } else if (statusLabel(r)) {
      box = `<span class="c-time">${esc(statusLabel(r))}</span>`;
    } else if (Number.isFinite(startMs) && data.startTimeOnly) {
      box = `<span class="c-time"><span class="st-at">${esc(timeOfDay(startMs, data.competitionTimeZone))}</span></span>`;
    } else if (Number.isFinite(startMs)) {
      const left = startMs - now(data);
      box = `<span class="c-time"><span class="st-at" data-tick="run" data-t="${startMs}">${esc(left > 0 ? clock(-Math.ceil(left / 1000)) : clock(-left / 1000))}</span></span>`;
      cls = left > 0 ? ' is-counting' : ` is-running${isFrozen(data) ? ' is-frozen' : ''}`;
    } else if (r.startTime) {
      box = `<span class="c-time">${esc(time(r.startTime))}</span>`;
    }
    const sub = atStart
      ? [data.detail, data.className].filter(Boolean).map(esc).join(' · ') || esc(L(ctx, 'start', 'Start'))
      : esc(splitLabel(data, ctx, !through));
    return {
      steps: 1,
      html: `<div class="panel panel--lower panel--strap panel--start"><div class="rows"><div class="row row--hl${cls}" style="--i:0" data-key="focus">` +
        (place ? `<span class="c-place">${esc(place)}</span>` : '') +
        `<span class="c-name">${nameHtml(runner.name, nameStyle(ctx, 'strap'))}</span><span class="c-id">${identityHtml(runner, data, { code: true })}</span>` +
        (data.showStartTime === false ? '' : box) + `</div></div>` +
        footer(sub, data) + `</div>`
    };
  },

  /** Free text lower third */
  'free-text'(data) {
    const text = esc(data.text || '');
    return {
      steps: 1,
      html: `<div class="panel panel--lower panel--strap panel--freetext"><div class="rows"><div class="row row--hl" style="--i:0"><span class="c-name c-text">${text}</span></div></div>` +
        (data.title ? footer(esc(data.title), data) : '') + `</div>`
    };
  },

  /** Commentators / speaker lower third */
  speaker(data, ctx) {
    const names = esc(data.commentators || data.text || '');
    const title = esc(data.title || L(ctx, 'commentators', 'Commentators'));
    return {
      steps: 1,
      html: `<div class="panel panel--lower panel--strap panel--speaker"><div class="rows"><div class="row row--hl" style="--i:0">` +
        `<span class="c-place c-mic" aria-hidden="true"><svg viewBox="0 0 24 24" width="1em" height="1em"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.93V22h2v-3.07A7 7 0 0 0 19 12h-2Z"/></svg></span>` +
        `<span class="c-name">${names}</span></div></div>` + footer(title, data) + `</div>`
    };
  },

  'name-strap'(data, ctx) {
    const runner = { name: data.name, club: data.club, country: data.country };
    return {
      steps: 1,
      html: `<div class="panel panel--lower panel--strap"><div class="rows"><div class="row row--hl" style="--i:0">` +
        (data.bib ? `<span class="c-place">${esc(data.bib)}</span>` : '') +
        `<span class="c-name">${nameHtml(data.name, nameStyle(ctx, 'strap'))}</span><span class="c-id">${identityHtml(runner, data, { code: true })}</span></div></div>` +
        (data.title ? footer(esc(data.title), data) : '') + `</div>`
    };
  }
};

export function renderView(kind, data, ctx) {
  const view = views[kind];
  if (!view) return { steps: 1, html: `<div class="panel"><div class="rows">${emptyRow(`Unknown graphic: ${kind}`)}</div></div>` };
  return view(data ?? {}, { ...ctx, labels: eventLabels(data?.presentation?.language, ctx?.labels) });
}

export const kinds = Object.keys(views);
// re-exported for themes/tests
export { time, diff };

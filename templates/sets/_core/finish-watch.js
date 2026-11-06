import { esc, nameHtml, clock, now, parseClock, statusLabel, clockStartMs } from './util.js';
const keyOf = r => JSON.stringify([r.className || '', r.name || '', r.club || '', r.bib || '']);
const splitAt = (runner, code) => (runner.splitTimes || []).find(s => String(s.code) === String(code) && Number(s.time) > 0 && Number(s.status || 0) === 0);
const isFinish = code => /^(f|finish|1000)$/i.test(String(code));

/** Official total race time at the measuring point; the trigger is never subtracted. */
export function measuredResult(runner, code) {
  if (isFinish(code)) {
    const ms = Number(runner.finishTimeMs) || parseClock(runner.time) * 1000;
    return Number(runner.statusCode || 0) === 0 && ms > 0
      ? { ms, place: runner.position } : null;
  }
  const split = splitAt(runner, code);
  return split ? { ms: Number(split.time) * 10, place: split.place } : null;
}

/** One state machine per graphic instance. Already-completed historical runners never replay. */
export function createFinishWatchView() {
  let scope;
  let observed = new Map();
  return function finishWatch(data, ctx = {}) {
    const trigger = data.triggerControl;
    const measure = data.measureControl || 'F';
    const signature = JSON.stringify([trigger, measure, data.className || '', data.competitionDate || '', data.competitionName || '']);
    const initial = scope !== signature;
    if (initial) { scope = signature; observed = new Map(); }
    const at = now(data);
    const sv = data.presentation?.language === 'sv';
    const valid = trigger && measure && String(trigger) !== String(measure);
    const all = Array.isArray(data.results) ? data.results : [];
    const results = data.className ? all.filter(r => !r.className || r.className === data.className) : all;
    const hold = Math.max(0, Number(data.holdSeconds ?? 4)) * 1000;
    if (valid) for (const runner of results) {
      const warning = splitAt(runner, trigger);
      if (!warning) continue;
      const id = keyOf(runner);
      const measured = measuredResult(runner, measure) || (statusLabel(runner) ? { ms: null, place: '—', label: statusLabel(runner) } : null);
      let state = observed.get(id);
      if (!state) {
        state = { firstSeen: at, runner, finishedAt: null, historical: initial && !!measured };
        observed.set(id, state);
      }
      state.runner = runner;
      state.measured = measured;
      if (measured && state.finishedAt === null) state.finishedAt = at;
      // Corrected/withdrawn times can resume the running clock.
      if (!measured && state.finishedAt !== null) { state.finishedAt = null; state.historical = false; }
    }
    const available = new Set(results.map(keyOf));
    // Two 250 ms clock ticks leave room for the full 240 ms exit, regardless of tick phase.
    const visible = [...observed.entries()].filter(([id, s]) => available.has(id) && !s.historical && (s.finishedAt === null || at - s.finishedAt < hold + (hold > 0 ? 500 : 0)))
      .sort((a, b) => a[1].firstSeen - b[1].firstSeen || String(a[1].runner.name).localeCompare(String(b[1].runner.name)));
    const max = Math.min(12, Math.max(1, Math.trunc(Number(data.maxRows) || 8)));
    const shown = visible.slice(0, max);
    const rows = shown.map(([id, state], index) => {
      const leaving = state.finishedAt !== null && at - state.finishedAt >= hold;
      const r = state.runner;
      const className = r.className || data.className || '';
      const elapsed = clockStartMs(r) > 0 ? Math.max(0, at - clockStartMs(r)) : null;
      const total = state.measured?.ms ?? elapsed;
      const completedInClass = results.filter(other => (other.className || data.className || '') === className)
        .map(other => measuredResult(other, measure)).filter(Boolean);
      const position = state.measured?.place || (total === null ? '—' : 1 + completedInClass.filter(s => s.ms < total).length);
      const time = state.measured ? esc(state.measured.label || clock(state.measured.ms / 1000)) : elapsed === null ? '—'
        : `<span data-tick="elapsed" data-t="${clockStartMs(r)}">${esc(clock(elapsed / 1000))}</span>`;
      return `<div class="row${leaving ? ' is-leaving' : ''}${state.measured ? ' is-registered' : ' is-approaching'}" style="--i:${index}" data-key="${esc(id)}">` +
        `<span class="c-place" title="${state.measured ? 'Registered placing' : 'Provisional placing at the measuring point'}">${esc(position)}${state.measured ? '' : '<small class="watch-provisional">*</small>'}</span>` +
        `<span class="c-name">${nameHtml(r.name, ctx.nameStyle?.table || 'full')}</span>` +
        `<span class="c-id">${esc(className)}</span><span class="c-time">${time}</span></div>`;
    }).join('');
    const label = isFinish(measure) ? (sv ? 'Mål' : 'Finish') : `${sv ? 'Kontroll' : 'Control'} ${measure || '—'}`;
    const empty = !valid ? (sv ? 'Välj förvarning och mätpunkt' : 'Choose a prewarning and measuring point') : (sv ? 'Väntar på löpare' : 'Waiting for runners');
    // Running ranks and completed-row expiry are evaluated on every shared clock tick.
    const key = JSON.stringify(shown.map(([id, s]) => [id, !!s.measured, s.finishedAt !== null && at - s.finishedAt >= hold, s.measured?.ms, s.measured?.place,
      s.finishedAt === null && clockStartMs(s.runner) ? Math.floor((at - clockStartMs(s.runner)) / 1000) : 0]));
    return { steps: 1, rekey: true, key,
      html: `<div class="panel panel--lower panel--finish-watch"><header class="hdr"><span class="hdr-mark"></span>` +
        `<span class="hdr-title">${esc(data.title || (sv ? 'På väg mot ' : 'Approaching ') + label)}</span><span class="hdr-sub">${esc(data.className || (sv ? 'Alla klasser' : 'All classes'))}</span></header>` +
        `<div class="rows">${rows || `<div class="row row--empty"><span class="c-name">${empty}</span></div>`}</div>` +
        `<footer class="ftr"><span class="watch-note">${sv ? '* preliminär placering' : '* provisional place'}</span><span>${visible.length > max ? `${max}/${visible.length} · ` : ''}${esc(label)}</span></footer></div>` };
  };
}

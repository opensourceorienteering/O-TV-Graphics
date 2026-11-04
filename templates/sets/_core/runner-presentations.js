import { esc, identityHtml, nameHtml, parseClock, time, timeOfDay, int } from './util.js';

/** The picker uses name + club, so bib-less runners and duplicate names stay distinct. */
export const presentationRunnerKey = (runner) => JSON.stringify([runner.name || '', runner.club || '']);

/** Each page opens normally, then presents its selected runners in start order. */
export function presentationSteps(data, ctx = {}) {
  const list = (Array.isArray(data.results) ? data.results : []).slice().sort((a, b) =>
    (a.startTimeMs ?? parseClock(a.startTime) * 1000) - (b.startTimeMs ?? parseClock(b.startTime) * 1000));
  const perPage = Math.max(1, int(data.rowsPerPage, ctx.rowsPerPage ?? 10));
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const picked = new Set(Array.isArray(data.highlightRunners) ? data.highlightRunners : list.filter(r => r.favourite).map(presentationRunnerKey));
  const steps = [];
  for (let page = 0; page < pages; page++) {
    const runners = list.slice(page * perPage, (page + 1) * perPage);
    steps.push({ page, runners, focus: null });
    for (const runner of runners) if (picked.has(presentationRunnerKey(runner))) steps.push({ page, runners, focus: presentationRunnerKey(runner) });
  }
  // One final Next fades the last focus away, without taking the list off air.
  if (steps.at(-1)?.focus) steps.push({ ...steps.at(-1), focus: null });
  return { list, pages, steps };
}

export default function runnerPresentations(data, ctx) {
  const { list, pages, steps } = presentationSteps(data, ctx);
  const current = steps[Math.min(steps.length - 1, Math.max(0, (ctx.step || 1) - 1))];
  const bibs = list.some(r => String(r.bib ?? '').trim());
  const rows = current.runners.map((runner, index) => {
    const key = presentationRunnerKey(runner);
    const name = nameHtml(runner.name, ctx.nameStyle?.table || 'full');
    return `<div class="row${current.focus === key ? ' is-presented' : ''}" style="--i:${index}" data-key="${esc(key)}">` +
      `<span class="c-start">${esc(runner.startTimeMs ? timeOfDay(runner.startTimeMs, data.competitionTimeZone) : time(runner.startTime))}</span>` +
      (bibs ? `<span class="c-bib">${esc(runner.bib ?? '')}</span>` : '') +
      `<span class="c-name"><span class="presentation-name">${name}</span><span class="presentation-focus-name" aria-hidden="true">${name}</span></span>` +
      `<span class="c-id">${identityHtml(runner, data)}</span></div>`;
  }).join('') || '<div class="row row--empty"><span class="c-name">No start list</span></div>';
  const label = data.presentation?.language === 'sv' ? 'Startlista' : 'Start list';
  return {
    steps: steps.length,
    // The shared lifecycle patches focus steps in place, animating only actual page changes.
    pageKey: `page-${current.page}`,
    html: `<div class="panel panel--table panel--startlist panel--presentations${bibs ? '' : ' no-bibs'}">` +
      `<header class="hdr"><span class="hdr-mark"></span><span class="hdr-title">${esc(data.className || '')}</span><span class="hdr-sub">${label}</span></header>` +
      `<div class="rows">${rows}</div>` +
      (pages > 1 ? `<footer class="ftr"><span class="ftr-mark"></span><span class="ftr-page">${current.page + 1}/${pages}</span></footer>` : '') + '</div>',
  };
}

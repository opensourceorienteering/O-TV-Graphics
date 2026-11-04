import { createRace } from '/site/preview/sim.js';
import { graphicFeedData } from '/site/preview/feeds.js';
const catalogue = await (await fetch('/catalogue.json')).json();
const results = [];
const errors = [];
addEventListener('error', e => errors.push(e.message));
addEventListener('unhandledrejection', e => errors.push(String(e.reason?.stack || e.reason)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const settle = async () => {
  await frames();
  for (const gfx of document.querySelector('#host').firstElementChild?.shadowRoot?.querySelectorAll('.gfx') || []) {
    for (const animation of gfx.getAnimations({ subtree: true })) {
      if (Number.isFinite(animation.effect.getComputedTiming().activeDuration)) animation.finish();
    }
  }
  await frames();
};
const capture = async name => { await settle(); await fetch(`/capture?name=${encodeURIComponent(name)}`, { method: 'POST' }); };
const race = createRace({ firstStart: Date.parse('2026-11-03T10:00:00Z') });
const timing = race.data(race.end, 'F');
let sequence = 0;
for (const { manifest, folder } of catalogue) {
  const errorStart = errors.length;
  let el;
  const result = { id: manifest.id, kind: manifest.v_olgrafik_kind, ok: false };
  try {
    const mod = await import(`${folder}/${manifest.main}`);
    const tag = `template-test-${++sequence}`;
    customElements.define(tag, mod.default);
    el = document.createElement(tag);
    document.querySelector('#host').append(el);
    const defaults = Object.fromEntries(Object.entries(manifest.schema?.properties || {}).filter(([, s]) => s.default !== undefined).map(([key, s]) => [key, s.default]));
    const first = race.runners[0];
    const data = {
      ...defaults, ...graphicFeedData({ desk: manifest.v_olgrafik_desk, schema: manifest.schema }, timing),
      results: timing.results.map((r, i) => ({ ...r, favourite: i === 0 || i === 3 })),
      runnerName: first.name, runnerClub: first.club, runnerBib: first.bib,
      className: race.className, name: first.name, club: first.club, country: first.country,
      title: 'Template regression · Å Ä Ö', text: 'Welcome to the race',
      series: 'Split Control', detail: 'Runner presentation', bio: 'European champion',
      commentators: 'Anna Andersson, Erik Berg', targetTime: '14:00:00', label: 'Race time', mode: 'time-of-day', time: '14:00:00',
      rowsPerPage: 5, maxControls: 4, clockOffsetMs: race.end - Date.now(), frozenAt: Date.now(),
      presentation: { language: 'en', identity: 'club', logoMode: 'template' },
      event: { name: 'Template regression', location: 'Arena', date: timing.competitionDate },
    };
    if (manifest.v_olgrafik_kind === 'finish-watch') {
      data.triggerControl = String(timing.splitControls[0].code);
      data.measureControl = 'F';
      data.className = '';
      data.results = data.results.map((r, i) => i < 2 ? { ...r, className: i ? 'H21' : 'D21', statusCode: 10, time: '--:--',
        startTimeMs: race.end - (35 + i) * 60000 } : { ...r, className: 'D21' });
    }
    await el.load({ data, renderType: 'realtime' });
    const shown = await el.playAction({ skipAnimation: true });
    await document.fonts.ready;
    await frames();
    assert(el.shadowRoot?.textContent?.trim(), 'Empty graphic');
    assert(!el.shadowRoot.textContent.includes('Unknown graphic:'), 'Unknown graphic renderer');
    const panel = el.shadowRoot.querySelector('.panel');
    if (panel) {
      const rect = panel.getBoundingClientRect();
      result.geometry = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      assert(rect.width > 0 && rect.height > 0, 'Zero-sized panel');
      assert(rect.left >= -1 && rect.top >= -1 && rect.right <= 1921 && rect.bottom <= 1081, `Panel outside 1920×1080: ${JSON.stringify(result.geometry)}`);
      assert(getComputedStyle(el.shadowRoot.querySelector('.gfx')).visibility !== 'hidden', 'Graphic remains hidden after Show');
    }
    for (const img of el.shadowRoot.querySelectorAll('img')) {
      try { await img.decode(); } catch { throw new Error(`Broken image: ${img.src}`); }
    }
    await capture(manifest.id);
    result.steps = shown.totalSteps ?? el.steps ?? 1;
    if (result.steps > 1) {
      const next = await el.playAction({ delta: 1, skipAnimation: true });
      assert(next.currentStep === 2, 'Next did not advance');
      await capture(`${manifest.id}-step2`);
      if (manifest.v_olgrafik_kind === 'runner-presentations') {
        const focus = el.shadowRoot.querySelector('.is-presented');
        assert(focus, 'Favourite did not receive focus');
        assert(getComputedStyle(focus).transform !== 'none', 'Focused runner is not elevated');
        assert(getComputedStyle(focus.querySelector('.presentation-focus-name')).opacity === '1', 'Focused name did not finish fading in');
      }
      const previous = await el.playAction({ delta: -1, skipAnimation: true });
      assert(previous.currentStep === 1, 'Previous did not reverse');
      const last = await el.playAction({ goto: result.steps, skipAnimation: true });
      assert(last.currentStep === result.steps, 'Cannot reach last step');
      await capture(`${manifest.id}-last`);
    }
    if (manifest.v_olgrafik_kind === 'finish-watch') {
      assert(el.shadowRoot.querySelectorAll('.is-approaching').length === 2, 'Prewarning did not show both classes');
      assert(el.shadowRoot.textContent.includes('35:00'), 'Clock must show total race time, not the radio interval');
      const activeRunner = el.shadowRoot.querySelector('.is-approaching');
      const activeKey = activeRunner.dataset.key;
      const registered = { ...data, results: data.results.map((r, i) => i ? r : { ...r, statusCode: 0, time: '35:12', finishTimeMs: 2112000, position: 1 }) };
      await el.updateAction({ data: registered });
      assert(el.shadowRoot.querySelector('.is-registered'), 'Finish did not freeze the runner');
      assert(el.shadowRoot.querySelector('.is-registered .c-time').getAnimations().length > 0, 'Finish registration did not animate');
      assert(el.shadowRoot.querySelector('.is-registered .c-time').textContent === '35:12', 'Wrong official finish time');
      await capture(`${manifest.id}-registered`);
      await el.updateAction({ data: { ...registered, frozenAt: data.frozenAt + 4000 } });
      const leavingRunner = el.shadowRoot.querySelector('.is-leaving');
      assert(leavingRunner, 'Expired runner must animate before removal');
      assert(leavingRunner.getAnimations().some(animation => animation.playState === 'running'), 'Completed runner must animate out');
      assert(!activeRunner.getAnimations().some(animation => animation.playState === 'running'), 'Active runner must not animate when another runner expires');
      await el.updateAction({ data: { ...registered, frozenAt: data.frozenAt + 5000 } });
      assert(!el.shadowRoot.querySelector('.is-registered'), 'Completed runner did not leave after the hold');
      assert(el.shadowRoot.querySelector('.is-approaching') === activeRunner, 'Active runner must remain in place when a completed runner is removed');
      assert(activeRunner.dataset.key === activeKey, 'Active runner identity changed while another runner left');
      await capture(`${manifest.id}-after-hold`);
      await el.updateAction({ data: { ...data, title: '', presentation: { ...data.presentation, language: 'sv' } } });
      assert(el.shadowRoot.textContent.includes('På väg mot Mål'), 'Swedish finish-watch labels did not apply');
      await capture(`${manifest.id}-sv`);
    }
    await el.updateAction({ data: { ...data, title: 'Updated title', text: 'Updated text' } });
    await frames();
    await el.updateAction({ data: { ...data, presentation: { ...data.presentation, identity: 'both', logoMode: 'custom', logoUrl: '/templates/sets/standard/split-control-logo.svg' } } });
    for (const img of el.shadowRoot.querySelectorAll('img')) { await img.decode(); }
    await capture(`${manifest.id}-custom-logo`);
    await el.updateAction({ data: { ...data, results: [], presentation: { ...data.presentation, logoMode: 'none' } } });
    await frames();
    assert(!el.shadowRoot.textContent.includes('Unknown graphic:'), 'Empty data broke view');
    await el.stopAction({ skipAnimation: true });
    const gfx = el.shadowRoot.querySelector('.gfx');
    if (gfx) assert(gfx.dataset.state === 'out', 'Hide did not set out state');
    await el.dispose();
    assert(!el.shadowRoot.childNodes.length, 'Dispose left DOM nodes');
    assert(errors.length === errorStart, errors.slice(errorStart).join('\n'));
    result.ok = true;
  } catch (error) {
    result.error = error.stack || String(error);
  } finally {
    try { await el?.dispose?.(); } catch { /* failure already recorded */ }
    el?.remove();
  }
  results.push(result);
}
for (const { manifest } of catalogue.filter(x => x.manifest.v_olgrafik_kind === 'runner-presentations')) {
  const normal = results.find(r => r.id === `${manifest.v_olgrafik_set}-start-list`)?.geometry;
  const presentation = results.find(r => r.id === manifest.id);
  if (normal && presentation?.geometry && (normal.x !== presentation.geometry.x || normal.y !== presentation.geometry.y || normal.width !== presentation.geometry.width)) {
    presentation.ok = false;
    presentation.error = 'Presentation placement/width differs from the normal start list';
  }
}
await fetch('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ total: results.length, failed: results.filter(r => !r.ok).length, results }) });

import { graphicFeedData } from './feeds.js';
// Split Control preview: every look's graphics in the browser, driven by a simulated race.
import { createRace, raceEvents } from './sim.js';
import { unzipSync } from './vendor/fflate.js';

const $ = (id) => document.getElementById(id);
const PREVIEW = new URL('./', location.href).pathname;            // .../preview/
const TEMPLATES = `${PREVIEW}templates/`;
const UPLOADS_KEY = 'split-control-preview-uploads';

/** Graphic kinds in the order of the Live desk, with the desk's names */
const KINDS = [
  ['event-title', 'Race title'], ['standings-lower-third', 'Live split'], ['runner-identity', 'Runner identity'],
  ['runner-start', 'Runner focus'], ['results', 'Results table'], ['runner-splits', 'Split comparison'],
  ['start-list', 'Start list'], ['start-group', 'Start group'], ['position-history', 'Position history'],
  ['podium', 'Podium / flowers'], ['course-info', 'Course parameters'], ['weather', 'Weather'],
  ['free-text', 'Identity plate'], ['speaker', 'Commentators / speaker'], ['clock', 'Elapsed timer'],
  ['runner-lower-third', 'Runner lower third'], ['name-strap', 'Name strap'],
];
const kindLabel = (kind, fallback) => KINDS.find(([k]) => k === kind)?.[1] || fallback || kind;
const kindOrder = (kind) => { const i = KINDS.findIndex(([k]) => k === kind); return i < 0 ? 99 : i; };

const state = {
  looks: [],          // { id, name, description, colors, uploaded, graphics: [{ kind, folder, name, main }] }
  look: null,
  graphic: null,      // the chosen graphic of the look
  el: null,           // its element
  onAir: false,
  colors: [],
  race: createRace(),
  simNow: 0,
  running: false,
};
// Open in the middle of the race, so passings and running clocks show at once
state.simNow = state.race.firstStart + 16 * 60_000;

// --- looks ---------------------------------------------------------------------------------

async function serviceWorkerReady() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
        setTimeout(resolve, 3000);
      });
    }
    return !!navigator.serviceWorker.controller;
  } catch {
    return false;
  }
}

const uploadedLooks = () => { try { return JSON.parse(localStorage.getItem(UPLOADS_KEY) || '[]'); } catch { return []; } };
const saveUploaded = (list) => localStorage.setItem(UPLOADS_KEY, JSON.stringify(list));

async function loadLooks() {
  let builtIn = [];
  try { builtIn = (await (await fetch('looks.json')).json()).looks; } catch { status('Could not load the list of looks.', true); }
  const uploaded = uploadedLooks();
  const ids = new Set(uploaded.map((l) => l.id));
  state.looks = [...uploaded, ...builtIn.filter((l) => !ids.has(l.id))];
  $('look').innerHTML = state.looks.map((l) =>
    `<option value="${esc(l.id)}">${esc(l.name)}${l.uploaded ? ' (loaded)' : ''}</option>`).join('');
  $('clear-uploads').hidden = !uploaded.length;
}

function chooseLook(id) {
  const look = state.looks.find((l) => l.id === id) || state.looks[0];
  if (!look) return;
  state.look = look;
  $('look').value = look.id;
  $('look-desc').textContent = (look.approvedEventsOnly ? 'Only use at approved events. ' : '') + (look.description || '');
  state.colors = [...(look.colors || [])];
  renderColors();
  const graphics = [...look.graphics].sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
  $('graphics').innerHTML = graphics.map((g) =>
    `<button type="button" role="option" data-folder="${esc(g.folder)}">${esc(kindLabel(g.kind, g.name))}</button>`).join('');
  const wantedKind = state.graphic?.kind || new URLSearchParams(location.search).get('graphic');
  const same = graphics.find((g) => g.kind && g.kind === wantedKind) || graphics[0];
  void chooseGraphic(same?.folder);
}

// --- loading a look from a zip -----------------------------------------------------------

const TYPES = { js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', json: 'application/json',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', html: 'text/html', txt: 'text/plain' };

async function loadZip(file) {
  if (!state.swReady) { status('Loading a look needs a browser with service workers (Chrome, Edge, Firefox, Safari).', true); return; }
  try {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const files = Object.entries(entries)
      .map(([name, data]) => [name.replace(/\\/g, '/'), data])
      .filter(([name]) => !name.endsWith('/') && !name.startsWith('__MACOSX/') && !name.split('/').includes('..'));
    const lookDirs = files.map(([n]) => n).filter((n) => n === 'set.json' || n.endsWith('/set.json'))
      .map((n) => n.slice(0, -'set.json'.length));
    if (!lookDirs.length) throw new Error('The zip has no set.json: is it a look?');
    const cache = await caches.open('uploaded-looks');
    const list = uploadedLooks();
    const added = [];
    for (const dir of lookDirs) {
      const inLook = files.filter(([n]) => n.startsWith(dir)).map(([n, d]) => [n.slice(dir.length), d]);
      const text = (path) => new TextDecoder().decode(inLook.find(([n]) => n === path)?.[1] ?? new Uint8Array());
      const meta = JSON.parse(text('set.json') || '{}');
      const id = String(meta.id || dir.replace(/\/$/, '').split('/').pop() || '').trim();
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || id.startsWith('_')) throw new Error(`"${id}" can't be used as a look id`);
      const graphics = [];
      for (const [n] of inLook) {
        const m = /^([^/]+)\/\1\.ograf\.json$/.exec(n);
        if (!m) continue;
        const manifest = JSON.parse(text(n));
        graphics.push({ folder: m[1], kind: manifest.v_olgrafik_kind || '', name: manifest.name || m[1], main: manifest.main || 'graphic.js', desk: manifest.v_olgrafik_desk, schema: manifest.schema });
      }
      if (!graphics.length) throw new Error(`The look "${id}" has no graphics`);
      // each load gets its own address, so the browser never reuses files of an earlier one
      const base = `${PREVIEW}uploads/${Date.now().toString(36)}/`;
      const old = list.find((l) => l.id === id);
      if (old?.base) for (const req of await cache.keys()) if (new URL(req.url).pathname.startsWith(old.base)) await cache.delete(req);
      for (const [n, data] of inLook) {
        const ext = n.split('.').pop().toLowerCase();
        await cache.put(new URL(`${base}sets/${id}/${n}`, location.href).href,
          new Response(data, { headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream' } }));
      }
      const look = { id, name: meta.name || id, description: meta.description || '', colors: meta.colors || [], approvedEventsOnly: meta.approvedEventsOnly === true, uploaded: true, base, graphics };
      const i = list.findIndex((l) => l.id === id);
      if (i >= 0) list[i] = look; else list.unshift(look);
      added.push(look);
    }
    saveUploaded(list);
    await loadLooks();
    chooseLook(added[0].id);
    status(`Loaded ${added.map((l) => l.name).join(', ')}. It stays in this browser until you remove it.`);
  } catch (error) {
    status(`Couldn't load the zip: ${error.message}`, true);
  }
}

async function clearUploads() {
  await caches.delete('uploaded-looks');
  localStorage.removeItem(UPLOADS_KEY);
  location.reload();
}

// --- the graphic ---------------------------------------------------------------------------

let tagSeq = 0;
const tags = new Map();
async function chooseGraphic(folder) {
  const g = state.look?.graphics.find((x) => x.folder === folder);
  if (!g) return;
  for (const b of $('graphics').children) b.setAttribute('aria-selected', String(b.dataset.folder === folder));
  const wasOnAir = state.onAir;
  if (state.el) { await state.el.stopAction?.({ skipAnimation: true }).catch(() => {}); state.el.remove(); }
  state.el = null;
  setOnAir(false);
  state.graphic = g;
  try {
    const url = `${state.look.base || TEMPLATES}sets/${state.look.id}/${g.folder}/${g.main}`;
    const mod = await import(url);
    // a graphic's class can be registered once only: reuse its tag when it is chosen again
    let tag = tags.get(mod.default);
    if (!tag) {
      tag = `pv-graphic-${++tagSeq}`;
      customElements.define(tag, mod.default);
      tags.set(mod.default, tag);
    }
    const el = document.createElement(tag);
    $('host').append(el);
    state.el = el;
    await el.load({ data: graphicData(), renderType: 'realtime' });
    status(`${kindLabel(g.kind, g.name)} · ${state.look.name}`);
    if (wasOnAir) await show();
  } catch (error) {
    status(`This graphic could not load: ${error.message}`, true);
  }
}

async function show() {
  if (!state.el) return;
  if (state.onAir) return hide();
  await state.el.updateAction({ data: graphicData(), skipAnimation: true });
  setOnAir(true);
  await state.el.playAction({});
}
async function hide() {
  if (!state.el || !state.onAir) return;
  setOnAir(false);
  await state.el.stopAction({});
}
async function update() { if (state.el) await state.el.updateAction({ data: graphicData() }); }
async function page(delta) { if (state.el && state.onAir) await state.el.playAction({ delta }); }

function setOnAir(on) {
  state.onAir = on;
  $('onair').textContent = on ? '● On air' : 'Not on air';
  $('onair').classList.toggle('is-on', on);
  $('show').disabled = on;
}

// --- data ----------------------------------------------------------------------------------

const DEFAULT_EXTRA = {
  title: 'SM Långdistans',
  series: 'Svenska mästerskapen',
  place: 'Önnestad, Kristianstad',
  text: 'Välkommen till SM i orientering',
  name: 'Anna Lindqvist',
  detail: 'Världsmästare 2025 · 3 SM-guld',
  commentators: 'Anna Lindqvist, Erik Berg',
  label: 'Race time',
  mode: 'time-of-day',
  length: '12.4', climb: '420', controls: '24', winningTime: '68 min', startInterval: '2 min', legs: 'Long distance',
  condition: 'Partly cloudy', temperature: '18', wind: '9', humidity: '62',
  showBib: true,
};

function extraData() {
  try { return JSON.parse($('extra').value || '{}'); } catch { return {}; }
}

/** Graphics about one runner: they need one even when the operator picked none */
const RUNNER_KINDS = ['runner-identity', 'runner-start', 'runner-lower-third', 'runner-splits'];

/** With no runner picked, runner graphics follow the runner who started most recently */
function autoRunner() {
  const started = state.race.runners.filter((r) => r.startTimeMs <= state.simNow);
  return started[started.length - 1] || state.race.runners[0];
}

function graphicData() {
  const race = state.race.data(state.simNow, $('control').value || 'F');
  const picked = state.race.runners.find((r) => r.name === $('runner').value);
  const runner = picked || autoRunner();
  // Live split and tables without a runner show the leader and the latest passings, as on
  // race day; with one, they follow that runner (and a running clock on the way)
  const focus = picked || ((state.graphic?.desk?.inputs?.includes('runner') || RUNNER_KINDS.includes(state.graphic?.kind)) ? runner : null);
  const offset = state.simNow - Date.now();
  const extra = extraData();
  const samples = graphicFeedData(state.graphic, race);
  return {
    ...samples,
    date: new Date(state.race.firstStart).toISOString().slice(0, 10),
    ...(focus ? { runnerName: focus.name, runnerClub: focus.club, runnerBib: focus.bib } : {}),
    club: runner.club, country: runner.country, bib: runner.bib,
    runners: race.results.slice(0, 6).map((r) => r.name),
    ...extra,
    // the name strap and speaker show a person's name; runner graphics the chosen runner
    name: ['name-strap', 'speaker', 'free-text'].includes(state.graphic?.kind) ? (extra.name || runner.name) : runner.name,
    // the graphic's running clocks follow the race clock; paused, they stand still
    clockOffsetMs: offset,
    ...(state.running ? {} : { frozenAt: Date.now() }),
    presentation: {
      language: $('language').value,
      identity: $('identity').value,
      international: $('identity').value !== 'club',
      themeColors: state.colors,
      // template: the look's own logo; custom: an uploaded logo (here the site's logo); none
      logoMode: $('logo').value,
      ...($('logo').value === 'custom' ? { logoUrl: new URL('../logo.svg', location.href).href } : {}),
    },
    event: { ...samples.event, name: extra.title || 'SM Långdistans', date: new Date(state.race.firstStart).toISOString().slice(0, 10), location: extra.place || 'Önnestad, Kristianstad' },
  };
}

function renderColors() {
  const names = state.look?.colorNames || [];
  $('colors').innerHTML = state.colors.map((c, i) =>
    `<input type="color" value="${esc(c)}" data-i="${i}" title="${esc(names[i] || `Colour ${i + 1}`)}">`).join('') +
    (state.colors.length ? '<button type="button" class="pv-link" id="reset-colors">Reset</button>' : '<span class="pv-note">This look has no theme colours.</span>');
}

// --- race clock ----------------------------------------------------------------------------

const hhmmss = (ms) => new Date(ms).toLocaleTimeString('en-GB');
let lastTick = performance.now();
let lastPush = 0;
function tick() {
  const t = performance.now();
  const dt = t - lastTick;
  lastTick = t;
  if (state.running) {
    const before = state.simNow;
    state.simNow = Math.min(state.race.end, state.simNow + dt * Number($('sim-speed').value));
    logEvents(before, state.simNow);
    if (state.simNow >= state.race.end) setRunning(false);
  }
  $('sim-time').textContent = hhmmss(state.simNow);
  if (state.onAir && $('live').checked && state.running && t - lastPush > 500) {
    lastPush = t;
    void update();
  }
}

function logEvents(from, to) {
  const events = raceEvents(state.race, from, to);
  if (!events.length) return;
  const log = $('sim-log');
  for (const e of events) {
    const li = document.createElement('li');
    li.innerHTML = `<time>${hhmmss(e.at)}</time> ${esc(e.text)}`;
    log.prepend(li);
  }
  while (log.children.length > 30) log.lastChild.remove();
}

function setRunning(on) {
  state.running = on;
  $('sim-play').textContent = on ? 'Pause' : state.simNow > state.race.firstStart ? 'Resume' : 'Start race';
  $('sim-state').textContent = on ? `running at ${$('sim-speed').value}×` : state.simNow >= state.race.end ? 'finished' : 'paused';
  void update();
}

// --- helpers and wiring --------------------------------------------------------------------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('is-error', error);
}

function fitStage() {
  const wrap = document.querySelector('.pv-stage-wrap');
  $('host').style.transform = `scale(${wrap.clientWidth / 1920})`;
}

async function init() {
  $('extra').value = JSON.stringify(DEFAULT_EXTRA, null, 2);
  $('control').innerHTML = [['S', 'Start'], ...state.race.controls.map((c) => [c.code, `${c.short} · ${c.name}`]), ['F', 'Finish']]
    .map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
  $('control').value = '31';
  $('runner').innerHTML = '<option value="">None: latest passings</option>' +
    state.race.runners.map((r) => `<option>${esc(r.name)}</option>`).join('');
  $('runner').value = '';
  $('language').value = (navigator.language || '').startsWith('sv') ? 'sv' : (navigator.language || '').startsWith('nb') ? 'nb' : 'en';

  state.swReady = await serviceWorkerReady();
  await loadLooks();
  const wanted = new URLSearchParams(location.search).get('look');
  chooseLook(state.looks.some((l) => l.id === wanted) ? wanted : 'standard');

  $('look').addEventListener('change', (e) => chooseLook(e.target.value));
  $('graphics').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) void chooseGraphic(b.dataset.folder); });
  $('show').addEventListener('click', () => void show());
  $('update').addEventListener('click', () => void update());
  $('hide').addEventListener('click', () => void hide());
  $('next').addEventListener('click', () => void page(1));
  $('prev').addEventListener('click', () => void page(-1));
  for (const id of ['control', 'runner', 'language', 'identity', 'logo']) $(id).addEventListener('change', () => void update());
  $('bg').addEventListener('change', (e) => { $('stage').className = `pv-stage bg-${e.target.value}`; });
  $('colors').addEventListener('input', (e) => { if (e.target.dataset.i) { state.colors[e.target.dataset.i] = e.target.value; void update(); } });
  $('colors').addEventListener('click', (e) => { if (e.target.id === 'reset-colors') { state.colors = [...(state.look.colors || [])]; renderColors(); void update(); } });

  $('sim-play').addEventListener('click', () => setRunning(!state.running));
  $('sim-reset').addEventListener('click', () => { state.simNow = state.race.firstStart - 45_000; $('sim-log').innerHTML = ''; setRunning(false); });
  $('sim-jump').addEventListener('click', () => { const b = state.simNow; state.simNow = Math.min(state.race.end, b + 120_000); logEvents(b, state.simNow); void update(); });
  $('sim-speed').addEventListener('change', () => { if (state.running) setRunning(true); });

  $('pick').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) void loadZip(f); e.target.value = ''; });
  $('clear-uploads').addEventListener('click', () => void clearUploads());
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); const f = e.dataTransfer.files?.[0]; if (f) void loadZip(f); });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); void show(); }
    else if (k === 'u') void update();
    else if (k === 'h') void hide();
    else if (e.key === 'ArrowRight') void page(1);
    else if (e.key === 'ArrowLeft') void page(-1);
  });

  new ResizeObserver(fitStage).observe(document.querySelector('.pv-stage-wrap'));
  fitStage();
  setInterval(tick, 100);
  logEvents(state.race.firstStart - 1, state.simNow);
  setRunning(true);
}

void init();

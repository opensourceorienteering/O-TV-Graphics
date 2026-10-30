#!/usr/bin/env node
/**
 * Replay a finished Liveresultat competition as if it were live now.
 *
 * Downloads the final results once, then serves the Liveresultat REST API
 * (api.orienteering.services) on today's date and the real clock. With --speed 4 the race is
 * compressed four times: the gaps between start times, every split time and every result are
 * divided by 4 (a radio passing 10 min after the start arrives 2.5 min after the start, with a
 * split time of 2:30). Runners start, pass radio controls and finish as the real clock reaches
 * those times, with places and time behind recomputed for that moment.
 *
 *   node scripts/replay-liveresultat.js --competition 33124 --from 16:20 --speed 4 [--port 5800]
 *
 * --from is the original race time that is replayed from now (default: 2 min before the first
 * start). In Split Control add a LiveResults data source with base URL http://127.0.0.1:5800
 * and API "rest", then pick the competition id. GET /replay shows the replay clock.
 *
 * Simplifications: runners who did not finish (DNF, MP, DSQ, ...) get their status at their
 * finish time if they have one, otherwise one (compressed) hour after their start.
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
    return acc;
  }, [])
);
const competitionId = Number(args.competition);
if (!competitionId) {
  console.error('Usage: node scripts/replay-liveresultat.js --competition <id> [--from HH:MM] [--speed 4] [--port 5800]');
  process.exit(1);
}
const speed = Number(args.speed || 1);
const port = Number(args.port || 5800);
const source = (args.source || 'https://api.orienteering.services').replace(/\/+$/, '');
const cacheFile = path.join(os.tmpdir(), `liveresultat-replay-${competitionId}.json`);
const timeZone = 'Europe/Stockholm';

// --- data --------------------------------------------------------------------------------

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function loadCompetition() {
  if (fs.existsSync(cacheFile) && !args.refresh) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const base = `${source}/competitions/${competitionId}`;
  const info = await getJson(base);
  const { classes } = await getJson(`${base}/classes`);
  const results = {};
  for (const name of classes) {
    results[name] = await getJson(`${base}/classresults?class=${encodeURIComponent(name)}`);
    await new Promise((r) => setTimeout(r, 250)); // be gentle with the real API
  }
  const data = { info, classes, results };
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  return data;
}

// --- clock -------------------------------------------------------------------------------

/** UTC epoch ms of local midnight today in the competition time zone */
function todayMidnightEpoch() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date()).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)])
  );
  const offset = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(Date.now() / 1000) * 1000;
  return { epoch: Date.UTC(parts.year, parts.month - 1, parts.day) - offset, date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}` };
}

const day = todayMidnightEpoch();
const startedAt = Date.now();
let fromCs; // original race time replayed at startedAt
let startedCs; // local clock at startedAt

/** Real clock in hundredths since local midnight */
const clockCs = () => Math.floor((Date.now() - day.epoch) / 10);
/** The original race time the replay is at now */
const originalCs = () => fromCs + (clockCs() - startedCs) * speed;
const csToEpochMs = (cs) => day.epoch + cs * 10;
const fmt = (cs) => {
  const s = Math.floor(cs / 100);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

// --- the competition at a moment ---------------------------------------------------------

const NOT_STARTED = 10;
const RUNNING = 9;

/** Places with ties: [{ key, time }] sorted -> Map key -> { place, timeplus } */
function rank(entries) {
  entries.sort((a, b) => a.time - b.time);
  const out = new Map();
  entries.forEach((e, i) => {
    const place = i > 0 && e.time === entries[i - 1].time ? out.get(entries[i - 1].key).place : i + 1;
    out.set(e.key, { place, timeplus: e.time - entries[0].time });
  });
  return out;
}

function classAt(raw, now) {
  const controls = (raw.splitControls || []).map((c) => String(typeof c === 'object' ? c.code : c));
  const runners = raw.results.map((r, idx) => {
    const start = Number(r.start);
    const started = Number.isFinite(start) && start <= now;
    const splits = {};
    if (started && r.status !== 1) {
      for (const code of controls) {
        const t = Number(r.splits?.[code]);
        if (Number.isFinite(t) && t > 0 && start + t <= now) splits[code] = t;
      }
    }
    const result = Number(r.result);
    const finalAt = r.status === 1 ? start : Number.isFinite(result) && result > 0 ? start + result : start + Math.round(360000 / speed);
    const done = started && finalAt <= now;
    // A DNS shows from the start time; everyone else is running until their final time
    const status = !started ? NOT_STARTED : r.status === 1 || done ? r.status : RUNNING;
    return { r, idx, start, splits, status, finished: done && r.status === 0, result, finalAt };
  });

  const finish = rank(runners.filter((x) => x.finished).map((x) => ({ key: x.idx, time: x.result })));
  const atControl = Object.fromEntries(controls.map((code) => [code,
    rank(runners.filter((x) => x.splits[code] !== undefined).map((x) => ({ key: x.idx, time: x.splits[code] })))]));

  const results = runners.map((x) => {
    const { r } = x;
    const splits = {};
    let lastChange = x.status === NOT_STARTED ? 0 : x.start;
    for (const code of controls) {
      if (x.splits[code] === undefined) continue;
      const at = atControl[code].get(x.idx);
      const changed = Math.floor(csToEpochMs(x.start + x.splits[code]) / 1000);
      Object.assign(splits, {
        [code]: x.splits[code], [`${code}_status`]: 0, [`${code}_place`]: at.place,
        [`${code}_timeplus`]: at.timeplus, [`${code}_changed`]: changed
      });
      lastChange = Math.max(lastChange, x.start + x.splits[code]);
    }
    const fin = finish.get(x.idx);
    if (x.status !== NOT_STARTED && x.status !== RUNNING) lastChange = Math.max(lastChange, x.finalAt);
    const passed = Object.keys(x.splits).length;
    return {
      place: fin ? String(fin.place) : '',
      name: r.name, club: r.club, dbId: r.dbId, bib: r.bib,
      result: x.status === NOT_STARTED || x.status === RUNNING ? null : x.finished || x.result > 0 ? x.result : null,
      status: x.status,
      timeplus: fin ? fin.timeplus : null,
      progress: x.finished ? 100 : controls.length ? Math.round((passed / (controls.length + 1)) * 100) : 0,
      start: r.start,
      changed: lastChange ? Math.floor(csToEpochMs(lastChange) / 1000) : Math.floor(startedAt / 1000),
      startChanged: Math.floor(startedAt / 1000),
      splits
    };
  });
  // Liveresultat order: finishers by place, then the rest by start time
  results.sort((a, b) => (a.place && b.place ? Number(a.place) - Number(b.place) : a.place ? -1 : b.place ? 1 : a.start - b.start));
  return { ...raw, results };
}

function passingsAt(data, now) {
  const rows = [];
  for (const className of data.classes) {
    const raw = data.results[className];
    const cls = classAt(raw, now);
    const names = new Map((raw.splitControls || []).map((c) => [String(c.code ?? c), c.name ?? null]));
    for (const r of cls.results) {
      for (const [code, name] of names) {
        if (r.splits[code] === undefined) continue;
        rows.push({ class: className, control: Number(code), controlName: name, place: r.splits[`${code}_place`], bib: r.bib, name: r.name, club: r.club,
          time: r.splits[code], timeplus: r.splits[`${code}_timeplus`], wallClock: r.start + r.splits[code], changed: r.splits[`${code}_changed`] });
      }
      if (r.status === 0 && r.result) {
        rows.push({ class: className, control: 1000, controlName: null, place: Number(r.place), bib: r.bib, name: r.name, club: r.club,
          time: r.result, timeplus: r.timeplus, wallClock: r.start + r.result, changed: r.changed });
      }
    }
  }
  rows.sort((a, b) => b.wallClock - a.wallClock);
  return { passings: rows.slice(0, 50) };
}

// --- server ------------------------------------------------------------------------------

(async () => {
  const data = await loadCompetition();
  const firstStart = Math.min(...Object.values(data.results).flatMap((c) => c.results.map((r) => Number(r.start)).filter((s) => s > 0)));
  if (args.from) {
    const [h, m, s] = String(args.from).split(':').map(Number);
    fromCs = ((h * 60 + m) * 60 + (s || 0)) * 100;
  } else {
    fromCs = firstStart - 2 * 60 * 100;
  }
  startedCs = clockCs();

  // Compress the race: start offsets from --from, splits and results are divided by `speed`
  const squeeze = (cs) => Math.round(cs / speed);
  for (const cls of Object.values(data.results)) {
    for (const r of cls.results) {
      const start = Number(r.start);
      if (Number.isFinite(start) && start > 0) r.start = startedCs + squeeze(start - fromCs);
      const result = Number(r.result);
      if (Number.isFinite(result) && result > 0) r.result = squeeze(result);
      for (const [k, v] of Object.entries(r.splits || {})) {
        if (/^\d+$/.test(k) && Number(v) > 0) r.splits[k] = squeeze(Number(v));
      }
    }
  }

  const send = (req, res, body) => {
    const json = JSON.stringify(body);
    const etag = `"${crypto.createHash('sha1').update(json).digest('hex').slice(0, 16)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag, 'Access-Control-Allow-Origin': '*' });
    res.end(json);
  };

  const info = { ...data.info, date: day.date, serverTime: undefined };

  http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname.replace(/\/+$/, '');
    const now = clockCs();
    const m = p.match(/^\/competitions\/(\d+)(\/[a-z]+)?$/);
    if (p === '/time') return send(req, res, { serverTime: Date.now() });
    if (p === '/replay') return send(req, res, { competitionId, clock: fmt(now), original: fmt(originalCs()), speed, date: day.date });
    if (p === '/competitions') return send(req, res, { competitions: [info] });
    if (!m || Number(m[1]) !== competitionId) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{"error":"Competition not found"}');
    }
    switch (m[2]) {
      case undefined: return send(req, res, { ...info, serverTime: Date.now() });
      case '/classes': return send(req, res, { classes: data.classes });
      case '/classresults': {
        const raw = data.results[url.searchParams.get('class') ?? ''];
        if (!raw) return send(req, res, { className: url.searchParams.get('class'), splitControls: [], results: [] });
        return send(req, res, classAt(raw, now));
      }
      case '/passings': return send(req, res, passingsAt(data, now));
      default:
        res.writeHead(404);
        return res.end();
    }
  }).listen(port, '127.0.0.1', () => {
    console.log(`Replaying ${data.info.name} (${competitionId}) on http://127.0.0.1:${port}`);
    console.log(`Original race time ${fmt(fromCs)} is now (${fmt(startedCs)} on ${day.date}), ${speed}x compressed. Original first start ${fmt(firstStart)}.`);
  });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

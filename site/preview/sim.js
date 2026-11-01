/**
 * A simulated race for the preview: one class, runners starting at an interval, radio controls
 * and the finish. It produces graphic data in the same shape the app sends from live timing
 * (results at the chosen timing point, split times, start times), at any simulated moment.
 */

const CLASS = 'D21';
const CONTROLS = [
  { code: 31, name: 'Radio 1', short: 'R1', at: 0.24 },
  { code: 45, name: 'Önnestad', short: 'R2', at: 0.5 },
  { code: 62, name: 'Arenapassage', short: 'Arena', at: 0.74 },
  { code: 78, name: 'Radio 3', short: 'R3', at: 0.9 },
];
const RUNNERS = [
  ['Tove Alexandersson', 'Stora Tuna OK', 'SWE', '1'],
  ['Simona Aebersold', 'OL Norska', 'SUI', '2'],
  ['Andrine Benjaminsen', 'Nydalens SK', 'NOR', '3'],
  ['Hanna Lundberg', 'OK Ravinen', 'SWE', '4'],
  ['Venla Harju', 'Kalevan Rasti', 'FIN', '5'],
  ['Alva Sonesson', 'Halden SK', 'NOR', '6'],
  ['Elena Roos', 'OK Hälsingland', 'SUI', '7'],
  ['Karolin Ohlsson', 'Ulricehamns OK', 'SWE', '8'],
  ['Sara Hägström', 'IFK Göteborg', 'SWE', '9'],
  ['Lina Strand', 'Järla Orientering', 'SWE', '10'],
  ['Marika Teini', 'Angelniemen Ankkuri', 'FIN', '11'],
  ['Kamila Ryšavá', 'OK Kamenice', 'CZE', '12'],
];
const INTERVAL_MS = 2 * 60_000;

/** Small seeded random numbers, so every reload runs the same race */
function random(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};

export function createRace({ seed = 7, firstStart } = {}) {
  const rnd = random(seed);
  const start0 = firstStart ?? (() => { const d = new Date(); d.setHours(14, 0, 0, 0); return d.getTime(); })();
  const runners = RUNNERS.map(([name, club, country, bib], i) => {
    const total = (34 + rnd() * 9) * 60_000; // finish time 34–43 min
    // each leg a little faster or slower than the runner's average
    let acc = 0;
    const legs = [...CONTROLS.map((c) => c.at), 1].map((at, j, all) => {
      const share = at - (j ? all[j - 1] : 0);
      acc += share * total * (0.9 + rnd() * 0.2);
      return acc;
    });
    const scale = total / legs[legs.length - 1];
    return {
      name, club, country, bib,
      startTimeMs: start0 + i * INTERVAL_MS,
      splitsMs: legs.slice(0, -1).map((ms) => Math.round(ms * scale / 1000) * 1000),
      finishMs: Math.round(total / 1000) * 1000,
      // one mispunch at the finish, one runner who gives up after the second control
      status: i === 8 ? 'mp' : i === 10 ? 'dnf' : 'ok',
    };
  });
  const last = runners[runners.length - 1];
  return {
    className: CLASS,
    controls: CONTROLS,
    runners,
    firstStart: start0,
    end: last.startTimeMs + last.finishMs + 60_000,
    /** Graphic data at simulated time `at` for a timing point ('S', a control code or 'F') */
    data(at, controlCode = 'F') {
      return raceData(this, at, controlCode);
    },
  };
}

function raceData(race, at, controlCode) {
  const code = String(controlCode);
  const isStart = /^s$/i.test(code);
  const isFinish = /^f$/i.test(code);
  const elapsed = (r) => at - r.startTimeMs;
  const dnfAfter = (r) => r.status === 'dnf' ? r.splitsMs[1] + 4 * 60_000 : Infinity;

  // place and time behind at every radio control, among the runners through it so far
  const passedAt = race.controls.map((c, i) => race.runners
    .filter((r) => elapsed(r) >= r.splitsMs[i] && !(r.status === 'dnf' && i > 1))
    .sort((a, b) => a.splitsMs[i] - b.splitsMs[i]));
  const splitTimes = (r) => race.controls.flatMap((c, i) => {
    const list = passedAt[i];
    const place = list.indexOf(r) + 1;
    if (!place) return [];
    return [{ code: c.code, time: r.splitsMs[i] / 10, place, timeplus: (r.splitsMs[i] - list[0].splitsMs[i]) / 10, status: 0 }];
  });

  const finished = (r) => elapsed(r) >= r.finishMs && r.status !== 'dnf';
  const ctlIndex = race.controls.findIndex((c) => String(c.code) === code);
  const timeAt = (r) => isFinish ? r.finishMs : r.splitsMs[ctlIndex];
  const through = isStart ? [] : race.runners
    .filter((r) => isFinish ? finished(r) && r.status === 'ok' : passedAt[ctlIndex]?.includes(r))
    .sort((a, b) => timeAt(a) - timeAt(b));
  const leader = through[0];

  const results = race.runners.map((r) => {
    const base = {
      name: r.name, club: r.club, country: r.country, bib: r.bib,
      startTimeMs: r.startTimeMs,
      startTime: new Date(r.startTimeMs).toLocaleTimeString('en-GB'),
      splitTimes: splitTimes(r),
      statusCode: 0, position: '', time: '', diff: '',
    };
    const place = through.indexOf(r) + 1;
    if (place) {
      const t = timeAt(r);
      return { ...base, position: place, place, time: clock(t / 1000), diff: place > 1 ? `+${clock((t - timeAt(leader)) / 1000)}` : '' };
    }
    if (isFinish && r.status === 'mp' && finished(r)) return { ...base, statusCode: 3 };
    if (isFinish && r.status === 'dnf' && elapsed(r) >= dnfAfter(r)) return { ...base, statusCode: 2 };
    return base;
  });
  // ranked first, then final statuses, then runners still out, in start order
  const rank = (r) => (r.position ? 0 : r.statusCode ? 1 : 2);
  results.sort((a, b) => rank(a) - rank(b) || (Number(a.position) || 0) - (Number(b.position) || 0) || a.startTimeMs - b.startTimeMs);

  const ctl = race.controls[ctlIndex];
  return {
    className: race.className,
    controlCode: isStart ? 'S' : isFinish ? 'F' : code,
    controlName: ctl?.name ?? (isStart ? 'Start' : 'Finish'),
    splitControls: race.controls.map(({ code: c, name, short }) => ({ code: c, name, short })),
    results,
    competitionDate: new Date(race.firstStart).toISOString().slice(0, 10),
  };
}

/** What happened between two moments, for the event log ("Venla Harju, R2, 3rd") */
export function raceEvents(race, from, to) {
  const out = [];
  for (const r of race.runners) {
    if (r.startTimeMs > from && r.startTimeMs <= to) out.push({ at: r.startTimeMs, text: `${r.name} starts` });
    race.controls.forEach((c, i) => {
      if (r.status === 'dnf' && i > 1) return;
      const t = r.startTimeMs + r.splitsMs[i];
      if (t > from && t <= to) out.push({ at: t, text: `${r.name} at ${c.short} · ${clock(r.splitsMs[i] / 1000)}` });
    });
    const f = r.startTimeMs + r.finishMs;
    if (r.status !== 'dnf' && f > from && f <= to) out.push({ at: f, text: `${r.name} finishes · ${r.status === 'mp' ? 'MP' : clock(r.finishMs / 1000)}` });
  }
  return out.sort((a, b) => a.at - b.at);
}

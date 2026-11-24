/**
 * End to end with the Liveresultat replay (scripts/replay-liveresultat.js) serving a recorded
 * race (SM Medel kval 2025, Liveresultat 33124) as if it were live, compressed in time:
 *
 *   replay server (REST API) -> Liveresultat plugin (API detection, ETag polling) -> TimingHub
 *   -> DataStore -> ResultsTransformer + DataSourceFieldMapper -> PlaybackEngine -> 'update'
 *
 * Only the rundown and template managers are stubbed. The race runs while the test watches:
 * runners start, pass the radio controls and finish, and every update the graphics get must
 * be consistent. A second replay, after the race, must give the recorded final results.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

vi.mock('../../utils/logger', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), verbose: vi.fn() };
  return { logger, getLogger: () => logger };
});

const ROOT = path.resolve(__dirname, '../../../..');
const FIXTURE = path.join(ROOT, 'test-data/liveresultat/33124.json');
const RACE = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const CLASS = 'D21–1'; // first start 15:30, winner 31:47, three radio controls
const RADIO = String(RACE.results[CLASS].splitControls[1].code);
const SPEED = 240; // two hours of racing in 30 s

const api = (extra: object = {}) => ({ mode: 'api', api: { provider: 'liveresults', fieldMappings: [{ templateField: 'results', apiPath: 'results' }], ...extra } });
const templates = [
  { manifest: { id: 'results-list', name: 'Results' }, directoryName: 'results-list', dataSourceConfig: api() },
  { manifest: { id: 'split-list', name: 'At the radio' }, directoryName: 'split-list', dataSourceConfig: api() }
];
vi.mock('../../templates/OGrafManager', () => ({
  getTemplateManager: () => ({ getAllTemplates: () => templates })
}));

const rundown: any = {
  id: 'r1', projectId: 'p1', settings: {},
  dataSource: { sourceId: 'replay', competitionId: 33124 },
  items: [
    { id: 'finish', templateId: 'results-list', fields: {}, liveResultsData: { autoUpdate: true, dataSourceValues: { className: CLASS } } },
    { id: 'radio', templateId: 'split-list', fields: {}, liveResultsData: { autoUpdate: true, dataSourceValues: { className: CLASS, controlCode: RADIO } } }
  ]
};
vi.mock('../../projects/RundownManager', () => ({
  getRundownManager: () => ({
    loadRundown: async () => rundown,
    updateItem: async () => ({}),
    saveRundown: async () => undefined
  })
}));

import { getDataSourceRegistry } from '../../data/DataSourceRegistry';
import { registerBuiltInDataSources } from '../../data/sources';
import { initDataStore } from '../../data/DataStore';
import { initDefaultTimingHub } from '../../data/timing/defaultHub';
import { DataSourceFieldMapper } from '../../data/DataSourceFieldMapper';
import { PlaybackEngine } from '../PlaybackEngine';
import { baseTagProblems } from '../../../shared/baseTags';
import { registerTimingPlugin } from '../../data/timing/TimingPlugins';
import type { Entry, PluginContext, TimingPlugin } from '../../../shared/timing-sdk';
import { fakeTraceTrack, type FakeTraceTrack } from '../../data/timing/tracetrack/__tests__/fakeTraceTrack';

/** Start the replay; resolves with its address once it listens */
function replay(args: string[]): Promise<{ proc: ChildProcess; url: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(ROOT, 'scripts/replay-liveresultat.js'), '--competition', '33124', '--data', FIXTURE, '--port', '0', ...args]);
    let out = '';
    proc.stdout.on('data', chunk => {
      out += chunk;
      const m = /on (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) resolve({ proc, url: m[1] });
    });
    proc.stderr.on('data', chunk => { out += chunk; });
    proc.on('exit', code => reject(new Error(`replay exited (${code}): ${out}`)));
    setTimeout(() => reject(new Error(`replay did not start: ${out}`)), 10_000);
  });
}

const seconds = (t: string) => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
const placed = (rows: any[]) => rows.filter(r => r.position !== '' && r.statusCode === 0);

/** What every update must satisfy */
function checkFinishList(data: any) {
  expect(data.className).toBe(CLASS);
  expect(data.results.length).toBe(RACE.results[CLASS].results.length);
  const top = placed(data.results);
  // placed first, numbered 1.. in time order ("=" for a tie), time behind from the leader
  expect(data.results.slice(0, top.length)).toEqual(top);
  top.forEach((r: any, i: number) => {
    if (i === 0) expect(r.position).toBe('1');
    else if (r.position === '=') expect(seconds(r.time)).toBe(seconds(top[i - 1].time));
    else expect(Number(r.position)).toBe(i + 1);
    if (i > 0) expect(seconds(r.time)).toBeGreaterThanOrEqual(seconds(top[i - 1].time));
    expect(r.finishTimeMs).toBeGreaterThan(0);
  });
  for (const r of data.results) {
    expect(r.startTimeMs).toBeGreaterThan(0);
    if (r.statusCode === 10 || r.statusCode === 9) expect(r.position).toBe('');
  }
}

describe('Liveresultat replay, end to end', () => {
  let engine: any;
  let run: { proc: ChildProcess; url: string };
  const updates: { id: string; data: any; at: number }[] = [];

  beforeAll(async () => {
    run = await replay(['--speed', String(SPEED), '--from', '15:29']);
    initDataStore();
    getDataSourceRegistry().clear();
    registerBuiltInDataSources();
    initDefaultTimingHub({ baseUrl: run.url });
    // api 'auto' on another address: the source must find out that the replay speaks REST
    await getDataSourceRegistry().create({
      id: 'replay', name: 'Replay', type: 'liveresults', enabled: true,
      config: { baseUrl: run.url, api: 'auto', localPollFloorMs: 200, push: false }
    });
    engine = new PlaybackEngine();
    engine.setWebSocketServer({ setResponseCallback() {}, setNewClientCallback() {} });
    engine.sendCommand = vi.fn(async (command: string, payload: any) => {
      if (command === 'update') updates.push({ id: payload.id, data: payload.data, at: Date.now() });
      return { success: true };
    });
  }, 20_000);

  afterAll(async () => {
    engine?.activeGraphics.clear();
    await engine?.syncPolling();
    getDataSourceRegistry().destroyAll();
    run?.proc.kill();
  });

  it('follows the race on air: starts, radio passings and finishes, always consistent', async () => {
    for (const item of rundown.items) {
      engine.activeGraphics.set(`p1-r1-${item.id}`, {
        id: `p1-r1-${item.id}`, projectId: 'p1', rundownId: 'r1', itemId: item.id, templateId: item.templateId,
        isPlaying: true, manifest: templates.find(t => t.manifest.id === item.templateId)!.manifest,
        templateDirectoryName: item.templateId, data: {}, currentStep: 1
      });
    }
    await engine.syncPolling();
    expect(engine.livePolls.size).toBe(1); // both graphics show the same class: one poll feeds them

    const finish = () => updates.filter(u => u.id === 'p1-r1-finish').map(u => u.data);
    const radio = () => updates.filter(u => u.id === 'p1-r1-radio').map(u => u.data);
    // The winner (31:47) finishes about 8 s in; wait for five finishers
    await vi.waitFor(() => expect(placed(finish().at(-1)?.results ?? []).length).toBeGreaterThanOrEqual(5), { timeout: 40_000, interval: 250 });

    expect(engine.getLivePollingStatus()[0]).toMatchObject({ sourceId: 'replay', sourceType: 'liveresults', apiFlavor: 'rest' });

    const list = finish();
    expect(list.length).toBeGreaterThan(5); // the graphic was updated as the race went on
    let finishers = 0;
    let running = 0;
    for (const data of list) {
      checkFinishList(data);
      const now = placed(data.results).length;
      expect(now).toBeGreaterThanOrEqual(finishers); // a finisher never disappears
      finishers = now;
      running = Math.max(running, data.results.filter((r: any) => r.statusCode === 10).length);
      expect(Math.abs(data.clockOffsetMs)).toBeLessThan(1000); // the replay's clock is this computer's
    }
    expect(running).toBeGreaterThan(0); // runners were seen out on the course

    // Everything the graphics got is described by the base tag library (docs/BASE-TAGS.md)
    for (const u of updates) expect(baseTagProblems(u.data), u.id).toEqual([]);
    expect(updates.at(-1)!.data.event).toMatchObject({ name: expect.any(String) });

    // Start times: the recorded start list, compressed 240x from 15:29
    const last = list.at(-1);
    // (by name and club: two runners in this class are both called Tilda Andersson)
    const byName = new Map(RACE.results[CLASS].results.map((r: any) => [`${r.name}|${r.club}`, r]));
    const recordedOf = (r: any) => byName.get(`${r.name}|${r.club}`) as any;
    const starts = last.results.map((r: any) => [recordedOf(r).start, r.startTimeMs]).sort((a: any, b: any) => a[0] - b[0]);
    const [first] = starts;
    for (const [original, ms] of starts) expect(ms - first[1]).toBeCloseTo(((original - first[0]) * 10) / SPEED, -2);

    // The finishers' times are the recorded ones compressed 240x, in the recorded order
    for (const r of placed(last.results)) {
      const recorded = recordedOf(r);
      expect(recorded.status).toBe(0);
      expect(Math.abs(seconds(r.time) * SPEED - recorded.result / 100)).toBeLessThanOrEqual(SPEED);
    }
    const recordedOrder = placed(last.results).map((r: any) => recordedOf(r).result);
    expect([...recordedOrder].sort((a, b) => a - b)).toEqual(recordedOrder);

    // At the radio: runners who passed it are ranked there, in order of their time there
    const atRadio = radio().at(-1);
    expect(atRadio.controlCode).toBe(RADIO);
    const passed = atRadio.results.filter((r: any) => r.statusCode === 0 && r.position !== '');
    expect(passed.length).toBeGreaterThan(placed(last.results).length);
    passed.forEach((r: any, i: number) => {
      if (i > 0) expect(seconds(r.time)).toBeGreaterThanOrEqual(seconds(passed[i - 1].time));
    });
    // Runners who have not started yet are "not started" (9), not "running" (10): the last starters
    const waiting = atRadio.results.filter((r: any) => r.statusCode === 9);
    expect(waiting.length).toBeGreaterThan(0);
    const latestPassedStart = Math.max(...passed.map((r: any) => recordedOf(r).start));
    for (const r of waiting) {
      expect(r).toMatchObject({ position: '', time: '--:--' });
      expect(recordedOf(r).start).toBeGreaterThan(latestPassedStart);
    }
  }, 60_000);
});

describe('Liveresultat replay after the race', () => {
  let run: { proc: ChildProcess; url: string };

  beforeAll(async () => {
    // Real time, from long after the last finish: the final results
    run = await replay(['--speed', '1', '--from', '20:00']);
    initDataStore();
    getDataSourceRegistry().clear();
    registerBuiltInDataSources();
    await getDataSourceRegistry().create({
      id: 'final', name: 'Final', type: 'liveresults', enabled: true,
      config: { baseUrl: run.url, api: 'rest', localPollFloorMs: 200, push: false }
    });
  }, 20_000);

  afterAll(() => {
    getDataSourceRegistry().destroyAll();
    run?.proc.kill();
  });

  it('gives the recorded results for every class', async () => {
    const config: any = api();
    let compared = 0;
    for (const className of RACE.classes) {
      const data = await DataSourceFieldMapper.fetchAndMapData(config, 33124, { className }, {}, 'final');
      const recorded = new Map(RACE.results[className].results.map((r: any) => [`${r.name}|${r.club}`, r]));
      expect(data.results.length).toBe(recorded.size);
      for (const r of data.results) {
        const rec: any = recorded.get(`${r.name}|${r.club}`);
        expect(r.statusCode).toBe(rec.status);
        if (rec.status === 0) {
          expect(r.finishTimeMs).toBe(rec.result * 10);
          // the recorded place ("=" for a tie: the replay numbers ties)
          if (rec.place !== '=') expect(r.position).toBe(rec.place);
        }
        for (const s of r.splitTimes ?? []) expect(s.time).toBe(Number(rec.splits[String(s.code)]));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(800);
  }, 60_000);
});

describe('Liveresultat replay with a GPS source next to it, end to end', () => {
  let run: { proc: ChildProcess; url: string };
  let engine: any;
  let gpsCtx: PluginContext | undefined;
  let speed = 10;
  const updates: { id: string; data: any; at: number }[] = [];
  // The tracker knows runners by bib; its class names are its own ("Tracked")
  const gpsEntries = (): Entry[] => RACE.results[CLASS].results.filter((r: any) => r.bib).map((r: any, i: number) => ({
    id: `g${i}`, classId: 'tracked', name: { full: r.name.toUpperCase() }, bib: String(r.bib), status: 'running', passings: [],
    ext: { speedKmh: speed + i / 10 }
  }));
  const gps: TimingPlugin = {
    manifest: { id: 'gps-track', name: 'GPS', version: '1.0.0', sdk: '^1.0', capabilities: { push: true, minPollMs: 60_000 },
      extFields: [{ key: 'speedKmh', on: 'entry', type: 'number', label: 'Speed' }] },
    create: (_config, ctx) => {
      gpsCtx = ctx;
      return {
        connect: async () => undefined,
        close: () => undefined,
        competitions: async () => [{ id: '9', name: 'Tracking', date: '2025-05-09' }],
        classes: async () => [{ id: 'tracked', name: 'Tracked', kind: 'individual', radioControls: [] }],
        entries: async () => gpsEntries()
      };
    }
  };

  beforeAll(async () => {
    run = await replay(['--speed', '1', '--from', '20:00']);
    initDataStore();
    getDataSourceRegistry().clear();
    registerBuiltInDataSources();
    registerTimingPlugin(gps, { kind: 'code', path: 'test' });
    initDefaultTimingHub({ baseUrl: run.url });
    await getDataSourceRegistry().create({ id: 'replay', name: 'Replay', type: 'liveresults', enabled: true,
      config: { baseUrl: run.url, api: 'rest', localPollFloorMs: 200, push: false } });
    await getDataSourceRegistry().create({ id: 'gps', name: 'GPS', type: 'gps-track', enabled: true, config: {} });
    rundown.additionalSources = [{ sourceId: 'gps' }];
    engine = new PlaybackEngine();
    engine.setWebSocketServer({ setResponseCallback() {}, setNewClientCallback() {} });
    engine.sendCommand = vi.fn(async (command: string, payload: any) => {
      if (command === 'update') updates.push({ id: payload.id, data: payload.data, at: Date.now() });
      return { success: true };
    });
  }, 20_000);

  afterAll(async () => {
    engine?.activeGraphics.clear();
    await engine?.syncPolling();
    delete rundown.additionalSources;
    getDataSourceRegistry().destroyAll();
    run?.proc.kill();
  });

  it('adds the GPS fields to the timing results and follows GPS changes on air, nothing else', async () => {
    engine.activeGraphics.set('p1-r1-finish', {
      id: 'p1-r1-finish', projectId: 'p1', rundownId: 'r1', itemId: 'finish', templateId: 'results-list',
      isPlaying: true, manifest: templates[0].manifest, templateDirectoryName: 'results-list', data: {}, currentStep: 1
    });
    await engine.syncPolling();
    // One poll for the timing source's class, one for the tracker's class
    expect([...engine.livePolls.values()].map((p: any) => [p.sourceId, p.role]).sort()).toEqual([['gps', 'additional'], ['replay', 'timing']]);

    const finishUpdates = () => updates.filter(u => u.id === 'p1-r1-finish');
    await vi.waitFor(() => expect(finishUpdates().length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(engine.getLivePollingStatus().some((p: any) => p.role === 'additional')).toBe(true), { timeout: 5000 });
    const first = finishUpdates().at(-1)!.data;
    expect(baseTagProblems(first)).toEqual([]);
    const recorded = new Map(RACE.results[CLASS].results.map((r: any) => [`${r.name}|${r.club}`, r]));
    for (const r of first.results) {
      const rec: any = recorded.get(`${r.name}|${r.club}`);
      // the timing source alone decides places, times and statuses
      expect(r.statusCode).toBe(rec.status);
      if (rec.status === 0) expect(r.finishTimeMs).toBe(rec.result * 10);
      // matched by bib, though the tracker spells names in capitals and has its own classes
      if (rec.bib) expect(r.x?.['gps-track']?.speedKmh).toBeGreaterThanOrEqual(10);
      else expect(r.x?.['gps-track']).toBeUndefined();
    }

    // The tracker reports new speeds and says so: the graphic follows within moments, although
    // the race data has not changed and both sources' poll intervals are much longer
    const count = finishUpdates().length;
    speed = 20;
    const t0 = Date.now();
    gpsCtx!.changed('9');
    await vi.waitFor(() => {
      expect(finishUpdates().length).toBeGreaterThan(count);
      const r = finishUpdates().at(-1)!.data.results.find((x: any) => x.x?.['gps-track']);
      expect(r.x['gps-track'].speedKmh).toBeGreaterThanOrEqual(20);
    }, { timeout: 5000, interval: 50 });
    expect(Date.now() - t0).toBeLessThan(5000);
    const after = finishUpdates().at(-1)!.data;
    const strip = (d: any) => d.results.map((r: any) => ({ ...r, x: undefined }));
    expect(strip(after)).toEqual(strip(first)); // nothing but the GPS fields changed
  }, 60_000);
});

describe('Liveresultat replay with Trace / Track next to it, end to end', () => {
  let run: { proc: ChildProcess; url: string };
  let tt: FakeTraceTrack;
  let engine: any;
  const updates: { id: string; data: any }[] = [];
  const recorded: any[] = RACE.results[CLASS].results;

  beforeAll(async () => {
    run = await replay(['--speed', '1', '--from', '20:00']);
    // The tracker's own class ids and names; every third runner without a bib (matched by name and club)
    tt = await fakeTraceTrack({
      eventId: 'sm-medel', key: 'ttr_e2e',
      runners: recorded.map((r, i) => ({
        id: `t${i}`, name: r.name, club: r.club, bib: i % 3 === 0 ? null : String(r.bib), classId: 'd21-q1', className: 'Damer 21 kval 1',
        signal: 'live', age: 1, heartRate: 150 + (i % 30), speed: 3.5, pace: 286, onProgram: i < 2, lowerThird: i === 0, time: Date.now()
      }))
    });
    initDataStore();
    getDataSourceRegistry().clear();
    registerBuiltInDataSources();
    initDefaultTimingHub({ baseUrl: run.url });
    await getDataSourceRegistry().create({ id: 'replay', name: 'Replay', type: 'liveresults', enabled: true,
      config: { baseUrl: run.url, api: 'rest', localPollFloorMs: 200, push: false } });
    await getDataSourceRegistry().create({ id: 'tt', name: 'Trace / Track', type: 'trace-track', enabled: true,
      config: { url: tt.url, eventId: 'sm-medel', key: 'ttr_e2e', pollIntervalMs: 10_000 } });
    rundown.additionalSources = [{ sourceId: 'tt' }];
    engine = new PlaybackEngine();
    engine.setWebSocketServer({ setResponseCallback() {}, setNewClientCallback() {} });
    engine.sendCommand = vi.fn(async (command: string, payload: any) => {
      if (command === 'update') updates.push({ id: payload.id, data: payload.data });
      return { success: true };
    });
  }, 20_000);

  afterAll(async () => {
    engine?.activeGraphics.clear();
    await engine?.syncPolling();
    delete rundown.additionalSources;
    getDataSourceRegistry().destroyAll();
    run?.proc.kill();
    await tt?.close();
  });

  it('puts heart rate and pace next to the official results, and follows the tracker\'s stream on air', async () => {
    engine.activeGraphics.set('p1-r1-finish', {
      id: 'p1-r1-finish', projectId: 'p1', rundownId: 'r1', itemId: 'finish', templateId: 'results-list',
      isPlaying: true, manifest: templates[0].manifest, templateDirectoryName: 'results-list', data: {}, currentStep: 1
    });
    await engine.syncPolling();
    expect([...engine.livePolls.values()].map((p: any) => [p.sourceId, p.role, p.className]).sort())
      .toEqual([['replay', 'timing', CLASS], ['tt', 'additional', 'Damer 21 kval 1']]);

    const finish = () => updates.filter(u => u.id === 'p1-r1-finish').map(u => u.data);
    await vi.waitFor(() => expect(finish().length).toBeGreaterThan(0), { timeout: 10_000 });
    await vi.waitFor(() => expect(tt.openStreams()).toBe(1), { timeout: 5000 });
    const first = finish().at(-1);
    expect(baseTagProblems(first)).toEqual([]);
    const byName = new Map(recorded.map((r, i) => [`${r.name}|${r.club}`, i]));
    for (const r of first.results) {
      const i = byName.get(`${r.name}|${r.club}`)!;
      // official results from the timing source; the tracker's values beside them, by bib or name and club
      expect(r.statusCode).toBe(recorded[i].status);
      expect(r.x['trace-track']).toMatchObject({ heartRate: 150 + (i % 30), speedKmh: 12.6, paceText: '4:46', signal: 'live' });
    }

    // The tracker streams new values: the graphic follows at once (poll intervals are 10 s and more)
    const count = finish().length;
    for (const r of tt.runners) r.heartRate = 190;
    const t0 = Date.now();
    tt.push();
    await vi.waitFor(() => {
      expect(finish().length).toBeGreaterThan(count);
      expect(finish().at(-1).results.every((r: any) => r.x['trace-track'].heartRate === 190)).toBe(true);
    }, { timeout: 5000, interval: 50 });
    expect(Date.now() - t0).toBeLessThan(5000);
    const strip = (d: any) => d.results.map((r: any) => ({ ...r, x: undefined }));
    expect(strip(finish().at(-1))).toEqual(strip(first)); // nothing but the tracker's fields changed
    expect(tt.requests.every(r => r.auth === 'Bearer ttr_e2e')).toBe(true);

    // The tracker goes away: the official results still go out, with its last good values
    await tt.close();
    tt = { close: async () => undefined } as any;
    await new Promise(r => setTimeout(r, 1200)); // past every short-lived cache
    const after = await DataSourceFieldMapper.fetchAndMapData(api() as any, 33124, { className: CLASS }, {}, 'replay', [{ sourceId: 'tt' }]);
    expect(after.results).toHaveLength(recorded.length);
    expect(after.results.every((r: any) => r.x['trace-track'].heartRate === 190)).toBe(true);
  }, 60_000);
});

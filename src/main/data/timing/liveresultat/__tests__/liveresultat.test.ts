/**
 * The Liveresultat plugin against the REST API (api.orienteering.services) and the legacy
 * api.php. Response fixtures are trimmed copies of real responses captured 2026-10-25.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../../utils/logger', () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}));

const get = vi.fn();
vi.mock('axios', () => {
  const isAxiosError = (e: any) => !!e?.isAxiosError;
  return {
    default: { create: vi.fn(() => ({ get })), isAxiosError },
    isAxiosError
  };
});

import { LiveresultatApi, resolveApiFlavor } from '../api';
import { LiveresultatSource, groupRelayLegs } from '../LiveresultatSource';
import { TimingHub } from '../../TimingHub';

const ok = (data: unknown, etag = '"e1"') => ({ status: 200, data, headers: { etag } });
const notModified = () => ({ status: 304, data: '', headers: {} });
const info = (id: number) => ({ id, name: `Race ${id}`, organizer: 'OK', date: '2026-06-30', timediff: 0, timezone: '' });

/** Answer by path; anything else is a 404 */
function serve(routes: Record<string, (url: string) => unknown>) {
  get.mockImplementation(async (url: string) => {
    const path = url.split("?")[0];
    const route = routes[path];
    if (!route) throw Object.assign(new Error(`Not found: ${url}`), { isAxiosError: true, response: { status: 404 } });
    return route(url);
  });
}

const hubOf = (options: ConstructorParameters<typeof LiveresultatSource>[0], ctx?: any) => {
  const ref: { hub?: TimingHub } = {};
  const source = new LiveresultatSource(options, ctx ?? { changed: (c: string, k?: string) => ref.hub?.notifyChanged(c, k) });
  ref.hub = new TimingHub(source, { pluginId: 'liveresults' });
  return ref.hub;
};

describe('resolveApiFlavor', () => {
  it('picks REST for api.orienteering.services', () => {
    expect(resolveApiFlavor('https://api.orienteering.services')).toBe('rest');
    expect(resolveApiFlavor('https://api.orienteering.services/')).toBe('rest');
  });

  it('keeps legacy for liveresultat.orientering.se and local simulators', () => {
    expect(resolveApiFlavor('https://liveresultat.orientering.se')).toBe('legacy');
    expect(resolveApiFlavor('http://localhost:3001')).toBe('legacy');
  });

  it('honours an explicit choice', () => {
    expect(resolveApiFlavor('http://localhost:3001', 'rest')).toBe('rest');
    expect(resolveApiFlavor('https://api.orienteering.services', 'legacy')).toBe('legacy');
  });
});

describe('relay legs', () => {
  it('groups leg classes 1..N of the same name, and nothing else', () => {
    expect([...groupRelayLegs(['Mixed-1', 'Mixed-2', 'H21', 'D18–1', 'D18–2', 'X-2', 'Y -1', 'Z', 'Z-1'])]).toEqual([
      ['Mixed', ['Mixed-1', 'Mixed-2']]
    ]);
  });
});

describe('Liveresultat REST', () => {
  beforeEach(() => { get.mockReset(); });

  it('uses a 10 s minimum poll interval instead of 15 s', () => {
    const hub = hubOf({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1 });
    expect(hub.getApiFlavor()).toBe('rest');
    expect(hub.pollInterval()).toBe(10000);
  });

  it('lists classes, grouping relay legs', async () => {
    serve({ '/competitions/40934': () => ok(info(40934)), '/competitions/40934/classes': () => ok({ classes: ['H21', 'D21', 'Mixed-1', 'Mixed-2'] }) });
    const res = await hubOf({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1 }).getClasses(40934);
    expect(res.data).toEqual([
      { className: 'H21', classId: 'H21' },
      { className: 'D21', classId: 'D21' },
      { className: 'Mixed-1', classId: 'Mixed', leg: 1, legs: 2 },
      { className: 'Mixed-2', classId: 'Mixed', leg: 2, legs: 2 }
    ]);
  });

  it("keeps Liveresultat's own standings, times and splits", async () => {
    serve({
      '/competitions/37049': () => ok(info(37049)),
      '/competitions/37049/classes': () => ok({ classes: ['H21'] }),
      '/competitions/37049/classresults': () => ok({
        className: 'H21',
        splitControls: [{ code: 1035, name: 'TV1' }],
        isMassStart: false,
        results: [
          { place: '1', name: 'Lucie Gaudion', club: 'France', bib: '8', result: 79700, status: 0, timeplus: 0, progress: 100, start: 4200000,
            changed: 1782814061, splits: { '1035': 21200, '1035_status': 0, '1035_place': 2, '1035_timeplus': 200 } },
          { place: '=', name: 'Tie', club: 'X', result: 79700, status: 0, timeplus: 0, progress: 100, start: 4210000, splits: {} },
          { place: '-', name: 'Gone', club: 'Y', result: 0, status: 1, timeplus: '', progress: 0, start: 4220000 }
        ]
      })
    });
    const res = (await hubOf({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1 }).getClassResults(37049, 'H21')).data;
    expect(get).toHaveBeenCalledWith('/competitions/37049/classresults?class=H21', expect.anything());
    expect(res.controls).toEqual([{ key: 1035, id: '1035', code: 35, name: 'TV1' }]);
    expect(res.rows.map(r => [r.name, r.place, r.tied, r.time, r.behind, r.statusCode, r.progress])).toEqual([
      ['Lucie Gaudion', 1, false, 797_000, 0, 0, 100],
      ['Tie', 1, true, 797_000, 0, 0, 100],
      ['Gone', undefined, false, 0, undefined, 1, 0]
    ]);
    expect(res.rows[0]).toMatchObject({ bib: '8', start: Date.UTC(2026, 5, 30, 9, 40) }); // 11:40 CEST
    expect(res.rows[0].splits[1035]).toEqual({ time: 212_000, status: 0, place: 2, behind: 2000 });
  });

  it('works relay team starts out from the previous leg', async () => {
    const leg = (rows: unknown[]) => () => ok({ className: 'x', splitControls: [{ code: 1050, name: 'R' }], results: rows });
    serve({
      '/competitions/1': () => ok(info(1)),
      '/competitions/1/classes': () => ok({ classes: ['Kavle-1', 'Kavle-2'] }),
      '/competitions/1/classresults': (url) => (url.includes('Kavle-1')
        ? leg([{ place: '1', name: 'A1', club: 'Team A', result: 180000, status: 0, timeplus: 0, progress: 100, start: 3600000 }])
        : leg([{ place: '1', name: 'A2', club: 'Team A', result: 370000, status: 0, timeplus: 0, progress: 100, start: 3780000,
            splits: { '1050': 245000, '1050_place': 1, '1050_timeplus': 0 } }]))()
    });
    const hub = hubOf({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1, push: false });
    const leg2 = (await hub.getClassResults(1, 'Kavle-2')).data;
    const a2 = leg2.rows[0];
    // the team started 30:00 before this changeover (its time at the end of leg 1)
    expect(a2.start! - a2.teamStart!).toBe(1_800_000);
    expect(a2).toMatchObject({ club: 'Team A', time: 3_700_000, team: { id: 'Team A', name: 'Team A', leg: 2 } });
    expect(a2.splits[1050].time).toBe(2_450_000); // Liveresultat's team time at the radio
    const leg1 = (await hub.getClassResults(1, 'Kavle-1')).data;
    expect(leg1.rows[0].teamStart).toBeUndefined(); // leg 1: the runner's own start
  });

  it('URL-encodes class names with spaces and slashes', async () => {
    get.mockResolvedValueOnce(ok({ className: 'H 21/K', results: [] }));
    await new LiveresultatApi({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1 }).classResult(1, 'H 21/K');
    expect(get).toHaveBeenCalledWith('/competitions/1/classresults?class=H+21%2FK', expect.anything());
  });

  it('sends If-None-Match and reuses the cached body on 304', async () => {
    const api = new LiveresultatApi({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1 });
    get.mockResolvedValueOnce(ok({ classes: ['H21'] }, '"abc"'));
    expect(await api.classes(5)).toEqual(['H21']);
    get.mockResolvedValueOnce(notModified());
    expect(await api.classes(5)).toEqual(['H21']);
    const [, secondOpts] = get.mock.calls[1];
    expect(secondOpts.headers).toEqual({ 'If-None-Match': '"abc"' });
  });

  it('does not retry 404 (unknown competition)', async () => {
    const err = Object.assign(new Error('Not found'), { isAxiosError: true, response: { status: 404 } });
    get.mockRejectedValue(err);
    const api = new LiveresultatApi({ baseUrl: 'https://api.orienteering.services', retryAttempts: 3, retryDelay: 1 });
    await expect(api.classResult(99999999, 'H21')).rejects.toThrow('Not found');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('measures the server clock against /time', async () => {
    get.mockImplementation(async (url: string) => (url === '/time' ? ok({ serverTime: Date.now() + 5000 }) : ok({})));
    const hub = hubOf({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1 });
    const offset = await hub.getServerClockOffsetMs();
    expect(offset).toBeGreaterThan(4900);
    expect(offset).toBeLessThan(5100);
  });
});

describe('Liveresultat API detection (auto, other addresses)', () => {
  beforeEach(() => { get.mockReset(); });

  it('uses REST when the server answers /competitions like api.orienteering.services (replay server)', async () => {
    get.mockResolvedValueOnce({ status: 200, data: { competitions: [] }, headers: {} });
    get.mockResolvedValueOnce(ok({ classes: ['H21'] }));
    const api = new LiveresultatApi({ baseUrl: 'http://127.0.0.1:5800', retryAttempts: 1 });
    expect(await api.classes(33124)).toEqual(['H21']);
    expect(get.mock.calls[0][0]).toBe('/competitions');
    expect(get.mock.calls[1][0]).toBe('/competitions/33124/classes');
    expect(api.flavor).toBe('rest');
  });

  it('falls back to the legacy api.php when /competitions is not a REST answer', async () => {
    get.mockResolvedValueOnce({ status: 404, data: 'Not found', headers: {} });
    get.mockResolvedValueOnce({ status: 200, data: { status: 'OK', classes: [{ className: 'H21' }] }, headers: {} });
    const api = new LiveresultatApi({ baseUrl: 'http://localhost:3001', retryAttempts: 1 });
    expect(await api.classes(1)).toEqual(['H21']);
    expect(api.flavor).toBe('legacy');
    expect(get.mock.calls[1][0]).toBe('/api.php');
  });

  it('asks again on the next request when the server could not be reached', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true }));
    get.mockResolvedValueOnce({ status: 200, data: { status: 'OK', classes: [] }, headers: {} });
    const api = new LiveresultatApi({ baseUrl: 'http://127.0.0.1:5800', retryAttempts: 1 });
    await api.classes(1).catch(() => undefined);
    get.mockResolvedValueOnce({ status: 200, data: { competitions: [] }, headers: {} });
    get.mockResolvedValueOnce(ok({ classes: [] }));
    await api.classes(1);
    expect(api.flavor).toBe('rest');
  });

  it('never asks for the two Liveresultat addresses or an explicit choice', async () => {
    get.mockResolvedValue({ status: 200, data: { status: 'OK', classes: [] }, headers: {} });
    await new LiveresultatApi({ baseUrl: 'https://liveresultat.orientering.se', retryAttempts: 1 }).classes(1);
    await new LiveresultatApi({ baseUrl: 'http://127.0.0.1:5800', api: 'legacy', retryAttempts: 1 }).classes(1);
    expect(get.mock.calls.every(c => c[0] === '/api.php')).toBe(true);
  });

  it('reads the legacy api.php, raw control characters and all', async () => {
    const raw = '{"status":"OK","className":"H21","splitcontrols":[],"results":[{"place":"1","name":"A\u0007na","club":"OK","result":"360000","status":0,"timeplus":"0","progress":100,"start":3600000}]}';
    get.mockImplementation(async (_url: string, opts: any) => {
      const m = opts?.params?.method;
      if (m === 'getcompetitioninfo') return { status: 200, data: info(1), headers: {} };
      if (m === 'getclasses') return { status: 200, data: { classes: [{ className: 'H21' }] }, headers: {} };
      if (m === 'getclassresults') return { status: 200, data: raw, headers: {} };
      return { status: 200, data: {}, headers: {} };
    });
    const hub = hubOf({ baseUrl: 'https://liveresultat.orientering.se', retryAttempts: 1 });
    expect(hub.pollInterval()).toBe(15000);
    const res = (await hub.getClassResults(1, 'H21')).data;
    expect(res.rows[0]).toMatchObject({ name: 'Ana', place: 1, time: 3_600_000 });
  });
});

describe('Liveresultat polling', () => {
  beforeEach(() => { get.mockReset(); });

  it('never overlaps polls while a request is still running', async () => {
    const hub = hubOf({ baseUrl: 'http://127.0.0.1:9', api: 'rest', localPollFloorMs: 100, retryAttempts: 1, push: false });
    let release!: (v: unknown) => void;
    let results = 0;
    get.mockImplementation(async (url: string) => {
      if (url === '/competitions/1') return ok(info(1));
      if (url === '/competitions/1/classes') return ok({ classes: ['H21'] });
      results++;
      if (results === 1) return new Promise(r => { release = r; });
      return ok({ className: 'H21', results: [] });
    });
    hub.startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: () => {} });
    await new Promise(r => setTimeout(r, 450)); // ~4 ticks
    expect(results).toBe(1);
    release(ok({ className: 'H21', results: [] }));
    await new Promise(r => setTimeout(r, 250));
    expect(results).toBeGreaterThan(1);
    hub.stopAllPolling();
  });

  it('only honours localPollFloorMs for local simulators', () => {
    expect(hubOf({ baseUrl: 'https://api.orienteering.services', localPollFloorMs: 100 }).pollInterval()).toBe(10000);
    expect(hubOf({ baseUrl: 'http://localhost:3001', localPollFloorMs: 100 }).pollInterval()).toBe(100);
  });

  it('reuses a result younger than maxAgeMs, but never for a push refetch', async () => {
    serve({
      '/competitions/1': () => ok(info(1)),
      '/competitions/1/classes': () => ok({ classes: ['H21'] }),
      '/competitions/1/classresults': () => ok({ className: 'H21', results: [] })
    });
    const hub = hubOf({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1, push: false });
    const results = () => get.mock.calls.filter(c => String(c[0]).includes('classresults')).length;
    await hub.getClassResults(1, 'H21');
    const reused = await hub.getClassResults(1, 'H21', { maxAgeMs: 2000 });
    expect(results()).toBe(1);
    expect(reused.changed).toBe(false);
    await hub.getClassResults(1, 'H21', { maxAgeMs: 2000, force: true });
    expect(results()).toBe(2);
    await hub.getClassResults(1, 'H21'); // no maxAge: always asks (ETag keeps it cheap)
    expect(results()).toBe(3);
  });
});

class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  open() { this.readyState = 1; this.onopen?.({}); }
  send(d: string) { this.sent.push(JSON.parse(d)); }
  push(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  close() { this.readyState = 3; this.onclose?.({}); }
}

describe('Liveresultat push channel', () => {
  beforeEach(() => { get.mockReset(); FakeSocket.all = []; });

  const make = () => hubOf({
    baseUrl: 'http://127.0.0.1:9', api: 'rest', localPollFloorMs: 60_000, retryAttempts: 1,
    // A local REST server gets push only with its own push address
    pushUrl: 'wss://push.test',
    webSocketFactory: (url: string) => new FakeSocket(url) as any
  });
  const race = (id: number, rows: () => unknown[] = () => []) => serve({
    [`/competitions/${id}`]: () => ok(info(id)),
    [`/competitions/${id}/classes`]: () => ok({ classes: ['H21', 'D21'] }),
    [`/competitions/${id}/classresults`]: () => ok({ className: 'H21', results: rows() })
  });

  it('subscribes the polled classes and refetches immediately on "changed", bypassing the CDN', async () => {
    let rows: unknown[] = [];
    race(40123, () => rows);
    const hub = make();
    const onUpdate = vi.fn();
    hub.startPolling({ competitionId: 40123, className: 'H21', interval: 0, onUpdate });
    hub.startPolling({ competitionId: 40123, className: 'D21', interval: 0, onUpdate });
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1)); // one socket per competition
    const sock = FakeSocket.all[0];
    expect(sock.url).toBe('wss://push.test?tavid=40123');
    sock.open();
    await vi.waitFor(() => expect(sock.sent.at(-1)).toEqual({ action: 'sub', tabs: ['H21', 'D21'] }));

    const before = get.mock.calls.length;
    rows = [{ place: '', name: 'New', club: 'X', result: '', status: 10, timeplus: '', progress: 0, start: 3600000 }];
    sock.push({ type: 'changed', tabs: ['H21'], ver: 77 });
    await vi.waitFor(() => expect(get.mock.calls.slice(before).map(c => c[0])).toContain('/competitions/40123/classresults?class=H21&push=77'));
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ rows: [expect.objectContaining({ name: 'New' })] })));
    hub.stopAllPolling();
  });

  it('closes the socket when the last class of a competition stops', async () => {
    race(1);
    const hub = make();
    hub.startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: () => {} });
    hub.startPolling({ competitionId: 1, className: 'D21', interval: 0, onUpdate: () => {} });
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    const sock = FakeSocket.all[0];
    sock.open();
    hub.stopPolling('1_H21');
    expect(sock.readyState).toBe(1);
    expect(sock.sent.at(-1)).toEqual({ action: 'sub', tabs: ['D21'] });
    hub.stopPolling('1_D21');
    expect(sock.readyState).toBe(3);
    expect(hub.isPushConnected(1)).toBe(false);
  });

  it('is off for the legacy API, with push: false, and for another REST server (replay)', async () => {
    get.mockResolvedValue(ok({ classes: [] }));
    const factory = (u: string) => new FakeSocket(u) as any;
    const hubs = [
      hubOf({ baseUrl: 'https://liveresultat.orientering.se', webSocketFactory: factory }),
      hubOf({ baseUrl: 'https://api.orienteering.services', push: false, webSocketFactory: factory }),
      hubOf({ baseUrl: 'http://127.0.0.1:5800', api: 'rest', webSocketFactory: factory })
    ];
    for (const hub of hubs) hub.startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: () => {} });
    await new Promise(r => setTimeout(r, 50));
    expect(FakeSocket.all).toHaveLength(0);
    for (const hub of hubs) hub.stopAllPolling();
  });

  it('ignores unknown push messages', async () => {
    race(2);
    const hub = make();
    hub.startPolling({ competitionId: 2, className: 'H21', interval: 0, onUpdate: () => {} });
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1));
    const sock = FakeSocket.all[0];
    sock.open();
    expect(() => { sock.onmessage({ data: 'not json' }); sock.push({ type: 'hello' }); }).not.toThrow();
    hub.stopAllPolling();
  });
});

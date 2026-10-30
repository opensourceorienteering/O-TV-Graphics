/**
 * LiveResultsClient against the REST API (api.orienteering.services)
 * Response fixtures are trimmed copies of real responses captured 2026-10-25.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
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

import { LiveResultsClient, resolveApiFlavor } from '../LiveResultsClient';

const ok = (data: unknown, etag = '"e1"') => ({ status: 200, data, headers: { etag } });
const notModified = () => ({ status: 304, data: '', headers: {} });

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

describe('LiveResultsClient (REST)', () => {
  let client: LiveResultsClient;

  beforeEach(() => {
    get.mockReset();
    client = new LiveResultsClient({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1 });
  });

  it('uses a 10 s minimum poll interval instead of 15 s', () => {
    expect(client.getApiFlavor()).toBe('rest');
    expect((client as any).options.cacheInterval).toBe(10000);
  });

  it('maps class names to legacy { className } objects', async () => {
    get.mockResolvedValueOnce(ok({ classes: ['H21', 'D21'] }));
    const res = await client.getClasses(40934);
    expect(get).toHaveBeenCalledWith('/competitions/40934/classes', expect.anything());
    expect(res.data).toEqual([{ className: 'H21' }, { className: 'D21' }]);
  });

  it('maps class results to the legacy shape and keeps splits', async () => {
    get.mockResolvedValueOnce(ok({
      className: 'Mixed-1',
      splitControls: [{ code: 1035, name: 'TV1' }],
      isMassStart: false,
      results: [{
        place: '1', name: 'Lucie Gaudion', club: 'France 1', bib: '8-1',
        result: 79700, status: 0, timeplus: 0, progress: 100, start: 420000,
        changed: 1782814061,
        splits: { '1035': 21200, '1035_status': 0, '1035_place': 2, '1035_timeplus': 200 }
      }]
    }));

    const res = await client.getClassResults(37049, 'Mixed-1');

    expect(get).toHaveBeenCalledWith('/competitions/37049/classresults?class=Mixed-1', expect.anything());
    expect(res.data.splitcontrols).toEqual([{ code: 1035, name: 'TV1' }]);
    expect(res.data.results[0].result).toBe('79700');
    expect(res.data.results[0].timeplus).toBe('0');
    expect(res.data.results[0].splits?.['1035']).toBe(21200);
    expect(res.data.results[0].bib).toBe('8-1');
  });

  it('URL-encodes class names with spaces and slashes', async () => {
    get.mockResolvedValueOnce(ok({ className: 'H 21/K', results: [] }));
    await client.getClassResults(1, 'H 21/K');
    expect(get).toHaveBeenCalledWith('/competitions/1/classresults?class=H+21%2FK', expect.anything());
  });

  it('sends If-None-Match and reuses the cached body on 304', async () => {
    get.mockResolvedValueOnce(ok({ classes: ['H21'] }, '"abc"'));
    const first = await client.getClasses(5);
    expect(first.changed).toBe(true);

    get.mockResolvedValueOnce(notModified());
    const second = await client.getClasses(5);

    const [, secondOpts] = get.mock.calls[1];
    expect(secondOpts.headers).toEqual({ 'If-None-Match': '"abc"' });
    expect(second.data).toEqual([{ className: 'H21' }]);
    expect(second.changed).toBe(false);
  });

  it('maps passings to the legacy format', async () => {
    get.mockResolvedValueOnce(ok({
      passings: [{
        class: 'Mixed-4', control: 1000, controlName: null, place: 53, bib: '66-4',
        name: 'Kate deBlonk', club: 'United States 3', time: 429700, timeplus: 112600,
        wallClock: 4401400, changed: 1782811350
      }]
    }));

    const res = await client.getLastPassings(37049);

    expect(res.data[0]).toMatchObject({
      runnerName: 'Kate deBlonk',
      club: 'United States 3',
      class: 'Mixed-4',
      control: '1000',
      controlName: 'Finish',
      time: '1:11:37',
      passtime: '12:13:34',
      place: 53,
      timeplus: 112600
    });
  });

  it('does not retry 404 (unknown competition)', async () => {
    const err = Object.assign(new Error('Not found'), { isAxiosError: true, response: { status: 404 } });
    get.mockRejectedValue(err);
    const retrying = new LiveResultsClient({ baseUrl: 'https://api.orienteering.services', retryAttempts: 3, retryDelay: 1 });
    await expect(retrying.getClassResults(99999999, 'H21')).rejects.toThrow('Not found');
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('LiveResultsClient API detection (auto, other addresses)', () => {
  beforeEach(() => get.mockReset());

  it('uses REST when the server answers /competitions like api.orienteering.services (replay server)', async () => {
    get.mockResolvedValueOnce({ status: 200, data: { competitions: [] }, headers: {} });
    get.mockResolvedValueOnce(ok({ classes: ['H21'] }));
    const client = new LiveResultsClient({ baseUrl: 'http://127.0.0.1:5800', retryAttempts: 1 });
    const res = await client.getClasses(33124);
    expect(get.mock.calls[0][0]).toBe('/competitions');
    expect(get.mock.calls[1][0]).toBe('/competitions/33124/classes');
    expect(client.getApiFlavor()).toBe('rest');
    expect(res.data).toEqual([{ className: 'H21' }]);
  });

  it('falls back to the legacy api.php when /competitions is not a REST answer', async () => {
    get.mockResolvedValueOnce({ status: 404, data: 'Not found', headers: {} });
    get.mockResolvedValueOnce({ status: 200, data: { status: 'OK', classes: [{ className: 'H21' }] }, headers: {} });
    const client = new LiveResultsClient({ baseUrl: 'http://localhost:3001', retryAttempts: 1 });
    await client.getClasses(1);
    expect(client.getApiFlavor()).toBe('legacy');
    expect(get.mock.calls[1][0]).toBe('/api.php');
  });

  it('asks again on the next request when the server could not be reached', async () => {
    get.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { isAxiosError: true }));
    get.mockResolvedValueOnce({ status: 200, data: { status: 'OK', classes: [] }, headers: {} });
    const client = new LiveResultsClient({ baseUrl: 'http://127.0.0.1:5800', retryAttempts: 1 });
    await client.getClasses(1).catch(() => undefined);
    get.mockResolvedValueOnce({ status: 200, data: { competitions: [] }, headers: {} });
    get.mockResolvedValueOnce(ok({ classes: [] }));
    await client.getClasses(1);
    expect(client.getApiFlavor()).toBe('rest');
  });

  it('never asks for the two Liveresultat addresses or an explicit choice', async () => {
    get.mockResolvedValue({ status: 200, data: { status: 'OK', classes: [] }, headers: {} });
    await new LiveResultsClient({ baseUrl: 'https://liveresultat.orientering.se', retryAttempts: 1 }).getClasses(1);
    await new LiveResultsClient({ baseUrl: 'http://127.0.0.1:5800', api: 'legacy', retryAttempts: 1 }).getClasses(1);
    expect(get.mock.calls.every(c => c[0] === '/api.php')).toBe(true);
  });
});

describe('LiveResultsClient polling', () => {
  beforeEach(() => get.mockReset());

  it('never overlaps polls while a request is still running', async () => {
    const client = new LiveResultsClient({ baseUrl: 'http://127.0.0.1:9', api: 'rest', localPollFloorMs: 100, retryAttempts: 1, push: false });
    let release!: (v: unknown) => void;
    get.mockImplementationOnce(() => new Promise(r => { release = r; }));
    client.startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: () => {} });
    await new Promise(r => setTimeout(r, 450)); // ~4 ticks
    expect(get).toHaveBeenCalledTimes(1);
    release(ok({ className: 'H21', results: [] }));
    get.mockResolvedValue(ok({ className: 'H21', results: [] }));
    await new Promise(r => setTimeout(r, 250));
    expect(get.mock.calls.length).toBeGreaterThan(1);
    client.stopAllPolling();
  });

  it('only honours localPollFloorMs for local simulators', () => {
    const remote = new LiveResultsClient({ baseUrl: 'https://api.orienteering.services', localPollFloorMs: 100 });
    const local = new LiveResultsClient({ baseUrl: 'http://localhost:3001', localPollFloorMs: 100 });
    expect((remote as any).options.cacheInterval).toBe(10000);
    expect((local as any).options.cacheInterval).toBe(100);
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

describe('LiveResultsClient push channel', () => {
  beforeEach(() => { get.mockReset(); FakeSocket.all = []; });

  const make = () => new LiveResultsClient({
    baseUrl: 'http://127.0.0.1:9', api: 'rest', localPollFloorMs: 60_000, retryAttempts: 1,
    // A local REST server gets push only with its own push address
    pushUrl: 'wss://push.test',
    webSocketFactory: (url: string) => new FakeSocket(url) as any
  });

  it('subscribes the polled classes and refetches immediately on "changed", bypassing the CDN', async () => {
    get.mockResolvedValue(ok({ className: 'H21', results: [] }));
    const client = make();
    const onUpdate = vi.fn();
    client.startPolling({ competitionId: 40123, className: 'H21', interval: 0, onUpdate });
    client.startPolling({ competitionId: 40123, className: 'D21', interval: 0, onUpdate });
    expect(FakeSocket.all).toHaveLength(1); // one socket per competition
    const sock = FakeSocket.all[0];
    expect(sock.url).toBe('wss://push.test?tavid=40123');
    sock.open();
    expect(sock.sent.at(-1)).toEqual({ action: 'sub', tabs: ['H21', 'D21'] });

    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2)); // the two initial polls
    get.mockResolvedValueOnce(ok({ className: 'H21', results: [{ name: 'New', result: 1 }] }, '"v2"'));
    sock.push({ type: 'changed', tabs: ['H21'], ver: 77 });
    await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(get.mock.calls[2][0]).toBe('/competitions/40123/classresults?class=H21&push=77');
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ results: [expect.objectContaining({ name: 'New' })] })));
    client.stopAllPolling();
  });

  it('closes the socket when the last class of a competition stops', () => {
    get.mockResolvedValue(ok({ className: 'H21', results: [] }));
    const client = make();
    client.startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: () => {} });
    client.startPolling({ competitionId: 1, className: 'D21', interval: 0, onUpdate: () => {} });
    const sock = FakeSocket.all[0];
    sock.open();
    client.stopPolling('1_H21');
    expect(sock.readyState).toBe(1);
    expect(sock.sent.at(-1)).toEqual({ action: 'sub', tabs: ['D21'] });
    client.stopPolling('1_D21');
    expect(sock.readyState).toBe(3);
    expect(client.isPushConnected(1)).toBe(false);
  });

  it('is off for the legacy API and when push: false', () => {
    get.mockResolvedValue(ok({ classes: [] }));
    const legacy = new LiveResultsClient({ baseUrl: 'https://liveresultat.orientering.se', webSocketFactory: (u: string) => new FakeSocket(u) as any });
    legacy.startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: () => {} });
    const off = new LiveResultsClient({ baseUrl: 'https://api.orienteering.services', push: false, webSocketFactory: (u: string) => new FakeSocket(u) as any });
    off.startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: () => {} });
    expect(FakeSocket.all).toHaveLength(0);
    legacy.stopAllPolling(); off.stopAllPolling();
  });

  it("is off for another REST server (replay), which Liveresultat's push channel knows nothing about", () => {
    get.mockResolvedValue(ok({ classes: [] }));
    const replay = new LiveResultsClient({ baseUrl: 'http://127.0.0.1:5800', api: 'rest', webSocketFactory: (u: string) => new FakeSocket(u) as any });
    replay.startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: () => {} });
    expect(FakeSocket.all).toHaveLength(0);
    replay.stopAllPolling();
  });

  it('ignores unknown push messages', () => {
    get.mockResolvedValue(ok({ className: 'H21', results: [] }));
    const client = make();
    client.startPolling({ competitionId: 2, className: 'H21', interval: 0, onUpdate: () => {} });
    const sock = FakeSocket.all[0];
    sock.open();
    expect(() => { sock.onmessage({ data: 'not json' }); sock.push({ type: 'hello' }); }).not.toThrow();
    client.stopAllPolling();
  });
});

describe('LiveResultsClient recent-result reuse', () => {
  beforeEach(() => get.mockReset());

  it('reuses a fetch younger than maxAgeMs, but never for a push refetch', async () => {
    const client = new LiveResultsClient({ baseUrl: 'https://api.orienteering.services', retryAttempts: 1, push: false });
    get.mockResolvedValue(ok({ className: 'H21', results: [] }));
    await client.getClassResults(1, 'H21');
    const reused = await client.getClassResults(1, 'H21', { maxAgeMs: 2000 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(reused.changed).toBe(false);
    await client.getClassResults(1, 'H21', { maxAgeMs: 2000, pushVer: 9 });
    expect(get).toHaveBeenCalledTimes(2);
    await client.getClassResults(1, 'H21'); // no maxAge: always asks (ETag keeps it cheap)
    expect(get).toHaveBeenCalledTimes(3);
  });
});

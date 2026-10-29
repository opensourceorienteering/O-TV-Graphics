/**
 * End-to-end live loop against a local fake of the Liveresultat REST API:
 *   LiveResultsClient (ETag polling) -> DataStore (change detection) -> PlaybackEngine
 *   -> DataSourceFieldMapper (+ live clock fields) -> 'update' command to the renderer.
 * Only the rundown/template managers and the source registry are stubbed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { WebSocketServer as WsServer } from 'ws';

vi.mock('../../utils/logger', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), verbose: vi.fn() };
  return { logger, getLogger: () => logger };
});

const template = {
  manifest: { id: 'results-list', name: 'Results' },
  directoryName: 'results-list',
  dataSourceConfig: { mode: 'api', api: { provider: 'liveresults', fieldMappings: [{ templateField: 'results', apiPath: 'results' }] } }
};
vi.mock('../../templates/OGrafManager', () => ({
  getTemplateManager: () => ({ getAllTemplates: () => [template] })
}));

const rundown = {
  id: 'r1', projectId: 'p1', settings: {},
  dataSource: { sourceId: 'fake-rest', competitionId: 40001 },
  items: [{ id: 'i1', templateId: 'results-list', fields: {}, liveResultsData: { autoUpdate: true, dataSourceValues: { className: 'H21' } } }]
};
vi.mock('../../projects/RundownManager', () => ({
  getRundownManager: () => ({
    loadRundown: async () => rundown,
    updateItem: async () => ({}),
    saveRundown: async () => undefined
  })
}));

let source: any;
vi.mock('../../data/DataSourceRegistry', () => ({
  getDataSourceRegistry: () => ({ get: () => source, getAll: () => [source] })
}));

import { initLiveResultsClient } from '../../data/LiveResultsClient';
import { initDataStore } from '../../data/DataStore';
import { LiveResultsDataSource } from '../../data/sources/LiveResultsDataSource';
import { PlaybackEngine } from '../PlaybackEngine';

// --- fake REST API ---------------------------------------------------------
const SERVER_AHEAD_MS = 3000; // the "official" clock is 3 s ahead of this machine
let results = [
  { place: '1', name: 'Anna Andersson', club: 'OK Exempel', result: 360000, status: 0, timeplus: 0, progress: 100, start: 3600000, changed: 1 },
  { place: '', name: 'Bertil Bok', club: 'OK Exempel', result: null, status: 10, timeplus: null, progress: 0, start: 3660000, changed: 1 }
];
let version = 1;
const requests: { path: string; inm?: string; status: number; url?: string }[] = [];

function send(res: http.ServerResponse, req: http.IncomingMessage, path: string, body: unknown, etag?: string) {
  if (etag && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    res.end();
    requests.push({ path, inm: String(req.headers['if-none-match']), status: 304, url: req.url });
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json', ...(etag ? { etag } : {}) });
  res.end(JSON.stringify(body));
  requests.push({ path, inm: req.headers['if-none-match'] as string | undefined, status: 200, url: req.url });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url!, 'http://x');
  if (url.pathname === '/time') return send(res, req, '/time', { serverTime: Date.now() + SERVER_AHEAD_MS });
  if (url.pathname === '/competitions') return send(res, req, '/competitions', { competitions: [{ id: 40001, name: 'Test', organizer: 'OK', date: '2026-10-25', timediff: 0 }] }, '"c1"');
  if (url.pathname === '/competitions/40001') return send(res, req, '/competitions/40001', { id: 40001, name: 'Testtävling', organizer: 'OK', date: '2026-10-25', timediff: 0, timezone: 'Europe/Stockholm', serverTime: Date.now() }, '"i1"');
  if (url.pathname === '/competitions/40001/classresults') {
    return send(res, req, '/classresults', { className: url.searchParams.get('class'), splitControls: [], results }, `"r${version}"`);
  }
  res.writeHead(404); res.end('{}');
});

describe('live loop (integration)', () => {
  let baseUrl: string;
  let engine: any;
  const updates: any[] = [];

  beforeAll(async () => {
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    initLiveResultsClient({ baseUrl, api: 'rest', localPollFloorMs: 200, push: false });
    const dataStore = initDataStore();
    source = new LiveResultsDataSource({
      id: 'fake-rest', name: 'Fake REST', type: 'liveresults', enabled: true,
      config: { baseUrl, api: 'rest', localPollFloorMs: 200, push: false }
    } as any);
    await source.initialize();

    engine = new PlaybackEngine();
    engine.setWebSocketServer({ setResponseCallback() {}, setNewClientCallback() {} });
    engine.sendCommand = vi.fn(async (command: string, payload: any) => {
      if (command === 'update') updates.push(payload.data);
      return { success: true };
    });
    expect(dataStore).toBeDefined();
  });

  afterAll(async () => {
    source?.destroy();
    await new Promise<void>(r => server.close(() => r()));
  });

  it('pushes a changed result to the on-air graphic with live clock fields', async () => {
    engine.activeGraphics.set('p1-r1-i1', {
      id: 'p1-r1-i1', projectId: 'p1', rundownId: 'r1', itemId: 'i1', templateId: 'results-list',
      isPlaying: true, manifest: template.manifest, templateDirectoryName: 'results-list', data: {}, currentStep: 1
    });
    await engine.syncPolling();

    // First poll establishes the baseline; then a runner finishes.
    await vi.waitFor(() => expect(requests.some(r => r.path === '/classresults')).toBe(true), { timeout: 3000 });
    results = results.map(r => r.name === 'Bertil Bok'
      ? { ...r, place: '2', result: 372000, status: 0, timeplus: 12000, progress: 100, changed: 2 }
      : r);
    version = 2;

    await vi.waitFor(() => {
      const last = updates.at(-1);
      expect(last?.results?.find((r: any) => r.name === 'Bertil Bok')?.statusCode).toBe(0);
    }, { timeout: 5000, interval: 50 });

    const last = updates.at(-1);
    const bertil = last.results.find((r: any) => r.name === 'Bertil Bok');
    // 3660000 cs = 10:10:00 Stockholm time (CET on 25 Oct 2026) = 09:10Z
    expect(new Date(bertil.startTimeMs).toISOString()).toBe('2026-10-25T09:10:00.000Z');
    expect(last.clockOffsetMs).toBeGreaterThan(SERVER_AHEAD_MS - 500);
    expect(last.clockOffsetMs).toBeLessThan(SERVER_AHEAD_MS + 500);
    expect(last.competitionTimeZone).toBe('Europe/Stockholm');
  });

  it('uses ETags: unchanged polls are 304s and trigger no update', async () => {
    const lastPoll = engine.getLivePollingStatus()[0].lastPoll;
    const changedAt = engine.getLivePollingStatus()[0].lastUpdate;
    const before = updates.length;
    const pollsBefore = requests.filter(r => r.path === '/classresults').length;
    await vi.waitFor(() => expect(requests.filter(r => r.path === '/classresults').length).toBeGreaterThan(pollsBefore + 2), { timeout: 3000 });
    const recent = requests.filter(r => r.path === '/classresults').slice(-2);
    expect(recent.every(r => r.status === 304 && r.inm === '"r2"')).toBe(true);
    expect(updates.length).toBe(before);
    expect(engine.getLivePollingStatus()[0].lastPoll).toBeGreaterThan(lastPoll!);
    expect(engine.getLivePollingStatus()[0].lastUpdate).toBe(changedAt);
    expect(engine.getLivePollingStatus()[0].errorCount).toBe(0);
  });

  it('keeps the last good frame when the API fails, and recovers', async () => {
    const before = updates.length;
    const original = server.listeners('request')[0] as any;
    server.removeAllListeners('request');
    server.on('request', (_req, res) => { res.writeHead(503); res.end(); });
    await new Promise(r => setTimeout(r, 700));
    expect(updates.length).toBe(before); // nothing blanked on air

    server.removeAllListeners('request');
    server.on('request', original);
    results = [...results, { place: '', name: 'Cesar Cykel', club: 'IK X', result: null, status: 9, timeplus: null, progress: 0, start: 3720000, changed: 3 }];
    version = 3;
    await vi.waitFor(() => expect(updates.at(-1)?.results?.length).toBe(3), { timeout: 5000, interval: 50 });
  });

  it('stops polling when the graphic goes off air', async () => {
    engine.activeGraphics.clear();
    await engine.syncPolling();
    expect(engine.livePolls.size).toBe(0);
    expect(source.getClient().pollingTimers.size).toBe(0);
    // A request already in flight (with its retries, 1 s apart) may still finish; then it goes quiet.
    await new Promise(r => setTimeout(r, 2500));
    const count = requests.length;
    await new Promise(r => setTimeout(r, 1000));
    expect(requests.slice(count)).toEqual([]);
  }, 10000);


  it('push: a "changed" message updates the graphic immediately, without waiting for the poll', async () => {
    const wss = new WsServer({ port: 0, host: '127.0.0.1' });
    await new Promise(r => wss.once('listening', r));
    const pushUrl = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
    const subscriptions: any[] = [];
    wss.on('connection', sock => sock.on('message', m => subscriptions.push(JSON.parse(String(m)))));

    const pushed = new LiveResultsDataSource({
      id: 'fake-rest', name: 'Fake REST push', type: 'liveresults', enabled: true,
      config: { baseUrl, api: 'rest', localPollFloorMs: 60_000, push: true, pushUrl }
    } as any);
    await pushed.initialize();
    source = pushed;

    engine.activeGraphics.set('p1-r1-i1', {
      id: 'p1-r1-i1', projectId: 'p1', rundownId: 'r1', itemId: 'i1', templateId: 'results-list',
      isPlaying: true, manifest: template.manifest, templateDirectoryName: 'results-list', data: {}, currentStep: 1
    });
    await engine.syncPolling();
    await vi.waitFor(() => expect(subscriptions.at(-1)).toEqual({ action: 'sub', tabs: ['H21'] }), { timeout: 3000 });

    results = [...results, { place: '', name: 'Doris Dahl', club: 'IK Y', result: null, status: 9, timeplus: null, progress: 0, start: 3780000, changed: 4 }];
    version = 4;
    const t0 = Date.now();
    for (const client of wss.clients) client.send(JSON.stringify({ type: 'changed', tabs: ['H21'], ver: 4 }));

    await vi.waitFor(() => expect(updates.at(-1)?.results?.some((r: any) => r.name === 'Doris Dahl')).toBe(true), { timeout: 3000, interval: 20 });
    expect(Date.now() - t0).toBeLessThan(2000); // poll interval is 60 s, so only push can explain this
    // The refetch went to the API with the push version, which bypasses the CDN cache
    expect(requests.some(r => r.path === '/classresults' && /[?&]push=4(&|$)/.test(r.url ?? ''))).toBe(true);

    engine.activeGraphics.clear();
    await engine.syncPolling();
    await vi.waitFor(() => expect(wss.clients.size).toBe(0), { timeout: 3000 });
    pushed.destroy();
    await new Promise(r => wss.close(r));
  });

});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  handlers: new Map<string, any>(),
  config: null as any,
  saved: [] as any[],
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: any) => mock.handlers.set(name, fn) }, app: { getPath: () => '/tmp' } }));
vi.mock('../../utils/logger', () => ({ getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../../templates/OGrafManager', () => ({ findTemplateManager: () => undefined }));
const ws = vi.hoisted(() => ({ dropUnauthorised: vi.fn(() => 0) }));
vi.mock('../../data/WebSocketServer', () => ({ getWebSocketServer: () => ws }));
vi.mock('../../utils/config', () => ({
  getConfig: () => mock.config,
  saveConfig: vi.fn(async (cfg: any) => { mock.config = cfg; mock.saved.push(cfg); }),
}));
import { registerSettingsHandlers } from '../settingsHandlers';

const invoke = (name: string, ...args: any[]) => mock.handlers.get(name)({}, ...args);

beforeEach(() => {
  mock.saved = [];
  mock.config = {
    general: { port: 5657, wsPort: 5656, loglevel: 'info', resolution: 'HD' },
    liveresults: {}, dataSources: [], output: { ndi: { fps: 50 }, web: { cors: true } },
    remoteAccess: { requireKey: true, key: 'k'.repeat(24) },
  };
  ws.dropUnauthorised.mockClear();
  mock.handlers.clear();
  registerSettingsHandlers();
});

describe('graphics internet allowlist', () => {
  it('saves valid entries normalised, sorted and once, and reports the rest', async () => {
    const result = await invoke('graphicsAccess:set', ['HTTPS://B.example', 'https://a.example', 'https://bad/path', 'http://a.example']);
    expect(result).toMatchObject({ success: true, data: { saved: ['https://a.example', 'https://b.example'], rejected: [{ input: 'https://bad/path', reason: expect.any(String) }] } });
    expect(mock.saved.at(-1).graphicsAllowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(await invoke('graphicsAccess:get')).toEqual({ success: true, data: ['https://a.example', 'https://b.example'] });
  });
  it('is kept when the settings page saves an older copy of the settings', async () => {
    await invoke('graphicsAccess:set', ['https://a.example']);
    await invoke('settings:update', { general: { loglevel: 'debug' } });
    expect(mock.saved.at(-1).graphicsAllowedOrigins).toEqual(['https://a.example']);
  });

});

describe('blocked addresses', () => {
  it('lists what graphics were refused, without what is allowed, and can be cleared', async () => {
    await invoke('graphicsAccess:clearBlocked');
    await invoke('graphicsAccess:reportBlocked', { origin: 'https://tile.openstreetmap.org', graphics: ['Map strap'] });
    await invoke('graphicsAccess:reportBlocked', { origin: 'https://a.example', graphics: ['GPS'] });
    await invoke('graphicsAccess:reportBlocked', { origin: 'javascript:alert(1)', graphics: [] });
    await invoke('graphicsAccess:set', ['https://a.example']);
    const list = await invoke('graphicsAccess:blocked');
    expect(list).toMatchObject({ success: true, data: [{ origin: 'https://tile.openstreetmap.org', graphics: ['Map strap'], count: 1 }] });
    await invoke('graphicsAccess:clearBlocked');
    expect((await invoke('graphicsAccess:blocked')).data).toEqual([]);
  });
});


describe('remote access', () => {
  it('shows the key and the switch, and keeps both when other settings are saved', async () => {
    expect(await invoke('remoteAccess:get')).toEqual({ success: true, data: { requireKey: true, key: 'k'.repeat(24) } });
    await invoke('settings:update', { general: { loglevel: 'debug' }, remoteAccess: { requireKey: false, key: 'mine' } });
    expect(mock.saved.at(-1).remoteAccess).toEqual({ requireKey: true, key: 'k'.repeat(24) });
  });
  it('turns the requirement off and on, and drops remote connections that no longer qualify', async () => {
    await invoke('remoteAccess:set', { requireKey: false });
    expect(mock.config.remoteAccess).toEqual({ requireKey: false, key: 'k'.repeat(24) });
    await invoke('remoteAccess:set', { requireKey: 'yes' });
    expect(mock.config.remoteAccess.requireKey).toBe(true);
    expect(ws.dropUnauthorised).toHaveBeenCalledTimes(2);
  });
  it('makes a new key and disconnects whoever used the old one', async () => {
    const result = await invoke('remoteAccess:regenerate');
    expect(result.data.key).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(result.data.key).not.toBe('k'.repeat(24));
    expect(mock.config.remoteAccess.key).toBe(result.data.key);
    expect(ws.dropUnauthorised).toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  handlers: new Map<string, any>(),
  config: null as any,
  saved: [] as any[],
}));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, fn: any) => mock.handlers.set(name, fn) }, app: { getPath: () => '/tmp' } }));
vi.mock('../../utils/logger', () => ({ getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../../templates/OGrafManager', () => ({ findTemplateManager: () => undefined }));
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
  };
  mock.handlers.clear();
  registerSettingsHandlers();
});

describe('graphics internet allowlist', () => {
  it('saves valid entries normalised, sorted and once, and reports the rest', async () => {
    const result = await invoke('graphicsAccess:set', ['HTTPS://B.example', 'https://a.example', 'http://bad', 'https://a.example']);
    expect(result).toMatchObject({ success: true, data: { saved: ['https://a.example', 'https://b.example'], rejected: [{ input: 'http://bad', reason: expect.any(String) }] } });
    expect(mock.saved.at(-1).graphicsAllowedOrigins).toEqual(['https://a.example', 'https://b.example']);
    expect(await invoke('graphicsAccess:get')).toEqual({ success: true, data: ['https://a.example', 'https://b.example'] });
  });
  it('is kept when the settings page saves an older copy of the settings', async () => {
    await invoke('graphicsAccess:set', ['https://a.example']);
    await invoke('settings:update', { general: { loglevel: 'debug' } });
    expect(mock.saved.at(-1).graphicsAllowedOrigins).toEqual(['https://a.example']);
  });
});

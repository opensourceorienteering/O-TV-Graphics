/**
 * Live update loop: polling reconciliation, update push, error handling and coalescing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger, getLogger: () => logger };
});

const template = {
  manifest: { id: 'results-list', name: 'Results' },
  directoryName: 'results-list',
  dataSourceConfig: { mode: 'api', api: { provider: 'liveresults', fieldMappings: [] } }
};
vi.mock('../../templates/OGrafManager', () => ({
  getTemplateManager: () => ({ getAllTemplates: () => [template] })
}));

let rundown: any;
vi.mock('../../projects/RundownManager', () => ({
  getRundownManager: () => ({
    loadRundown: vi.fn(async () => rundown),
    updateItem: vi.fn(async () => ({})),
    saveRundown: vi.fn()
  })
}));

const dataStore = { on: vi.fn(), startPolling: vi.fn(), stopPolling: vi.fn() };
vi.mock('../../data/DataStore', () => ({ getDataStore: () => dataStore }));

const fetchAndMapData = vi.fn();
vi.mock('../../data/DataSourceFieldMapper', () => ({
  DataSourceFieldMapper: { fetchAndMapData: (...args: any[]) => fetchAndMapData(...args) }
}));

const sourceClient = { name: 'rest-client', getApiFlavor: () => 'rest' as const };
vi.mock('../../data/DataSourceRegistry', () => ({
  getDataSourceRegistry: () => ({
    get: () => ({
      config: { type: 'liveresults', name: 'Test LiveResults' },
      getClient: () => sourceClient
    })
  })
}));

import { PlaybackEngine } from '../PlaybackEngine';

function makeRundown(overrides: Record<string, any> = {}) {
  return {
    id: 'r1',
    projectId: 'p1',
    settings: {},
    dataSource: { sourceId: 'liveresults-default', competitionId: 37049 },
    items: [{
      id: 'i1',
      templateId: 'results-list',
      fields: {},
      liveResultsData: { competitionId: 11111, autoUpdate: true, dataSourceValues: { className: 'Mixed-1' }, ...overrides }
    }]
  };
}

function onAir(engine: any, isPlaying = true) {
  engine.activeGraphics.set('p1-r1-i1', {
    id: 'p1-r1-i1', projectId: 'p1', rundownId: 'r1', itemId: 'i1',
    templateId: 'results-list', isPlaying, manifest: template.manifest,
    templateDirectoryName: 'results-list', data: { results: [{ name: 'old' }] }, currentStep: 1
  });
}

describe('PlaybackEngine live updates', () => {
  let engine: any;

  beforeEach(() => {
    vi.clearAllMocks();
    rundown = makeRundown();
    engine = new PlaybackEngine();
    engine.sendCommand = vi.fn(async () => ({ success: true }));
  });

  describe('resolveLiveBinding', () => {
    it("uses the rundown's competition over a stale item copy, and the datasource class", () => {
      const binding = engine.resolveLiveBinding(rundown, rundown.items[0], template);
      expect(binding).toMatchObject({ competitionId: 37049, className: 'Mixed-1', sourceId: 'liveresults-default' });
    });

    it('defaults autoUpdate to on for API templates', () => {
      rundown = makeRundown({ autoUpdate: undefined });
      expect(engine.resolveLiveBinding(rundown, rundown.items[0], template)).not.toBeNull();
    });

    it('respects autoUpdate: false', () => {
      rundown = makeRundown({ autoUpdate: false });
      expect(engine.resolveLiveBinding(rundown, rundown.items[0], template)).toBeNull();
    });
  });

  describe('syncPolling', () => {
    it("starts one poll per on-air class with the source's client and the API minimum interval", async () => {
      onAir(engine);
      await engine.syncPolling();
      expect(dataStore.startPolling).toHaveBeenCalledTimes(1);
      expect(dataStore.startPolling).toHaveBeenCalledWith(37049, 'Mixed-1', 0, sourceClient);

      await engine.syncPolling(); // idempotent
      expect(dataStore.startPolling).toHaveBeenCalledTimes(1);
    });

    it('stops the poll when nothing on air uses it (stop / clear all)', async () => {
      onAir(engine);
      await engine.syncPolling();
      engine.activeGraphics.clear();
      await engine.syncPolling();
      expect(dataStore.stopPolling).toHaveBeenCalledWith(37049, 'Mixed-1', sourceClient);
    });

    it('moves the poll when the on-air class changes', async () => {
      onAir(engine);
      await engine.syncPolling();
      rundown = makeRundown({ dataSourceValues: { className: 'Mixed-2' } });
      await engine.syncPolling();
      expect(dataStore.stopPolling).toHaveBeenCalledWith(37049, 'Mixed-1', sourceClient);
      expect(dataStore.startPolling).toHaveBeenLastCalledWith(37049, 'Mixed-2', 0, sourceClient);
    });
  });

  describe('applying updates', () => {
    it('pushes freshly mapped data to the on-air graphic', async () => {
      onAir(engine);
      fetchAndMapData.mockResolvedValueOnce({ results: [{ name: 'new' }] });
      await engine.handleLiveResultsUpdate(37049, 'Mixed-1', { results: [] });
      expect(fetchAndMapData).toHaveBeenCalledWith(
        template.dataSourceConfig, 37049, { className: 'Mixed-1' }, {}, 'liveresults-default'
      );
      expect(engine.sendCommand).toHaveBeenCalledWith('update', {
        id: 'p1-r1-i1',
        data: expect.objectContaining({ results: [{ name: 'new' }], presentation: expect.objectContaining({ identity: 'auto' }) })
      });
    });

    it('keeps the last good data on air when the fetch fails', async () => {
      onAir(engine);
      fetchAndMapData.mockRejectedValueOnce(new Error('ECONNRESET'));
      await engine.handleLiveResultsUpdate(37049, 'Mixed-1', { results: [] });
      expect(engine.sendCommand).not.toHaveBeenCalled();
      expect(engine.activeGraphics.get('p1-r1-i1').data.results[0].name).toBe('old');
    });

    it('never sends an empty update', async () => {
      onAir(engine);
      fetchAndMapData.mockResolvedValueOnce({});
      await engine.handleLiveResultsUpdate(37049, 'Mixed-1', { results: [] });
      expect(engine.sendCommand).not.toHaveBeenCalled();
    });

    it('ignores updates for other classes', async () => {
      onAir(engine);
      await engine.handleLiveResultsUpdate(37049, 'Mixed-9', { results: [] });
      expect(fetchAndMapData).not.toHaveBeenCalled();
    });

    it('coalesces updates that arrive while one is running into a single follow-up', async () => {
      onAir(engine);
      let release!: () => void;
      fetchAndMapData
        .mockImplementationOnce(() => new Promise(r => { release = () => r({ results: [{ name: 'a' }] }); }))
        .mockResolvedValue({ results: [{ name: 'b' }] });

      const first = engine.handleLiveResultsUpdate(37049, 'Mixed-1', {});
      await Promise.resolve();
      engine.handleLiveResultsUpdate(37049, 'Mixed-1', {});
      engine.handleLiveResultsUpdate(37049, 'Mixed-1', {});
      engine.handleLiveResultsUpdate(37049, 'Mixed-1', {});
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      release();
      await first;

      expect(fetchAndMapData).toHaveBeenCalledTimes(2); // the running one + one follow-up
      expect(engine.sendCommand).toHaveBeenLastCalledWith('update', { id: 'p1-r1-i1', data: expect.objectContaining({ results: [{ name: 'b' }] }) });
    });
  });

  describe('refreshItem (edit while on air)', () => {
    it('re-maps with the saved values and re-syncs polling', async () => {
      onAir(engine);
      rundown = makeRundown({ dataSourceValues: { className: 'Mixed-3', runnerName: 'Anna' } });
      fetchAndMapData.mockResolvedValueOnce({ results: [], runnerName: 'Anna' });
      const refreshed = await engine.refreshItem('p1', 'r1', 'i1');
      expect(refreshed).toBe(true);
      expect(fetchAndMapData.mock.calls[0][2]).toEqual({ className: 'Mixed-3', runnerName: 'Anna' });
      expect(dataStore.startPolling).toHaveBeenCalledWith(37049, 'Mixed-3', 0, sourceClient);
    });

    it('does nothing for an item that is not on air', async () => {
      expect(await engine.refreshItem('p1', 'r1', 'i1')).toBe(false);
      expect(engine.sendCommand).not.toHaveBeenCalled();
    });
  });
});

describe('PlaybackEngine OGraf Server API instances', () => {
  let engine: any;
  beforeEach(() => {
    vi.clearAllMocks();
    rundown = makeRundown();
    engine = new PlaybackEngine();
    engine.sendCommand = vi.fn(async (command: string) =>
      command === 'play' ? { success: true, result: { statusCode: 200, currentStep: 3 } } : { success: true });
  });

  it('loads, plays (reading the nested currentStep) and clears an API instance', async () => {
    const { graphicInstanceId } = await engine.apiLoad('results-list', { results: [] });
    expect(engine.sendCommand).toHaveBeenCalledWith('load', expect.objectContaining({ id: graphicInstanceId, templateId: 'results-list' }));
    const play = await engine.apiPlay(graphicInstanceId, { goto: 3 });
    expect(play.currentStep).toBe(3);
    expect(engine.listGraphicInstances()).toEqual([{ graphicInstanceId, templateId: 'results-list', source: 'api', isPlaying: true }]);
    expect(await engine.apiClear([{ graphicInstanceId }])).toEqual([graphicInstanceId]);
    expect(engine.sendCommand).toHaveBeenLastCalledWith('dispose', { id: graphicInstanceId });
    expect(engine.listGraphicInstances()).toEqual([]);
  });

  it('404s an unknown graphic and 409s rundown-owned instances', async () => {
    await expect(engine.apiLoad('nope', {})).rejects.toMatchObject({ httpStatus: 404 });
    onAir(engine);
    await expect(engine.apiUpdate('p1-r1-i1', { data: {} })).rejects.toMatchObject({ httpStatus: 409 });
  });

  it('API instances never start live polling', async () => {
    await engine.apiLoad('results-list', {});
    const [inst] = engine.listGraphicInstances();
    await engine.apiPlay(inst.graphicInstanceId, {});
    await engine.syncPolling();
    expect(dataStore.startPolling).not.toHaveBeenCalled();
  });
});

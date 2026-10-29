/**
 * Template sets in playback: graphics from another set are refused, every graphic gets the
 * project's presentation settings, and playing a graphic clears graphics in clashing zones.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger, getLogger: () => logger };
});

const tpl = (id: string, setId: string, zone: string) => ({
  manifest: { id, name: id, stepCount: 1 }, setId, zone, directoryName: `sets/${setId}/${id}`, dataSourceConfig: null
});
const templates = [
  tpl('iof-results', 'iof', 'main'),
  tpl('iof-name-strap', 'iof', 'lower'),
  tpl('iof-clock', 'iof', 'corner'),
  tpl('cz-podium', 'cz', 'main')
];
vi.mock('../../templates/OGrafManager', () => ({
  getTemplateManager: () => ({ getAllTemplates: () => templates })
}));

let project: any;
vi.mock('../../projects/ProjectManager', () => ({
  getProjectManager: () => ({ loadProject: vi.fn(async () => project) })
}));

const item = (id: string, templateId: string, fields: any = {}) => ({ id, templateId, fields, layer: '1', out: 'animate', onair: false });
let rundown: any;
vi.mock('../../projects/RundownManager', () => ({
  getRundownManager: () => ({
    loadRundown: vi.fn(async () => rundown),
    saveRundown: vi.fn(async () => undefined),
    updateItem: vi.fn(async () => ({}))
  })
}));
vi.mock('../../data/DataStore', () => ({ getDataStore: () => ({ startPolling: vi.fn(), stopPolling: vi.fn() }) }));
vi.mock('../../data/DataSourceFieldMapper', () => ({ DataSourceFieldMapper: { fetchAndMapData: vi.fn() } }));
vi.mock('../../data/DataSourceRegistry', () => ({ getDataSourceRegistry: () => ({ get: () => undefined }) }));

import { PlaybackEngine } from '../PlaybackEngine';

describe('PlaybackEngine and template sets', () => {
  let engine: any;
  beforeEach(() => {
    project = { id: 'p1', name: 'WOC', templateSet: 'iof', settings: { presentation: { international: true, logoUrl: '/assets/iof.png' } } };
    rundown = {
      id: 'r1', projectId: 'p1', settings: { raceLocation: 'Genova' }, dataSource: { competitionName: 'WOC 2026' },
      items: [item('strap', 'iof-name-strap', { name: 'Tove Alexandersson' }), item('clock', 'iof-clock'), item('table', 'iof-results'), item('cz', 'cz-podium')]
    };
    engine = new PlaybackEngine();
    engine.sendCommand = vi.fn(async () => ({ success: true, result: { currentStep: 1 } }));
  });

  const commands = (name: string) => engine.sendCommand.mock.calls.filter((c: any[]) => c[0] === name).map((c: any[]) => c[1]);

  it('refuses a graphic from another set', async () => {
    await expect(engine.playItem('p1', 'r1', 'cz')).rejects.toThrow(/belongs to the "cz" template set/);
    expect(commands('load')).toHaveLength(0);
  });

  it('sends the project presentation and event info with the graphic', async () => {
    await engine.playItem('p1', 'r1', 'strap');
    const load = commands('load')[0];
    expect(load.data).toMatchObject({
      name: 'Tove Alexandersson',
      presentation: { international: true, identity: 'auto', clubLogos: true, clearClashing: true, logoUrl: '/assets/iof.png' },
      event: { name: 'WOC 2026', location: 'Genova' }
    });
  });

  it('a results table takes the lower third off air but leaves the clock', async () => {
    await engine.playItem('p1', 'r1', 'strap');
    await engine.playItem('p1', 'r1', 'clock');
    engine.sendCommand.mockClear();
    await engine.playItem('p1', 'r1', 'table');
    expect(commands('stop').map((c: any) => c.id)).toEqual(['p1-r1-strap']);
    expect(engine.activeGraphics.get('p1-r1-clock').isPlaying).toBe(true);
  });

  it('can be turned off per project', async () => {
    project.settings.presentation.clearClashing = false;
    await engine.playItem('p1', 'r1', 'strap');
    engine.sendCommand.mockClear();
    await engine.playItem('p1', 'r1', 'table');
    expect(commands('stop')).toHaveLength(0);
  });
});

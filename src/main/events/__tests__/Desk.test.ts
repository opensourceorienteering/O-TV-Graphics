import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../utils/logger', () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: l, getLogger: () => l };
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-'));
fs.mkdirSync(path.join(dir, 'p1', 'rundowns'), { recursive: true });
vi.mock('../../utils/config', () => ({ getConfig: () => ({ general: { dataroot: dir } }) }));

const tpl = (id: string, kind: string, api = true) => ({
  manifest: { id, name: id, stepCount: kind === 'results' ? -1 : 1, v_olgrafik_kind: kind, schema: { type: 'object', properties: { detail: { type: 'string' }, text: { type: 'string', title: 'Text' } }, ...(kind === 'free-text' ? { required: ['text'] } : {}) } },
  setId: 'iof', zone: 'lower', directoryName: `sets/iof/${id}`, dataSourceConfig: api ? { mode: 'api' } : null
});
const templates: any[] = [tpl('iof-runner-identity', 'runner-identity'), tpl('iof-results', 'results'), tpl('iof-free-text', 'free-text', false), tpl('iof-weather', 'weather', false)];
// Like classic's results-list-paginated: requires fields that the timing data fills in
templates[1].manifest.schema.required = ['className', 'results'];
templates[1].dataSourceConfig = { mode: 'api', api: { fieldMappings: [{ templateField: 'className' }, { templateField: 'results' }] } };
vi.mock('../../templates/OGrafManager', () => ({ getTemplateManager: () => ({ getAllTemplates: () => templates }) }));

let project: any;
vi.mock('../../projects/ProjectManager', () => ({
  getProjectManager: () => ({ loadProject: async () => project, getRundownsDir: () => path.join(dir, 'p1', 'rundowns') })
}));

const pages: any[] = [];
vi.mock('../../projects/RundownManager', () => ({
  getRundownManager: () => ({
    listRundowns: async () => pages.map(p => ({ id: p.id, name: p.name })),
    loadRundown: async (_p: string, id: string) => pages.find(p => p.id === id),
    createRundown: async ({ name }: any) => { const p = { id: `page${pages.length}`, name, items: [] as any[], created: Date.now() }; pages.push(p); return p; },
    addItem: async (_p: string, pageId: string, o: any) => { const item = { id: `item${Math.random().toString(36).slice(2, 7)}`, ...o }; pages.find(p => p.id === pageId).items.push(item); return item; },
    updateItem: async (_p: string, pageId: string, itemId: string, u: any) => { const it = pages.find(p => p.id === pageId).items.find((i: any) => i.id === itemId); Object.assign(it, u); return it; }
  })
}));

const active: any[] = [];
const engine = {
  getActiveGraphics: () => active,
  playItem: vi.fn(async (p: string, r: string, i: string) => { const it = pages.find(x => x.id === r).items.find((x: any) => x.id === i); active.push({ id: `${p}-${r}-${i}`, projectId: p, rundownId: r, itemId: i, templateId: it.templateId, isPlaying: true, currentStep: 1 }); }),
  stopItem: vi.fn(async (_p: string, _r: string, i: string) => { const k = active.findIndex(g => g.itemId === i); if (k >= 0) active.splice(k, 1); }),
  refreshItem: vi.fn(async () => true),
  nextItem: vi.fn(async (_p: string, _r: string, i: string) => { const g = active.find(x => x.itemId === i); if (g) g.currentStep++; }),
  previousItem: vi.fn(),
  clearAll: vi.fn(async () => { active.length = 0; })
};
vi.mock('../../playback/PlaybackEngine', () => ({ getPlaybackEngine: () => engine }));
const weather = vi.hoisted(() => ({ reading: { place: 'Arena', latitude: 0, longitude: 0, condition: 'Overcast', temperature: 10, windSpeed: 17, humidity: 90, fetchedAt: 1 } as any, error: undefined as string | undefined }));
vi.mock('../../data/Weather', async (orig) => ({
  ...(await orig<typeof import('../../data/Weather')>()),
  eventWeather: async () => ({ reading: weather.reading, source: weather.reading ? 'live' : 'none', error: weather.error }),
  WEATHER_MAX_AGE_MS: 300000
}));
vi.mock('../../data/DataSourceFieldMapper', () => ({ DataSourceFieldMapper: { fetchAndMapData: vi.fn(async () => ({ results: [{ name: 'Jan Novák' }] })) } }));
vi.mock('../EventService', () => ({
  loadEvent: async () => project,
  syncPages: async () => undefined,
  applyStartList: (_p: string, d: any) => d
}));

import * as desk from '../Desk';

describe('live desk', () => {
  beforeEach(() => {
    project = { id: 'p1', name: 'Bohemian Forest Open', templateSet: 'iof', dataSource: { sourceId: 'lr', competitionId: 7 }, info: {}, settings: {} };
    active.length = 0;
    vi.clearAllMocks();
  });

  it('lists the desk graphics the look provides', async () => {
    const list = await desk.deskTemplates('p1');
    expect(list.find(t => t.key === 'runner-identity')).toMatchObject({ available: true, templateId: 'iof-runner-identity' });
    expect(list.find(t => t.key === 'podium')?.available).toBe(false);
  });

  it('refuses incomplete drafts and never plays them', async () => {
    await expect(desk.deskShow('p1', { key: 'runner-identity', values: { className: 'H21' }, fields: {} })).rejects.toThrow('Choose a runner first');
    await expect(desk.deskShow('p1', { key: 'free-text', values: {}, fields: {} })).rejects.toThrow('Choose Text first');
    expect(engine.playItem).not.toHaveBeenCalled();
  });

  it('flags missing timing data for live graphics', async () => {
    project.dataSource = undefined;
    await expect(desk.deskShow('p1', { key: 'runner-identity', values: { runnerName: 'Jan Novák' }, fields: {} })).rejects.toThrow('Timing data is not set up');
  });

  it('Show plays the draft from a hidden desk page; Update refreshes in place; Hide stops it', async () => {
    const draft = { key: 'runner-identity', values: { className: 'Men Elite', runnerName: 'Jan Novák', runnerBib: '101' }, fields: { detail: 'Leader' } };
    let state = await desk.deskShow('p1', draft);
    expect(engine.playItem).toHaveBeenCalledTimes(1);
    expect(pages[0].name).toBe('__desk__');
    expect(pages[0].items[0]).toMatchObject({ templateId: 'iof-runner-identity', fields: { detail: 'Leader' }, liveResultsData: { dataSourceValues: { className: 'Men Elite', runnerName: 'Jan Novák', runnerId: 'Jan Novák', runnerBib: '101' } } });
    expect(state.onAir).toHaveLength(1);
    expect(state.onAir[0]).toMatchObject({ key: 'runner-identity', draft });

    const changed = { ...draft, fields: { detail: 'Winner' } };
    state = await desk.deskUpdate('p1', changed);
    expect(engine.refreshItem).toHaveBeenCalledTimes(1);
    expect(engine.playItem).toHaveBeenCalledTimes(1); // no re-entry
    expect(state.onAir[0].draft.fields.detail).toBe('Winner');

    state = await desk.deskHide('p1', 'runner-identity');
    expect(state.onAir).toHaveLength(0);
    await expect(desk.deskUpdate('p1', changed)).rejects.toThrow('not on air');
  });

  it('opens paged graphics on the requested page and pages the one on air', async () => {
    await desk.deskShow('p1', { key: 'results', values: { className: 'H21' }, fields: {}, page: 3 });
    expect(engine.nextItem).toHaveBeenCalledTimes(2);
    await desk.deskPageStep('p1', 1);
    expect((await desk.deskState('p1')).onAir[0].step).toBe(4);
  });

  it('Hide all clears everything', async () => {
    await desk.deskShow('p1', { key: 'free-text', values: {}, fields: { text: 'Welcome' } });
    const state = await desk.deskHideAll('p1');
    expect(engine.clearAll).toHaveBeenCalled();
    expect(state.onAir).toEqual([]);
  });

  it('keeps favourites per graphic and validates the command numbers', () => {
    const draft = { key: 'free-text', values: {}, fields: { text: 'Hello' } };
    const all = desk.saveDeskFavorite('p1', 'Greeting', draft);
    expect(all['free-text'][0]).toMatchObject({ label: 'Greeting', draft });
    expect(desk.deleteDeskFavorite('p1', 'free-text', all['free-text'][0].id)['free-text']).toEqual([]);

    expect(desk.loadDeskCommands()['0']).toBe('event-title');
    expect(desk.saveDeskCommands({ '1': 'results', '20': 'free-text' })).toEqual({ '1': 'results', '20': 'free-text' });
    expect(() => desk.saveDeskCommands({ '1': 'results', '2': 'results' })).toThrow('only one number');
    expect(() => desk.saveDeskCommands({ x: 'results' } as any)).toThrow('0–99');
  });

  it('numbers favourites F1, F2 ... per graphic and gives a freed number to the next one', () => {
    const d = (text: string) => ({ key: 'free-text', values: {}, fields: { text } });
    desk.saveDeskFavorite('p1', 'A', d('a'));
    desk.saveDeskFavorite('p1', 'B', d('b'));
    let all = desk.saveDeskFavorite('p1', 'Other graphic', { key: 'speaker', values: {}, fields: {} });
    expect(all['free-text'].map(f => `F${f.n} ${f.label}`)).toEqual(['F1 A', 'F2 B']);
    expect(all.speaker[0].n).toBe(1); // numbering restarts per graphic
    all = desk.deleteDeskFavorite('p1', 'free-text', all['free-text'][0].id);
    all = desk.saveDeskFavorite('p1', 'C', d('c'));
    expect(all['free-text'].map(f => `F${f.n} ${f.label}`)).toEqual(['F2 B', 'F1 C']);
    for (const f of all['free-text']) desk.deleteDeskFavorite('p1', 'free-text', f.id);
    desk.deleteDeskFavorite('p1', 'speaker', all.speaker[0].id);
  });

  it('fills the weather graphic automatically, keeps typed overrides, and explains a missing reading', async () => {
    await desk.deskShow('p1', { key: 'weather', values: {}, fields: { title: 'Arena', wind: '20' } });
    const item = pages[0].items.find((i: any) => i.templateId === 'iof-weather');
    expect(item.fields).toEqual({ title: 'Arena', condition: 'Overcast', temperature: '10', wind: '20', humidity: '90' });
    const preview = await desk.deskPreviewData('p1', { key: 'weather', values: {}, fields: {} });
    expect(preview.data).toMatchObject({ condition: 'Overcast', temperature: '10' });

    weather.reading = null; weather.error = 'offline';
    await expect(desk.deskPreviewData('p1', { key: 'weather', values: {}, fields: {} })).rejects.toThrow('No weather reading (offline)');
    // Typed conditions still work without the service
    await expect(desk.deskPreviewData('p1', { key: 'weather', values: {}, fields: { condition: 'Sunny' } })).resolves.toBeTruthy();
  });
});

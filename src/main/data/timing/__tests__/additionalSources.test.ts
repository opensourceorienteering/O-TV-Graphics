/**
 * An event's additional sources (GPS …) next to its timing source: they add their own fields
 * and nothing else, and never interfere with the timing source or each other.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import path from 'path';

vi.mock('../../../utils/logger', () => {
  const l = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };
  return { getLogger: () => l, logger: l };
});

import { getDataSourceRegistry } from '../../DataSourceRegistry';
import { registerBuiltInDataSources } from '../../sources';
import { registerTimingPlugin, resetTimingPlugins } from '../TimingPlugins';
import { DataSourceFieldMapper } from '../../DataSourceFieldMapper';
import { getDataStore, initDataStore } from '../../DataStore';
import { clearAdditionalSourceCache, runnerMatcher, setAdditionalTimeoutMs, usableAdditionalSources } from '../additionalSources';
import { providedSourceFields } from '../../../events/Desk';
import { baseTagProblems } from '../../../../shared/baseTags';
import type { Entry, TimingPlugin } from '../../../../shared/timing-sdk';

const IOF = path.resolve(__dirname, '../../../../../test-data/iofxml/resultlist-course.xml');
const CONFIG: any = { version: '1.0', mode: 'api', api: { provider: 'timing', fieldMappings: [{ templateField: 'results', apiPath: 'results' }, { templateField: 'gpsWind', apiPath: 'x.gps.wind' }] } };

/** A GPS tracker that also reports places, times and runners: none of that may leak */
let gpsEntries: Entry[] = [];
let gpsMode: 'ok' | 'fail' | 'hang' = 'ok';
let gpsCalls = 0;
const gpsEntry = (id: string, full: string, club: string, speedKmh: number, bib?: string): Entry => ({
  id, classId: 'H21', name: { full }, club: { name: club }, ...(bib ? { bib } : {}),
  status: 'ok', time: 1000, passings: [], standing: { place: 1, progress: 100 }, ext: { speedKmh }
});
function gpsPlugin(id: string): TimingPlugin {
  return {
    manifest: {
      id, name: `GPS ${id}`, version: '1.0.0', sdk: '^1.0', capabilities: { minPollMs: 500 },
      extFields: [{ key: 'speedKmh', on: 'entry', type: 'number', label: 'Speed' }, { key: 'wind', on: 'class', type: 'number', label: 'Wind' }]
    },
    create: () => ({
      connect: async () => undefined,
      close: () => undefined,
      competitions: async () => [{ id: '1', name: 'Tracking', date: '2026-10-25' }],
      classes: async () => [{ id: 'H21', name: 'H21', kind: 'individual', radioControls: [], ext: { wind: 3 } }],
      entries: async () => {
        gpsCalls++;
        if (gpsMode === 'fail') throw new Error('tracker offline');
        if (gpsMode === 'hang') return new Promise<Entry[]>(() => undefined);
        return gpsEntries;
      }
    })
  };
}

const withoutPlugin = (data: any, plugin: string) => JSON.parse(JSON.stringify(data, (k, v) => {
  if (k === 'x' && v && typeof v === 'object') {
    const { [plugin]: _drop, ...rest } = v;
    return Object.keys(rest).length ? rest : undefined;
  }
  return k === 'dataTimestamp' ? undefined : v;
}));

describe('additional sources', () => {
  beforeAll(async () => {
    initDataStore();
    getDataSourceRegistry().clear();
    resetTimingPlugins();
    registerBuiltInDataSources();
    registerTimingPlugin(gpsPlugin('gps'), { kind: 'code', path: 'test' });
    registerTimingPlugin(gpsPlugin('gps-two'), { kind: 'code', path: 'test2' });
    const registry = getDataSourceRegistry();
    await registry.create({ id: 'iof', name: 'IOF', type: 'iofxml', enabled: true, config: { filePath: IOF, competitionId: 1, timezone: 'Europe/Stockholm' } });
    await registry.create({ id: 'gps', name: 'GPS', type: 'gps', enabled: true, config: {} });
    await registry.create({ id: 'gps-again', name: 'GPS again', type: 'gps', enabled: true, config: {} });
    await registry.create({ id: 'gps2', name: 'GPS two', type: 'gps-two', enabled: true, config: {} });
  });

  beforeEach(() => {
    clearAdditionalSourceCache();
    setAdditionalTimeoutMs(3000);
    gpsMode = 'ok';
    gpsEntries = [
      gpsEntry('g1', 'A. Andersson', 'Someone', 12, '101'), // bib 101 = Anna Andersson
      gpsEntry('g2', 'Bertil Bok', 'IK Granen', 10),        // name and club
      gpsEntry('g3', 'Doris Dahl', 'Elsewhere', 9),         // name only, unique
      gpsEntry('g4', 'Cesar Cykel', 'A', 8),                // the name twice: no match by name alone
      gpsEntry('g5', 'Cesar Cykel', 'B', 7),
      gpsEntry('g6', 'Zed Unknown', 'Nowhere', 30)          // not in the timing source
    ];
  });

  afterAll(() => {
    getDataStore().clear();
    getDataSourceRegistry().destroyAll();
  });

  it('adds only its own fields, under its own plugin; base tags stay exactly the timing source\'s', async () => {
    const plain = await DataSourceFieldMapper.fetchAndMapData(CONFIG, 1, { className: 'H21' }, {}, 'iof');
    const withGps = await DataSourceFieldMapper.fetchAndMapData(CONFIG, 1, { className: 'H21' }, {}, 'iof', [{ sourceId: 'gps' }]);
    const { gpsWind: _wind, ...rest } = withGps; // the graphic's own field, mapped from x.gps.wind
    expect(withoutPlugin(rest, 'gps')).toEqual(withoutPlugin(plain, 'gps'));
    expect(baseTagProblems(withGps, ['gpsWind'])).toEqual([]);

    const speed = Object.fromEntries(withGps.results.map((r: any) => [r.name, r.x?.gps?.speedKmh]));
    expect(speed).toEqual({
      'Bertil Bok': 10,
      'Anna Andersson': 12,     // matched by bib
      'Doris Dahl': 9,          // matched by name (unique)
      'Cesar Cykel': undefined, // two GPS runners of that name, neither club matches
      'Erik Ek': undefined
    });
    expect(withGps.results.map((r: any) => r.name)).not.toContain('Zed Unknown');
    expect(withGps.gpsWind).toBe(3); // a class field, mapped from x.gps.wind
    expect(plain.gpsWind).toBeUndefined();
  });

  it('keeps one source per plugin, and never the timing source itself', () => {
    const used = usableAdditionalSources('iof', [
      { sourceId: 'gps' }, { sourceId: 'gps-again' }, { sourceId: 'iof' }, { sourceId: 'missing' }, { sourceId: 'gps2' }
    ]).map(a => a.sourceId);
    expect(used).toEqual(['gps', 'gps2']);
  });

  it('two plugins side by side each add their own fields', async () => {
    const data = await DataSourceFieldMapper.fetchAndMapData(CONFIG, 1, { className: 'H21' }, {}, 'iof', [{ sourceId: 'gps' }, { sourceId: 'gps2' }]);
    const anna = data.results.find((r: any) => r.name === 'Anna Andersson');
    expect(anna.x).toEqual({ gps: { speedKmh: 12 }, 'gps-two': { speedKmh: 12 } });
  });

  it('a failing source keeps its last good fields; the timing data always goes out', async () => {
    await DataSourceFieldMapper.fetchAndMapData(CONFIG, 1, { className: 'H21' }, {}, 'iof', [{ sourceId: 'gps' }]);
    gpsMode = 'fail';
    const gpsHub = (getDataSourceRegistry().get('gps') as any).getClient();
    gpsHub.clearCache(); // no recent result to fall back on: the source itself must fail
    const before = gpsCalls;
    const data = await DataSourceFieldMapper.fetchAndMapData(CONFIG, 1, { className: 'H21' }, {}, 'iof', [{ sourceId: 'gps' }]);
    expect(gpsCalls).toBeGreaterThan(before); // it was asked, and failed
    expect(data.results.find((r: any) => r.name === 'Bertil Bok').x.gps.speedKmh).toBe(10);

    clearAdditionalSourceCache(); // never had good data: none, and the timing data is still complete
    gpsHub.clearCache();
    const none = await DataSourceFieldMapper.fetchAndMapData(CONFIG, 1, { className: 'H21' }, {}, 'iof', [{ sourceId: 'gps' }]);
    expect(none.results).toHaveLength(5);
    expect(none.results.some((r: any) => r.x?.gps)).toBe(false);
  });

  it('a hanging source never holds the graphic up', async () => {
    setAdditionalTimeoutMs(100);
    gpsMode = 'hang';
    const t0 = Date.now();
    const data = await DataSourceFieldMapper.fetchAndMapData(CONFIG, 1, { className: 'H21' }, {}, 'iof', [{ sourceId: 'gps' }]);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(data.results).toHaveLength(5);
  });

  it('matches by bib, then name and club, then a unique name', () => {
    const row = (name: string, club: string, bib?: string, speed = 1) => ({ name, club, ...(bib ? { bib } : {}), ext: { p: { speed } } }) as any;
    const match = runnerMatcher([row('X', 'Y', '7', 1), row('Ann Ek', 'OK', undefined, 2), row('Bo', 'A', undefined, 3), row('Bo', 'B', undefined, 4), row('Cy', 'Z', undefined, 5)], 'p');
    expect(match({ name: 'Anyone', club: '', bib: ' 7 ' })).toEqual({ speed: 1 });
    expect(match({ name: 'ann  ek', club: 'ok' })).toEqual({ speed: 2 });
    expect(match({ name: 'Bo', club: 'C' })).toBeUndefined();
    expect(match({ name: 'Cy', club: 'Other' })).toEqual({ speed: 5 });
  });

  it('polls of different sources never share state, even with the same competition id and class', () => {
    const store = getDataStore();
    const iof = (getDataSourceRegistry().get('iof') as any).getClient();
    const gps = (getDataSourceRegistry().get('gps') as any).getClient();
    const events: string[] = [];
    store.on('results:updated', (_c: number, cls: string, _d: unknown, source: string) => events.push(`${source}:${cls}`));
    store.startPolling(1, 'H21', 0, iof);
    store.startPolling(1, 'H21', 0, gps);
    expect(store.getPollingStatus(1, 'H21').map(s => s.source).sort()).toEqual([gps.label, iof.label].sort());
    store.stopPolling(1, 'H21', gps);
    expect(store.getPollingStatus(1, 'H21').map(s => [s.source, s.active])).toEqual(expect.arrayContaining([[iof.label, true], [gps.label, false]]));
    store.stopPolling(1, 'H21', iof);
  });

  it('the Live desk counts the additional sources\' fields', () => {
    const fields = providedSourceFields({ dataSource: { sourceId: 'iof' }, additionalSources: [{ sourceId: 'gps' }] } as any);
    expect([...fields].sort()).toEqual(['results[].x.gps.speedKmh', 'x.gps.wind']);
  });
});

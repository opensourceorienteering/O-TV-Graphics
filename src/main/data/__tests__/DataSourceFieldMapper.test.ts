import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger, getLogger: () => logger };
});

const client = {
  getCompetitionInfo: vi.fn(),
  getClasses: vi.fn(),
  getCompetitions: vi.fn(),
  getClassResults: vi.fn(),
  getServerClockOffsetMs: vi.fn()
};

class LiveResultsDataSource {
  config = { id: 'src', name: 'LiveResults', type: 'liveresults', config: { baseUrl: 'https://api.orienteering.services' } };
  client = client;
  getClient() { return this.client; }
}

const INFO = { id: 37049, sourceId: '37049', name: 'JWOC 2026, Sprint Relay', organiser: 'SOFT', date: '2026-06-30', timediffHours: 0 };
const CLOCK = { date: '2026-06-30', timediffHours: 0 };
/** One class's standings as the hub gives them */
const classResults = (className: string, rows: any[], controls: any[] = [], extra: any = {}) => ({
  data: {
    competitionId: 37049, className, classId: className, controls,
    rows: rows.map(r => ({ entryId: r.name, status: 'ok', statusCode: 0, ranked: true, tied: false, progress: 0, splits: {}, ...r })),
    ...extra
  },
  hash: 'h', timestamp: 1, changed: true
});

let source: any;
vi.mock('../DataSourceRegistry', () => ({
  getDataSourceRegistry: () => ({ get: () => source, getAll: () => [source] })
}));

const cachedOgraf = {
  title: 'Mixed-1',
  className: 'Mixed-1',
  competitionName: 'JWOC 2026, Sprint Relay',
  timestamp: 1,
  results: [{ position: 1, name: 'Lucie Gaudion', club: 'France 1', time: '13:17', diff: '', status: 'OK', statusCode: 0, progress: 100 }]
};
vi.mock('../DataStore', () => ({
  getDataStore: () => ({ getTransformedClassResults: vi.fn(async () => cachedOgraf) })
}));

vi.mock('../ClubLogoService', () => ({
  getClubLogoService: () => ({ lookup: (club: string) => (club === 'France 1' ? '/club-logos/logos/7.png' : undefined) })
}));

import { DataSourceFieldMapper } from '../DataSourceFieldMapper';
import { instantOfWallClock } from '../timing/model';

const config: any = { mode: 'api', api: { provider: 'liveresults', fieldMappings: [{ templateField: 'results', apiPath: 'results' }] } };

describe('DataSourceFieldMapper live clock data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    source = new (LiveResultsDataSource as any)();
    client.getCompetitionInfo.mockResolvedValue(INFO);
    client.getServerClockOffsetMs.mockResolvedValue(-120);
    client.getClassResults.mockResolvedValue(classResults('Mixed-1', [{ name: 'Lucie Gaudion', club: 'France 1', start: instantOfWallClock(CLOCK, 420000) }]));
  });

  it('combines optional all-class data while preserving each runner’s class and clock', async () => {
    client.getClasses.mockResolvedValue({ data: [{ className: 'D21', classId: 'D21' }, { className: 'H21', classId: 'H21' }] });
    const scoped = { ...config, api: { ...config.api, classScope: 'optional' } };
    const [result, shared] = await Promise.all([
      DataSourceFieldMapper.fetchAndMapData(scoped, 37049, {}, {}, 'src'),
      DataSourceFieldMapper.fetchAndMapData(scoped, 37049, {}, {}, 'src'),
    ]);
    expect(shared).toBe(result);
    expect(client.getClassResults).toHaveBeenCalledTimes(2);
    expect(result.className).toBe('');
    expect(result.results.map((r: any) => r.className)).toEqual(['D21', 'H21']);
    expect(result.results.every((r: any) => r.startTimeMs > 0)).toBe(true);
    expect(result.clockOffsetMs).toBe(-120);
    client.getClasses.mockClear();
    await DataSourceFieldMapper.fetchAndMapData(scoped, 37049, { className: 'D21' }, {}, 'src');
    expect(client.getClasses).not.toHaveBeenCalled();
  });

  it('adds absolute start times and the server clock offset', async () => {
    const data = await DataSourceFieldMapper.fetchAndMapData(config, 37049, { className: 'Mixed-1' }, {}, 'src');
    // 420000 cs = 01:10:00 local Swedish time (CEST) on 2026-06-30
    expect(new Date(data.results[0].startTimeMs).toISOString()).toBe('2026-06-29T23:10:00.000Z');
    expect(data.clockOffsetMs).toBe(-120);
    expect(data.competitionTimeZone).toBe('Europe/Stockholm');
    expect(data.competitionDate).toBe('2026-06-30');
    expect(client.getCompetitions).not.toHaveBeenCalled(); // no full competition list per update
  });

  it('does not mutate the cached DataStore results', async () => {
    await DataSourceFieldMapper.fetchAndMapData(config, 37049, { className: 'Mixed-1' }, { competitionNameOverride: 'X' }, 'src');
    expect((cachedOgraf.results[0] as any).startTimeMs).toBeUndefined();
    expect(cachedOgraf.competitionName).toBe('JWOC 2026, Sprint Relay');
  });

  it('rethrows fetch errors instead of returning empty data', async () => {
    client.getClassResults.mockRejectedValueOnce(new Error('503'));
    await expect(DataSourceFieldMapper.fetchAndMapData(config, 37049, { className: 'Mixed-1' }, {}, 'src')).rejects.toThrow('503');
  });

  it('adds split times, radio controls, nation and club logo for the template sets', async () => {
    client.getClassResults.mockResolvedValue(classResults('Mixed-1',
      [{ name: 'Lucie Gaudion', club: 'France 1', start: instantOfWallClock(CLOCK, 420000), country: 'FRA',
        splits: { 1031: { time: 300_000, place: 2, behind: 5000, status: 0 } } }],
      [{ key: 1031, id: '31', name: 'Radio 1' }, { key: 1045, id: '45', name: 'Radio 2' }]));
    const data = await DataSourceFieldMapper.fetchAndMapData(config, 37049, { className: 'Mixed-1' }, {}, 'src');
    expect(data.splitControls).toEqual([{ code: 1031, name: 'Radio 1' }, { code: 1045, name: 'Radio 2' }]);
    expect(data.results[0]).toMatchObject({
      country: 'FRA',
      clubLogo: '/club-logos/logos/7.png',
      splitTimes: [{ code: 1031, time: 30000, place: 2, timeplus: 500, status: 0 }] // no time at 1045 yet
    });
  });

  it('applies a template\'s fixed values (start lists always read start times)', async () => {
    const startList: any = { ...config, api: { ...config.api, fixedValues: { controlCode: 'Start' } } };
    const data = await DataSourceFieldMapper.fetchAndMapData(startList, 37049, { className: 'Mixed-1', controlCode: '1031' }, {}, 'src');
    expect(data.controlCode).toBe('Start');
  });
});

describe('DataSourceFieldMapper timing plugin fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    source = new (LiveResultsDataSource as any)();
    client.getCompetitionInfo.mockResolvedValue(INFO);
    client.getServerClockOffsetMs.mockResolvedValue(0);
    client.getClassResults.mockResolvedValue(classResults('Mixed-1',
      [{ name: 'Lucie Gaudion', club: 'France 1', start: instantOfWallClock(CLOCK, 420000), ext: { 'gps-track': { speedKmh: 14.2 } } }],
      [], { ext: { 'gps-track': { sponsor: 'Acme' } } }));
  });

  it("accepts provider 'timing' and exposes x.<plugin>.<key> per runner and per class", async () => {
    const timing: any = {
      mode: 'api',
      api: {
        provider: 'timing',
        fieldMappings: [
          { templateField: 'results', apiPath: 'results' },
          { templateField: 'sponsor', apiPath: 'x.gps-track.sponsor' }
        ]
      }
    };
    const data = await DataSourceFieldMapper.fetchAndMapData(timing, 37049, { className: 'Mixed-1' }, {}, 'src');
    expect(data.results[0].x).toEqual({ 'gps-track': { speedKmh: 14.2 } });
    expect(data.sponsor).toBe('Acme');
  });
});

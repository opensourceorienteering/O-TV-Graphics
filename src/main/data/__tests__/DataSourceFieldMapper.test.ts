import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/logger', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger, getLogger: () => logger };
});

const client = {
  getCompetitionInfo: vi.fn(),
  getCompetitions: vi.fn(),
  getClassResults: vi.fn(),
  getServerClockOffsetMs: vi.fn()
};

vi.mock('../sources/LiveResultsDataSource', () => {
  class LiveResultsDataSource {
    config = { id: 'src', name: 'LiveResults', type: 'liveresults', config: { baseUrl: 'https://api.orienteering.services' } };
    client = client;
    getClient() { return this.client; }
  }
  return { LiveResultsDataSource };
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
import { LiveResultsDataSource } from '../sources/LiveResultsDataSource';

const config: any = { mode: 'api', api: { provider: 'liveresults', fieldMappings: [{ templateField: 'results', apiPath: 'results' }] } };

describe('DataSourceFieldMapper live clock data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    source = new (LiveResultsDataSource as any)();
    client.getCompetitionInfo.mockResolvedValue({ id: 37049, name: 'JWOC 2026, Sprint Relay', organizer: 'SOFT', date: '2026-06-30', timediff: 0 });
    client.getServerClockOffsetMs.mockResolvedValue(-120);
    client.getClassResults.mockResolvedValue({
      data: { className: 'Mixed-1', splitcontrols: [], results: [{ name: 'Lucie Gaudion', club: 'France 1', start: 420000 }] },
      hash: 'h', timestamp: 1, changed: true
    });
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

  it('falls back to the competition list if competition info fails', async () => {
    client.getCompetitionInfo.mockRejectedValueOnce(new Error('404'));
    client.getCompetitions.mockResolvedValueOnce({ data: [{ id: 37049, name: 'JWOC', organizer: '', date: '2026-06-30', timediff: 0 }] });
    const data = await DataSourceFieldMapper.fetchAndMapData(config, 37049, { className: 'Mixed-1' }, {}, 'src');
    expect(data.competitionName).toBe('JWOC');
    expect(data.results[0].startTimeMs).toBeGreaterThan(0);
  });

  it('adds split times, radio controls, nation and club logo for the template sets', async () => {
    client.getClassResults.mockResolvedValue({
      data: {
        className: 'Mixed-1',
        splitcontrols: [{ code: 1031, name: 'Radio 1' }, { code: 1045, name: 'Radio 2' }],
        results: [{ name: 'Lucie Gaudion', club: 'France 1', start: 420000, country: 'FRA',
          splits: { '1031': 30000, '1031_place': 2, '1031_timeplus': 500, '1031_status': 0 } }]
      },
      hash: 'h', timestamp: 1, changed: true
    });
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

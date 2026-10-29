/**
 * Unit Tests for LiveResultsDataSource
 * The client is mocked; mocks return the client's real CachedResponse shape ({ data, hash, timestamp, changed }).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveResultsDataSource } from '../LiveResultsDataSource';
import { LiveResultsClient } from '../../LiveResultsClient';
import { LiveResultsDataSourceConfig } from '../../../../shared/types/dataSource';

vi.mock('../../LiveResultsClient');

const cached = <T,>(data: T) => ({ data, hash: 'h', timestamp: Date.now(), changed: true });

describe('LiveResultsDataSource', () => {
  let dataSource: LiveResultsDataSource;
  let mockClient: any;

  const createConfig = (overrides?: Partial<LiveResultsDataSourceConfig['config']>): LiveResultsDataSourceConfig => ({
    id: 'test-liveresults',
    name: 'Test LiveResults',
    type: 'liveresults',
    enabled: true,
    config: {
      baseUrl: 'https://test.liveresultat.se',
      cacheInterval: 15000,
      timeout: 10000,
      ...overrides
    }
  });

  const createInitialized = async () => {
    dataSource = new LiveResultsDataSource(createConfig());
    mockClient.getCompetitions.mockResolvedValue(cached([{ id: 1, name: 'Test Competition' }]));
    await dataSource.initialize();
    vi.clearAllMocks();
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      getCompetitions: vi.fn(),
      getClasses: vi.fn(),
      getClassResults: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      stopAllPolling: vi.fn(),
      destroy: vi.fn()
    };

    // Must be a function (not an arrow) so `new LiveResultsClient()` works under Vitest 4+
    (LiveResultsClient as any).mockImplementation(function () { return mockClient; });
  });

  afterEach(() => {
    dataSource?.destroy();
  });

  describe('Initialization', () => {
    it('should create instance with valid configuration', () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      expect(dataSource).toBeDefined();
      expect(dataSource.config).toEqual(config);
      expect(dataSource.initialized).toBe(false);
    });

    it('should reject a non-liveresults config', () => {
      expect(() => new LiveResultsDataSource({ ...createConfig(), type: 'manual' } as any)).toThrow('Invalid config type');
    });

    it('should initialize successfully', async () => {
      dataSource = new LiveResultsDataSource(createConfig());
      mockClient.getCompetitions.mockResolvedValue(cached([{ id: 1, name: 'Test Competition' }]));

      await dataSource.initialize();

      expect(dataSource.initialized).toBe(true);
      expect(mockClient.getCompetitions).toHaveBeenCalledTimes(1);
    });

    it('should throw error if initialization fails', async () => {
      dataSource = new LiveResultsDataSource(createConfig());
      mockClient.getCompetitions.mockRejectedValue(new Error('Network error'));

      await expect(dataSource.initialize()).rejects.toThrow('Network error');
      expect(dataSource.initialized).toBe(false);
    });

    it('should pass configuration to LiveResultsClient', () => {
      dataSource = new LiveResultsDataSource(createConfig({
        baseUrl: 'https://api.orienteering.services',
        cacheInterval: 30000,
        timeout: 20000,
        api: 'rest'
      }));

      expect(LiveResultsClient).toHaveBeenCalledWith({
        baseUrl: 'https://api.orienteering.services',
        cacheInterval: 30000,
        timeout: 20000,
        api: 'rest'
      });
    });

    it('should refuse queries before initialization', async () => {
      dataSource = new LiveResultsDataSource(createConfig());
      await expect(dataSource.getCompetitions()).rejects.toThrow('not initialized');
    });
  });

  describe('getCompetitions', () => {
    beforeEach(createInitialized);

    it('should convert competitions to the normalized format', async () => {
      mockClient.getCompetitions.mockResolvedValue(cached([
        { id: 123, name: 'Test Event', date: '2025-10-20', organizer: 'Test Organizer', timediff: 0, extraField: 'x' },
        { id: 124, name: 'Test Event 2', date: '2025-10-21', organizer: 'Other', timediff: 0 }
      ]));

      const competitions = await dataSource.getCompetitions();

      expect(competitions).toHaveLength(2);
      expect(competitions[0]).toEqual({ id: 123, name: 'Test Event', date: '2025-10-20', organizer: 'Test Organizer' });
      expect(competitions[0]).not.toHaveProperty('extraField');
    });

    it('should return empty array when no competitions', async () => {
      mockClient.getCompetitions.mockResolvedValue(cached([]));
      expect(await dataSource.getCompetitions()).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockClient.getCompetitions.mockRejectedValue(new Error('API error'));
      await expect(dataSource.getCompetitions()).rejects.toThrow('API error');
    });
  });

  describe('getClasses', () => {
    beforeEach(createInitialized);

    it('should fetch and convert classes for a competition', async () => {
      mockClient.getClasses.mockResolvedValue(cached([{ className: 'M21' }, { className: 'W21' }]));

      const classes = await dataSource.getClasses(123);

      expect(mockClient.getClasses).toHaveBeenCalledWith(123);
      expect(classes).toEqual([
        { className: 'M21', displayName: 'M21', numberOfEntries: 0 },
        { className: 'W21', displayName: 'W21', numberOfEntries: 0 }
      ]);
    });

    it('should return empty array when no classes', async () => {
      mockClient.getClasses.mockResolvedValue(cached([]));
      expect(await dataSource.getClasses(123)).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockClient.getClasses.mockRejectedValue(new Error('API error'));
      await expect(dataSource.getClasses(123)).rejects.toThrow('API error');
    });
  });

  describe('getResults', () => {
    beforeEach(createInitialized);

    it('should fetch class results and convert them', async () => {
      mockClient.getClassResults.mockResolvedValue(cached({
        className: 'M21',
        splitcontrols: [],
        hash: '',
        results: [
          { place: '1', name: 'John Doe', club: 'Test Club', result: '180000', status: 0, timeplus: '0', progress: 100, start: 3600000 },
          { place: '2', name: 'Jane Smith', club: 'Another Club', result: '192000', status: 0, timeplus: '12000', progress: 100, start: 3660000 }
        ]
      }));

      const results = await dataSource.getResults(123, 'M21');

      expect(mockClient.getClassResults).toHaveBeenCalledWith(123, 'M21');
      expect(results).toEqual([
        { place: 1, name: 'John Doe', club: 'Test Club', time: '180000', status: '0' },
        { place: 2, name: 'Jane Smith', club: 'Another Club', time: '192000', status: '0' }
      ]);
    });

    it('should leave place undefined for runners without a place', async () => {
      mockClient.getClassResults.mockResolvedValue(cached({
        className: 'M21', splitcontrols: [], hash: '',
        results: [{ place: '', name: 'Runner DNS', club: 'Club', result: '', status: 1, timeplus: '', progress: 0, start: 0 }]
      }));

      const [result] = await dataSource.getResults(123, 'M21');
      expect(result.place).toBeUndefined();
      expect(result.status).toBe('1');
    });

    it('should return empty array when no results', async () => {
      mockClient.getClassResults.mockResolvedValue(cached({ className: 'M21', splitcontrols: [], hash: '', results: [] }));
      expect(await dataSource.getResults(123, 'M21')).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockClient.getClassResults.mockRejectedValue(new Error('API error'));
      await expect(dataSource.getResults(123, 'M21')).rejects.toThrow('API error');
    });
  });

  describe('Real-time Support', () => {
    beforeEach(createInitialized);

    it('should support real-time updates', () => {
      expect(dataSource.supportsRealTime()).toBe(true);
    });

    it('should start polling through the client', () => {
      dataSource.startPolling!(123, 'M21', 15000);

      expect(mockClient.startPolling).toHaveBeenCalledWith(expect.objectContaining({
        competitionId: 123,
        className: 'M21',
        interval: 15000
      }));
    });

    it('should stop polling with the client poll id', () => {
      dataSource.stopPolling!(123, 'M21');
      expect(mockClient.stopPolling).toHaveBeenCalledWith('123_M21');
    });
  });

  describe('Cleanup', () => {
    it('should destroy client on destroy', async () => {
      await createInitialized();
      dataSource.destroy();

      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      expect(dataSource.initialized).toBe(false);
    });

    it('should be safe to destroy multiple times', async () => {
      await createInitialized();
      dataSource.destroy();
      dataSource.destroy();

      expect(mockClient.destroy).toHaveBeenCalledTimes(2);
    });

    it('should be safe to destroy before initialization', () => {
      dataSource = new LiveResultsDataSource(createConfig());

      expect(() => dataSource.destroy()).not.toThrow();
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });
  });
});

/**
 * Integration Tests for LiveResultsDataSource
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveResultsDataSource, LiveResultsDataSourceConfig } from '../LiveResultsDataSource';
import { LiveResultsClient } from '../../LiveResultsClient';

// Mock LiveResultsClient
vi.mock('../../LiveResultsClient');

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

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock client
    mockClient = {
      getCompetitions: vi.fn(),
      getClasses: vi.fn(),
      getResults: vi.fn(),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      destroy: vi.fn()
    };

    // Mock LiveResultsClient constructor
    (LiveResultsClient as any).mockImplementation(() => mockClient);
  });

  afterEach(() => {
    if (dataSource) {
      dataSource.destroy();
    }
  });

  describe('Initialization', () => {
    it('should create instance with valid configuration', () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      expect(dataSource).toBeDefined();
      expect(dataSource.config).toEqual(config);
      expect(dataSource.initialized).toBe(false);
    });

    it('should initialize successfully', async () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      mockClient.getCompetitions.mockResolvedValue([
        { id: 1, name: 'Test Competition' }
      ]);

      await dataSource.initialize();

      expect(dataSource.initialized).toBe(true);
      expect(mockClient.getCompetitions).toHaveBeenCalledTimes(1);
    });

    it('should throw error if initialization fails', async () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      mockClient.getCompetitions.mockRejectedValue(new Error('Network error'));

      await expect(dataSource.initialize()).rejects.toThrow('Network error');
      expect(dataSource.initialized).toBe(false);
    });

    it('should pass configuration to LiveResultsClient', () => {
      const config = createConfig({
        baseUrl: 'https://custom.url',
        cacheInterval: 30000,
        timeout: 20000
      });

      dataSource = new LiveResultsDataSource(config);

      expect(LiveResultsClient).toHaveBeenCalledWith({
        baseUrl: 'https://custom.url',
        cacheInterval: 30000,
        timeout: 20000
      });
    });
  });

  describe('getCompetitions', () => {
    beforeEach(async () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      mockClient.getCompetitions.mockResolvedValue([
        { id: 1, name: 'Test Competition' }
      ]);

      await dataSource.initialize();
      vi.clearAllMocks();
    });

    it('should fetch competitions from LiveResults', async () => {
      mockClient.getCompetitions.mockResolvedValue([
        { id: 1, name: 'Competition 1', date: '2025-10-20', organizer: 'Test Club' },
        { id: 2, name: 'Competition 2', date: '2025-10-21', organizer: 'Another Club' }
      ]);

      const competitions = await dataSource.getCompetitions();

      expect(competitions).toHaveLength(2);
      expect(competitions[0]).toEqual({
        id: 1,
        name: 'Competition 1',
        date: '2025-10-20',
        organizer: 'Test Club'
      });
      expect(mockClient.getCompetitions).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no competitions', async () => {
      mockClient.getCompetitions.mockResolvedValue([]);

      const competitions = await dataSource.getCompetitions();

      expect(competitions).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockClient.getCompetitions.mockRejectedValue(new Error('API error'));

      await expect(dataSource.getCompetitions()).rejects.toThrow('API error');
    });

    it('should convert LiveResults format to normalized format', async () => {
      mockClient.getCompetitions.mockResolvedValue([
        {
          id: 123,
          name: 'Test Event',
          date: '2025-10-20',
          organizer: 'Test Organizer',
          extraField: 'should be ignored'
        }
      ]);

      const competitions = await dataSource.getCompetitions();

      expect(competitions[0]).toEqual({
        id: 123,
        name: 'Test Event',
        date: '2025-10-20',
        organizer: 'Test Organizer'
      });
      expect(competitions[0]).not.toHaveProperty('extraField');
    });
  });

  describe('getClasses', () => {
    beforeEach(async () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      mockClient.getCompetitions.mockResolvedValue([
        { id: 1, name: 'Test Competition' }
      ]);

      await dataSource.initialize();
      vi.clearAllMocks();
    });

    it('should fetch classes for a competition', async () => {
      mockClient.getClasses.mockResolvedValue([
        { name: 'M21', distance: 5000, climb: 200, numberOfControls: 15 },
        { name: 'W21', distance: 4000, climb: 150, numberOfControls: 12 }
      ]);

      const classes = await dataSource.getClasses(123);

      expect(classes).toHaveLength(2);
      expect(classes[0]).toEqual({
        name: 'M21',
        distance: 5000,
        climb: 200,
        numberOfControls: 15
      });
      expect(mockClient.getClasses).toHaveBeenCalledWith(123);
    });

    it('should return empty array when no classes', async () => {
      mockClient.getClasses.mockResolvedValue([]);

      const classes = await dataSource.getClasses(123);

      expect(classes).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockClient.getClasses.mockRejectedValue(new Error('API error'));

      await expect(dataSource.getClasses(123)).rejects.toThrow('API error');
    });
  });

  describe('getResults', () => {
    beforeEach(async () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      mockClient.getCompetitions.mockResolvedValue([
        { id: 1, name: 'Test Competition' }
      ]);

      await dataSource.initialize();
      vi.clearAllMocks();
    });

    it('should fetch results for a class', async () => {
      mockClient.getResults.mockResolvedValue([
        {
          place: 1,
          name: 'John Doe',
          club: 'Test Club',
          time: '00:30:00',
          status: 'OK',
          bibNumber: '101',
          startTime: '10:00:00',
          finishTime: '10:30:00',
          timeBehind: '00:00:00',
          splits: [
            { controlCode: '101', time: '00:05:00', timeBehind: '00:00:00', place: 1 }
          ]
        },
        {
          place: 2,
          name: 'Jane Smith',
          club: 'Another Club',
          time: '00:32:00',
          status: 'OK',
          bibNumber: '102',
          timeBehind: '00:02:00'
        }
      ]);

      const results = await dataSource.getResults(123, 'M21');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        place: 1,
        name: 'John Doe',
        club: 'Test Club',
        time: '00:30:00',
        status: 'OK',
        bibNumber: '101',
        startTime: '10:00:00',
        finishTime: '10:30:00',
        timeBehind: '00:00:00',
        splits: [
          { controlCode: '101', time: '00:05:00', timeBehind: '00:00:00', place: 1 }
        ]
      });
      expect(mockClient.getResults).toHaveBeenCalledWith(123, 'M21');
    });

    it('should handle different result statuses', async () => {
      mockClient.getResults.mockResolvedValue([
        { place: 1, name: 'Runner 1', club: 'Club 1', time: '00:30:00', status: 'OK' },
        { place: 0, name: 'Runner 2', club: 'Club 2', time: '', status: 'DNS' },
        { place: 0, name: 'Runner 3', club: 'Club 3', time: '', status: 'DNF' },
        { place: 0, name: 'Runner 4', club: 'Club 4', time: '', status: 'DSQ' },
        { place: 0, name: 'Runner 5', club: 'Club 5', time: '', status: 'MP' }
      ]);

      const results = await dataSource.getResults(123, 'M21');

      expect(results).toHaveLength(5);
      expect(results.map(r => r.status)).toEqual(['OK', 'DNS', 'DNF', 'DSQ', 'MP']);
    });

    it('should return empty array when no results', async () => {
      mockClient.getResults.mockResolvedValue([]);

      const results = await dataSource.getResults(123, 'M21');

      expect(results).toHaveLength(0);
    });

    it('should handle API errors', async () => {
      mockClient.getResults.mockRejectedValue(new Error('API error'));

      await expect(dataSource.getResults(123, 'M21')).rejects.toThrow('API error');
    });
  });

  describe('Real-time Support', () => {
    beforeEach(async () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      mockClient.getCompetitions.mockResolvedValue([
        { id: 1, name: 'Test Competition' }
      ]);

      await dataSource.initialize();
      vi.clearAllMocks();
    });

    it('should support real-time updates', () => {
      expect(dataSource.supportsRealTime()).toBe(true);
    });

    it('should start polling', () => {
      dataSource.startPolling!(123, 'M21', 15000);

      expect(mockClient.startPolling).toHaveBeenCalledWith(123, 'M21', 15000);
    });

    it('should stop polling', () => {
      dataSource.stopPolling!(123, 'M21');

      expect(mockClient.stopPolling).toHaveBeenCalledWith(123, 'M21');
    });
  });

  describe('Cleanup', () => {
    it('should destroy client on destroy', async () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      mockClient.getCompetitions.mockResolvedValue([
        { id: 1, name: 'Test Competition' }
      ]);

      await dataSource.initialize();

      dataSource.destroy();

      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      expect(dataSource.initialized).toBe(false);
    });

    it('should be safe to destroy multiple times', async () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      mockClient.getCompetitions.mockResolvedValue([
        { id: 1, name: 'Test Competition' }
      ]);

      await dataSource.initialize();

      dataSource.destroy();
      dataSource.destroy();

      expect(mockClient.destroy).toHaveBeenCalledTimes(2);
    });

    it('should be safe to destroy before initialization', () => {
      const config = createConfig();
      dataSource = new LiveResultsDataSource(config);

      expect(() => dataSource.destroy()).not.toThrow();
      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
    });
  });
});


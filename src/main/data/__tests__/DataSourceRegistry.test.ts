/**
 * Unit Tests for DataSourceRegistry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataSourceRegistry, getDataSourceRegistry } from '../DataSourceRegistry';
import { IDataSource, DataSourceConfig, Competition, Class, Result } from '../../../shared/types/dataSource';

// Mock data source implementation for testing
class MockDataSource implements IDataSource {
  readonly config: DataSourceConfig;
  private _initialized: boolean = false;
  private _destroyed: boolean = false;

  constructor(config: DataSourceConfig) {
    this.config = config;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  get destroyed(): boolean {
    return this._destroyed;
  }

  async initialize(): Promise<void> {
    if (this.config.config.shouldFailInit) {
      throw new Error('Initialization failed');
    }
    this._initialized = true;
  }

  destroy(): void {
    this._destroyed = true;
    this._initialized = false;
  }

  async getCompetitions(): Promise<Competition[]> {
    return [
      { id: 1, name: 'Test Competition 1' },
      { id: 2, name: 'Test Competition 2' }
    ];
  }

  async getClasses(competitionId: number): Promise<Class[]> {
    return [
      { name: 'M21' },
      { name: 'W21' }
    ];
  }

  async getResults(competitionId: number, className: string): Promise<Result[]> {
    return [
      {
        place: 1,
        name: 'Test Runner',
        club: 'Test Club',
        time: '00:30:00',
        status: 'OK'
      }
    ];
  }

  supportsRealTime(): boolean {
    return false;
  }
}

describe('DataSourceRegistry', () => {
  let registry: DataSourceRegistry;

  beforeEach(() => {
    // Create a fresh registry instance for each test
    registry = new DataSourceRegistry();
  });

  afterEach(() => {
    // Clean up all instances after each test
    registry.destroyAll();
  });

  describe('Factory Registration', () => {
    it('should register a data source factory', () => {
      const factory = (config: DataSourceConfig) => new MockDataSource(config);

      registry.register({
        type: 'mock',
        factory,
        displayName: 'Mock Data Source',
        description: 'A mock data source for testing'
      });

      const types = registry.getRegisteredTypes();
      expect(types).toHaveLength(1);
      expect(types[0].type).toBe('mock');
      expect(types[0].displayName).toBe('Mock Data Source');
      expect(types[0].description).toBe('A mock data source for testing');
    });

    it('should allow registering multiple factories', () => {
      const factory1 = (config: DataSourceConfig) => new MockDataSource(config);
      const factory2 = (config: DataSourceConfig) => new MockDataSource(config);

      registry.register({
        type: 'mock1',
        factory: factory1,
        displayName: 'Mock 1',
        description: 'First mock'
      });

      registry.register({
        type: 'mock2',
        factory: factory2,
        displayName: 'Mock 2',
        description: 'Second mock'
      });

      const types = registry.getRegisteredTypes();
      expect(types).toHaveLength(2);
      expect(types.map(t => t.type)).toContain('mock1');
      expect(types.map(t => t.type)).toContain('mock2');
    });

    it('should overwrite existing factory when registering same type', () => {
      const factory1 = (config: DataSourceConfig) => new MockDataSource(config);
      const factory2 = (config: DataSourceConfig) => new MockDataSource(config);

      registry.register({
        type: 'mock',
        factory: factory1,
        displayName: 'Mock 1',
        description: 'First mock'
      });

      registry.register({
        type: 'mock',
        factory: factory2,
        displayName: 'Mock 2',
        description: 'Second mock'
      });

      const types = registry.getRegisteredTypes();
      expect(types).toHaveLength(1);
      expect(types[0].displayName).toBe('Mock 2');
    });
  });

  describe('Source Creation', () => {
    beforeEach(() => {
      const factory = (config: DataSourceConfig) => new MockDataSource(config);
      registry.register({
        type: 'mock',
        factory,
        displayName: 'Mock Data Source',
        description: 'A mock data source for testing'
      });
    });

    it('should create a data source instance', async () => {
      const config: DataSourceConfig = {
        id: 'test-source',
        name: 'Test Source',
        type: 'mock',
        enabled: true,
        config: {}
      };

      const instance = await registry.create(config);

      expect(instance).toBeDefined();
      expect(instance.config.id).toBe('test-source');
      expect(instance.initialized).toBe(true);
    });

    it('should throw error for unknown data source type', async () => {
      const config: DataSourceConfig = {
        id: 'test-source',
        name: 'Test Source',
        type: 'unknown' as any,
        enabled: true,
        config: {}
      };

      await expect(registry.create(config)).rejects.toThrow('No factory registered for data source type: unknown');
    });

    it('should throw error if source with same ID already exists', async () => {
      const config: DataSourceConfig = {
        id: 'test-source',
        name: 'Test Source',
        type: 'mock',
        enabled: true,
        config: {}
      };

      await registry.create(config);

      await expect(registry.create(config)).rejects.toThrow('Data source with ID test-source already exists');
    });

    it('should propagate initialization errors', async () => {
      const config: DataSourceConfig = {
        id: 'test-source',
        name: 'Test Source',
        type: 'mock',
        enabled: true,
        config: { shouldFailInit: true }
      };

      await expect(registry.create(config)).rejects.toThrow('Initialization failed');
    });

    it('should store created instance', async () => {
      const config: DataSourceConfig = {
        id: 'test-source',
        name: 'Test Source',
        type: 'mock',
        enabled: true,
        config: {}
      };

      await registry.create(config);

      const instance = registry.get('test-source');
      expect(instance).toBeDefined();
      expect(instance?.config.id).toBe('test-source');
    });
  });

  describe('Source Retrieval', () => {
    beforeEach(async () => {
      const factory = (config: DataSourceConfig) => new MockDataSource(config);
      registry.register({
        type: 'mock',
        factory,
        displayName: 'Mock Data Source',
        description: 'A mock data source for testing'
      });

      await registry.create({
        id: 'source-1',
        name: 'Source 1',
        type: 'mock',
        enabled: true,
        config: {}
      });

      await registry.create({
        id: 'source-2',
        name: 'Source 2',
        type: 'mock',
        enabled: true,
        config: {}
      });
    });

    it('should retrieve a data source by ID', () => {
      const instance = registry.get('source-1');

      expect(instance).toBeDefined();
      expect(instance?.config.id).toBe('source-1');
      expect(instance?.config.name).toBe('Source 1');
    });

    it('should return null for non-existent ID', () => {
      const instance = registry.get('non-existent');

      expect(instance).toBeNull();
    });

    it('should retrieve all data sources', () => {
      const instances = registry.getAll();

      expect(instances).toHaveLength(2);
      expect(instances.map(i => i.config.id)).toContain('source-1');
      expect(instances.map(i => i.config.id)).toContain('source-2');
    });

    it('should return empty array when no sources exist', () => {
      registry.destroyAll();

      const instances = registry.getAll();

      expect(instances).toHaveLength(0);
    });
  });

  describe('Source Destruction', () => {
    beforeEach(async () => {
      const factory = (config: DataSourceConfig) => new MockDataSource(config);
      registry.register({
        type: 'mock',
        factory,
        displayName: 'Mock Data Source',
        description: 'A mock data source for testing'
      });

      await registry.create({
        id: 'source-1',
        name: 'Source 1',
        type: 'mock',
        enabled: true,
        config: {}
      });

      await registry.create({
        id: 'source-2',
        name: 'Source 2',
        type: 'mock',
        enabled: true,
        config: {}
      });
    });

    it('should destroy a data source by ID', () => {
      const instance = registry.get('source-1') as MockDataSource;
      expect(instance.destroyed).toBe(false);

      registry.destroy('source-1');

      expect(instance.destroyed).toBe(true);
      expect(registry.get('source-1')).toBeNull();
    });

    it('should not throw error when destroying non-existent source', () => {
      expect(() => registry.destroy('non-existent')).not.toThrow();
    });

    it('should destroy all data sources', () => {
      const instance1 = registry.get('source-1') as MockDataSource;
      const instance2 = registry.get('source-2') as MockDataSource;

      registry.destroyAll();

      expect(instance1.destroyed).toBe(true);
      expect(instance2.destroyed).toBe(true);
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance from getDataSourceRegistry', () => {
      const instance1 = getDataSourceRegistry();
      const instance2 = getDataSourceRegistry();

      expect(instance1).toBe(instance2);
    });
  });

  describe('Error Handling', () => {
    it('should handle factory errors gracefully', async () => {
      const factory = (config: DataSourceConfig) => {
        throw new Error('Factory error');
      };

      registry.register({
        type: 'error',
        factory,
        displayName: 'Error Source',
        description: 'A source that throws errors'
      });

      const config: DataSourceConfig = {
        id: 'error-source',
        name: 'Error Source',
        type: 'error',
        enabled: true,
        config: {}
      };

      await expect(registry.create(config)).rejects.toThrow('Factory error');
    });

    it('should not store instance if initialization fails', async () => {
      const factory = (config: DataSourceConfig) => new MockDataSource(config);
      registry.register({
        type: 'mock',
        factory,
        displayName: 'Mock',
        description: 'Mock'
      });

      const config: DataSourceConfig = {
        id: 'fail-source',
        name: 'Fail Source',
        type: 'mock',
        enabled: true,
        config: { shouldFailInit: true }
      };

      await expect(registry.create(config)).rejects.toThrow();

      expect(registry.get('fail-source')).toBeNull();
    });
  });
});


/**
 * Data Source Registry
 * Factory pattern for creating and managing data source instances
 */

import { getLogger } from '../utils/logger';
import {
  IDataSource,
  DataSourceConfig,
  DataSourceType,
  DataSourceRegistryEntry,
  DataSourceTypeInfo
} from '../../shared/types/dataSource';

const logger = getLogger();

/**
 * Data Source Registry
 * Singleton registry for data source factories
 */
export class DataSourceRegistry {
  private factories: Map<DataSourceType, DataSourceRegistryEntry> = new Map();
  private instances: Map<string, IDataSource> = new Map();

  /**
   * Register a data source factory
   */
  register(entry: DataSourceRegistryEntry): void {
    if (this.factories.has(entry.type)) {
      logger.warn('Data source type already registered, overwriting', { type: entry.type });
    }
    
    this.factories.set(entry.type, entry);
    logger.info('Data source type registered', {
      type: entry.type,
      displayName: entry.displayName
    });
  }

  /**
   * Unregister a data source factory
   */
  unregister(type: DataSourceType): void {
    this.factories.delete(type);
    logger.info('Data source type unregistered', { type });
  }

  /**
   * Get all registered data source types (internal - includes factory functions)
   */
  getRegisteredTypes(): DataSourceRegistryEntry[] {
    return Array.from(this.factories.values());
  }

  /**
   * Get all registered data source type info (serializable for IPC)
   */
  getRegisteredTypeInfo(): DataSourceTypeInfo[] {
    return Array.from(this.factories.values()).map(entry => ({
      type: entry.type,
      displayName: entry.displayName,
      description: entry.description
    }));
  }

  /**
   * Check if a data source type is registered
   */
  isRegistered(type: DataSourceType): boolean {
    return this.factories.has(type);
  }

  /**
   * Create a data source instance
   */
  async create(config: DataSourceConfig, initialize = true): Promise<IDataSource> {
    const entry = this.factories.get(config.type);
    
    if (!entry) {
      throw new Error(`Data source type not registered: ${config.type}`);
    }

    // Check if instance already exists
    if (this.instances.has(config.id)) {
      logger.warn('Data source instance already exists, returning existing instance', {
        id: config.id
      });
      return this.instances.get(config.id)!;
    }

    try {
      // Create new instance
      const instance = entry.factory(config);
      
      // Store the instance
      this.instances.set(config.id, instance);

      // Packaged and saved sources are registered lazily at startup so an
      // offline network cannot make them disappear from the application.
      if (initialize) {
        try {
          await instance.initialize();
        } catch (error) {
          this.instances.delete(config.id);
          instance.destroy();
          throw error;
        }
      }
      
      logger.info('Data source instance created', {
        id: config.id,
        type: config.type,
        name: config.name
      });
      
      return instance;
    } catch (error) {
      logger.error('Failed to create data source instance', {
        id: config.id,
        type: config.type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get a data source instance by ID
   */
  get(id: string): IDataSource | null {
    return this.instances.get(id) || null;
  }

  /**
   * Get all data source instances
   */
  getAll(): IDataSource[] {
    return Array.from(this.instances.values());
  }

  /**
   * Destroy a data source instance
   */
  destroy(id: string): void {
    const instance = this.instances.get(id);
    
    if (instance) {
      try {
        instance.destroy();
        this.instances.delete(id);
        
        logger.info('Data source instance destroyed', { id });
      } catch (error) {
        logger.error('Failed to destroy data source instance', {
          id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * Destroy all data source instances
   */
  destroyAll(): void {
    const ids = Array.from(this.instances.keys());
    
    for (const id of ids) {
      this.destroy(id);
    }
    
    logger.info('All data source instances destroyed');
  }

  /**
   * Clear the registry (for testing)
   */
  clear(): void {
    this.destroyAll();
    this.factories.clear();
    logger.info('Data source registry cleared');
  }
}

// Singleton instance
let registryInstance: DataSourceRegistry | null = null;

/**
 * Get the data source registry instance
 */
export function getDataSourceRegistry(): DataSourceRegistry {
  if (!registryInstance) {
    registryInstance = new DataSourceRegistry();
  }
  return registryInstance;
}

/**
 * Initialize the data source registry with default factories
 */
export function initDataSourceRegistry(): void {
  // Get registry instance to ensure it's initialized
  getDataSourceRegistry();

  // Register built-in data source types
  // LiveResults factory will be registered separately to avoid circular dependencies

  logger.info('Data source registry initialized');
}

/**
 * Destroy the data source registry
 */
export function destroyDataSourceRegistry(): void {
  if (registryInstance) {
    registryInstance.destroyAll();
    registryInstance = null;
    logger.info('Data source registry destroyed');
  }
}


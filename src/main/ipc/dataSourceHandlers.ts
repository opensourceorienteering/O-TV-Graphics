/**
 * Data Source IPC Handlers
 * Handles data source management operations
 */

import { ipcMain } from 'electron';
import { getLogger } from '../utils/logger';
import { getDataSourceRegistry } from '../data/DataSourceRegistry';
import { DataSourceConfig } from '../../shared/types/dataSource';
import { getConfig, saveConfig } from '../utils/config';
import {
  BUILT_IN_DATA_SOURCE_IDS,
  getBuiltInDataSource,
  mergeBuiltInDataSources,
} from '../../shared/builtInDataSources';

const logger = getLogger();

/**
 * Register data source IPC handlers
 */
export function registerDataSourceHandlers(): void {
  /**
   * Get all registered data source types
   */
  ipcMain.handle('dataSource:getTypes', async () => {
    try {
      const registry = getDataSourceRegistry();
      const types = registry.getRegisteredTypeInfo();

      return {
        success: true,
        data: types
      };
    } catch (error) {
      logger.error('Failed to get data source types', {
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get data source types'
      };
    }
  });

  /**
   * Get all data source instances
   */
  ipcMain.handle('dataSource:getAll', async () => {
    try {
      // Configuration is the source of truth here. Disabled and temporarily
      // offline built-ins must still be visible and selectable in setup.
      const configs = mergeBuiltInDataSources(getConfig().dataSources || []);
      
      return {
        success: true,
        data: configs
      };
    } catch (error) {
      logger.error('Failed to get data sources', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get data sources'
      };
    }
  });

  /**
   * Get a specific data source by ID
   */
  ipcMain.handle('dataSource:get', async (_event, id: string) => {
    try {
      const registry = getDataSourceRegistry();
      const instance = registry.get(id);
      
      if (!instance) {
        return {
          success: false,
          error: `Data source not found: ${id}`
        };
      }
      
      return {
        success: true,
        data: instance.config
      };
    } catch (error) {
      logger.error('Failed to get data source', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get data source'
      };
    }
  });

  /**
   * Create a new data source
   */
  ipcMain.handle('dataSource:create', async (_event, config: DataSourceConfig) => {
    try {
      if (BUILT_IN_DATA_SOURCE_IDS.has(config.id))
        throw new Error('This ID is reserved for a built-in data source');
      const registry = getDataSourceRegistry();
      const instance = await registry.create(config);

      // Persist to config file
      const appConfig = getConfig();
      if (!appConfig.dataSources) {
        appConfig.dataSources = [];
      }
      appConfig.dataSources.push(config);
      await saveConfig(appConfig);

      logger.info('Data source created and persisted via IPC', {
        id: config.id,
        type: config.type,
        name: config.name
      });

      return {
        success: true,
        data: instance.config
      };
    } catch (error) {
      logger.error('Failed to create data source', {
        config,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create data source'
      };
    }
  });

  /**
   * Update a data source configuration
   */
  ipcMain.handle('dataSource:update', async (_event, id: string, config: DataSourceConfig) => {
    try {
      const registry = getDataSourceRegistry();
      const builtIn = getBuiltInDataSource(id);
      const effectiveConfig = builtIn
        ? {
            ...builtIn,
            config: { ...builtIn.config },
            enabled: config.enabled,
          }
        : config;

      // Destroy old instance
      registry.destroy(id);

      // Create new instance with updated config
      const instance = await registry.create(effectiveConfig, !builtIn);

      // Persist to config file
      const appConfig = getConfig();
      if (!appConfig.dataSources) {
        appConfig.dataSources = [];
      }

      // Find and update the existing config, or add if not found
      const existingIndex = appConfig.dataSources.findIndex(ds => ds.id === id);
      if (existingIndex >= 0) {
        appConfig.dataSources[existingIndex] = effectiveConfig;
      } else {
        appConfig.dataSources.push(effectiveConfig);
      }

      await saveConfig(appConfig);

      logger.info('Data source updated and persisted via IPC', {
        id,
        type: effectiveConfig.type,
        name: effectiveConfig.name
      });

      return {
        success: true,
        data: instance.config
      };
    } catch (error) {
      logger.error('Failed to update data source', {
        id,
        config,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update data source'
      };
    }
  });

  /**
   * Delete a data source
   */
  ipcMain.handle('dataSource:delete', async (_event, id: string) => {
    try {
      if (BUILT_IN_DATA_SOURCE_IDS.has(id))
        throw new Error('Built-in data sources cannot be deleted');
      const registry = getDataSourceRegistry();
      registry.destroy(id);

      // Remove from config file
      const appConfig = getConfig();
      if (appConfig.dataSources) {
        appConfig.dataSources = appConfig.dataSources.filter(ds => ds.id !== id);
        await saveConfig(appConfig);
      }

      logger.info('Data source deleted and removed from config via IPC', { id });

      return {
        success: true
      };
    } catch (error) {
      logger.error('Failed to delete data source', {
        id,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete data source'
      };
    }
  });

  /**
   * Test a data source connection
   */
  ipcMain.handle('dataSource:test', async (_event, config: DataSourceConfig) => {
    try {
      const registry = getDataSourceRegistry();
      
      // Create temporary instance for testing
      const tempId = `${config.id}-test-${Date.now()}`;
      const tempConfig = { ...config, id: tempId };
      
      const instance = await registry.create(tempConfig);
      
      // Try to fetch competitions to test connection
      await instance.getCompetitions();
      
      // Clean up test instance
      registry.destroy(tempId);
      
      logger.info('Data source connection test successful', {
        type: config.type,
        name: config.name
      });
      
      return {
        success: true,
        data: { message: 'Connection successful' }
      };
    } catch (error) {
      logger.error('Data source connection test failed', {
        config,
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed'
      };
    }
  });

  /**
   * Get competitions from a specific data source
   */
  ipcMain.handle('dataSource:getCompetitions', async (_event, sourceId: string = 'liveresults-default') => {
    try {
      const registry = getDataSourceRegistry();
      const instance = registry.get(sourceId);

      if (!instance) {
        return {
          success: false,
          error: `Data source not found: ${sourceId}`
        };
      }

      if (!instance.initialized) {
        await instance.initialize();
      }

      const competitions = await instance.getCompetitions();

      return {
        success: true,
        data: competitions
      };
    } catch (error) {
      logger.error('Failed to get competitions from data source', {
        sourceId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get competitions'
      };
    }
  });

  /**
   * Get classes from a specific data source
   */
  ipcMain.handle('dataSource:getClasses', async (_event, sourceId: string, competitionId: number) => {
    try {
      logger.debug('IPC: dataSource:getClasses', { sourceId, competitionId, timestamp: Date.now() });

      const registry = getDataSourceRegistry();
      const instance = registry.get(sourceId);

      if (!instance) {
        return {
          success: false,
          error: `Data source not found: ${sourceId}`
        };
      }

      if (!instance.initialized) {
        await instance.initialize();
      }

      const classes = await instance.getClasses(competitionId);

      logger.info('Fetched classes', {
        sourceId,
        competitionId,
        count: classes.length,
        timestamp: Date.now()
      });

      return {
        success: true,
        data: classes
      };
    } catch (error) {
      logger.error('Failed to get classes from data source', {
        sourceId,
        competitionId,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get classes'
      };
    }
  });

  /**
   * Get results from a specific data source
   */
  ipcMain.handle('dataSource:getResults', async (_event, sourceId: string, competitionId: number, className: string) => {
    try {
      const registry = getDataSourceRegistry();
      const instance = registry.get(sourceId);

      if (!instance) {
        return {
          success: false,
          error: `Data source not found: ${sourceId}`
        };
      }

      if (!instance.initialized) {
        await instance.initialize();
      }

      const results = await instance.getResults(competitionId, className);

      return {
        success: true,
        data: results
      };
    } catch (error) {
      logger.error('Failed to get results from data source', {
        sourceId,
        competitionId,
        className,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get results'
      };
    }
  });

  logger.info('Data source IPC handlers registered');
}


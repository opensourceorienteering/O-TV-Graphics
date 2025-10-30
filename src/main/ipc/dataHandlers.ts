/**
 * IPC Handlers for LiveResults Data Operations
 */

import { ipcMain } from 'electron';
import { getLogger } from '../utils/logger';
import { getDataStore } from '../data/DataStore';
import { DataSourceFieldMapper } from '../data/DataSourceFieldMapper';
import { TemplateDataSourceConfig } from '../../shared/types/template-datasource';

const logger = getLogger();

/**
 * Register all data-related IPC handlers
 */
export function registerDataHandlers(): void {
  /**
   * Get list of competitions
   */
  ipcMain.handle('data:getCompetitions', async () => {
    try {
      logger.debug('IPC: data:getCompetitions - START');
      const store = getDataStore();
      logger.debug('IPC: DataStore obtained, calling loadCompetitions...');
      const competitions = await store.loadCompetitions();
      logger.debug('IPC: loadCompetitions returned', {
        count: competitions.length,
        isArray: Array.isArray(competitions),
        sample: competitions.length > 0 ? competitions[0] : null
      });
      const result = { success: true, data: competitions };
      logger.debug('IPC: data:getCompetitions - SUCCESS', { count: competitions.length });
      return result;
    } catch (error) {
      logger.error('IPC error: data:getCompetitions', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get cached competitions (no API call)
   */
  ipcMain.handle('data:getCachedCompetitions', async () => {
    try {
      logger.debug('IPC: data:getCachedCompetitions');
      const store = getDataStore();
      const competitions = store.getCompetitions();
      return { success: true, data: competitions };
    } catch (error) {
      logger.error('IPC error: data:getCachedCompetitions', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get classes for a competition
   */
  ipcMain.handle('data:getClasses', async (_event, competitionId: number) => {
    try {
      logger.debug('IPC: data:getClasses', { competitionId });
      const store = getDataStore();
      const classes = await store.loadClasses(competitionId);
      return { success: true, data: classes };
    } catch (error) {
      logger.error('IPC error: data:getClasses', {
        competitionId,
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get cached classes (no API call)
   */
  ipcMain.handle('data:getCachedClasses', async (_event, competitionId: number) => {
    try {
      logger.debug('IPC: data:getCachedClasses', { competitionId });
      const store = getDataStore();
      const classes = store.getClasses(competitionId);
      return { success: true, data: classes || [] };
    } catch (error) {
      logger.error('IPC error: data:getCachedClasses', {
        competitionId,
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get results for a class
   */
  ipcMain.handle('data:getResults', async (_event, competitionId: number, className: string) => {
    try {
      logger.debug('IPC: data:getResults', { competitionId, className });
      const store = getDataStore();
      const results = await store.loadResults(competitionId, className);
      return { success: true, data: results };
    } catch (error) {
      logger.error('IPC error: data:getResults', {
        competitionId,
        className,
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get cached results (no API call)
   */
  ipcMain.handle('data:getCachedResults', async (_event, competitionId: number, className: string) => {
    try {
      logger.debug('IPC: data:getCachedResults', { competitionId, className });
      const store = getDataStore();
      const results = store.getResults(competitionId, className);
      return { success: true, data: results || null };
    } catch (error) {
      logger.error('IPC error: data:getCachedResults', {
        competitionId,
        className,
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get all runners for a competition (across all classes or for a specific class)
   * Used by runner search components
   */
  ipcMain.handle('data:getRunners', async (_event, params: { competitionId: number; className?: string }) => {
    try {
      logger.debug('IPC: data:getRunners', params);

      const { getLiveResultsClient } = await import('../data/LiveResultsClient');
      const client = getLiveResultsClient();

      // If className is specified, get runners from that class only
      if (params.className) {
        const result = await client.getClassResults(params.competitionId, params.className);

        const runners = (result.data.results || []).map((runner, index) => {
          // Convert start time from centiseconds to formatted string
          let startTime: string | undefined;
          if (runner.start !== undefined && runner.start !== null) {
            const startTimeSeconds = runner.start / 100;
            const hours = Math.floor(startTimeSeconds / 3600);
            const minutes = Math.floor((startTimeSeconds % 3600) / 60);
            const seconds = Math.floor(startTimeSeconds % 60);

            if (hours > 0) {
              startTime = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            } else {
              startTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
          }

          return {
            id: `${params.competitionId}_${params.className}_${index}`,
            name: runner.name,
            bib: runner.place || '', // Note: LiveResults API doesn't provide bib numbers, using place as fallback
            club: runner.club || '',
            className: params.className,
            startTime
          };
        });

        return { success: true, data: runners };
      }

      // Otherwise, get runners from all classes
      const classesResult = await client.getClasses(params.competitionId);
      const allRunners: Array<{
        id: string;
        name: string;
        bib: string;
        club: string;
        className: string;
        startTime?: string;
      }> = [];

      // Fetch runners from each class
      for (const classObj of classesResult.data) {
        try {
          const result = await client.getClassResults(params.competitionId, classObj.className);

          const runners = (result.data.results || []).map((runner, index) => {
            // Convert start time from centiseconds to formatted string
            let startTime: string | undefined;
            if (runner.start !== undefined && runner.start !== null) {
              const startTimeSeconds = runner.start / 100;
              const hours = Math.floor(startTimeSeconds / 3600);
              const minutes = Math.floor((startTimeSeconds % 3600) / 60);
              const seconds = Math.floor(startTimeSeconds % 60);

              if (hours > 0) {
                startTime = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
              } else {
                startTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
              }
            }

            return {
              id: `${params.competitionId}_${classObj.className}_${index}`,
              name: runner.name,
              bib: runner.place || '', // Note: LiveResults API doesn't provide bib numbers, using place as fallback
              club: runner.club || '',
              className: classObj.className,
              startTime
            };
          });

          allRunners.push(...runners);
        } catch (error) {
          logger.warn('Failed to fetch runners for class', {
            competitionId: params.competitionId,
            className: classObj.className,
            error: (error as Error).message
          });
        }
      }

      return { success: true, data: allRunners };
    } catch (error) {
      logger.error('IPC error: data:getRunners', {
        params,
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get raw class results (including splitcontrols array)
   * Used by ControlPointSelector to fetch available split controls
   */
  ipcMain.handle('data:getClassResults', async (_event, params: { competitionId: number; className: string }) => {
    try {
      logger.debug('IPC: data:getClassResults START', {
        competitionId: params?.competitionId,
        className: params?.className,
        paramsType: typeof params
      });

      if (!params || !params.competitionId || !params.className) {
        logger.error('IPC: data:getClassResults - Invalid parameters', { params });
        return {
          success: false,
          error: 'Missing required parameters: competitionId and className'
        };
      }

      const { getLiveResultsClient } = await import('../data/LiveResultsClient');
      const client = getLiveResultsClient();

      logger.debug('IPC: data:getClassResults - Client obtained, fetching results...');
      const result = await client.getClassResults(params.competitionId, params.className);

      logger.debug('IPC: data:getClassResults - Result received', {
        hasData: !!result?.data,
        dataType: typeof result?.data,
        hasSplitControls: !!result?.data?.splitcontrols,
        splitControlsType: typeof result?.data?.splitcontrols,
        splitControlsIsArray: Array.isArray(result?.data?.splitcontrols)
      });

      if (!result || !result.data) {
        logger.error('IPC: data:getClassResults - No data in result', { result });
        return {
          success: false,
          error: 'No data returned from API'
        };
      }

      // Validate and log splitcontrols data
      const splitControls = result.data.splitcontrols || [];
      if (Array.isArray(splitControls) && splitControls.length > 0) {
        logger.debug('IPC: data:getClassResults - Split controls sample', {
          count: splitControls.length,
          firstItemType: typeof splitControls[0],
          firstItem: splitControls[0],
          allTypes: splitControls.map((sc: any) => typeof sc)
        });
      }

      const response = { success: true, data: result.data };
      logger.debug('IPC: data:getClassResults SUCCESS', {
        splitControlsCount: splitControls.length
      });
      return response;
    } catch (error) {
      logger.error('IPC error: data:getClassResults', {
        competitionId: params?.competitionId,
        className: params?.className,
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Start polling for results
   */
  ipcMain.handle('data:startPolling', async (
    _event,
    competitionId: number,
    className: string,
    interval?: number
  ) => {
    try {
      logger.debug('IPC: data:startPolling', { competitionId, className, interval });
      const store = getDataStore();
      const pollId = store.startPolling(competitionId, className, interval);
      return { success: true, pollId };
    } catch (error) {
      logger.error('IPC error: data:startPolling', {
        competitionId,
        className,
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Stop polling for results
   */
  ipcMain.handle('data:stopPolling', async (
    _event,
    competitionId: number,
    className: string
  ) => {
    try {
      logger.debug('IPC: data:stopPolling', { competitionId, className });
      const store = getDataStore();
      store.stopPolling(competitionId, className);
      return { success: true };
    } catch (error) {
      logger.error('IPC error: data:stopPolling', {
        competitionId,
        className,
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Stop all polling
   */
  ipcMain.handle('data:stopAllPolling', async () => {
    try {
      logger.debug('IPC: data:stopAllPolling');
      const store = getDataStore();
      store.stopAllPolling();
      return { success: true };
    } catch (error) {
      logger.error('IPC error: data:stopAllPolling', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get polling status
   */
  ipcMain.handle('data:getPollingStatus', async (
    _event,
    competitionId?: number,
    className?: string
  ) => {
    try {
      logger.debug('IPC: data:getPollingStatus', { competitionId, className });
      const store = getDataStore();
      const status = store.getPollingStatus(competitionId, className);
      return { success: true, data: status };
    } catch (error) {
      logger.error('IPC error: data:getPollingStatus', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get data store statistics
   */
  ipcMain.handle('data:getStats', async () => {
    try {
      logger.debug('IPC: data:getStats');
      const store = getDataStore();
      const stats = store.getStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error('IPC error: data:getStats', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Clear data store cache
   */
  ipcMain.handle('data:clearCache', async () => {
    try {
      logger.debug('IPC: data:clearCache');
      const store = getDataStore();
      store.clear();
      return { success: true };
    } catch (error) {
      logger.error('IPC error: data:clearCache', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Clear transformed data cache
   */
  ipcMain.handle('data:clearTransformedCache', async (
    _event,
    competitionId?: number,
    className?: string
  ) => {
    try {
      logger.debug('IPC: data:clearTransformedCache', { competitionId, className });
      const store = getDataStore();
      store.clearTransformedCache(competitionId, className);
      return { success: true };
    } catch (error) {
      logger.error('IPC error: data:clearTransformedCache', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get transformed cache statistics
   */
  ipcMain.handle('data:getTransformedCacheStats', async () => {
    try {
      logger.debug('IPC: data:getTransformedCacheStats');
      const store = getDataStore();
      const stats = store.getTransformedCacheStats();
      return { success: true, data: stats };
    } catch (error) {
      logger.error('IPC error: data:getTransformedCacheStats', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Fetch and map data using datasource configuration (for preview)
   */
  ipcMain.handle('data:fetchMappedData', async (
    _event,
    params: {
      dataSourceConfig: TemplateDataSourceConfig;
      competitionId: number;
      dataSourceValues: Record<string, any>;
      rundownSettings?: {
        competitionNameOverride?: string;
        raceLocation?: string;
      };
      dataSourceId?: string;
    }
  ) => {
    try {
      logger.debug('IPC: data:fetchMappedData', {
        mode: params.dataSourceConfig.mode,
        competitionId: params.competitionId,
        dataSourceValues: params.dataSourceValues,
        dataSourceId: params.dataSourceId
      });

      const mappedData = await DataSourceFieldMapper.fetchAndMapData(
        params.dataSourceConfig,
        params.competitionId,
        params.dataSourceValues,
        params.rundownSettings,
        params.dataSourceId
      );

      return {
        success: true,
        data: mappedData
      };
    } catch (error) {
      logger.error('IPC error: data:fetchMappedData', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  logger.info('Data IPC handlers registered');
}


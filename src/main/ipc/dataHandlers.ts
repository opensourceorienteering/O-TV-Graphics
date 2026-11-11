/**
 * IPC Handlers for LiveResults Data Operations
 */

import { ipcMain } from 'electron';
import { getLogger } from '../utils/logger';
import { getDataStore } from '../data/DataStore';
import { getDefaultTimingHub } from '../data/timing/defaultHub';
import { ResultsTransformer } from '../data/ResultsTransformer';
import { wallClockCs, type CompetitionInfo } from '../data/timing/model';
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
   * Runners of a class, or of every class (runner search). Uses the application-wide hub.
   */
  ipcMain.handle('data:getRunners', async (_event, params: { competitionId: number; className?: string }) => {
    try {
      const client = getDefaultTimingHub();
      let info: CompetitionInfo | undefined;
      try { info = await client.getCompetitionInfo(params.competitionId); } catch { info = undefined; }
      const classNames = params.className
        ? [params.className]
        : (await client.getClasses(params.competitionId)).data.map(c => c.className);
      const runners: Array<{ id: string; name: string; bib: string; club: string; className: string; startTime?: string }> = [];
      for (const className of classNames) {
        try {
          const result = await client.getClassResults(params.competitionId, className);
          result.data.rows.forEach((row, index) => {
            const cs = info ? wallClockCs(info, row.start) : 0;
            runners.push({
              id: `${params.competitionId}_${className}_${index}`,
              name: row.name,
              bib: row.bib ?? '',
              club: row.club || '',
              className,
              ...(cs ? { startTime: ResultsTransformer.formatTime(cs / 100) } : {})
            });
          });
        } catch (error) {
          if (params.className) throw error;
          logger.warn('Failed to fetch runners for class', { competitionId: params.competitionId, className, error: (error as Error).message });
        }
      }
      return { success: true, data: runners };
    } catch (error) {
      logger.error('IPC error: data:getRunners', { params, error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * A class's standings and radio controls (ClassResults). Uses the application-wide hub.
   */
  ipcMain.handle('data:getClassResults', async (_event, params: { competitionId: number; className: string }) => {
    try {
      if (!params || !params.competitionId || !params.className) {
        return { success: false, error: 'Missing required parameters: competitionId and className' };
      }
      const result = await getDefaultTimingHub().getClassResults(params.competitionId, params.className);
      return { success: true, data: result.data };
    } catch (error) {
      logger.error('IPC error: data:getClassResults', {
        competitionId: params?.competitionId,
        className: params?.className,
        error: (error as Error).message
      });
      return { success: false, error: (error as Error).message };
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


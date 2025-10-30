/**
 * System Status IPC Handlers
 * Provides aggregated system status information for the dashboard
 */

import { ipcMain } from 'electron';
import { getLogger } from '../utils/logger';
import { getWebServer } from '../output/WebServer';
import { getWebSocketServer } from '../data/WebSocketServer';
import { ndiOutputManager } from '../output/NDIOutputManager';
import { checkNDIAvailability } from '../utils/ndi-check';
import { getDataStore } from '../data/DataStore';
import { getDataSourceRegistry } from '../data/DataSourceRegistry';

const logger = getLogger();

export interface SystemStatus {
  webSocket: {
    running: boolean;
    port: number;
    clientCount: number;
  };
  webServer: {
    running: boolean;
    port: number;
  };
  liveResults: {
    configured: boolean;
    connected: boolean;
    activePolls: number;
    competitionsLoaded: number;
  };
  ndi: {
    available: boolean;
    active: boolean;
    version?: string;
    error?: string;
  };
}

/**
 * Register system status IPC handlers
 */
export function registerSystemHandlers() {
  /**
   * Get comprehensive system status
   */
  ipcMain.handle('system:getStatus', async () => {
    try {
      logger.debug('IPC: system:getStatus');

      // WebSocket Server Status
      const wsServer = getWebSocketServer();
      const wsStatus = {
        running: wsServer !== null,
        port: 5656, // Default port, could be made configurable
        clientCount: wsServer ? wsServer.getClientCount() : 0
      };

      // Web Server Status
      const webServer = getWebServer();
      const webStatus = {
        running: webServer.isRunning(),
        port: webServer.getPort()
      };

      // LiveResults Status
      const dataStore = getDataStore();
      const dataStats = dataStore.getStats();
      const pollingStatus = dataStore.getPollingStatus();
      
      // Check if any data sources are configured
      const registry = getDataSourceRegistry();
      const dataSources = registry.getAll();
      const liveResultsSources = dataSources.filter(ds => ds.config.type === 'liveresults');
      
      const liveResultsStatus = {
        configured: liveResultsSources.length > 0,
        connected: liveResultsSources.some(ds => ds.initialized),
        activePolls: pollingStatus.filter(p => p.active).length,
        competitionsLoaded: dataStats.competitions
      };

      // NDI Status
      const ndiAvailability = checkNDIAvailability();
      const ndiStatus = ndiOutputManager.getStatus();
      const ndiInfo = {
        available: ndiAvailability.available,
        active: ndiStatus.active,
        version: ndiAvailability.version,
        error: ndiAvailability.error
      };

      const status: SystemStatus = {
        webSocket: wsStatus,
        webServer: webStatus,
        liveResults: liveResultsStatus,
        ndi: ndiInfo
      };

      return {
        success: true,
        data: status
      };
    } catch (error) {
      logger.error('IPC error: system:getStatus', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  logger.info('System IPC handlers registered');
}


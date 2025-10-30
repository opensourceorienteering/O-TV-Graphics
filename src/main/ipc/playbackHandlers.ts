/**
 * Playback IPC Handlers
 * Handles IPC communication for graphics playback
 */

import { ipcMain } from 'electron';
import { getLogger } from '../utils/logger';
import { getPlaybackEngine } from '../playback/PlaybackEngine';

const logger = getLogger();

/**
 * IPC Response interface
 */
interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Register playback IPC handlers
 */
export function registerPlaybackHandlers() {
  /**
   * Play rundown item
   */
  ipcMain.handle('playback:play', async (_event, projectId: string, rundownId: string, itemId: string): Promise<IPCResponse> => {
    logger.debug('IPC: playback:play', { projectId, rundownId, itemId });

    try {
      const playbackEngine = getPlaybackEngine();
      await playbackEngine.playItem(projectId, rundownId, itemId);

      return {
        success: true,
        data: { itemId }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('IPC: playback:play failed', { error: message });

      return {
        success: false,
        error: message
      };
    }
  });

  /**
   * Stop rundown item
   */
  ipcMain.handle('playback:stop', async (_event, projectId: string, rundownId: string, itemId: string): Promise<IPCResponse> => {
    logger.debug('IPC: playback:stop', { projectId, rundownId, itemId });

    try {
      const playbackEngine = getPlaybackEngine();
      await playbackEngine.stopItem(projectId, rundownId, itemId);

      return {
        success: true,
        data: { itemId }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('IPC: playback:stop failed', { error: message });

      return {
        success: false,
        error: message
      };
    }
  });

  /**
   * Update rundown item data
   */
  ipcMain.handle('playback:update', async (_event, projectId: string, rundownId: string, itemId: string, data: any): Promise<IPCResponse> => {
    logger.debug('IPC: playback:update', { projectId, rundownId, itemId });

    try {
      const playbackEngine = getPlaybackEngine();
      await playbackEngine.updateItem(projectId, rundownId, itemId, data);

      return {
        success: true,
        data: { itemId }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('IPC: playback:update failed', { error: message });

      return {
        success: false,
        error: message
      };
    }
  });

  /**
   * Advance to next step in multi-step graphic
   */
  ipcMain.handle('playback:next', async (_event, projectId: string, rundownId: string, itemId: string): Promise<IPCResponse> => {
    logger.debug('IPC: playback:next', { projectId, rundownId, itemId });

    try {
      const playbackEngine = getPlaybackEngine();
      await playbackEngine.nextItem(projectId, rundownId, itemId);

      return {
        success: true,
        data: { itemId }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('IPC: playback:next failed', { error: message });

      return {
        success: false,
        error: message
      };
    }
  });

  /**
   * Go back to previous step in multi-step graphic
   */
  ipcMain.handle('playback:previous', async (_event, projectId: string, rundownId: string, itemId: string): Promise<IPCResponse> => {
    logger.debug('IPC: playback:previous', { projectId, rundownId, itemId });

    try {
      const playbackEngine = getPlaybackEngine();
      await playbackEngine.previousItem(projectId, rundownId, itemId);

      return {
        success: true,
        data: { itemId }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('IPC: playback:previous failed', { error: message });

      return {
        success: false,
        error: message
      };
    }
  });

  /**
   * Clear all graphics
   */
  ipcMain.handle('playback:clear', async (_event): Promise<IPCResponse> => {
    // Log with stack trace to identify caller
    const stack = new Error().stack;
    logger.info('IPC: playback:clear called', {
      timestamp: new Date().toISOString(),
      caller: stack?.split('\n').slice(1, 4).join('\n') || 'unknown'
    });

    try {
      const playbackEngine = getPlaybackEngine();
      await playbackEngine.clearAll();

      logger.info('IPC: playback:clear completed successfully', {
        timestamp: new Date().toISOString()
      });

      return {
        success: true
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('IPC: playback:clear failed', { error: message });

      return {
        success: false,
        error: message
      };
    }
  });

  /**
   * Get active graphics
   */
  ipcMain.handle('playback:getActive', async (_event): Promise<IPCResponse> => {
    logger.debug('IPC: playback:getActive');

    try {
      const playbackEngine = getPlaybackEngine();
      const activeGraphics = playbackEngine.getActiveGraphics();

      return {
        success: true,
        data: activeGraphics
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('IPC: playback:getActive failed', { error: message });

      return {
        success: false,
        error: message
      };
    }
  });

  logger.info('Playback IPC handlers registered');
}


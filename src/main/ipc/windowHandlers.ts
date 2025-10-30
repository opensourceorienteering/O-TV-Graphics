/**
 * Window Management IPC Handlers
 * Handles window visibility and control operations
 */

import { ipcMain, BrowserWindow, shell } from 'electron';
import { getLogger } from '../utils/logger';

const logger = getLogger();

// Store reference to graphics window
let graphicsWindow: BrowserWindow | null = null;

/**
 * Set the graphics window reference
 */
export function setGraphicsWindow(window: BrowserWindow) {
  graphicsWindow = window;
}

/**
 * Register window management IPC handlers
 */
export function registerWindowHandlers() {
  // Show graphics window
  ipcMain.handle('window:showGraphics', async () => {
    try {
      if (!graphicsWindow || graphicsWindow.isDestroyed()) {
        throw new Error('Graphics window not initialized or destroyed');
      }

      graphicsWindow.show();
      logger.info('Graphics window shown');

      return { success: true };
    } catch (error) {
      logger.error('Failed to show graphics window', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Hide graphics window
  ipcMain.handle('window:hideGraphics', async () => {
    try {
      if (!graphicsWindow || graphicsWindow.isDestroyed()) {
        throw new Error('Graphics window not initialized or destroyed');
      }

      graphicsWindow.hide();
      logger.info('Graphics window hidden');

      return { success: true };
    } catch (error) {
      logger.error('Failed to hide graphics window', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Toggle graphics window visibility
  ipcMain.handle('window:toggleGraphics', async () => {
    try {
      if (!graphicsWindow || graphicsWindow.isDestroyed()) {
        throw new Error('Graphics window not initialized or destroyed');
      }

      if (graphicsWindow.isVisible()) {
        graphicsWindow.hide();
        logger.info('Graphics window hidden (toggled)');
      } else {
        graphicsWindow.show();
        logger.info('Graphics window shown (toggled)');
      }

      return {
        success: true,
        data: { visible: graphicsWindow.isVisible() }
      };
    } catch (error) {
      logger.error('Failed to toggle graphics window', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Check if graphics window is visible
  ipcMain.handle('window:isGraphicsVisible', async () => {
    try {
      if (!graphicsWindow || graphicsWindow.isDestroyed()) {
        throw new Error('Graphics window not initialized or destroyed');
      }

      const visible = graphicsWindow.isVisible();

      return {
        success: true,
        data: { visible }
      };
    } catch (error) {
      logger.error('Failed to check graphics window visibility', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Capture graphics window screenshot
  ipcMain.handle('window:captureGraphics', async () => {
    try {
      if (!graphicsWindow || graphicsWindow.isDestroyed()) {
        throw new Error('Graphics window not initialized or destroyed');
      }

      if (!graphicsWindow.isVisible()) {
        return {
          success: false,
          error: 'Graphics window is not visible'
        };
      }

      // Capture the page
      const image = await graphicsWindow.webContents.capturePage();
      const dataUrl = image.toDataURL();

      return {
        success: true,
        data: {
          dataUrl,
          size: image.getSize()
        }
      };
    } catch (error) {
      logger.error('Failed to capture graphics window', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  // Open external URL in default browser
  ipcMain.handle('window:openExternal', async (_event, url: string) => {
    try {
      logger.debug('Opening external URL', { url });

      // Validate URL to prevent security issues
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error('Invalid URL protocol. Only http:// and https:// are allowed.');
      }

      await shell.openExternal(url);
      logger.info('External URL opened', { url });

      return { success: true };
    } catch (error) {
      logger.error('Failed to open external URL', { error, url });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  });

  logger.info('Window IPC handlers registered');
}


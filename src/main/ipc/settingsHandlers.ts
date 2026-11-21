/**
 * Settings IPC Handlers
 * Handles IPC communication for application settings
 */

import { ipcMain } from 'electron';
import { getLogger } from '../utils/logger';
import { getConfig, saveConfig, AppConfig } from '../utils/config';
import { cleanRemoteAccess, generateAccessKey, type RemoteAccessSettings } from '../security/accessKey';
import { getWebSocketServer } from '../data/WebSocketServer';
import path from 'path';
import { mergeBuiltInDataSources } from '../../shared/builtInDataSources';
import { findTemplateManager } from '../templates/OGrafManager';
import { normalizeAllowedOrigin } from '../security/csp';
import { graphicsRulesChanged } from '../security/rulesReload';
import { blockedList, clearBlocked, recordBlocked } from '../security/blocked';

const logger = getLogger();

/**
 * Standard IPC response format
 */
interface IPCResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Validate configuration updates
 */
function validateConfig(updates: Partial<AppConfig>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate general settings
  if (updates.general) {
    const { port, wsPort, loglevel, resolution } = updates.general;

    if (port !== undefined) {
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        errors.push('Port must be between 1024 and 65535');
      }
    }

    if (wsPort !== undefined) {
      if (!Number.isInteger(wsPort) || wsPort < 1024 || wsPort > 65535) {
        errors.push('WebSocket port must be between 1024 and 65535');
      }
    }

    if (loglevel !== undefined) {
      const validLevels = ['error', 'warn', 'info', 'verbose', 'debug'];
      if (!validLevels.includes(loglevel)) {
        errors.push(`Log level must be one of: ${validLevels.join(', ')}`);
      }
    }

    if (resolution !== undefined) {
      const validResolutions = ['HD', '4K', 'AUTO'];
      if (!validResolutions.includes(resolution)) {
        errors.push(`Resolution must be one of: ${validResolutions.join(', ')}`);
      }
    }
  }

  // Validate NDI settings
  if (updates.output?.ndi) {
    const { fps } = updates.output.ndi;

    if (fps !== undefined) {
      const validFps = [25, 30, 50, 60];
      if (!validFps.includes(fps)) {
        errors.push(`NDI FPS must be one of: ${validFps.join(', ')}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if settings require application restart
 */
function requiresRestart(current: AppConfig, updates: Partial<AppConfig>): boolean {
  const fields = ['port', 'wsPort', 'dataroot', 'logfolder', 'resolution'] as const;
  return fields.some(key => updates.general?.[key] !== undefined && updates.general[key] !== current.general[key]) ||
    (updates.output?.web?.cors !== undefined && updates.output.web.cors !== current.output.web.cors);
}

/**
 * Deep merge configuration objects
 */
function mergeConfig(current: AppConfig, updates: Partial<AppConfig>): AppConfig {
  return {
    general: { ...current.general, ...updates.general },
    liveresults: current.liveresults, // Keep existing liveresults for backward compatibility (read-only)
    dataSources: mergeBuiltInDataSources(
      updates.dataSources !== undefined ? updates.dataSources : current.dataSources,
    ),
    eventor: updates.eventor !== undefined ? updates.eventor : current.eventor,
    // Changed only through clubNames:set, so a settings page saving a stale copy cannot drop names
    clubNames: current.clubNames,
    // Changed only through graphicsAccess:set, for the same reason
    graphicsAllowedOrigins: current.graphicsAllowedOrigins,
    // Changed only through remoteAccess:set / remoteAccess:regenerate
    remoteAccess: current.remoteAccess,
    output: {
      ndi: { ...current.output.ndi, ...updates.output?.ndi },
      web: { ...current.output.web, ...updates.output?.web }
    }
  };
}

/**
 * Register settings IPC handlers
 */
export function registerSettingsHandlers() {
  // Settings → Internet access for graphics: addresses graphics may load from
  ipcMain.handle('graphicsAccess:get', async (): Promise<IPCResponse<string[]>> => {
    return { success: true, data: getConfig().graphicsAllowedOrigins ?? [] };
  });

  // What graphics tried to reach and were refused (Settings → Internet access → Blocked recently)
  ipcMain.handle('graphicsAccess:blocked', async () => ({ success: true, data: blockedList(getConfig().graphicsAllowedOrigins ?? []) }));
  // Preview frames report through the operator UI, which has the IPC bridge
  ipcMain.handle('graphicsAccess:reportBlocked', async (_event, report: unknown) => {
    recordBlocked(report);
    return { success: true };
  });
  ipcMain.handle('graphicsAccess:clearBlocked', async () => {
    clearBlocked();
    return { success: true };
  });

  ipcMain.handle('graphicsAccess:set', async (_event, list: unknown): Promise<IPCResponse<{ saved: string[]; rejected: Array<{ input: string; reason: string }> }>> => {
    try {
      const saved = new Set<string>();
      const rejected: Array<{ input: string; reason: string }> = [];
      for (const input of Array.isArray(list) ? list : []) {
        const result = normalizeAllowedOrigin(String(input));
        if (result.ok) saved.add(result.value);
        else rejected.push({ input: String(input), reason: result.reason });
      }
      const sorted = [...saved].sort();
      await saveConfig({ ...getConfig(), graphicsAllowedOrigins: sorted });
      logger.info('Graphics internet allowlist saved', { count: sorted.length, rejected: rejected.length });
      graphicsRulesChanged();
      return { success: true, data: { saved: sorted, rejected } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  /**
   * Get current configuration
   */
  // --- Remote access: the key other computers need (see security/accessKey.ts) ---

  const saveRemoteAccess = async (next: RemoteAccessSettings) => {
    await saveConfig({ ...getConfig(), remoteAccess: next });
    // Other computers connected under the old rules and no longer allowed are disconnected
    getWebSocketServer()?.dropUnauthorised();
    logger.info('Remote access changed', { requireKey: next.requireKey });
    return { success: true, data: next };
  };
  const currentRemoteAccess = () => cleanRemoteAccess(getConfig().remoteAccess).value;

  ipcMain.handle('remoteAccess:get', async () => ({ success: true, data: currentRemoteAccess() }));

  ipcMain.handle('remoteAccess:set', async (_event, update: { requireKey?: unknown }) => {
    try {
      // Anything but an explicit false keeps the key required
      return await saveRemoteAccess({ ...currentRemoteAccess(), requireKey: update?.requireKey !== false });
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('remoteAccess:regenerate', async () => {
    try {
      return await saveRemoteAccess({ ...currentRemoteAccess(), key: generateAccessKey() });
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('settings:get', async (): Promise<IPCResponse<AppConfig>> => {
    try {
      logger.debug('IPC: settings:get');
      
      const config = getConfig();
      
      return {
        success: true,
        data: config
      };
    } catch (error) {
      logger.error('IPC error: settings:get', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Update configuration
   */
  ipcMain.handle('settings:update', async (_event, updates: Partial<AppConfig>): Promise<IPCResponse<{ requiresRestart: boolean }>> => {
    try {
      logger.debug('IPC: settings:update', { fields: Object.keys(updates ?? {}) });

      // Validate updates
      const validation = validateConfig(updates);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.errors.join('; ')
        };
      }

      // Get current config
      const currentConfig = getConfig();

      // Merge updates
      const newConfig = mergeConfig(currentConfig, updates);

      // Save to file
      await saveConfig(newConfig);

      // Check if restart is required
      const needsRestart = requiresRestart(currentConfig, updates);

      logger.info('Configuration updated', {
        requiresRestart: needsRestart,
        updatedFields: Object.keys(updates)
      });

      return {
        success: true,
        data: { requiresRestart: needsRestart }
      };
    } catch (error) {
      logger.error('IPC error: settings:update', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Reset configuration to defaults
   */
  ipcMain.handle('settings:reset', async (): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: settings:reset');

      // This would require importing DEFAULT_CONFIG from config.ts
      // For now, we'll just return an error suggesting manual deletion
      return {
        success: false,
        error: 'Reset not implemented. Please delete config.json and restart the application.'
      };
    } catch (error) {
      logger.error('IPC error: settings:reset', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  /**
   * Get application paths
   */
  ipcMain.handle('settings:getPaths', async (): Promise<IPCResponse<{
    configPath: string;
    dataroot: string;
    logfolder: string;
    templatesDir: string;
  }>> => {
    try {
      logger.debug('IPC: settings:getPaths');
      
      const config = getConfig();
      
      return {
        success: true,
        data: {
          configPath: path.join(process.cwd(), 'config.json'),
          dataroot: config.general.dataroot,
          logfolder: config.general.logfolder,
          // Where imported looks go; the built-in ones are inside the app
          templatesDir: findTemplateManager()?.getUserDirectory() || path.join(config.general.dataroot, 'templates')
        }
      };
    } catch (error) {
      logger.error('IPC error: settings:getPaths', {
        error: (error as Error).message
      });
      return {
        success: false,
        error: (error as Error).message
      };
    }
  });

  logger.info('Settings IPC handlers registered');
}


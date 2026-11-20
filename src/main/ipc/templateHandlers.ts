/**
 * IPC Handlers for Template Operations
 * Handles communication between renderer and main process for templates
 */

import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import { getTemplateManager } from '../templates/OGrafManager';
import {
  exportLookZip,
  lookFileName,
  importTemplateZip,
  previewTemplateZip,
  removeAddition,
  removeImportedLook,
} from '../templates/TemplatePackages';
import { listEvents } from '../events/EventService';
import { logger } from '../utils/logger';
import { getConfig, saveConfig } from '../utils/config';
import { normalizeAllowedOrigin } from '../security/csp';
import { PickedFile } from '../security/callers';
import { graphicsRulesChanged } from '../security/rulesReload';

const pickedImport = new PickedFile();
import { SYSTEM_TEMPLATE_SET } from '../../shared/types/ograf';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Unknown error');

/**
 * Register all template IPC handlers
 */
export function registerTemplateHandlers(): void {
  /**
   * Get all templates
   */
  ipcMain.handle('templates:getAll', async () => {
    try {
      const manager = getTemplateManager();
      // system tools (the output test pattern) are not graphics to pick from
      const templates = manager.getAllTemplates().filter(t => t.setId !== SYSTEM_TEMPLATE_SET);

      // Debug: Check if datasource configs are present
      const templatesWithDataSource = templates.filter(t => t.dataSourceConfig).length;
      logger.info('Templates retrieved for IPC', {
        count: templates.length,
        withDataSource: templatesWithDataSource,
        sampleTemplate: templates[0] ? {
          id: templates[0].manifest.id,
          hasDataSourceConfig: !!templates[0].dataSourceConfig,
          dataSourceMode: templates[0].dataSourceConfig?.mode
        } : null
      });

      return {
        success: true,
        templates
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get templates', { error: message });

      return {
        success: false,
        error: message
      };
    }
  });

  /** Template sets (a project uses one set; graphics of other sets are not offered) */
  ipcMain.handle('templates:getSets', async () => {
    try {
      return { success: true, sets: getTemplateManager().getTemplateSets() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Get template by ID
   */
  ipcMain.handle('templates:getById', async (_event, id: string) => {
    try {
      const manager = getTemplateManager();
      const template = manager.getTemplateById(id);
      
      if (!template) {
        return {
          success: false,
          error: `Template not found: ${id}`
        };
      }
      
      logger.debug('Template retrieved', { id });
      
      return {
        success: true,
        template
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get template', { id, error: message });
      
      return {
        success: false,
        error: message
      };
    }
  });

  /**
   * Reload templates
   */
  ipcMain.handle('templates:reload', async () => {
    try {
      const manager = getTemplateManager();
      
      // Clear cache and rediscover
      manager.clearCache();
      const result = await manager.discoverTemplates();
      
      logger.info('Templates reloaded', { 
        found: result.templatesFound,
        errors: result.errors.length 
      });
      
      return {
        success: true,
        templatesFound: result.templatesFound,
        errors: result.errors
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to reload templates', { error: message });
      
      return {
        success: false,
        error: message
      };
    }
  });

  /**
   * Get cache statistics
   */
  ipcMain.handle('templates:getCacheStats', async () => {
    try {
      const manager = getTemplateManager();
      const stats = manager.getCacheStats();
      
      return {
        success: true,
        stats
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to get cache stats', { error: message });
      
      return {
        success: false,
        error: message
      };
    }
  });

  // --- import / export looks as .splitlook (zip) files ---

  /** Choose a zip and describe what importing it would do (nothing is installed yet) */
  ipcMain.handle('templates:pickImport', async (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options: Electron.OpenDialogOptions = {
        title: 'Import look',
        properties: ['openFile'],
        filters: [{ name: 'Look or OGraf graphic (.splitlook, .zip)', extensions: ['splitlook', 'zip'] }],
      };
      const pick = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (pick.canceled || !pick.filePaths[0]) return { success: true, cancelled: true };
      const filePath = pick.filePaths[0];
      const preview = previewTemplateZip(getTemplateManager(), fs.readFileSync(filePath), getConfig().graphicsAllowedOrigins ?? []);
      pickedImport.remember(filePath);
      return { success: true, filePath, preview };
    } catch (error) {
      logger.warn('Look import check failed', { error: errorMessage(error) });
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('templates:import', async (_event, filePath: string, allow?: unknown) => {
    try {
      // Only the file the operator just picked in the dialog, and only once
      if (!pickedImport.take(filePath)) throw new Error('Choose the file in Import look… first');
      const preview = await importTemplateZip(getTemplateManager(), fs.readFileSync(filePath));
      // Internet addresses the operator agreed to in the import confirmation
      const added = (Array.isArray(allow) ? allow : [])
        .map((entry) => normalizeAllowedOrigin(String(entry)))
        .flatMap((r) => (r.ok ? [r.value] : []));
      if (added.length) {
        const current = getConfig();
        const merged = [...new Set([...(current.graphicsAllowedOrigins ?? []), ...added])].sort();
        await saveConfig({ ...current, graphicsAllowedOrigins: merged });
        logger.info('Internet addresses allowed at import', { added });
        graphicsRulesChanged();
      }
      logger.info('Looks imported', { filePath, looks: preview.looks.map((l) => l.id), graphics: preview.graphics.length });
      return { success: true, preview };
    } catch (error) {
      logger.warn('Look import failed', { filePath, error: errorMessage(error) });
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('templates:exportSet', async (event, setId: string) => {
    try {
      const manager = getTemplateManager();
      const zip = exportLookZip(manager, setId);
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const lookName = manager.getTemplateSets().find((s) => s.id === setId)?.name || setId;
      const options: Electron.SaveDialogOptions = {
        title: 'Export look',
        defaultPath: `${lookFileName(lookName)}.splitlook`,
        filters: [{ name: 'Split Control look', extensions: ['splitlook'] }, { name: 'Zip', extensions: ['zip'] }],
      };
      const save = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (save.canceled || !save.filePath) return { success: true, cancelled: true };
      fs.writeFileSync(save.filePath, zip);
      logger.info('Look exported', { setId, filePath: save.filePath });
      return { success: true, filePath: save.filePath };
    } catch (error) {
      logger.warn('Look export failed', { setId, error: errorMessage(error) });
      return { success: false, error: errorMessage(error) };
    }
  });

  /** Names of the events that use a look */
  ipcMain.handle('templates:setUsage', async (_event, setId: string) => {
    try {
      const events = (await listEvents()).filter((e) => e.templateSet === setId).map((e) => e.name);
      return { success: true, events };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('templates:removeSet', async (_event, setId: string) => {
    try {
      await removeImportedLook(getTemplateManager(), setId);
      logger.info('Imported look removed', { setId });
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  /** Remove a graphic added to a look; a graphic it replaced comes back */
  ipcMain.handle('templates:removeAddition', async (_event, lookId: string, graphicId: string) => {
    try {
      await removeAddition(getTemplateManager(), String(lookId), String(graphicId));
      logger.info('Graphic removed from look', { lookId, graphicId });
      return { success: true };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  /** Which graphics replace which in a look (new graphic id → replaced id) */
  ipcMain.handle('templates:getReplacements', async (_event, setId: string) => {
    return { success: true, data: getTemplateManager().getReplacements(String(setId)) };
  });

  ipcMain.handle('templates:openFolder', async () => {
    const dir = getTemplateManager().getUserDirectory();
    if (!dir) return { success: false, error: 'There is no imported looks folder' };
    const error = await shell.openPath(dir);
    return error ? { success: false, error } : { success: true };
  });

  logger.info('Template IPC handlers registered');
}


/**
 * IPC Handlers for Template Operations
 * Handles communication between renderer and main process for templates
 */

import { ipcMain } from 'electron';
import { getTemplateManager } from '../templates/OGrafManager';
import { logger } from '../utils/logger';

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
      const templates = manager.getAllTemplates();

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

  logger.info('Template IPC handlers registered');
}


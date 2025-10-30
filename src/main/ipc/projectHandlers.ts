/**
 * IPC Handlers for Project and Rundown Operations
 */

import { ipcMain } from 'electron';
import { getLogger } from '../utils/logger';
import { getProjectManager, CreateProjectOptions } from '../projects/ProjectManager';
import { getRundownManager, CreateRundownOptions, CreateRundownItemOptions } from '../projects/RundownManager';
import { SPXProject, SPXRundown, SPXRundownItem } from '../../shared/types/spx';

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
 * Register all project and rundown IPC handlers
 */
export function registerProjectHandlers(): void {
  
  // ============================================================================
  // PROJECT HANDLERS
  // ============================================================================
  
  /**
   * Create a new project
   */
  ipcMain.handle('project:create', async (_event, options: CreateProjectOptions): Promise<IPCResponse<SPXProject>> => {
    try {
      logger.debug('IPC: project:create', { name: options.name });
      const projectManager = getProjectManager();
      const project = await projectManager.createProject(options);
      logger.info('IPC: project:create success', { projectId: project.id });
      return { success: true, data: project };
    } catch (error) {
      logger.error('IPC: project:create failed', { error, options });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Load a project
   */
  ipcMain.handle('project:load', async (_event, projectId: string): Promise<IPCResponse<SPXProject>> => {
    try {
      logger.debug('IPC: project:load', { projectId });
      const projectManager = getProjectManager();
      const project = await projectManager.loadProject(projectId);
      logger.info('IPC: project:load success', { projectId });
      return { success: true, data: project };
    } catch (error) {
      logger.error('IPC: project:load failed', { error, projectId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update a project
   */
  ipcMain.handle('project:update', async (_event, projectId: string, updates: Partial<SPXProject>): Promise<IPCResponse<SPXProject>> => {
    try {
      logger.debug('IPC: project:update', { projectId, updates: Object.keys(updates) });
      const projectManager = getProjectManager();
      const project = await projectManager.updateProject(projectId, updates);
      logger.info('IPC: project:update success', { projectId });
      return { success: true, data: project };
    } catch (error) {
      logger.error('IPC: project:update failed', { error, projectId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Delete a project
   */
  ipcMain.handle('project:delete', async (_event, projectId: string): Promise<IPCResponse<void>> => {
    try {
      logger.debug('IPC: project:delete', { projectId });
      const projectManager = getProjectManager();
      await projectManager.deleteProject(projectId);
      logger.info('IPC: project:delete success', { projectId });
      return { success: true };
    } catch (error) {
      logger.error('IPC: project:delete failed', { error, projectId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * List all projects
   */
  ipcMain.handle('project:list', async (): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: project:list');
      const projectManager = getProjectManager();
      const projects = await projectManager.listProjects();
      logger.info('IPC: project:list success', { count: projects.length });
      return { success: true, data: projects };
    } catch (error) {
      logger.error('IPC: project:list failed', { error });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // RUNDOWN HANDLERS
  // ============================================================================

  /**
   * Create a new rundown
   */
  ipcMain.handle('rundown:create', async (_event, options: CreateRundownOptions): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: rundown:create', { projectId: options.projectId, name: options.name });
      const rundownManager = getRundownManager();
      const rundown = await rundownManager.createRundown(options);
      logger.info('IPC: rundown:create success', { rundownId: rundown.id, projectId: options.projectId });
      return { success: true, data: rundown };
    } catch (error) {
      logger.error('IPC: rundown:create failed', { error, options });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Load a rundown
   *
   * NOTE: This handler does NOT automatically clear graphics.
   * Graphics should only be cleared when explicitly requested via playback:clear.
   * This allows reloading a rundown to refresh state without affecting active graphics.
   */
  ipcMain.handle('rundown:load', async (_event, projectId: string, rundownId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: rundown:load', { projectId, rundownId });

      const rundownManager = getRundownManager();
      const rundown = await rundownManager.loadRundown(projectId, rundownId);
      logger.info('IPC: rundown:load success', { rundownId, projectId });
      return { success: true, data: rundown };
    } catch (error) {
      logger.error('IPC: rundown:load failed', { error, projectId, rundownId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update a rundown
   */
  ipcMain.handle('rundown:update', async (_event, projectId: string, rundownId: string, updates: any): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: rundown:update', { projectId, rundownId, updates: Object.keys(updates) });
      const rundownManager = getRundownManager();
      const rundown = await rundownManager.updateRundown(projectId, rundownId, updates);
      logger.info('IPC: rundown:update success', { rundownId, projectId });
      return { success: true, data: rundown };
    } catch (error) {
      logger.error('IPC: rundown:update failed', { error, projectId, rundownId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Delete a rundown
   */
  ipcMain.handle('rundown:delete', async (_event, projectId: string, rundownId: string): Promise<IPCResponse<void>> => {
    try {
      logger.debug('IPC: rundown:delete', { projectId, rundownId });
      const rundownManager = getRundownManager();
      await rundownManager.deleteRundown(projectId, rundownId);
      logger.info('IPC: rundown:delete success', { rundownId, projectId });
      return { success: true };
    } catch (error) {
      logger.error('IPC: rundown:delete failed', { error, projectId, rundownId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * List rundowns for a project
   */
  ipcMain.handle('rundown:list', async (_event, projectId: string): Promise<IPCResponse> => {
    try {
      logger.debug('IPC: rundown:list', { projectId });
      const rundownManager = getRundownManager();
      const rundowns = await rundownManager.listRundowns(projectId);
      logger.info('IPC: rundown:list success', { projectId, count: rundowns.length });
      return { success: true, data: rundowns };
    } catch (error) {
      logger.error('IPC: rundown:list failed', { error, projectId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // RUNDOWN ITEM HANDLERS
  // ============================================================================

  /**
   * Add item to rundown
   */
  ipcMain.handle('rundown:addItem', async (_event, projectId: string, rundownId: string, options: CreateRundownItemOptions, index?: number): Promise<IPCResponse<SPXRundownItem>> => {
    try {
      logger.debug('IPC: rundown:addItem', { projectId, rundownId, templateId: options.templateId, index });
      const rundownManager = getRundownManager();
      const item = await rundownManager.addItem(projectId, rundownId, options, index);
      logger.info('IPC: rundown:addItem success', { rundownId, projectId, itemId: item.id });
      return { success: true, data: item };
    } catch (error) {
      logger.error('IPC: rundown:addItem failed', { error, projectId, rundownId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update rundown item
   */
  ipcMain.handle('rundown:updateItem', async (_event, projectId: string, rundownId: string, itemId: string, updates: Partial<SPXRundownItem>): Promise<IPCResponse<SPXRundownItem>> => {
    try {
      logger.debug('IPC: rundown:updateItem', { projectId, rundownId, itemId, updates: Object.keys(updates) });
      const rundownManager = getRundownManager();
      const item = await rundownManager.updateItem(projectId, rundownId, itemId, updates);
      logger.info('IPC: rundown:updateItem success', { rundownId, projectId, itemId });
      return { success: true, data: item };
    } catch (error) {
      logger.error('IPC: rundown:updateItem failed', { error, projectId, rundownId, itemId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Remove item from rundown
   */
  ipcMain.handle('rundown:removeItem', async (_event, projectId: string, rundownId: string, itemId: string): Promise<IPCResponse<void>> => {
    try {
      logger.debug('IPC: rundown:removeItem', { projectId, rundownId, itemId });
      const rundownManager = getRundownManager();
      await rundownManager.removeItem(projectId, rundownId, itemId);
      logger.info('IPC: rundown:removeItem success', { rundownId, projectId, itemId });
      return { success: true };
    } catch (error) {
      logger.error('IPC: rundown:removeItem failed', { error, projectId, rundownId, itemId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Reorder items in rundown
   */
  ipcMain.handle('rundown:reorderItems', async (_event, projectId: string, rundownId: string, itemIds: string[]): Promise<IPCResponse<void>> => {
    try {
      logger.debug('IPC: rundown:reorderItems', { projectId, rundownId, count: itemIds.length });
      const rundownManager = getRundownManager();
      await rundownManager.reorderItems(projectId, rundownId, itemIds);
      logger.info('IPC: rundown:reorderItems success', { rundownId, projectId });
      return { success: true };
    } catch (error) {
      logger.error('IPC: rundown:reorderItems failed', { error, projectId, rundownId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // ============================================================================
  // RUNDOWN CONFIGURATION HANDLERS (New Data Model)
  // ============================================================================

  /**
   * Update rundown data source configuration
   */
  ipcMain.handle('rundown:updateDataSource', async (
    _event,
    projectId: string,
    rundownId: string,
    dataSource: SPXRundown['dataSource']
  ): Promise<IPCResponse<SPXRundown>> => {
    try {
      logger.debug('IPC: rundown:updateDataSource', {
        projectId,
        rundownId,
        sourceId: dataSource?.sourceId,
        baseUrl: dataSource?.baseUrl,
        competitionId: dataSource?.competitionId
      });
      const rundownManager = getRundownManager();
      const rundown = await rundownManager.updateRundown(projectId, rundownId, { dataSource });
      logger.info('IPC: rundown:updateDataSource success', { rundownId, projectId });
      return { success: true, data: rundown };
    } catch (error) {
      logger.error('IPC: rundown:updateDataSource failed', { error, projectId, rundownId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update rundown global settings
   */
  ipcMain.handle('rundown:updateSettings', async (
    _event,
    projectId: string,
    rundownId: string,
    settings: SPXRundown['settings']
  ): Promise<IPCResponse<SPXRundown>> => {
    try {
      logger.debug('IPC: rundown:updateSettings', {
        projectId,
        rundownId,
        competitionNameOverride: settings?.competitionNameOverride,
        raceLocation: settings?.raceLocation
      });
      const rundownManager = getRundownManager();
      const rundown = await rundownManager.updateRundown(projectId, rundownId, { settings });
      logger.info('IPC: rundown:updateSettings success', { rundownId, projectId });
      return { success: true, data: rundown };
    } catch (error) {
      logger.error('IPC: rundown:updateSettings failed', { error, projectId, rundownId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  /**
   * Update rundown template allowlist
   */
  ipcMain.handle('rundown:updateAllowedTemplates', async (
    _event,
    projectId: string,
    rundownId: string,
    allowedTemplates: string[]
  ): Promise<IPCResponse<SPXRundown>> => {
    try {
      logger.debug('IPC: rundown:updateAllowedTemplates', {
        projectId,
        rundownId,
        count: allowedTemplates.length
      });
      const rundownManager = getRundownManager();
      const rundown = await rundownManager.updateRundown(projectId, rundownId, { allowedTemplates });
      logger.info('IPC: rundown:updateAllowedTemplates success', {
        rundownId,
        projectId,
        count: allowedTemplates.length
      });
      return { success: true, data: rundown };
    } catch (error) {
      logger.error('IPC: rundown:updateAllowedTemplates failed', { error, projectId, rundownId });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  logger.info('Project IPC handlers registered');
}


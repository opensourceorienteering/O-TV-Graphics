/**
 * Rundown Manager
 * Manages rundowns and rundown items within projects
 */

import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../utils/logger';
import { getProjectManager } from './ProjectManager';
import {
  SPXRundown,
  SPXRundownItem,
  SPXRundownListItem
} from '../../shared/types/spx';

const logger = getLogger();

/**
 * Rundown creation options
 */
export interface CreateRundownOptions {
  name: string;
  projectId: string;
}

/**
 * Rundown item creation options
 */
export interface CreateRundownItemOptions {
  graphicKind?: string;
  templateId: string;
  templatePath: string;
  fields?: Record<string, any>;
  layer?: string;
  out?: string;
  playbackMode?: SPXRundownItem['playbackMode'];
  autoPageDurationSeconds?: number;
  instanceName?: string;
  liveResultsData?: SPXRundownItem['liveResultsData'];
}

/**
 * Rundown Manager
 * Handles CRUD operations for rundowns and rundown items
 */
export class RundownManager {

  /**
   * Get rundown file path
   */
  private getRundownFilePath(projectId: string, rundownId: string): string {
    const projectManager = getProjectManager();
    const rundownsDir = projectManager.getRundownsDir(projectId);
    return path.join(rundownsDir, `${rundownId}.json`);
  }

  /**
   * Migrate old rundown format to new format
   * Handles backward compatibility for rundowns created before the data model update
   */
  private migrateRundown(rundown: SPXRundown): SPXRundown {
    let migrated = false;

    // Migrate liveResults to dataSource
    // NOTE: We no longer auto-assign 'liveresults-default' - users must explicitly select a data source
    // Old rundowns with liveResults config will have dataSource set to undefined, which will trigger
    // the data source selection UI when the rundown is opened
    if (rundown.liveResults && !rundown.dataSource) {
      // Mark that this rundown needs data source configuration
      // Store the old competition info for reference, but don't assign a sourceId
      rundown.dataSource = {
        sourceId: '', // Empty string indicates "needs configuration"
        baseUrl: '', // Will be set when user selects a data source
        competitionId: rundown.liveResults.competitionId,
        competitionName: rundown.liveResults.competitionName
      };
      migrated = true;
      logger.debug('Migrated liveResults to dataSource (needs user selection)', {
        rundownId: rundown.id,
        competitionId: rundown.dataSource.competitionId
      });
    }

    // Initialize empty allowedTemplates if not present
    if (rundown.allowedTemplates === undefined) {
      rundown.allowedTemplates = [];
      migrated = true;
      logger.debug('Initialized empty allowedTemplates', { rundownId: rundown.id });
    }

    // Initialize empty settings if not present
    if (!rundown.settings) {
      rundown.settings = {};
      migrated = true;
      logger.debug('Initialized empty settings', { rundownId: rundown.id });
    }

    if (migrated) {
      logger.info('Rundown migrated to new format', {
        rundownId: rundown.id,
        hasDataSource: !!rundown.dataSource,
        hasSettings: !!rundown.settings,
        allowedTemplatesCount: rundown.allowedTemplates?.length || 0
      });
    }

    return rundown;
  }

  /**
   * Create a new rundown
   */
  async createRundown(options: CreateRundownOptions): Promise<SPXRundown> {
    const rundownId = uuidv4();
    const now = Date.now();

    const rundown: SPXRundown = {
      id: rundownId,
      name: options.name,
      projectId: options.projectId,
      items: [],
      created: now,
      modified: now
    };

    try {
      // Verify project exists
      const projectManager = getProjectManager();
      if (!projectManager.projectExists(options.projectId)) {
        throw new Error(`Project not found: ${options.projectId}`);
      }

      // Ensure rundowns directory exists
      const rundownsDir = projectManager.getRundownsDir(options.projectId);
      if (!fs.existsSync(rundownsDir)) {
        fs.mkdirSync(rundownsDir, { recursive: true });
      }

      // Save rundown file
      await this.saveRundown(rundown);

      logger.info('Rundown created', { rundownId, projectId: options.projectId, name: rundown.name });
      return rundown;

    } catch (error) {
      logger.error('Failed to create rundown', { error, projectId: options.projectId, name: options.name });
      throw new Error(`Failed to create rundown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load a rundown by ID
   */
  async loadRundown(projectId: string, rundownId: string): Promise<SPXRundown> {
    try {
      const rundownPath = this.getRundownFilePath(projectId, rundownId);

      if (!fs.existsSync(rundownPath)) {
        throw new Error(`Rundown not found: ${rundownId}`);
      }

      const content = fs.readFileSync(rundownPath, 'utf-8');
      let rundown: SPXRundown = JSON.parse(content);

      // Apply migration to ensure rundown has new fields
      const originalJson = JSON.stringify(rundown);
      rundown = this.migrateRundown(rundown);

      // Save if migration occurred
      if (JSON.stringify(rundown) !== originalJson) {
        await this.saveRundown(rundown);
        logger.info('Rundown auto-migrated and saved', { rundownId, projectId });
      }

      logger.debug('Rundown loaded', { rundownId, projectId, name: rundown.name });
      return rundown;

    } catch (error) {
      logger.error('Failed to load rundown', { error, projectId, rundownId });
      throw new Error(`Failed to load rundown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save a rundown
   */
  async saveRundown(rundown: SPXRundown): Promise<void> {
    try {
      // Update modified timestamp
      rundown.modified = Date.now();

      const rundownPath = this.getRundownFilePath(rundown.projectId, rundown.id);
      const content = JSON.stringify(rundown, null, 2);

      fs.writeFileSync(rundownPath, content, 'utf-8');

      logger.debug('Rundown saved', { rundownId: rundown.id, projectId: rundown.projectId, name: rundown.name });

    } catch (error) {
      logger.error('Failed to save rundown', { error, rundownId: rundown.id, projectId: rundown.projectId });
      throw new Error(`Failed to save rundown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update rundown metadata
   */
  async updateRundown(projectId: string, rundownId: string, updates: Partial<SPXRundown>): Promise<SPXRundown> {
    try {
      const rundown = await this.loadRundown(projectId, rundownId);

      // Apply updates (excluding id, projectId, created)
      const { id, projectId: pid, created, ...allowedUpdates } = updates;
      Object.assign(rundown, allowedUpdates);

      await this.saveRundown(rundown);

      logger.info('Rundown updated', { rundownId, projectId, updates: Object.keys(allowedUpdates) });
      return rundown;

    } catch (error) {
      logger.error('Failed to update rundown', { error, projectId, rundownId });
      throw new Error(`Failed to update rundown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete a rundown
   */
  async deleteRundown(projectId: string, rundownId: string): Promise<void> {
    try {
      const rundownPath = this.getRundownFilePath(projectId, rundownId);

      if (!fs.existsSync(rundownPath)) {
        throw new Error(`Rundown not found: ${rundownId}`);
      }

      fs.unlinkSync(rundownPath);

      logger.info('Rundown deleted', { rundownId, projectId });

    } catch (error) {
      logger.error('Failed to delete rundown', { error, projectId, rundownId });
      throw new Error(`Failed to delete rundown: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * List all rundowns for a project
   */
  async listRundowns(projectId: string): Promise<SPXRundownListItem[]> {
    try {
      const projectManager = getProjectManager();
      const rundownsDir = projectManager.getRundownsDir(projectId);

      if (!fs.existsSync(rundownsDir)) {
        return [];
      }

      const files = fs.readdirSync(rundownsDir).filter(f => f.endsWith('.json'));
      const rundowns: SPXRundownListItem[] = [];

      for (const file of files) {
        try {
          const rundownId = path.basename(file, '.json');
          const rundown = await this.loadRundown(projectId, rundownId);

          rundowns.push({
            id: rundown.id,
            name: rundown.name,
            projectId: rundown.projectId,
            itemCount: rundown.items.length,
            created: rundown.created,
            modified: rundown.modified
          });
        } catch (error) {
          logger.warn('Failed to load rundown in list', { projectId, file, error });
        }
      }

      // Sort by modified date (newest first)
      rundowns.sort((a, b) => b.modified - a.modified);

      logger.debug('Rundowns listed', { projectId, count: rundowns.length });
      return rundowns;

    } catch (error) {
      logger.error('Failed to list rundowns', { error, projectId });
      throw new Error(`Failed to list rundowns: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add item to rundown
   */
  async addItem(projectId: string, rundownId: string, options: CreateRundownItemOptions, index?: number): Promise<SPXRundownItem> {
    try {
      const rundown = await this.loadRundown(projectId, rundownId);

      const item: SPXRundownItem = {
        id: uuidv4(),
        ...(options.graphicKind ? { graphicKind: options.graphicKind } : {}),
        templateId: options.templateId,
        templatePath: options.templatePath,
        fields: options.fields || {},
        onair: false,
        layer: options.layer || '1',
        out: options.out || 'animate',
        ...(options.playbackMode ? { playbackMode: options.playbackMode } : {}),
        ...(options.autoPageDurationSeconds && options.autoPageDurationSeconds > 0
          ? { autoPageDurationSeconds: options.autoPageDurationSeconds }
          : {}),
        ...(options.instanceName ? { instanceName: options.instanceName } : {}),
        ...(options.liveResultsData ? { liveResultsData: options.liveResultsData } : {})
      };

      // Insert at index or append
      if (index !== undefined && index >= 0 && index <= rundown.items.length) {
        rundown.items.splice(index, 0, item);
      } else {
        rundown.items.push(item);
      }

      await this.saveRundown(rundown);

      logger.info('Item added to rundown', { rundownId, projectId, itemId: item.id, templateId: item.templateId });
      return item;

    } catch (error) {
      logger.error('Failed to add item to rundown', { error, projectId, rundownId });
      throw new Error(`Failed to add item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update rundown item
   */
  async updateItem(projectId: string, rundownId: string, itemId: string, updates: Partial<SPXRundownItem>): Promise<SPXRundownItem> {
    try {
      const rundown = await this.loadRundown(projectId, rundownId);
      const itemIndex = rundown.items.findIndex(item => item.id === itemId);

      if (itemIndex === -1) {
        throw new Error(`Item not found: ${itemId}`);
      }

      // Apply updates (excluding id)
      const { id, ...allowedUpdates } = updates;
      Object.assign(rundown.items[itemIndex], allowedUpdates);

      await this.saveRundown(rundown);

      logger.info('Item updated', { rundownId, projectId, itemId, updates: Object.keys(allowedUpdates) });
      return rundown.items[itemIndex];

    } catch (error) {
      logger.error('Failed to update item', { error, projectId, rundownId, itemId });
      throw new Error(`Failed to update item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Remove item from rundown
   */
  async removeItem(projectId: string, rundownId: string, itemId: string): Promise<void> {
    try {
      const rundown = await this.loadRundown(projectId, rundownId);
      const itemIndex = rundown.items.findIndex(item => item.id === itemId);

      if (itemIndex === -1) {
        throw new Error(`Item not found: ${itemId}`);
      }

      rundown.items.splice(itemIndex, 1);
      await this.saveRundown(rundown);

      logger.info('Item removed from rundown', { rundownId, projectId, itemId });

    } catch (error) {
      logger.error('Failed to remove item', { error, projectId, rundownId, itemId });
      throw new Error(`Failed to remove item: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Reorder items in rundown
   */
  async reorderItems(projectId: string, rundownId: string, itemIds: string[]): Promise<void> {
    try {
      const rundown = await this.loadRundown(projectId, rundownId);

      // Validate all item IDs exist
      const existingIds = new Set(rundown.items.map(item => item.id));
      const newIds = new Set(itemIds);

      if (existingIds.size !== newIds.size || ![...existingIds].every(id => newIds.has(id))) {
        throw new Error('Invalid item IDs for reordering');
      }

      // Reorder items
      const itemMap = new Map(rundown.items.map(item => [item.id, item]));
      rundown.items = itemIds.map(id => itemMap.get(id)!);

      await this.saveRundown(rundown);

      logger.info('Items reordered', { rundownId, projectId, count: itemIds.length });

    } catch (error) {
      logger.error('Failed to reorder items', { error, projectId, rundownId });
      throw new Error(`Failed to reorder items: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Singleton instance
let rundownManager: RundownManager | null = null;

/**
 * Initialize rundown manager
 */
export function initRundownManager(): RundownManager {
  if (!rundownManager) {
    rundownManager = new RundownManager();
    logger.info('Rundown manager initialized');
  }
  return rundownManager;
}

/**
 * Get rundown manager instance
 */
export function getRundownManager(): RundownManager {
  if (!rundownManager) {
    throw new Error('Rundown manager not initialized. Call initRundownManager() first.');
  }
  return rundownManager;
}


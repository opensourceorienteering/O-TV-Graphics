/**
 * OGRAF Template Manager
 * Discovers, loads, and manages OGRAF templates
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { OGrafManifest, OGrafTemplateInfo } from '../../shared/types/ograf';
import { TemplateDataSourceConfig } from '../../shared/types/template-datasource';
import { validateAndCastManifest, ValidationError } from './OGrafValidator';
import { logger } from '../utils/logger';

/**
 * Template discovery result
 */
export interface TemplateDiscoveryResult {
  success: boolean;
  templatesFound: number;
  errors: TemplateError[];
}

/**
 * Template error
 */
export interface TemplateError {
  path: string;
  error: string;
  details?: ValidationError[];
}

/**
 * Template cache entry
 */
interface TemplateCacheEntry {
  manifestPath: string;
  manifest: OGrafManifest;
  templateInfo: OGrafTemplateInfo;
  lastModified: number;
}

/**
 * OGRAF Template Manager
 */
export class OGrafManager {
  private templatesDir: string;
  private cache: Map<string, TemplateCacheEntry>;

  constructor(templatesDir: string) {
    this.templatesDir = templatesDir;
    this.cache = new Map();
  }

  /**
   * Initialize the template manager
   * Must be called after construction
   */
  async initialize(): Promise<void> {
    // Verify templates directory exists (read-only check)
    // In production, templates are bundled in app.asar (read-only)
    // In development, templates are in the project directory
    // DO NOT attempt to create the directory - it should already exist

    // IMPORTANT: Use fsSync.existsSync() instead of fs.access()
    // Electron patches the sync fs methods to work with asar archives,
    // but the async fs.promises methods don't work with asar
    if (!fsSync.existsSync(this.templatesDir)) {
      // Templates directory doesn't exist - this is an error condition
      // Do NOT attempt to create it, especially not in app.asar (read-only)
      logger.error('Templates directory not found', {
        path: this.templatesDir,
        hint: 'Templates should be bundled with the app or in the project directory'
      });
      throw new Error(`Templates directory not found: ${this.templatesDir}`);
    }

    logger.debug('Templates directory verified', { path: this.templatesDir });
  }

  /**
   * Discover all OGRAF templates in the templates directory
   */
  async discoverTemplates(): Promise<TemplateDiscoveryResult> {
    logger.info('Discovering OGRAF templates', { dir: this.templatesDir });

    const errors: TemplateError[] = [];

    try {
      // Read templates directory
      const entries = await fs.readdir(this.templatesDir, { withFileTypes: true });

      // Filter directories and check for manifest files in parallel
      // Prioritize .ograf.json files (new spec requirement as of 2025-07-13)
      const templateDirs = await Promise.all(
        entries
          .filter(entry => entry.isDirectory())
          .map(async (entry) => {
            const templateDir = path.join(this.templatesDir, entry.name);

            // First, try to find .ograf.json file (new spec requirement)
            const ografManifestPath = path.join(templateDir, `${entry.name}.ograf.json`);
            try {
              await fs.access(ografManifestPath);
              logger.debug('Found .ograf.json manifest', { dir: entry.name, file: `${entry.name}.ograf.json` });
              return ografManifestPath;
            } catch {
              // Fall back to manifest.json for backward compatibility
              const legacyManifestPath = path.join(templateDir, 'manifest.json');
              try {
                await fs.access(legacyManifestPath);
                logger.debug('Found legacy manifest.json (should be renamed to .ograf.json)', { dir: entry.name });
                return legacyManifestPath;
              } catch {
                logger.debug('Skipping directory without manifest', { dir: entry.name });
                return null;
              }
            }
          })
      );

      // Filter out null values (directories without manifest)
      const validManifestPaths = templateDirs.filter((p): p is string => p !== null);

      // Load all templates in parallel using Promise.allSettled
      const results = await Promise.allSettled(
        validManifestPaths.map(manifestPath => this.loadTemplate(manifestPath))
      );

      // Process results
      let templatesFound = 0;
      results.forEach((result, index) => {
        const manifestPath = validManifestPaths[index];

        if (result.status === 'fulfilled') {
          const loadResult = result.value;

          if (loadResult.success) {
            templatesFound++;
            logger.info('Template loaded', {
              id: loadResult.manifest!.id,
              name: loadResult.manifest!.name
            });
          } else {
            errors.push({
              path: manifestPath,
              error: loadResult.error || 'Unknown error',
              details: loadResult.validationErrors
            });
          }
        } else {
          errors.push({
            path: manifestPath,
            error: result.reason?.message || 'Unknown error'
          });
        }
      });

      logger.info('Template discovery complete', {
        found: templatesFound,
        errors: errors.length
      });

      return {
        success: true,
        templatesFound,
        errors
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Template discovery failed', { error: errorMessage });

      return {
        success: false,
        templatesFound: 0,
        errors: [{
          path: this.templatesDir,
          error: errorMessage
        }]
      };
    }
  }

  /**
   * Load a single template from manifest path
   */
  async loadTemplate(manifestPath: string): Promise<{
    success: boolean;
    manifest?: OGrafManifest;
    error?: string;
    validationErrors?: ValidationError[];
  }> {
    try {
      // Read manifest file
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifestData = JSON.parse(manifestContent);

      // Validate manifest
      const validationResult = validateAndCastManifest(manifestData);

      if (!validationResult.valid) {
        logger.warn('Invalid OGRAF manifest', {
          path: manifestPath,
          errors: validationResult.errors
        });

        return {
          success: false,
          error: 'Manifest validation failed',
          validationErrors: validationResult.errors
        };
      }

      const manifest = validationResult.manifest;

      // Verify main file exists
      const templateDir = path.dirname(manifestPath);
      const mainFilePath = path.join(templateDir, manifest.main);

      try {
        await fs.access(mainFilePath);
      } catch {
        logger.warn('Main file not found', {
          manifest: manifestPath,
          mainFile: manifest.main
        });

        return {
          success: false,
          error: `Main file not found: ${manifest.main}`
        };
      }

      // Get file stats for caching
      const stats = await fs.stat(manifestPath);

      // Create template info (now async to load datasource config)
      const templateInfo = await this.createTemplateInfo(manifestPath, manifest);

      // Cache the template
      this.cache.set(manifest.id, {
        manifestPath,
        manifest,
        templateInfo,
        lastModified: stats.mtimeMs
      });

      return {
        success: true,
        manifest
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to load template', { path: manifestPath, error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Load data source configuration for a template (if exists)
   */
  private async loadDataSourceConfig(templateDir: string, templateId: string): Promise<TemplateDataSourceConfig | null> {
    try {
      // Try to find datasource file: {template-id}.datasource.json
      const datasourcePath = path.join(templateDir, `${templateId}.datasource.json`);

      try {
        await fs.access(datasourcePath);
      } catch {
        // Datasource file doesn't exist - this is OK, not all templates need it
        return null;
      }

      // Read and parse datasource file
      const datasourceContent = await fs.readFile(datasourcePath, 'utf-8');
      const datasourceConfig = JSON.parse(datasourceContent) as TemplateDataSourceConfig;

      // Basic validation
      if (!datasourceConfig.version || !datasourceConfig.mode) {
        logger.warn('Invalid datasource config - missing required fields', { path: datasourcePath });
        return null;
      }

      logger.debug('Loaded datasource config', {
        templateId,
        mode: datasourceConfig.mode,
        hasApiControls: !!datasourceConfig.api?.uiControls,
        controlCount: datasourceConfig.api?.uiControls?.length || 0
      });
      return datasourceConfig;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('Failed to load datasource config', { templateId, error: errorMessage });
      return null;
    }
  }

  /**
   * Create template info for UI
   */
  private async createTemplateInfo(manifestPath: string, manifest: OGrafManifest): Promise<OGrafTemplateInfo> {
    // Extract vendor-specific UI color if available
    const uicolor = (manifest as any).v_tvgrafik_uicolor ||
                    (manifest as any).v_spx_uicolor ||
                    0; // Default to gray

    // Get the directory name (e.g., "runner-spotlight" from "/path/to/templates/runner-spotlight/manifest.json")
    const templateDir = path.dirname(manifestPath);
    const directoryName = path.basename(templateDir);

    // Load datasource configuration (if exists)
    const dataSourceConfig = await this.loadDataSourceConfig(templateDir, manifest.id);

    return {
      type: 'ograf',
      manifestPath,
      manifest,
      description: manifest.description || manifest.name,
      uicolor,
      webplayout: templateDir,
      directoryName, // Add directory name for URL construction
      dataSourceConfig // Add datasource config (null if not found)
    };
  }

  /**
   * Get all loaded templates
   */
  getAllTemplates(): OGrafTemplateInfo[] {
    return Array.from(this.cache.values()).map(entry => entry.templateInfo);
  }

  /**
   * Get template by ID
   */
  getTemplateById(id: string): OGrafTemplateInfo | null {
    const entry = this.cache.get(id);
    return entry ? entry.templateInfo : null;
  }

  /**
   * Get template manifest by ID
   */
  getManifestById(id: string): OGrafManifest | null {
    const entry = this.cache.get(id);
    return entry ? entry.manifest : null;
  }

  /**
   * Reload a specific template
   */
  async reloadTemplate(id: string): Promise<boolean> {
    const entry = this.cache.get(id);
    if (!entry) {
      logger.warn('Template not found for reload', { id });
      return false;
    }

    logger.info('Reloading template', { id });
    const result = await this.loadTemplate(entry.manifestPath);
    return result.success;
  }

  /**
   * Clear template cache
   */
  clearCache(): void {
    logger.info('Clearing template cache');
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalTemplates: number;
    templateIds: string[];
  } {
    return {
      totalTemplates: this.cache.size,
      templateIds: Array.from(this.cache.keys())
    };
  }

  /**
   * Check if template needs reload (file modified)
   */
  async needsReload(id: string): Promise<boolean> {
    const entry = this.cache.get(id);
    if (!entry) return false;

    try {
      const stats = await fs.stat(entry.manifestPath);
      return stats.mtimeMs > entry.lastModified;
    } catch {
      return false;
    }
  }

  /**
   * Get templates directory path
   */
  getTemplatesDirectory(): string {
    return this.templatesDir;
  }
}

/**
 * Singleton instance
 */
let managerInstance: OGrafManager | null = null;

/**
 * Initialize the template manager
 */
export async function initTemplateManager(templatesDir: string): Promise<OGrafManager> {
  if (!managerInstance) {
    managerInstance = new OGrafManager(templatesDir);
    await managerInstance.initialize();
    logger.info('OGRAF Template Manager initialized', { templatesDir });
  }
  return managerInstance;
}

/**
 * Get template manager instance
 */
export function getTemplateManager(): OGrafManager {
  if (!managerInstance) {
    throw new Error('Template manager not initialized. Call initTemplateManager() first.');
  }
  return managerInstance;
}


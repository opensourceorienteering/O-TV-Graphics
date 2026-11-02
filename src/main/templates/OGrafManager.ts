/**
 * OGRAF Template Manager
 * Discovers, loads, and manages OGRAF templates
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { OGrafManifest, OGrafTemplateInfo, TemplateSetInfo, GraphicZone, CUSTOM_TEMPLATE_SET, SYSTEM_TEMPLATE_SET } from '../../shared/types/ograf';
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
const LOGO_TYPES: Record<string, string> = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** A look's own logo (set.json "logo", a file in the look's folder) as a data URL, or undefined */
async function readLookLogo(setDir: string, file: unknown): Promise<string | undefined> {
  if (typeof file !== 'string' || !file) return undefined;
  const target = path.resolve(setDir, file);
  const type = LOGO_TYPES[path.extname(target).toLowerCase()];
  if (!type || !target.startsWith(path.resolve(setDir) + path.sep)) return undefined;
  try {
    const bytes = await fs.readFile(target);
    return bytes.length <= 512 * 1024 ? `data:${type};base64,${bytes.toString('base64')}` : undefined;
  } catch {
    return undefined;
  }
}

export class OGrafManager {
  private templatesDir: string;
  /** Writable folder for imported looks and graphics (same layout as templatesDir) */
  private userDir?: string;
  private cache: Map<string, TemplateCacheEntry>;
  private sets: Map<string, TemplateSetInfo> = new Map();
  private setOfManifest: Map<string, string> = new Map();
  /** Root folder (templatesDir or userDir) each manifest was found in */
  private rootOfManifest: Map<string, string> = new Map();
  /** Folder of each set found by the last discovery */
  private setDirs: Map<string, string> = new Map();

  constructor(templatesDir: string, userDir?: string) {
    this.templatesDir = templatesDir;
    this.userDir = userDir;
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

    if (this.userDir) {
      try {
        fsSync.mkdirSync(path.join(this.userDir, 'sets'), { recursive: true });
      } catch (error) {
        logger.warn('Could not create the imported templates folder', { path: this.userDir, error: (error as Error).message });
        this.userDir = undefined;
      }
    }
  }

  /**
   * Discover all OGRAF templates in the templates directory
   */
  async discoverTemplates(): Promise<TemplateDiscoveryResult> {
    logger.info('Discovering OGRAF templates', { dir: this.templatesDir });

    const errors: TemplateError[] = [];

    try {
      // Graphics live in template sets (templates/sets/<set>/<graphic>/); graphics directly in
      // templates/ form the "custom" set; templates/system/ holds tools that belong to no set.
      // Imported looks (userDir) are scanned first: an imported set replaces a built-in set
      // with the same id.
      const systemDir = path.join(this.templatesDir, SYSTEM_TEMPLATE_SET);
      this.sets.clear();
      this.setDirs.clear();
      this.setOfManifest.clear();
      this.rootOfManifest.clear();
      const candidates: Array<{ dir: string; name: string; setId: string; root: string }> = [];
      const roots = [
        ...(this.userDir && fsSync.existsSync(this.userDir) ? [{ dir: this.userDir, imported: true }] : []),
        { dir: this.templatesDir, imported: false }
      ];
      for (const root of roots) {
        const entries = await fs.readdir(root.dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name === 'sets' || entry.name === SYSTEM_TEMPLATE_SET || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
          candidates.push({ dir: path.join(root.dir, entry.name), name: entry.name, setId: CUSTOM_TEMPLATE_SET, root: root.dir });
        }
        const setsDir = path.join(root.dir, 'sets');
        if (!fsSync.existsSync(setsDir)) continue;
        for (const setEntry of await fs.readdir(setsDir, { withFileTypes: true })) {
          if (!setEntry.isDirectory() || setEntry.name.startsWith('_') || setEntry.name.startsWith('.')) continue;
          const existing = this.sets.get(setEntry.name);
          if (existing) {
            // An imported copy of this look is already loaded
            if (!root.imported) existing.replacesBuiltIn = true;
            continue;
          }
          const setDir = path.join(setsDir, setEntry.name);
          let meta: Partial<TemplateSetInfo> = {};
          try {
            meta = JSON.parse(await fs.readFile(path.join(setDir, 'set.json'), 'utf-8'));
          } catch {
            logger.warn('Template set without a readable set.json', { set: setEntry.name });
          }
          this.setDirs.set(setEntry.name, setDir);
          this.sets.set(setEntry.name, {
            id: setEntry.name,
            name: meta.name || setEntry.name,
            description: meta.description,
            author: meta.author,
            colors: meta.colors,
            fonts: meta.fonts,
            approvedEventsOnly: meta.approvedEventsOnly === true,
            logoPreview: await readLookLogo(setDir, (meta as { logo?: unknown }).logo),
            templateCount: 0,
            source: root.imported ? 'imported' : 'built-in'
          });
          for (const g of await fs.readdir(setDir, { withFileTypes: true })) {
            if (!g.isDirectory() || g.name === 'fonts' || g.name.startsWith('_') || g.name.startsWith('.')) continue;
            candidates.push({ dir: path.join(setDir, g.name), name: g.name, setId: setEntry.name, root: root.dir });
          }
        }
      }
      if (fsSync.existsSync(systemDir)) {
        for (const g of await fs.readdir(systemDir, { withFileTypes: true })) {
          if (g.isDirectory() && !g.name.startsWith('_')) candidates.push({ dir: path.join(systemDir, g.name), name: g.name, setId: SYSTEM_TEMPLATE_SET, root: this.templatesDir });
        }
      }

      // Check for manifest files in parallel; .ograf.json first (spec), manifest.json as fallback
      const templateDirs = await Promise.all(
        candidates.map(async ({ dir: templateDir, name, setId, root }) => {
          const ografManifestPath = path.join(templateDir, `${name}.ograf.json`);
          try {
            await fs.access(ografManifestPath);
            this.setOfManifest.set(ografManifestPath, setId);
            this.rootOfManifest.set(ografManifestPath, root);
            return ografManifestPath;
          } catch {
            const legacyManifestPath = path.join(templateDir, 'manifest.json');
            try {
              await fs.access(legacyManifestPath);
              logger.debug('Found legacy manifest.json (should be renamed to .ograf.json)', { dir: name });
              this.setOfManifest.set(legacyManifestPath, setId);
              this.rootOfManifest.set(legacyManifestPath, root);
              return legacyManifestPath;
            } catch {
              logger.debug('Skipping directory without manifest', { dir: name });
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

      for (const entry of this.cache.values()) {
        const set = this.sets.get(entry.templateInfo.setId);
        if (set) set.templateCount++;
      }
      if ([...this.cache.values()].some(e => e.templateInfo.setId === CUSTOM_TEMPLATE_SET)) {
        this.sets.set(CUSTOM_TEMPLATE_SET, {
          id: CUSTOM_TEMPLATE_SET,
          name: 'Other graphics',
          description: 'Graphics placed directly in the templates folder, outside any set',
          templateCount: [...this.cache.values()].filter(e => e.templateInfo.setId === CUSTOM_TEMPLATE_SET).length
        });
      }

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

      const existing = this.cache.get(manifest.id);
      if (existing && existing.manifestPath !== manifestPath) {
        return {
          success: false,
          error: `Duplicate graphic id "${manifest.id}" (already used by ${existing.manifestPath})`
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

    // URL path below templates/ ("sets/iof/iof-results", or "my-graphic" outside sets)
    const templateDir = path.dirname(manifestPath);
    // Imported graphics are served from the same /templates/ URL as built-in ones
    const root = this.rootOfManifest.get(manifestPath) ?? this.templatesDir;
    const directoryName = path.relative(root, templateDir).split(path.sep).join('/');
    const setId = this.setOfManifest.get(manifestPath) ?? CUSTOM_TEMPLATE_SET;
    const zoneValue = (manifest as any).v_olgrafik_zone;
    const zone: GraphicZone | undefined = ['main', 'lower', 'side', 'corner', 'full'].includes(zoneValue) ? zoneValue : undefined;

    // Load datasource configuration (if exists)
    const dataSourceConfig = await this.loadDataSourceConfig(templateDir, manifest.id);

    return {
      type: 'ograf',
      manifestPath,
      manifest,
      description: manifest.description || manifest.name,
      uicolor,
      webplayout: templateDir,
      directoryName, // URL path below templates/
      dataSourceConfig, // Add datasource config (null if not found)
      setId,
      zone
    };
  }

  /**
   * Get all loaded templates
   */
  getAllTemplates(): OGrafTemplateInfo[] {
    return Array.from(this.cache.values()).map(entry => entry.templateInfo);
  }

  /** Template sets found by the last discovery, sorted by name ("Other graphics" last) */
  getTemplateSets(): TemplateSetInfo[] {
    return [...this.sets.values()].sort((a, b) =>
      (a.id === CUSTOM_TEMPLATE_SET ? 1 : 0) - (b.id === CUSTOM_TEMPLATE_SET ? 1 : 0) || a.name.localeCompare(b.name));
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

  /** Writable folder for imported looks and graphics, if there is one */
  getUserDirectory(): string | undefined {
    return this.userDir;
  }

  /** Folder of a set found by the last discovery */
  getSetDirectory(setId: string): string | undefined {
    return this.setDirs.get(setId);
  }
}

/**
 * Singleton instance
 */
let managerInstance: OGrafManager | null = null;

/**
 * Initialize the template manager
 */
export async function initTemplateManager(templatesDir: string, userDir?: string): Promise<OGrafManager> {
  if (!managerInstance) {
    managerInstance = new OGrafManager(templatesDir, userDir);
    await managerInstance.initialize();
    logger.info('OGRAF Template Manager initialized', { templatesDir, userDir });
  }
  return managerInstance;
}

/** The template manager, or undefined before it is initialised */
export function findTemplateManager(): OGrafManager | undefined {
  return managerInstance ?? undefined;
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


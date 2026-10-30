/**
 * Configuration Management
 * SPX-inspired config.json handling
 */

import fs from 'fs';
import type { EventorLogoSettings } from '../data/ClubLogoService';
import path from 'path';
import { app } from 'electron';
import { getLogger } from './logger';
import { DataSourceConfig } from '../../shared/types/dataSource';
import { BUILT_IN_DATA_SOURCES, mergeBuiltInDataSources } from '../../shared/builtInDataSources';

/**
 * Get the appropriate user data directory based on environment
 * In production: Use Electron's userData directory
 * In development: Use project root
 */
function getUserDataDirectory(): string {
  // Use app.isPackaged to detect production vs development
  // This is the recommended Electron best practice
  const isProduction = app.isPackaged;

  if (isProduction) {
    // Production: Use Electron's userData directory
    // This is platform-specific:
    // - macOS: ~/Library/Application Support/OL-Grafik
    // - Windows: %APPDATA%\OL-Grafik
    // - Linux: ~/.config/OL-Grafik
    // (kept after the rename to Split Control; see appIdentity.ts)
    return app.getPath('userData');
  } else {
    // Development: Use project directory for easier debugging
    return process.cwd();
  }
}

/**
 * Get the appropriate log directory based on environment
 * In production: Use Electron's logs directory
 * In development: Use LOG folder in project root
 */
function getLogDirectory(): string {
  const isProduction = app.isPackaged;

  if (isProduction) {
    return app.getPath('logs');
  } else {
    return path.join(process.cwd(), 'LOG');
  }
}

export interface AppConfig {
  general: {
    hostname: string;
    port: number;
    wsPort: number;
    dataroot: string;
    logfolder: string;
    loglevel: 'error' | 'warn' | 'info' | 'verbose' | 'debug';
    langfile: string;
    launchBrowser: boolean;
    resolution: 'HD' | '4K' | 'AUTO';
  };
  /**
   * @deprecated Use dataSources array instead. Kept for backward compatibility.
   */
  liveresults: {
    baseUrl: string;
    cacheInterval: number;
    /** 'auto' picks the REST API when baseUrl is https://api.orienteering.services */
    api?: 'legacy' | 'rest' | 'auto';
    timeout: number;
  };
  /**
   * Data sources configuration (new pluggable architecture)
   */
  dataSources?: DataSourceConfig[];
  /** Eventor access for club logos (downloaded on request, never polled) */
  eventor?: EventorLogoSettings;
  /** Club name library: name as the data source sends it -> name on air (see data/clubNames.ts) */
  clubNames?: Record<string, string>;
  output: {
    ndi: {
      enabled: boolean;
      name: string;
      fps: number;
      colorFormat: 'BGRA' | 'RGBA';
    };
    web: {
      enabled: boolean;
      cors: boolean;
    };
  };
}

/**
 * Get default configuration with proper paths
 * Uses Electron app paths when available, falls back to process.cwd() in development
 */
function getDefaultConfig(): AppConfig {
  const userDataDir = getUserDataDirectory();
  const logDir = getLogDirectory();

  return {
    general: {
      hostname: 'Split Control',
      port: 5657,
      wsPort: 5656,
      dataroot: path.join(userDataDir, 'DATAROOT'),
      logfolder: logDir,
      loglevel: 'info',
      langfile: 'en.json',
      launchBrowser: false,
      resolution: 'HD'
    },
    liveresults: {
      baseUrl: '',
      cacheInterval: 15000,
      timeout: 10000
    },
    dataSources: BUILT_IN_DATA_SOURCES.map((source) => ({
      ...source,
      config: { ...source.config },
    })),
    output: {
      ndi: {
        enabled: false,
        name: 'Split Control NDI Output',
        fps: 50,
        colorFormat: 'BGRA'
      },
      web: {
        enabled: true,
        cors: true
      }
    }
  };
}

let config: AppConfig | null = null;

export async function loadConfig(configPath?: string): Promise<AppConfig> {
  const logger = getLogger();

  // Use provided path or default
  // In production, use userData directory; in development, use project root
  const userDataDir = getUserDataDirectory();
  const cfgPath = configPath || path.join(userDataDir, 'config.json');

  try {
    if (fs.existsSync(cfgPath)) {
      // Load existing config
      const fileContent = fs.readFileSync(cfgPath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);

      // Merge with defaults (in case new fields were added)
      // Use getDefaultConfig() to get proper paths for the current environment
      config = mergeConfig(getDefaultConfig(), loadedConfig);

      logger.info('Configuration loaded from file', { path: cfgPath });
    } else {
      // Create default config with proper paths
      config = getDefaultConfig();
      await saveConfig(config, cfgPath);

      logger.info('Default configuration created', { path: cfgPath });
    }

    // Ensure directories exist
    ensureDirectories(config);

    return config;

  } catch (error) {
    logger.error('Failed to load configuration', { error, path: cfgPath });
    throw error;
  }
}

export async function saveConfig(cfg: AppConfig, configPath?: string): Promise<void> {
  const logger = getLogger();
  const userDataDir = getUserDataDirectory();
  const cfgPath = configPath || path.join(userDataDir, 'config.json');

  try {
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    config = cfg;
    logger.info('Configuration saved', { path: cfgPath });
  } catch (error) {
    logger.error('Failed to save configuration', { error, path: cfgPath });
    throw error;
  }
}

export function getConfig(): AppConfig {
  if (!config) {
    throw new Error('Configuration not loaded. Call loadConfig() first.');
  }
  return config;
}

function mergeConfig(defaults: AppConfig, loaded: Partial<AppConfig>): AppConfig {
  const merged = {
    general: { ...defaults.general, ...loaded.general },
    liveresults: { ...defaults.liveresults, ...loaded.liveresults },
    dataSources: mergeBuiltInDataSources(
      loaded.dataSources || defaults.dataSources || [],
    ),
    ...(loaded.eventor ? { eventor: loaded.eventor } : {}),
    ...(loaded.clubNames ? { clubNames: loaded.clubNames } : {}),
    output: {
      ndi: { ...defaults.output.ndi, ...loaded.output?.ndi },
      web: { ...defaults.output.web, ...loaded.output?.web }
    }
  };

  return merged;
}

function ensureDirectories(cfg: AppConfig): void {
  const userDataDir = getUserDataDirectory();

  // Only create directories in writable locations (userData)
  // NEVER attempt to create directories in app.asar (read-only)
  const dirs = [
    cfg.general.dataroot,
    cfg.general.logfolder,
    path.join(userDataDir, 'plugins')
  ];

  dirs.forEach(dir => {
    try {
      // Safety check: Never try to create directories inside app.asar
      if (dir.includes('app.asar')) {
        const logger = getLogger();
        logger.warn('Skipping directory creation in read-only app.asar', { dir });
        return;
      }

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        const logger = getLogger();
        logger.debug('Directory created', { dir });
      }
    } catch (error) {
      // Log error but don't throw - some directories might not be critical
      const logger = getLogger();
      logger.warn('Failed to create directory', {
        dir,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
}


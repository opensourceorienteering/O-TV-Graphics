/**
 * Main Process Entry Point
 * Electron main process - handles app lifecycle, windows, and backend services
 */

import { app, BrowserWindow, session, dialog } from 'electron';
import * as path from 'path';
import { initLogger } from './utils/logger';
import { loadConfig, saveConfig } from './utils/config';
import { WebSocketServer } from './data/WebSocketServer';
import { WebServer } from './output/WebServer';
import { createMainWindow, createGraphicsWindow } from './windows';
import { initTemplateManager } from './templates/OGrafManager';
import { registerTemplateHandlers } from './ipc/templateHandlers';
import { initLiveResultsClient } from './data/LiveResultsClient';
import { initDataStore } from './data/DataStore';
import { registerDataHandlers } from './ipc/dataHandlers';
import { registerDataSourceHandlers } from './ipc/dataSourceHandlers';
import { initProjectManager } from './projects/ProjectManager';
import { initRundownManager } from './projects/RundownManager';
import { registerProjectHandlers } from './ipc/projectHandlers';
import { initPlaybackEngine, getPlaybackEngine } from './playback/PlaybackEngine';
import { registerPlaybackHandlers } from './ipc/playbackHandlers';

import { registerWindowHandlers, setGraphicsWindow } from './ipc/windowHandlers';
import { registerOutputHandlers } from './ipc/outputHandlers';
import { registerSettingsHandlers } from './ipc/settingsHandlers';
import { registerSystemHandlers } from './ipc/systemHandlers';
import { checkNDIAvailability, isSupportedCPU } from './utils/ndi-check';
import { ndiOutputManager } from './output/NDIOutputManager';
import { frameCaptureService } from './output/FrameCaptureService';
import { validateNodeVersionOrExit } from './utils/version-check';
import { initDataSourceRegistry, getDataSourceRegistry } from './data/DataSourceRegistry';
import { registerBuiltInDataSources } from './data/sources';

const logger = initLogger();

// CRITICAL: Validate Node.js version before proceeding
// OL-Grafik requires Node.js v20.x for NDI (grandiose) compatibility
validateNodeVersionOrExit();

// Environment detection
const isDev = process.env.NODE_ENV === 'development';

// Global references to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let graphicsWindow: BrowserWindow | null = null;
let wsServer: WebSocketServer | null = null;
let webServer: WebServer | null = null;

// Module-level config reference (loaded during initialization)
let appConfig: any = null;

// Track initialization state to prevent duplicate initialization during HMR
let servicesInitialized = false;

// Handle creating/removing shortcuts on Windows when installing/uninstalling
// This is only needed for production builds with Squirrel installer
// Skip in development mode
if (process.env.NODE_ENV === 'production') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const squirrelStartup = require('electron-squirrel-startup');
    if (squirrelStartup) {
      app.quit();
    }
  } catch (e) {
    // electron-squirrel-startup not installed, skip
  }
}

/**
 * Initialize backend services
 */
async function initializeServices() {
  // Prevent duplicate initialization during HMR in development mode
  if (servicesInitialized) {
    logger.debug('Services already initialized, skipping duplicate initialization');
    return;
  }
  try {
    // Load configuration and store at module level
    appConfig = await loadConfig();
    logger.info('Configuration loaded', {
      port: appConfig.general.port,
      dataroot: appConfig.general.dataroot
    });

    // Initialize WebSocket server for real-time communication
    wsServer = new WebSocketServer(appConfig.general.wsPort || 5656);
    await wsServer.start();
    // Note: WebSocketServer.start() already logs "WebSocket server started"

    // Initialize web server for graphics output
    webServer = new WebServer(appConfig.general.port || 5657);
    await webServer.start();
    // Note: WebServer.start() already logs "Web server started"

    // Initialize template manager
    // In development, use project templates directory
    // In production, templates are bundled in app.asar at app.asar/templates
    // __dirname in production points to: app.asar/dist-electron/main
    const templatesDir = isDev
      ? path.join(process.cwd(), 'templates')
      : path.join(__dirname, '../../templates');

    logger.info('Template directory configured', {
      templatesDir,
      isDev,
      dirname: __dirname,
      cwd: process.cwd(),
      exists: require('fs').existsSync(templatesDir)
    });

    const templateManager = await initTemplateManager(templatesDir);

    // Discover templates
    const discoveryResult = await templateManager.discoverTemplates();
    logger.info('Template discovery complete', {
      found: discoveryResult.templatesFound,
      errors: discoveryResult.errors.length
    });

    if (discoveryResult.errors.length > 0) {
      logger.warn('Template discovery errors', { errors: discoveryResult.errors });
    }

    // Initialize data source registry
    initDataSourceRegistry();
    registerBuiltInDataSources();
    logger.info('Data source registry initialized');

    // Create data source instances from config
    const registry = getDataSourceRegistry();
    if (appConfig.dataSources && appConfig.dataSources.length > 0) {
      for (const dsConfig of appConfig.dataSources) {
        if (dsConfig.enabled) {
          try {
            await registry.create(dsConfig);
            logger.info('Data source created from config', {
              id: dsConfig.id,
              type: dsConfig.type,
              name: dsConfig.name
            });
          } catch (error) {
            logger.error('Failed to create data source from config', {
              id: dsConfig.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    } else {
      logger.warn('No data sources configured. Users must configure data sources in Settings > Data.');
    }

    // Initialize LiveResults client (backward compatibility)
    const liveResultsBaseUrl = appConfig.liveresults?.baseUrl || 'https://liveresultat.orientering.se';
    initLiveResultsClient({
      baseUrl: liveResultsBaseUrl,
      cacheInterval: 15000,
      timeout: 10000
    });
    logger.info('LiveResults client initialized (legacy)', { baseUrl: liveResultsBaseUrl });

    // Initialize data store
    const dataStore = initDataStore();

    // Attach WebSocket server to data store for broadcasting
    if (wsServer) {
      dataStore.setWebSocketServer(wsServer.getServer());
    }

    logger.info('Data store initialized');

    // Initialize project and rundown managers
    initProjectManager();
    logger.info('Project manager initialized');

    initRundownManager();
    logger.info('Rundown manager initialized');

    // Initialize playback engine
    const playbackEngine = initPlaybackEngine();
    playbackEngine.setWebSocketServer(wsServer!);
    logger.info('Playback engine initialized');

    // Mark services as initialized to prevent duplicate initialization
    servicesInitialized = true;

  } catch (error) {
    logger.error('Failed to initialize services', { error });
    throw error;
  }
}

/**
 * Initialize NDI output system
 *
 * NDI is a core feature but with graceful degradation.
 * The application will continue to run if NDI is not available,
 * but NDI output will be disabled.
 */
async function initializeNDI() {
  try {
    // Ensure config is loaded
    if (!appConfig) {
      throw new Error('Configuration not loaded - cannot initialize NDI');
    }

    // Check NDI availability
    const ndiAvailability = checkNDIAvailability();

    if (!ndiAvailability.available) {
      // NDI not available - log warning but continue
      logger.warn('NDI SDK not available - NDI output will be disabled', {
        error: ndiAvailability.error
      });

      // Show a non-blocking warning dialog to inform the user
      dialog.showMessageBox({
        type: 'warning',
        title: 'NDI Not Available',
        message: 'NDI output is not available',
        detail:
          `${ndiAvailability.error}\n\n` +
          `The application will continue to run, but NDI output will be disabled.\n\n` +
          `To enable NDI output:\n` +
          `1. Install NDI Runtime from https://ndi.link/NDIRedistV5\n` +
          `2. Restart this application\n\n` +
          `Note: If grandiose failed to install, ensure you're using Node.js v18-v20 during npm install.`,
        buttons: ['OK']
      }).catch(err => {
        logger.error('Failed to show NDI warning dialog', { error: err });
      });

      return;
    }

    logger.info('NDI SDK available', {
      version: ndiAvailability.version,
      cpuSupported: isSupportedCPU()
    });

    // Initialize NDI Output Manager with config from config.json
    const initialized = await ndiOutputManager.initialize({
      enabled: appConfig.output.ndi.enabled,
      name: appConfig.output.ndi.name,
      fps: appConfig.output.ndi.fps,
      colorFormat: appConfig.output.ndi.colorFormat,
      groups: [],
      clockVideo: true,
      clockAudio: false
    });

    if (initialized) {
      logger.info('NDI Output Manager initialized successfully');

      // Attach frame capture service to graphics window
      if (graphicsWindow && !graphicsWindow.isDestroyed()) {
        frameCaptureService.setWindow(graphicsWindow);
        logger.info('Frame capture service attached to graphics window');
      }
    } else {
      logger.warn('Failed to initialize NDI Output Manager');
    }

  } catch (error) {
    logger.error('Error initializing NDI', {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorType: error instanceof Error ? error.constructor.name : typeof error
    });
  }
}

/**
 * Create application windows
 */
async function createWindows() {
  // Create main control panel window
  mainWindow = createMainWindow();
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create graphics output window (hidden by default)
  graphicsWindow = createGraphicsWindow();

  graphicsWindow.on('closed', () => {
    graphicsWindow = null;
  });

  // Set graphics window reference for IPC handlers
  setGraphicsWindow(graphicsWindow);

  logger.info('Application windows created');
}

/**
 * Configure Content Security Policy
 */
function setupContentSecurityPolicy() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Build CSP based on environment
    const cspDirectives = [
      // Default: only allow resources from same origin
      "default-src 'self'",

      // Scripts: allow self and localhost for Vite dev server and web output server
      // Production also needs localhost:5657 for dynamic ES module imports from web server
      // Allow cdnjs.cloudflare.com for highlight.js in documentation
      isDev
        ? "script-src 'self' 'unsafe-inline' http://localhost:5173 http://localhost:5657 https://cdnjs.cloudflare.com"
        : "script-src 'self' http://localhost:5657 https://cdnjs.cloudflare.com",

      // Styles: allow self and inline styles (required for React inline styles)
      // Allow cdnjs.cloudflare.com for highlight.js CSS in documentation
      "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",

      // Images: allow self, data URIs, and localhost
      isDev
        ? "img-src 'self' data: http://localhost:5173 http://localhost:5657"
        : "img-src 'self' data:",

      // Fonts: allow self and data URIs
      "font-src 'self' data:",

      // Connect: allow WebSocket and HTTP connections to localhost
      // Allow cdnjs.cloudflare.com for documentation assets
      isDev
        ? "connect-src 'self' ws://localhost:5656 ws://localhost:5173 http://localhost:5173 http://localhost:5657 https://cdnjs.cloudflare.com"
        : "connect-src 'self' ws://localhost:5656 http://localhost:5657 https://cdnjs.cloudflare.com",

      // Media: allow self
      "media-src 'self'",

      // Workers: allow self
      "worker-src 'self' blob:",

      // Child frames: allow self and localhost web server
      // Production also needs localhost:5657 for web output pages
      isDev
        ? "frame-src 'self' http://localhost:5657"
        : "frame-src 'self' http://localhost:5657",

      // Object/embed: disallow
      "object-src 'none'",

      // Base URI: restrict to self
      "base-uri 'self'",

      // Form actions: restrict to self
      "form-action 'self'"
    ];

    const csp = cspDirectives.join('; ');

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    });
  });

  logger.info('Content Security Policy configured', {
    environment: isDev ? 'development' : 'production'
  });
}

/**
 * App ready handler
 */
app.whenReady().then(async () => {
  try {
    logger.info('OL-Grafik starting...', {
      version: app.getVersion(),
      platform: process.platform
    });

    // Configure security policies
    setupContentSecurityPolicy();

    // Register IPC handlers
    registerTemplateHandlers();
    registerDataHandlers();
    registerDataSourceHandlers();
    registerProjectHandlers();
    registerPlaybackHandlers();
    registerOutputHandlers();
    registerSettingsHandlers();
    registerSystemHandlers();

    // Initialize backend services
    await initializeServices();

    // Create windows
    await createWindows();

    // Register window handlers after windows are created
    registerWindowHandlers();

    // Initialize NDI output system
    await initializeNDI();

    logger.info('OL-Grafik ready');

  } catch (error) {
    logger.error('Failed to start application', { error });

    // Show user-friendly error dialog
    const errorMessage = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'OL-Grafik Startup Error',
      `Failed to start OL-Grafik:\n\n${errorMessage}\n\nPlease check the logs for more details.`
    );

    app.quit();
  }
});

/**
 * Activate handler (macOS)
 */
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindows();
  }
});

/**
 * Window all closed handler
 */
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Before quit handler - cleanup
 */
app.on('before-quit', async () => {
  logger.info('OL-Grafik shutting down...');

  try {
    // Clear all graphics and reset rundown states
    // This ensures templates don't show as "On Air" after restart
    try {
      const playbackEngine = getPlaybackEngine();
      await playbackEngine.clearAll();
      logger.info('Graphics cleared and rundown states reset');
    } catch (error) {
      logger.error('Failed to clear graphics during shutdown', { error });
    }

    // Stop NDI output
    frameCaptureService.shutdown();
    await ndiOutputManager.shutdown();

    // Stop services
    if (wsServer) {
      await wsServer.stop();
    }
    if (webServer) {
      await webServer.stop();
    }

    logger.info('OL-Grafik shutdown complete');
  } catch (error) {
    logger.error('Error during shutdown', { error });
  }
});

/**
 * Uncaught exception handler
 */
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
});

/**
 * Unhandled rejection handler
 */
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});


/**
 * Main Process Entry Point
 * Electron main process - handles app lifecycle, windows, and backend services
 */

import './utils/appIdentity';
import { app, BrowserWindow, session, dialog } from 'electron';
import * as path from 'path';
import { initLogger } from './utils/logger';
import { loadConfig, getConfig } from './utils/config';
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
import { registerClubLogoHandlers } from './ipc/clubLogoHandlers';
import { registerEventHandlers } from './ipc/eventHandlers';
import { registerDirectorHandlers } from './output/DirectorApi';
import { initClubLogoService } from './data/ClubLogoService';
import { checkNDIAvailability, isSupportedCPU } from './utils/ndi-check';
import { ndiOutputManager } from './output/NDIOutputManager';
import { frameCaptureService } from './output/FrameCaptureService';
import { validateNodeVersionOrExit } from './utils/version-check';
import { initDataSourceRegistry, getDataSourceRegistry } from './data/DataSourceRegistry';
import { registerBuiltInDataSources } from './data/sources';
import { claimSingleInstance } from './utils/singleInstance';

const logger = initLogger();

// CRITICAL: Validate Node.js version before proceeding
// Split Control requires Node.js v20.x for NDI (grandiose) compatibility
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
let handlersRegistered = false;
let windowsCreated = false;

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

    // Create data source instances from config
    const registry = getDataSourceRegistry();
    if (appConfig.dataSources && appConfig.dataSources.length > 0) {
      for (const dsConfig of appConfig.dataSources) {
        if (dsConfig.enabled) {
          try {
            await registry.create(dsConfig, false);
            logger.info('Data source created from config', {
              id: dsConfig.id,
              type: dsConfig.type,
              name: dsConfig.name
            });
          } catch (error) {
            // Log as warning instead of error - data sources may be unavailable at startup
            // (e.g., simulator not running, network issues, etc.)
            logger.warn('Failed to initialize data source from config (will retry on demand)', {
              id: dsConfig.id,
              type: dsConfig.type,
              name: dsConfig.name,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    } else {
      logger.warn('No data sources configured. Users must configure data sources in Settings > Data.');
    }

    // Initialize LiveResults client (backward compatibility)
    const liveResultsBaseUrl = appConfig.liveresults?.baseUrl || 'https://api.orienteering.services';
    initLiveResultsClient({
      baseUrl: liveResultsBaseUrl,
      cacheInterval: appConfig.liveresults?.cacheInterval,
      timeout: 10000,
      api: appConfig.liveresults?.api ?? 'auto'
    });
    logger.info('LiveResults client initialized (legacy)', { baseUrl: liveResultsBaseUrl });

    // Initialize data store
    const dataStore = initDataStore();

    // Attach WebSocket server to data store for broadcasting
    if (wsServer) {
      dataStore.setWebSocketServer(wsServer.getServer());
    }

    logger.info('Data store initialized');

    // Club logos: bundled with the app (club-logos/, refreshed by maintainers before a release)
    // plus logos the operator adds by hand in DATAROOT/club-logos/manual
    try {
      initClubLogoService(
        isDev ? path.join(process.cwd(), 'club-logos') : path.join(__dirname, '../../club-logos'),
        path.join(appConfig.general.dataroot, 'club-logos')
      );
    } catch (error) {
      logger.warn('Club logos unavailable', { error: error instanceof Error ? error.message : String(error) });
    }

    // Initialize project and rundown managers
    initProjectManager();
    initRundownManager();

    // Initialize playback engine
    const playbackEngine = initPlaybackEngine();
    playbackEngine.setWebSocketServer(wsServer!);

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
          `1. Install NDI Tools / NDI 6 Runtime from https://ndi.video/tools/\n` +
          `2. Restart this application\n\n` +
          `Note: If the NDI bindings failed to build, run "npm rebuild @stagetimerio/grandiose".`,
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
      // Output is paced by the graphics renderer's paints (see FrameCaptureService)
      clockVideo: false,
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
  // Prevent duplicate window creation during HMR in development mode
  if (windowsCreated) {
    logger.debug('Windows already created, skipping duplicate creation');
    return;
  }

  // Create main control panel window
  mainWindow = createMainWindow();

  mainWindow.on('closed', () => {
    mainWindow = null;
    windowsCreated = false; // Allow recreation if window is closed
  });

  // Create graphics output window (hidden by default)
  graphicsWindow = createGraphicsWindow();

  graphicsWindow.on('closed', () => {
    graphicsWindow = null;
  });

  // Set graphics window reference for IPC handlers
  setGraphicsWindow(graphicsWindow);

  windowsCreated = true;
  logger.info('Application windows created');
}

/**
 * Configure Content Security Policy
 */
function setupContentSecurityPolicy() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const webOrigin = `http://localhost:${getConfig().general.port}`;
    const socketOrigin = `ws://localhost:${getConfig().general.wsPort}`;
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
      `style-src 'self' 'unsafe-inline' ${webOrigin} https://cdnjs.cloudflare.com`,

      // Images: allow self, data URIs, and localhost
      isDev
        ? "img-src 'self' data: http://localhost:5173 http://localhost:5657"
        : `img-src 'self' data: ${webOrigin}`,

      // Fonts: allow self and data URIs
      `font-src 'self' data: ${webOrigin}`,

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

    const csp = cspDirectives.join('; ').split('http://localhost:5657').join(webOrigin).split('ws://localhost:5656').join(socketOrigin);

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
// Development aid: OLG_REMOTE_DEBUGGING_PORT=9333 lets tools drive and screenshot the windows
if (process.env.OLG_REMOTE_DEBUGGING_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.OLG_REMOTE_DEBUGGING_PORT);
  app.commandLine.appendSwitch('remote-allow-origins', 'http://127.0.0.1');
}

// One app at a time; in development the newest start takes over and orphans quit themselves
let instanceClaimed = false;

app.whenReady().then(async () => {
  instanceClaimed = claimSingleInstance({
    dev: !app.isPackaged,
    focus: () => {
      const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
      if (!window) return;
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    },
    log: (message) => logger.info(message)
  });
  if (!instanceClaimed) {
    // Another Split Control runs: it was focused instead. Nothing here was started yet.
    app.exit(0);
    return;
  }
  try {
    logger.info('Split Control starting...', {
      version: app.getVersion(),
      platform: process.platform,
      isDev,
      servicesInitialized,
      handlersRegistered,
      windowsCreated
    });

    // Configure security policies
    setupContentSecurityPolicy();

    // Initialize backend services FIRST (before registering IPC handlers that depend on them)
    await initializeServices();

    // Register IPC handlers AFTER services are initialized
    // This ensures all managers (project, rundown, etc.) are ready when handlers are called
    // Protect against duplicate registration during HMR in development mode
    if (!handlersRegistered) {
      registerTemplateHandlers();
      registerDataHandlers();
      registerDataSourceHandlers();
      registerProjectHandlers();
      registerPlaybackHandlers();
      registerOutputHandlers();
      registerSettingsHandlers();
      registerSystemHandlers();
      registerClubLogoHandlers();
      registerEventHandlers();
      registerDirectorHandlers();
      registerWindowHandlers();
      handlersRegistered = true;
      logger.info('IPC handlers registered');
    } else {
      logger.debug('IPC handlers already registered, skipping duplicate registration');
    }

    // Create windows AFTER IPC handlers are registered
    // This prevents race conditions where renderer tries to call IPC before handlers are ready
    await createWindows();

    // Initialize NDI output system
    await initializeNDI();

    logger.info('Split Control ready');

  } catch (error) {
    logger.error('Failed to start application', { error });

    // Show user-friendly error dialog
    const errorMessage = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'Split Control Startup Error',
      `Failed to start Split Control:\n\n${errorMessage}\n\nPlease check the logs for more details.`
    );

    app.quit();
  }
});

/**
 * Activate handler (macOS)
 */
app.on('activate', () => {
  if (instanceClaimed && BrowserWindow.getAllWindows().length === 0) {
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
  logger.info('Split Control shutting down...');

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

    logger.info('Split Control shutdown complete');
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


import { devIconPath } from "../utils/appIdentity";
/**
 * Window Management
 * Creates and manages Electron windows
 */

import { BrowserWindow, app, screen } from "electron";
import path from "path";
import { getLogger } from "../utils/logger";
import { getConfig } from "../utils/config";

const logger = getLogger();

// Determine if running in development
const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

/**
 * Get graphics output dimensions based on resolution setting
 */
export function getGraphicsDimensions(): { width: number; height: number } {
  try {
    const config = getConfig();
    const resolution = config.general.resolution;

    switch (resolution) {
      case "HD":
        return { width: 1920, height: 1080 };
      case "4K":
        return { width: 3840, height: 2160 };
      case "AUTO": {
        // Use primary display dimensions
        const primaryDisplay = screen.getPrimaryDisplay();
        return {
          width: primaryDisplay.bounds.width,
          height: primaryDisplay.bounds.height,
        };
      }
      default:
        logger.warn(
          `Unknown resolution setting: ${resolution}, defaulting to HD`,
        );
        return { width: 1920, height: 1080 };
    }
  } catch (error) {
    logger.warn(
      "Failed to get graphics dimensions from config, defaulting to HD",
      { error },
    );
    return { width: 1920, height: 1080 };
  }
}

/**
 * Create main control panel window
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: "Split Control",
    icon: devIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Load the app
  if (isDev) {
    window.loadURL("http://localhost:5174");
    window.webContents.openDevTools();
  } else {
    // In production, files are in the asar archive
    // __dirname points to: app.asar/dist-electron/main
    // We need to go up to app.asar and then into dist/
    const indexPath = path.join(__dirname, "../../dist/index.html");
    logger.info("Loading main window", { path: indexPath });
    window.loadFile(indexPath);
  }

  logger.info("Main window created");

  return window;
}

/**
 * Create graphics output window
 */
export function createGraphicsWindow(): BrowserWindow {
  // Get configured graphics dimensions
  const dimensions = getGraphicsDimensions();

  logger.info(
    "Creating graphics window with configured dimensions",
    dimensions,
  );

  const window = new BrowserWindow({
    width: dimensions.width,
    height: dimensions.height,
    title: "Split Control Graphics Output",
    icon: devIconPath(),
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      offscreen: true,
      backgroundThrottling: false,
    },
    show: false, // Hidden by default
  });

  // Load graphics renderer
  if (isDev) {
    const { port, wsPort } = getConfig().general;
    window.loadURL(
      `http://localhost:5174/graphics.html?webPort=${port}&wsPort=${wsPort}`,
    );
    // Open graphics DevTools only on demand; an inspector adds capture overhead.
  } else {
    // In production, files are in the asar archive
    // __dirname points to: app.asar/dist-electron/main
    // We need to go up to app.asar and then into dist/
    const graphicsPath = path.join(__dirname, "../../dist/graphics.html");
    logger.info("Loading graphics window", { path: graphicsPath });
    const { port, wsPort } = getConfig().general;
    window.loadFile(graphicsPath, {
      search: `webPort=${port}&wsPort=${wsPort}`,
    });
  }

  // Add keyboard shortcut to toggle DevTools (Cmd+Shift+I on Mac, Ctrl+Shift+I on Windows/Linux)
  window.webContents.on("before-input-event", (_event, input) => {
    if (input.key === "I" && (input.meta || input.control) && input.shift) {
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools({ mode: "detach" });
      }
    }
  });

  logger.info("Graphics window created");

  return window;
}

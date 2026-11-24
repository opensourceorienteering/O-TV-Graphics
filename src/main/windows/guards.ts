/**
 * Window guards. Graphic code must not escape its page: no popups (a popup would inherit the
 * opener's preload) and no navigation away. The operator UI opens links through
 * window:openExternal, never with window.open.
 */
import type { BrowserWindow, WebPreferences } from "electron";

/** The graphics window never uses the preload bridge, so it doesn't get one */
export function graphicsWindowPreferences(): WebPreferences {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    offscreen: true,
    backgroundThrottling: false,
  };
}

/** Same page (scheme, host, port and path); the query and hash may change */
export function allowNavigation(currentUrl: string, targetUrl: string): boolean {
  try {
    const a = new URL(currentUrl);
    const b = new URL(targetUrl);
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

export function guardWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!allowNavigation(win.webContents.getURL(), url)) event.preventDefault();
  });
}

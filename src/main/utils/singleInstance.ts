/**
 * One Split Control at a time (they would fight over the web, WebSocket and NDI outputs).
 *
 *  - Installed app: opening it again focuses the running window.
 *  - Development (`npm run dev`): the newly started app takes over, so you always see the code
 *    you just started. The old dev app quits as soon as the new one asks for the lock, and the
 *    new one gets it in the same call.
 *  - Development: the app also quits when the dev server that started it is gone, so stopping
 *    `npm run dev` never leaves an orphaned app behind (macOS / Linux).
 *
 * Call it once the app is ready: on macOS a takeover requested before `ready` stalls the new app.
 */

import { app } from "electron";

interface Options {
  dev: boolean;
  /** Bring the running app to the front (another copy was opened) */
  focus: () => void;
  log: (message: string) => void;
}

const LOCK_DATA = { dev: true };

/** True when this process may run; false when another Split Control keeps running instead */
export function claimSingleInstance({ dev, focus, log }: Options): boolean {
  app.on("second-instance", (_event, _argv, _cwd, data) => {
    if (dev && (data as typeof LOCK_DATA | undefined)?.dev) {
      log("A newer development instance started; quitting this one");
      app.quit();
      return;
    }
    focus();
  });
  if (!app.requestSingleInstanceLock(dev ? LOCK_DATA : undefined)) {
    log(dev
      ? "Another Split Control is running (an installed copy?) and keeps running; quitting this one"
      : "Split Control is already running; focusing it");
    return false;
  }
  if (dev) watchDevServer(log);
  return true;
}

/** Quit when the process that started us (the Vite dev server) is gone */
function watchDevServer(log: Options["log"]): void {
  const parent = process.ppid;
  const timer = setInterval(() => {
    // An orphaned process is re-parented (to launchd / init), so its parent id changes
    if (process.ppid !== parent) {
      clearInterval(timer);
      log("The dev server stopped; quitting");
      app.quit();
    }
  }, 2000);
  timer.unref();
}

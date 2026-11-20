/**
 * Who may call the app's sensitive functions. Graphics never get the preload bridge, so in
 * practice only the operator UI can call IPC at all; these checks are a second line, in case
 * graphic code ever gets a bridge again.
 */
import type { BrowserWindow, WebContents, WebFrameMain } from "electron";

const operator = new Set<BrowserWindow>();

/** The main window and pop-out monitor windows load the operator UI */
export function registerOperatorWindow(win: BrowserWindow): void {
  operator.add(win);
}

/** Open operator windows; closed ones are forgotten here */
export function operatorWindows(): BrowserWindow[] {
  for (const w of operator) if (w.isDestroyed()) operator.delete(w);
  return [...operator];
}

/** The top frame of an operator window, never a frame inside it or another window */
export function isOperatorMainFrame(
  event: { sender: WebContents; senderFrame: WebFrameMain | null },
  windows: () => Array<Pick<BrowserWindow, "webContents">>,
): boolean {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  return windows().some((w) => w.webContents === event.sender);
}

/** The file the operator picked in the import dialog: it may be imported once */
export class PickedFile {
  private path: string | null = null;

  remember(path: string): void {
    this.path = path;
  }

  take(path: string): boolean {
    if (!this.path || path !== this.path) return false;
    this.path = null;
    return true;
  }
}

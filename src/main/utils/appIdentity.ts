/**
 * App identity. Imported first in main, before anything reads Electron paths.
 *
 * The product is called Split Control (it was OL-Grafik). Electron derives the user data
 * folder from the product name, so it is pinned to the old folder: existing settings, events,
 * club logos and the DATAROOT stay where they are after the rename.
 */

import { app } from "electron";
import * as path from "path";

export const APP_NAME = "Split Control";
export const APP_TAGLINE = "Orienteering Graphics";
/** Folder name under the OS app-data directory (unchanged since OL-Grafik) */
export const DATA_FOLDER = "OL-Grafik";

app.setName(APP_NAME);
app.setPath("userData", path.join(app.getPath("appData"), DATA_FOLDER));

/** The app icon while developing (packaged builds take it from the bundle / executable) */
export function devIconPath(): string | undefined {
  return app.isPackaged ? undefined : path.join(process.cwd(), "resources", "icon.png");
}

if (!app.isPackaged && process.platform === "darwin") {
  void app.whenReady().then(() => {
    try {
      app.dock?.setIcon(devIconPath()!);
    } catch {
      /* keep Electron's icon */
    }
  });
}

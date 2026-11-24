/**
 * .splitlook files opened from the system (double-click, "Open with"). The path arrives in the
 * command line (Windows, Linux: on first start or, while running, via the second instance) or
 * in macOS's open-file event. It waits here until the library asks for it, then the library
 * shows the import confirmation: nothing is installed without the operator's yes.
 */
import fs from 'fs';
import { fileURLToPath } from 'url';

export const LOOK_FILE_EXTENSION = '.splitlook';

/** The last argument naming a .splitlook file that exists, or null */
export function lookFileFromArgv(argv: string[]): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    let arg = argv[i];
    if (typeof arg !== 'string' || !arg.toLowerCase().endsWith(LOOK_FILE_EXTENSION)) continue;
    try {
      // Linux desktops may pass file:// addresses
      if (arg.startsWith('file://')) arg = fileURLToPath(arg);
      if (fs.statSync(arg).isFile()) return arg;
    } catch {
      // not there (anymore)
    }
  }
  return null;
}

let pending: string | null = null;

export function setPendingLookFile(filePath: string): void {
  pending = filePath;
}

/** The file waiting to be imported, once */
export function takePendingLookFile(): string | null {
  const file = pending;
  pending = null;
  return file;
}

/**
 * Mock Electron module for testing
 */

export const app = {
  getPath: (name: string) => `/mock/path/${name}`,
  isReady: () => false, // Return false in tests to use development path
  on: () => {},
  quit: () => {},
  whenReady: () => Promise.resolve()
};

export const BrowserWindow = class {
  webContents = {
    send: () => {},
    on: () => {}
  };
  on = () => {};
  loadURL = () => Promise.resolve();
  loadFile = () => Promise.resolve();
};

export const ipcMain = {
  handle: () => {},
  on: () => {},
  removeHandler: () => {}
};

export const ipcRenderer = {
  invoke: () => Promise.resolve(),
  on: () => {},
  send: () => {}
};


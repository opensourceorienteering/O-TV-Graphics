/// <reference types="vite/client" />
/**
 * Global type definitions for renderer process
 */

export interface ElectronAPI {
  send: (channel: string, data: any) => void;
  receive: (channel: string, func: (...args: any[]) => void) => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
}

export interface AppInfo {
  version: string;
  platform: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    appInfo: AppInfo;
  }
}


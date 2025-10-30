/**
 * Preload Script
 * Exposes safe APIs to renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // IPC communication
  send: (channel: string, data: any) => {
    const validChannels = ['toMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel: string, func: (...args: any[]) => void) => {
    const validChannels = ['fromMain'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => func(...args));
    }
  },
  invoke: (channel: string, ...args: any[]) => {
    const validChannels = [
      'loadConfig',
      'saveConfig',
      'getProjects',
      'createProject',
      'loadProject',
      'saveProject',
      'deleteProject',
      'getTemplates',
      'loadTemplate',
      'playGraphic',
      'stopGraphic',
      'updateGraphic',
      'templates:getAll',
      'templates:getById',
      'templates:reload',
      'templates:getCacheStats',
      'data:getCompetitions',
      'data:getCachedCompetitions',
      'data:getClasses',
      'data:getCachedClasses',
      'data:getResults',
      'data:getCachedResults',
      'data:getClassResults',
      'data:getRunners',
      'data:startPolling',
      'data:stopPolling',
      'data:stopAllPolling',
      'data:getPollingStatus',
      'data:getStats',
      'data:clearCache',
      'data:fetchMappedData',
      'data:clearTransformedCache',
      'data:getTransformedCacheStats',
      // Data source channels
      'dataSource:getTypes',
      'dataSource:getAll',
      'dataSource:get',
      'dataSource:create',
      'dataSource:update',
      'dataSource:delete',
      'dataSource:test',
      'dataSource:getCompetitions',
      'dataSource:getClasses',
      'dataSource:getResults',
      'project:create',
      'project:load',
      'project:update',
      'project:delete',
      'project:list',
      'rundown:create',
      'rundown:load',
      'rundown:update',
      'rundown:delete',
      'rundown:list',
      'rundown:addItem',
      'rundown:updateItem',
      'rundown:removeItem',
      'rundown:reorderItems',
      'rundown:updateDataSource',
      'rundown:updateSettings',
      'rundown:updateAllowedTemplates',
      // Playback channels
      'playback:play',
      'playback:stop',
      'playback:update',
      'playback:next',
      'playback:previous',
      'playback:clear',
      'playback:getActive',
      // Window channels
      'window:showGraphics',
      'window:hideGraphics',
      'window:toggleGraphics',
      'window:isGraphicsVisible',
      'window:openExternal',
      // Output channels
      'output:getWebInfo',
      'output:getNDIInfo',
      'output:startNDI',
      'output:stopNDI',
      'output:updateConfig',
      'output:updateNDIConfig',
      // Settings channels
      'settings:get',
      'settings:update',
      'settings:reset',
      'settings:getPaths',
      // System channels
      'system:getStatus'
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
  }
});

// Expose version info
contextBridge.exposeInMainWorld('appInfo', {
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform
});


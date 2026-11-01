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
      'folder:list', 'folder:create', 'folder:update', 'folder:delete',
      'event:list', 'event:create', 'event:get', 'event:update', 'event:delete', 'event:test', 'event:classes', 'event:controls',
      'startlist:get', 'startlist:refresh', 'startlist:import', 'startlist:assignBibs', 'startlist:clearBibs', 'startlist:update', 'startlist:updatePreferences', 'startlist:exportPdf', 'startlist:clubs',
      'live:enter', 'live:exit', 'live:state', 'live:prepared',
      'control:openModule',
      'desk:templates', 'desk:state', 'desk:show', 'desk:update', 'desk:hide', 'desk:hideAll', 'desk:page',
      'event:exportSettings', 'event:pickSettingsFile', 'event:importSettings', 'desk:favorites', 'desk:saveFavorite', 'desk:deleteFavorite', 'desk:commands', 'desk:saveCommands', 'desk:weather', 'weather:lookup', 'output:testNDI', 'preview:draft', 'preview:clear',
      'preview:template', 'preview:get',
      'output:startLive',
      'window:openMonitor', 'window:closeMonitor', 'window:monitors',
      'templates:getSets',
      'templates:pickImport', 'templates:import', 'templates:exportSet', 'templates:removeSet', 'templates:setUsage', 'templates:openFolder',
      'clubLogos:status',
      'clubNames:list',
      'clubNames:set',
      'clubLogos:openFolder',
      'director:getUrl',
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
      'output:pattern', 'output:getWebInfo',
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
    // Say so instead of failing silently when a new channel is missing from this list
    return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
  }
});

// Expose version info
contextBridge.exposeInMainWorld('appInfo', {
  version: process.env.npm_package_version || '1.0.0',
  platform: process.platform
});


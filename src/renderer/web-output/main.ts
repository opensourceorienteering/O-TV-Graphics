/**
 * Web Output Renderer Entry Point
 * Standalone graphics renderer for network-accessible web output
 * Used by OBS Browser Source, vMix Web Input, and remote browsers
 */

import { io, Socket } from 'socket.io-client';
import { OGrafRenderer } from '../graphics/ograf-renderer';
import { OGrafManifest } from '../../shared/types/ograf';

// Global renderer instance
let renderer: OGrafRenderer | null = null;
let socket: Socket | null = null;

// Get WebSocket server URL from query parameters or use default
const urlParams = new URLSearchParams(window.location.search);
const wsHost = urlParams.get('host') || 'localhost';
const wsPort = urlParams.get('wsPort') || '5656';
const webServerPort = urlParams.get('webPort') || '5657';
const wsUrl = `http://${wsHost}:${wsPort}`;
const webServerUrl = `http://${wsHost}:${webServerPort}`;

// Generate unique client ID for this web renderer instance
const clientId = `WEB_RENDERER_${Math.random().toString(36).substring(2, 11)}`;

// Debug mode (show overlay if debug=true in query params)
const debugMode = urlParams.get('debug') === 'true';

/**
 * Simple logger that always logs with [WebOutput] prefix
 */
const logger = {
  log: (...args: any[]) => {
    console.log('[WebOutput]', ...args);
  },
  error: (...args: any[]) => {
    console.error('[WebOutput]', ...args);
  },
  warn: (...args: any[]) => {
    console.warn('[WebOutput]', ...args);
  }
};

/**
 * Send response back to server
 */
function sendResponse(command: string, id: string, result: any) {
  if (!socket) {
    logger.warn('[WebOutput] Cannot send response - socket not connected');
    return;
  }

  socket.emit('SPXMessage2Server', {
    spxcmd: 'graphics:response',
    command,
    id,
    result
  });

  logger.log('[WebOutput] 📤 Sent response:', { command, id, result });
}

/**
 * Initialize the graphics renderer
 */
function initRenderer() {
  const container = document.getElementById('graphics-container');
  if (!container) {
    logger.error('[WebOutput] Container not found');
    return;
  }

  // Create renderer instance with web server URL
  renderer = new OGrafRenderer(container, webServerUrl);
  logger.log('[WebOutput] Renderer initialized', { webServerUrl });

  // Show debug overlay if enabled
  if (debugMode) {
    const debugOverlay = document.getElementById('debug-overlay');
    if (debugOverlay) {
      debugOverlay.classList.add('visible');
    }
  }
}

/**
 * Update debug overlay statistics
 */
function updateDebugStats() {
  if (!renderer || !debugMode) return;

  const loadedCount = document.getElementById('loaded-graphics');
  const playingCount = document.getElementById('playing-graphics');
  const clientIdEl = document.getElementById('client-id');

  if (loadedCount) {
    loadedCount.textContent = `Loaded: ${renderer.getLoadedCount()}`;
  }
  if (playingCount) {
    playingCount.textContent = `Playing: ${renderer.getPlayingCount()}`;
  }
  if (clientIdEl) {
    clientIdEl.textContent = `Client: ${clientId}`;
  }
}

/**
 * Initialize WebSocket connection
 */
function initWebSocket() {
  logger.log('[WebOutput] 🔌 Initializing WebSocket connection to', wsUrl);

  // Connect to WebSocket server
  socket = io(wsUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10
  });

  socket.on('connect', () => {
    logger.log('[WebOutput] ✅ WebSocket connected successfully!');
    logger.log('[WebOutput] 📡 Socket ID:', socket?.id);
    updateDebugStatus('connected');

    // Identify as web renderer with unique ID
    socket?.emit('SPXMessage2Server', {
      spxcmd: 'identifyClient',
      name: clientId
    });
    logger.log('[WebOutput] 🏷️  Identified as', clientId);
  });

  socket.on('disconnect', () => {
    logger.log('[WebOutput] ❌ WebSocket disconnected');
    updateDebugStatus('disconnected');
  });

  socket.on('reconnect', (attemptNumber: number) => {
    logger.log('[WebOutput] 🔄 WebSocket reconnected after', attemptNumber, 'attempts');
    updateDebugStatus('connected');
  });

  socket.on('reconnect_error', (error: Error) => {
    logger.error('[WebOutput] ⚠️  Reconnection error:', error.message);
  });

  socket.on('connect_error', (error: Error) => {
    logger.error('[WebOutput] ⚠️  Connection error:', error.message);
    updateDebugStatus('disconnected');
  });

  // Listen for graphics commands from server
  socket.on('SPXMessage2Client', async (data: any) => {
    logger.log('[WebOutput] 📨 Message from server:', data);
    await handleCommand(data);
  });
}

/**
 * Handle graphics commands from WebSocket
 */
async function handleCommand(data: any) {
  // Filter for graphics commands only
  if (data.spxcmd !== 'graphics:command') {
    logger.log('[WebOutput] ⏭️  Ignoring non-graphics message:', data.spxcmd);
    return;
  }

  logger.log('[WebOutput] ✅ Message is a graphics command!');

  if (!renderer) {
    logger.error('[WebOutput] ❌ Renderer not initialized!');
    return;
  }

  const { command, payload } = data;

  try {
    logger.log('[WebOutput] 🎬 Executing command:', command, 'with payload:', payload);

    switch (command) {
      case 'load':
        await handleLoad(payload);
        break;
      case 'play':
        await handlePlay(payload);
        break;
      case 'stop':
        await handleStop(payload);
        break;
      case 'update':
        await handleUpdate(payload);
        break;
      case 'dispose':
        await handleDispose(payload);
        break;
      case 'clear':
        await handleClear();
        break;
      default:
        logger.warn('[WebOutput] ⚠️  Unknown command:', command);
    }

    updateDebugStats();
  } catch (error) {
    logger.error('[WebOutput] ❌ Command error:', error);
  }
}

/**
 * Load a graphic
 */
async function handleLoad(payload: any) {
  const { id, manifest, templateId, data } = payload;
  logger.log('[WebOutput] Loading graphic', { id, templateId });

  // Check if already loaded
  if (renderer!.isLoaded(id)) {
    logger.warn('[WebOutput] Graphic already loaded', id);
    // Send success response even if already loaded
    sendResponse('load', id, { success: true, alreadyLoaded: true });
    return;
  }

  try {
    const result = await renderer!.loadGraphic(id, manifest as OGrafManifest, templateId, data);
    logger.log('[WebOutput] Graphic loaded', result);

    // Send success response
    sendResponse('load', id, { success: true });
  } catch (error) {
    logger.error('[WebOutput] Load failed', id, error);

    // Send error response
    sendResponse('load', id, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Play a graphic
 */
async function handlePlay(payload: any) {
  const { id, options } = payload;
  logger.log('[WebOutput] Playing graphic', { id, options });

  // Check if loaded
  if (!renderer!.isLoaded(id)) {
    logger.warn('[WebOutput] Graphic not loaded, cannot play', id);
    sendResponse('play', id, { success: false, error: 'Graphic not loaded' });
    return;
  }

  try {
    const result = await renderer!.playGraphic(id, options);
    logger.log('[WebOutput] Graphic playing', result);

    // Send success response
    sendResponse('play', id, { success: true, result });
  } catch (error) {
    logger.error('[WebOutput] Play failed', id, error);

    // Send error response
    sendResponse('play', id, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Stop a graphic
 */
async function handleStop(payload: any) {
  const { id, options } = payload;
  logger.log('[WebOutput] Stopping graphic', { id, options });

  // Check if loaded
  if (!renderer!.isLoaded(id)) {
    logger.warn('[WebOutput] Graphic not loaded, cannot stop', id);
    sendResponse('stop', id, { success: false, error: 'Graphic not loaded' });
    return;
  }

  try {
    const result = await renderer!.stopGraphic(id, options);
    logger.log('[WebOutput] Graphic stopped', result);

    // Send success response
    sendResponse('stop', id, { success: true, result });
  } catch (error) {
    logger.error('[WebOutput] Stop failed', id, error);

    // Send error response
    sendResponse('stop', id, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Update a graphic
 */
async function handleUpdate(payload: any) {
  const { id, data } = payload;
  logger.log('[WebOutput] Updating graphic', { id, dataKeys: Object.keys(data || {}) });

  // Check if loaded
  if (!renderer!.isLoaded(id)) {
    logger.warn('[WebOutput] Graphic not loaded, cannot update', id);
    sendResponse('update', id, { success: false, error: 'Graphic not loaded' });
    return;
  }

  try {
    const result = await renderer!.updateGraphic(id, data);
    logger.log('[WebOutput] Graphic updated', result);

    // Send success response
    sendResponse('update', id, { success: true, result });
  } catch (error) {
    logger.error('[WebOutput] Update failed', id, error);

    // Send error response
    sendResponse('update', id, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Dispose a graphic
 */
async function handleDispose(payload: any) {
  const { id } = payload;
  logger.log('[WebOutput] Disposing graphic', { id });

  // Check if loaded
  if (!renderer!.isLoaded(id)) {
    logger.warn('[WebOutput] Graphic not loaded, cannot dispose', id);
    sendResponse('dispose', id, { success: false, error: 'Graphic not loaded' });
    return;
  }

  try {
    const result = await renderer!.disposeGraphic(id);
    logger.log('[WebOutput] Graphic disposed', result);

    // Send success response
    sendResponse('dispose', id, { success: true, result });
  } catch (error) {
    logger.error('[WebOutput] Dispose failed', id, error);

    // Send error response
    sendResponse('dispose', id, {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Clear all graphics
 */
async function handleClear() {
  logger.log('[WebOutput] Clearing all graphics');

  try {
    await renderer!.clearAll();
    logger.log('[WebOutput] All graphics cleared');

    // Send success response (use empty string as id for clear command)
    sendResponse('clear', '', { success: true });
  } catch (error) {
    logger.error('[WebOutput] Clear failed', error);

    // Send error response
    sendResponse('clear', '', {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Update debug status indicator
 */
function updateDebugStatus(status: 'connected' | 'disconnected' | 'error') {
  const statusEl = document.getElementById('ws-status');
  if (statusEl) {
    statusEl.textContent = `WebSocket: ${status === 'connected' ? 'Connected' : status === 'error' ? 'Error' : 'Disconnected'}`;
    statusEl.className = `status ${status}`;
  }

  const hostEl = document.getElementById('ws-host');
  if (hostEl) {
    hostEl.textContent = `Host: ${wsUrl}`;
  }
}

/**
 * Initialize on DOM ready
 */
document.addEventListener('DOMContentLoaded', () => {
  logger.log('');
  logger.log('═══════════════════════════════════════════════════════════');
  logger.log('🌐 OL-GRAFIK WEB OUTPUT RENDERER');
  logger.log('═══════════════════════════════════════════════════════════');
  logger.log('📍 Client ID:', clientId);
  logger.log('🌐 Web Server:', webServerUrl);
  logger.log('🔌 WebSocket:', wsUrl);
  logger.log('🐛 Debug Mode:', debugMode);
  logger.log('═══════════════════════════════════════════════════════════');
  logger.log('');

  logger.log('[WebOutput] 🚀 Initializing web output renderer...');
  initRenderer();
  initWebSocket();

  logger.log('[WebOutput] ✅ Initialization complete!');
  logger.log('[WebOutput] 👀 Waiting for playback commands...');
  logger.log('');
});

// Handle window close
window.addEventListener('beforeunload', async () => {
  if (renderer) {
    await renderer.clearAll();
  }
  if (socket) {
    socket.disconnect();
  }
});


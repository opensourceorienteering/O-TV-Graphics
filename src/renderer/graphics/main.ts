/**
 * Graphics Renderer Entry Point
 * Initializes the OGRAF renderer and handles playback commands via WebSocket
 */

import { io, Socket } from "socket.io-client";
import { RendererCommandQueue } from "./RendererCommandQueue";
import { OGrafRenderer } from "./ograf-renderer";
import { OGrafManifest } from "../../shared/types/ograf";

// Global renderer instance
let renderer: OGrafRenderer | null = null;
let socket: Socket | null = null;
const commands = new RendererCommandQueue();
let connectionVersion = 0;
let readyForResponses = false;
const ports = new URLSearchParams(window.location.search);
const wsOrigin = `http://localhost:${ports.get("wsPort") || "5656"}`;
const webOrigin = `http://localhost:${ports.get("webPort") || "5657"}`;

/**
 * Initialize the graphics renderer
 */
function initRenderer() {
  const container = document.getElementById("graphics-container");
  if (!container) {
    console.error("[Graphics] Container not found");
    return;
  }

  // Create renderer instance
  renderer = new OGrafRenderer(container, webOrigin);
  console.log("[Graphics] Renderer initialized");

  // NOTE: Debug overlay is intentionally NOT shown in graphics window
  // to prevent it from appearing in NDI output. Use DevTools console instead.
}

/**
 * Send response back to server
 */
/**
 * Request id of the command being handled, per command and graphic. Commands for one graphic
 * run one at a time, so the id set when a command starts belongs to the response it sends.
 */
const requestIds = new Map<string, string>();
function withRequestId(data: any, run: () => Promise<void>) {
  const requestId = data?.payload?.requestId;
  if (requestId) requestIds.set(`${data.command}:${data.payload?.id || ""}`, requestId);
  return run();
}

function sendResponse(command: string, id: string, result: any) {
  const requestKey = `${command}:${id}`;
  const requestId = requestIds.get(requestKey);
  requestIds.delete(requestKey);
  if (!socket || !readyForResponses) {
    console.warn("[Graphics] Cannot send response - socket not connected");
    return;
  }

  socket.emit("SPXMessage2Server", {
    spxcmd: "graphics:response",
    command,
    id,
    result,
    ...(requestId ? { requestId } : {}),
  });

  console.log("[Graphics] 📤 Sent response:", { command, id, result });
}

/**
 * Initialize WebSocket connection
 */
function initWebSocket() {
  console.log("[Graphics] Initializing WebSocket connection", wsOrigin);

  // Connect to WebSocket server
  socket = io(wsOrigin, {
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: Infinity,
  });

  socket.on("connect", async () => {
    const version = ++connectionVersion;
    readyForResponses = false;
    await commands.barrier(async () => {
      await renderer?.clearAll();
    });
    if (!socket?.connected || version !== connectionVersion) return;
    readyForResponses = true;
    console.log("[Graphics] ✅ WebSocket connected successfully!");
    console.log("[Graphics] 📡 Socket ID:", socket?.id);

    // Identify as graphics renderer
    socket?.emit("SPXMessage2Server", {
      spxcmd: "identifyClient",
      name: "GRAPHICS_RENDERER",
    });
    console.log("[Graphics] 🏷️  Identified as GRAPHICS_RENDERER");
  });

  socket.on("disconnect", () => {
    connectionVersion++;
    readyForResponses = false;
    console.log("[Graphics] ❌ WebSocket disconnected");
  });

  socket.on("connect_error", (error) => {
    console.error("[Graphics] ⚠️  WebSocket connection error:", error);
  });

  socket.on("error", (error) => {
    console.error("[Graphics] ⚠️  WebSocket error:", error);
  });

  // Listen for playback commands (all messages come through SPXMessage2Client)
  socket.on("SPXMessage2Client", async (data) => {
    if (data.command === "clear")
      await commands.barrier(() => withRequestId(data, () => handlePlaybackCommand(data)));
    else
      await commands.enqueue(data.payload?.id || "__control__", () =>
        withRequestId(data, () => handlePlaybackCommand(data)),
      );
  });
  console.log("[Graphics] 👂 Listening for SPXMessage2Client events");
}

/**
 * Handle playback commands from control panel
 */
async function handlePlaybackCommand(data: any) {
  console.log("[Graphics] 📨 Received message:", JSON.stringify(data, null, 2));

  // Filter for graphics commands only
  if (data.spxcmd !== "graphics:command") {
    console.log("[Graphics] ⏭️  Ignoring non-graphics message:", data.spxcmd);
    return;
  }

  console.log("[Graphics] ✅ Message is a graphics command!");

  if (!renderer) {
    console.error("[Graphics] ❌ Renderer not initialized!");
    return;
  }

  try {
    const { command, payload } = data;

    console.log("[Graphics] 🎬 Processing command:", command);
    console.log("[Graphics] 📦 Payload:", JSON.stringify(payload, null, 2));

    switch (command) {
      case "load":
        console.log("[Graphics] 📥 Loading graphic...");
        await handleLoad(payload);
        break;

      case "play":
        console.log("[Graphics] ▶️  Playing graphic...");
        await handlePlay(payload);
        break;

      case "stop":
        console.log("[Graphics] ⏹️  Stopping graphic...");
        await handleStop(payload);
        break;

      case "update":
        console.log("[Graphics] 🔄 Updating graphic...");
        await handleUpdate(payload);
        break;

      case "custom":
        await handleCustom(payload);
        break;

      case "dispose":
        console.log("[Graphics] 🗑️  Disposing graphic...");
        await handleDispose(payload);
        break;

      case "clear":
        console.log("[Graphics] 🧹 Clearing all graphics...");
        await handleClear();
        break;

      default:
        console.warn("[Graphics] ⚠️  Unknown command:", command);
    }
  } catch (error) {
    console.error("[Graphics] ❌ Command failed!");
    console.error("[Graphics] Command:", data.command);
    console.error("[Graphics] Error:", error);
    console.error(
      "[Graphics] Stack:",
      error instanceof Error ? error.stack : "No stack trace",
    );
  }
}

/**
 * Load a graphic
 */
async function handleLoad(payload: {
  id: string;
  manifest: OGrafManifest;
  templateId: string;
  data: any;
}) {
  console.log("[Graphics] Loading graphic", payload.id);

  const { id, manifest, templateId, data } = payload;

  // Check if already loaded
  if (renderer!.isLoaded(id)) {
    console.warn("[Graphics] Graphic already loaded", id);
    // Send success response even if already loaded
    sendResponse("load", id, { success: true, alreadyLoaded: true });
    return;
  }

  try {
    await renderer!.loadGraphic(id, manifest, templateId, data);
    console.log("[Graphics] Graphic loaded", id);

    // Send success response
    sendResponse("load", id, { success: true });
  } catch (error) {
    console.error("[Graphics] Load failed", id, error);

    // Send error response
    sendResponse("load", id, {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Play a graphic
 */
async function handlePlay(payload: { id: string; options?: any }) {
  console.log(
    "[Graphics] Playing graphic",
    payload.id,
    "with options:",
    payload.options,
  );

  const { id, options = {} } = payload;

  // Load if not already loaded (shouldn't happen, but handle gracefully)
  if (!renderer!.isLoaded(id)) {
    console.warn("[Graphics] Graphic not loaded, cannot play", id);
    sendResponse("play", id, { success: false, error: "Graphic not loaded" });
    return;
  }

  try {
    const result = await renderer!.playGraphic(id, options);
    console.log("[Graphics] Graphic playing", id, "result:", result);

    // Send success response with result
    sendResponse("play", id, { success: true, result });
  } catch (error) {
    console.error("[Graphics] Play failed", id, error);

    // Send error response
    sendResponse("play", id, {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Stop a graphic
 */
async function handleStop(payload: { id: string; skipAnimation?: boolean }) {
  console.log("[Graphics] Stopping graphic", payload.id);

  const { id, skipAnimation = false } = payload;

  if (!renderer!.isLoaded(id)) {
    console.warn("[Graphics] Graphic not loaded, cannot stop", id);
    return;
  }

  await renderer!.stopGraphic(id, { skipAnimation });
  console.log("[Graphics] Graphic stopped", id);

  // Note: Graphics are NOT auto-disposed after stopping
  // This allows graphics to be played again without reloading
  // Disposal happens explicitly via the 'dispose' command or 'clear' command
}

/**
 * Update a graphic's data
 */
async function handleUpdate(payload: {
  id: string;
  data: any;
  skipAnimation?: boolean;
}) {
  console.log("[Graphics] Updating graphic", payload.id);

  const { id, data } = payload;

  if (!renderer!.isLoaded(id)) {
    console.warn("[Graphics] Graphic not loaded, cannot update", id);
    return;
  }

  await renderer!.updateGraphic(id, data, payload.skipAnimation);
  console.log("[Graphics] Graphic updated", id);
}

/**
 * Invoke an OGraf custom action on a graphic
 */
async function handleCustom(payload: {
  id: string;
  actionId: string;
  payload?: any;
  skipAnimation?: boolean;
}) {
  if (!renderer!.isLoaded(payload.id)) {
    console.warn(
      "[Graphics] Graphic not loaded, cannot run custom action",
      payload.id,
    );
    return;
  }
  await renderer!.customAction(
    payload.id,
    payload.actionId,
    payload.payload,
    payload.skipAnimation,
  );
}

/**
 * Dispose a graphic
 */
async function handleDispose(payload: { id: string }) {
  console.log("[Graphics] Disposing graphic", payload.id);

  const { id } = payload;

  if (!renderer!.isLoaded(id)) {
    console.warn("[Graphics] Graphic not loaded, cannot dispose", id);
    return;
  }

  await renderer!.disposeGraphic(id);
  console.log("[Graphics] Graphic disposed", id);
}

/**
 * Clear all graphics
 */
async function handleClear() {
  console.log("[Graphics] Clearing all graphics");

  try {
    await renderer!.clearAll();
    console.log("[Graphics] All graphics cleared");

    // Send success response (use empty string as id for clear command)
    sendResponse("clear", "", { success: true });
  } catch (error) {
    console.error("[Graphics] Clear failed", error);

    // Send error response
    sendResponse("clear", "", {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Initialize on DOM ready
 */
document.addEventListener("DOMContentLoaded", () => {
  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🎨 TV-GRAFIK GRAPHICS RENDERER");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("📍 Window: Graphics Output");
  console.log("Web Server:", webOrigin);
  console.log("WebSocket:", wsOrigin);
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");

  console.log("[Graphics] 🚀 Initializing graphics renderer...");
  initRenderer();
  initWebSocket();

  console.log("[Graphics] ✅ Initialization complete!");
  console.log("[Graphics] 👀 Waiting for playback commands...");
  console.log("");
});

// Handle window close
window.addEventListener("beforeunload", async () => {
  if (renderer) {
    await renderer.clearAll();
  }
  if (socket) {
    socket.disconnect();
  }
});

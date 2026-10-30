/**
 * Output IPC Handlers
 * Handles IPC communication for web output and NDI output
 */

import { ipcMain } from "electron";
import { getLogger } from "../utils/logger";
import { getWebServer } from "../output/WebServer";
import { getConfig } from "../utils/config";
import { ndiOutputManager } from "../output/NDIOutputManager";
import { frameCaptureService } from "../output/FrameCaptureService";
import { checkNDIAvailability } from "../utils/ndi-check";
import { getGraphicsDimensions } from "../windows";
import os from "os";
import type { EventLiveOutputs } from "../../shared/types/event";

const logger = getLogger();

/** Set when the output handlers are registered (NDI start/stop share their lifecycle guard) */
let startNDIOutput: (() => Promise<{ success: boolean; error?: string }>) | null = null;
let stopNDIOutput: (() => Promise<unknown>) | null = null;
/** NDI was turned on by entering Live (so ending Live turns it off again) */
let ndiStartedByLive = false;

/**
 * Turn on the outputs an event uses in Live. Failures do not stop Live; they are returned so
 * the desk can tell the operator. NDI is stopped when the event does not use it.
 */
export async function activateLiveOutputs(
  wanted: EventLiveOutputs,
): Promise<{ web: boolean; ndi: boolean; errors: string[] }> {
  const errors: string[] = [];
  const webServer = getWebServer();
  if (wanted.web && !webServer.isRunning()) {
    try {
      await webServer.start();
    } catch (error) {
      errors.push(`Web output could not start: ${(error as Error).message}`);
    }
  }
  const ndiActive = () => ndiOutputManager.getStatus().active;
  if (wanted.ndi && !ndiActive() && startNDIOutput) {
    const result = await startNDIOutput();
    if (result.success) ndiStartedByLive = true;
    else errors.push(`NDI output could not start: ${result.error || "unknown error"}`);
  } else if (!wanted.ndi && ndiActive() && stopNDIOutput) {
    await stopNDIOutput();
    ndiStartedByLive = false;
  }
  if (errors.length) logger.warn("Live outputs did not all start", { errors });
  return { web: wanted.web && webServer.isRunning(), ndi: ndiActive(), errors };
}

/** Ending Live: stop NDI if Live started it. The web server stays up (it also serves the control API). */
export async function deactivateLiveOutputs(): Promise<void> {
  if (ndiStartedByLive && stopNDIOutput) await stopNDIOutput();
  ndiStartedByLive = false;
}

/**
 * Register output-related IPC handlers
 */
export function registerOutputHandlers() {
  /**
   * Get web output information
   */
  ipcMain.handle("output:getWebInfo", async () => {
    try {
      logger.debug("IPC: output:getWebInfo");

      const webServer = getWebServer();
      const config = getConfig();
      const hostname = os.hostname();
      const networkInterfaces = os.networkInterfaces();

      // Get local IP addresses
      const addresses: string[] = [];
      Object.values(networkInterfaces).forEach((iface) => {
        if (iface) {
          iface.forEach((addr) => {
            if (addr.family === "IPv4" && !addr.internal) {
              addresses.push(addr.address);
            }
          });
        }
      });

      const port = webServer.getPort();
      const wsPort = config.general.wsPort;

      return {
        success: true,
        data: {
          hostname,
          port,
          wsPort,
          enabled: config.output.web.enabled,
          cors: config.output.web.cors,
          isRunning: webServer.isRunning(),
          localUrls: addresses.map((addr) => ({
            address: addr,
            url: `http://${addr}:${port}/output`,
            wsUrl: `http://${addr}:${wsPort}`,
          })),
          localhostUrl: `http://localhost:${port}/output`,
          localhostWsUrl: `http://localhost:${wsPort}`,
        },
      };
    } catch (error) {
      logger.error("IPC error: output:getWebInfo", {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  /**
   * Get NDI output information
   */
  ipcMain.handle("output:getNDIInfo", async () => {
    try {
      logger.debug("IPC: output:getNDIInfo");

      const availability = checkNDIAvailability();
      const status = ndiOutputManager.getStatus();
      const captureStatus = frameCaptureService.getStatus();

      return {
        success: true,
        data: {
          available: availability.available,
          version: availability.version,
          error: availability.error,
          initialized: status.initialized,
          enabled: status.enabled,
          active: status.active,
          name: status.name,
          fps: status.fps,
          frameCount: status.frameCount,
          lastFrameTime: status.lastFrameTime,
          capturing: captureStatus.isCapturing,
          captureFrameCount: captureStatus.frameCount,
          captureErrors: captureStatus.errorCount,
          captureSkippedFrames: captureStatus.skippedFrameCount,
          measuredFps: captureStatus.measuredFps,
          captureDurationMs: captureStatus.lastCaptureDurationMs,
        },
      };
    } catch (error) {
      logger.error("IPC error: output:getNDIInfo", {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  /**
   * Start NDI output
   */
  let ndiLifecycleVersion = 0;
  const startNDI = async () => {
    const version = ndiLifecycleVersion;
    try {
      logger.debug("IPC: output:startNDI");
      if (
        ndiOutputManager.getStatus().active &&
        frameCaptureService.getStatus().isCapturing
      )
        return { success: true, message: "NDI output is already running" };

      const started = await ndiOutputManager.start();

      if (version !== ndiLifecycleVersion) {
        await ndiOutputManager.stop();
        return { success: false, error: "NDI start was cancelled" };
      }
      if (started) {
        // Get configured graphics dimensions for NDI output
        const dimensions = getGraphicsDimensions();

        // Start frame capture with target dimensions
        const capturing = await frameCaptureService.start({
          fps: ndiOutputManager.getConfig().fps,
          targetWidth: dimensions.width,
          targetHeight: dimensions.height,
        });
        if (version !== ndiLifecycleVersion) {
          frameCaptureService.stop();
          await ndiOutputManager.stop();
          return { success: false, error: "NDI start was cancelled" };
        }
        if (!capturing) {
          await ndiOutputManager.stop();
          return {
            success: false,
            error:
              "NDI capture could not start. Reopen the graphics window and try again.",
          };
        }

        return {
          success: true,
          message: "NDI output started",
        };
      } else {
        return {
          success: false,
          error: "Failed to start NDI output",
        };
      }
    } catch (error) {
      frameCaptureService.stop();
      await ndiOutputManager.stop();
      logger.error("IPC error: output:startNDI", {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  };

  let startingNDI: Promise<unknown> | undefined;
  const ensureNDIStarted = () => {
    if (startingNDI) return startingNDI;
    startingNDI = startNDI().finally(() => {
      startingNDI = undefined;
    });
    return startingNDI;
  };
  ipcMain.handle("output:startNDI", ensureNDIStarted);
  startNDIOutput = ensureNDIStarted as () => Promise<{ success: boolean; error?: string }>;

  ipcMain.handle("output:startLive", async () => {
    try {
      const config = getConfig();
      const webServer = getWebServer();
      if (config.output.web.enabled && !webServer.isRunning())
        await webServer.start();

      if (config.output.ndi.enabled) {
        const ndi = (await ensureNDIStarted()) as {
          success: boolean;
          error?: string;
        };
        if (!ndi.success) return ndi;
      }

      return {
        success: true,
        data: {
          web: config.output.web.enabled && webServer.isRunning(),
          ndi:
            config.output.ndi.enabled && ndiOutputManager.getStatus().active,
        },
      };
    } catch (error) {
      logger.error("IPC error: output:startLive", {
        error: (error as Error).message,
      });
      return { success: false, error: (error as Error).message };
    }
  });

  /**
   * Stop NDI output
   */
  const stopNDI = async () => {
    ndiLifecycleVersion++;
    frameCaptureService.stop();
    await ndiOutputManager.stop();
  };
  stopNDIOutput = stopNDI;

  ipcMain.handle("output:stopNDI", async () => {
    try {
      logger.debug("IPC: output:stopNDI");
      await stopNDI();
      // Stopped by hand: ending Live has nothing left to stop
      ndiStartedByLive = false;

      return {
        success: true,
        message: "NDI output stopped",
      };
    } catch (error) {
      logger.error("IPC error: output:stopNDI", {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  /**
   * Update NDI configuration
   */
  ipcMain.handle("output:updateNDIConfig", async (_event, config: any) => {
    try {
      logger.debug("IPC: output:updateNDIConfig", { config });

      const updated = await ndiOutputManager.updateConfig(config);

      if (updated) {
        // Update frame capture FPS if changed
        if (config.fps !== undefined) {
          frameCaptureService.updateOptions({ fps: config.fps });
        }

        return {
          success: true,
          message: "NDI configuration updated",
        };
      } else {
        return {
          success: false,
          error: "Failed to update NDI configuration",
        };
      }
    } catch (error) {
      logger.error("IPC error: output:updateNDIConfig", {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  /**
   * Update output configuration
   */
  ipcMain.handle("output:updateConfig", async (_event, updates: any) => {
    try {
      logger.debug("IPC: output:updateConfig", { updates });

      // TODO: Implement configuration updates
      // This will require restarting servers in some cases

      return {
        success: true,
        message: "Configuration update not yet implemented",
      };
    } catch (error) {
      logger.error("IPC error: output:updateConfig", {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  /**
   * Test NDI output
   * Performs a comprehensive test of NDI functionality
   */
  ipcMain.handle("output:testNDI", async () => {
    try {
      logger.debug("IPC: output:testNDI");

      const testResults = {
        available: false,
        version: null as string | null,
        cpuSupported: false,
        canInitialize: false,
        canCreateSender: false,
        error: null as string | null,
        details: [] as string[],
      };

      // Step 1: Check NDI SDK availability
      const availability = checkNDIAvailability();
      testResults.available = availability.available;
      testResults.version = availability.version || null;

      if (!availability.available) {
        testResults.error = availability.error || "NDI SDK not available";
        testResults.details.push("❌ NDI SDK not found on system");
        testResults.details.push(
          "💡 Install NDI Runtime from https://ndi.link/NDIRedistV5",
        );

        return {
          success: true,
          data: testResults,
        };
      }

      testResults.details.push("✅ NDI SDK found");
      testResults.details.push(`📦 Version: ${testResults.version}`);

      // Step 2: Check CPU support
      try {
        const { isSupportedCPU } = require("../utils/ndi-check");
        testResults.cpuSupported = isSupportedCPU();

        if (testResults.cpuSupported) {
          testResults.details.push("✅ CPU supports NDI");
        } else {
          testResults.details.push("⚠️  CPU may not be fully supported");
        }
      } catch (error) {
        testResults.details.push("⚠️  Could not verify CPU support");
      }

      // Step 3: Check if NDI Output Manager is initialized
      const status = ndiOutputManager.getStatus();
      testResults.canInitialize = status.initialized;

      if (status.initialized) {
        testResults.details.push("✅ NDI Output Manager initialized");
      } else {
        testResults.details.push("❌ NDI Output Manager not initialized");
        testResults.error = "NDI Output Manager failed to initialize";

        return {
          success: true,
          data: testResults,
        };
      }

      // Step 4: Check if sender can be created (test by checking current status)
      if (status.active) {
        testResults.canCreateSender = true;
        testResults.details.push("✅ NDI sender is active");
        testResults.details.push(`📡 Source name: ${status.name}`);
        testResults.details.push(`🎬 Frame rate: ${status.fps} FPS`);
        testResults.details.push(`📊 Frames sent: ${status.frameCount}`);
      } else {
        testResults.details.push("ℹ️  NDI sender not currently active");
        testResults.details.push('💡 Click "Start NDI" to send');
        testResults.canCreateSender = true; // Assume it can be created if initialized
      }

      // Step 5: Check frame capture service
      const captureStatus = frameCaptureService.getStatus();
      if (captureStatus.isCapturing) {
        testResults.details.push("✅ Frame capture active");
        testResults.details.push(
          `📸 Captured frames: ${captureStatus.frameCount}`,
        );

        if (captureStatus.errorCount > 0) {
          testResults.details.push(
            `⚠️  Capture errors: ${captureStatus.errorCount}`,
          );
        }
      } else if (status.active) {
        testResults.details.push(
          "⚠️  NDI active but frame capture not running",
        );
      }

      // Overall result
      if (testResults.available && testResults.canInitialize) {
        testResults.details.push("");
        testResults.details.push("✅ NDI is ready to use!");
      }

      return {
        success: true,
        data: testResults,
      };
    } catch (error) {
      logger.error("IPC error: output:testNDI", {
        error: (error as Error).message,
      });
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  logger.info("Output IPC handlers registered");
}

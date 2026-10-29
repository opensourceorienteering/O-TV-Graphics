/**
 * Frame Capture Service
 * Captures frames from the graphics window and sends them to NDI
 *
 * This service handles:
 * - Periodic frame capture from Electron BrowserWindow
 * - Image format conversion (PNG/JPEG → Buffer)
 * - Frame rate management
 * - Memory optimization
 */

import { BrowserWindow } from "electron";
import { getLogger } from "../utils/logger";
import { ndiOutputManager } from "./NDIOutputManager";

const logger = getLogger();

export interface FrameCaptureOptions {
  /** Target frame rate (frames per second) */
  fps: number;
  /** Target output width in pixels (NDI output resolution) */
  targetWidth?: number;
  /** Target output height in pixels (NDI output resolution) */
  targetHeight?: number;
  /** Image format for capture ('png' or 'jpeg') */
  format?: "png" | "jpeg";
  /** JPEG quality (1-100, only used if format is 'jpeg') */
  quality?: number;
}

/**
 * Frame Capture Service (Singleton)
 */
class FrameCaptureService {
  private static instance: FrameCaptureService | null = null;

  private window: BrowserWindow | null = null;
  private isCapturing: boolean = false;
  private captureInterval: NodeJS.Timeout | null = null;
  private options: FrameCaptureOptions;
  private frameCount: number = 0;
  private errorCount: number = 0;
  private lastCaptureTime: number = 0;
  private totalErrorCount = 0;
  private skippedFrameCount = 0;
  private captureTimes: number[] = [];
  private lastCaptureDurationMs = 0;
  private latestPaint: Electron.NativeImage | null = null;
  private convertedPaint: Electron.NativeImage | null = null;
  private latestBitmap: Awaited<ReturnType<FrameCaptureService['convertToBitmap']>> | null = null;
  /**
   * Offscreen output: Chromium paints at twice the output rate (only while something moves)
   * and a drift-corrected output clock sends the newest paint on every tick. Sampling a
   * renderer that runs at the same rate as the output repeats and skips frames whenever the
   * two clocks drift; oversampling means every output frame is a new, at most half-frame-old
   * picture. Static graphics repeat the last bitmap without converting it again.
   */
  private readonly onPaint = (_event: unknown, _dirty: unknown, image: Electron.NativeImage) => {
    this.latestPaint = image;
  };
  private sending = false;
  private isCapturingFrame: boolean = false; // Guard to prevent overlapping captures

  private constructor() {
    this.options = {
      fps: 30,
      format: "png",
      quality: 90,
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): FrameCaptureService {
    if (!FrameCaptureService.instance) {
      FrameCaptureService.instance = new FrameCaptureService();
    }
    return FrameCaptureService.instance;
  }

  /**
   * Set the graphics window to capture from
   */
  public setWindow(window: BrowserWindow): void {
    this.window = window;
    logger.info("Frame capture window set");
  }

  /**
   * Start capturing frames
   */
  public async start(options?: Partial<FrameCaptureOptions>): Promise<boolean> {
    try {
      if (this.isCapturing) {
        logger.warn("Frame capture already running");
        return false;
      }

      if (!this.window || this.window.isDestroyed()) {
        logger.error(
          "Cannot start frame capture - window not set or destroyed",
        );
        return false;
      }

      // Update options
      if (options) {
        this.options = { ...this.options, ...options };
      }

      // Calculate capture interval in milliseconds
      const intervalMs = 1000 / this.options.fps;

      logger.info("Starting frame capture", {
        fps: this.options.fps,
        intervalMs,
        format: this.options.format,
      });

      this.isCapturing = true;
      this.frameCount = 0;
      this.errorCount = 0;
      this.totalErrorCount = 0;
      this.skippedFrameCount = 0;
      this.captureTimes = [];
      this.lastCaptureDurationMs = 0;
      this.lastCaptureTime = Date.now();

      this.latestPaint = null;
      this.convertedPaint = null;
      this.latestBitmap = null;
      if (this.window.webContents.isOffscreen?.()) {
        this.sending = false;
        this.window.webContents.on('paint', this.onPaint);
        this.window.webContents.setFrameRate(Math.min(240, Math.round(this.options.fps * 2)));
        this.window.webContents.startPainting();
        this.window.webContents.invalidate();
        const t0 = performance.now();
        let k = 0;
        const loop = () => {
          if (!this.isCapturing) return;
          this.outputTick();
          k++;
          const now = performance.now();
          let next = t0 + k * intervalMs;
          if (next < now - intervalMs) { k = Math.floor((now - t0) / intervalMs) + 1; next = t0 + k * intervalMs; }
          this.captureInterval = setTimeout(loop, Math.max(0, next - now));
        };
        this.captureInterval = setTimeout(loop, intervalMs);
        logger.info("Frame capture started (oversampled output clock)", { renderFps: Math.min(240, Math.round(this.options.fps * 2)) });
        return true;
      }

      // Start capture loop
      this.captureInterval = setInterval(() => {
        this.captureFrame().catch((error) => {
          this.errorCount++;
          this.totalErrorCount++;
          logger.error("Frame capture error", {
            errorMessage:
              error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
            errorCount: this.errorCount,
          });

          // Stop capturing if too many errors
          if (this.errorCount > 10) {
            logger.error("Too many frame capture errors - stopping capture");
            this.stop();
          }
        });
      }, intervalMs);

      logger.info("Frame capture started");
      return true;
    } catch (error) {
      logger.error("Failed to start frame capture", { error });
      this.isCapturing = false;
      return false;
    }
  }

  /** One output frame: the newest paint (converted once), or the last bitmap again */
  private outputTick(): void {
    const image = this.latestPaint;
    if (!image) return;
    if (this.sending) { this.skippedFrameCount++; return; }
    this.sending = true;
    const ready = image === this.convertedPaint && this.latestBitmap
      ? Promise.resolve(this.latestBitmap)
      : this.convertToBitmap(image, this.options.targetWidth, this.options.targetHeight).then((bitmap) => {
          this.convertedPaint = image;
          this.latestBitmap = bitmap;
          return bitmap;
        });
    ready
      .then((bitmap) => (this.isCapturing ? this.sendBitmap(bitmap) : undefined))
      .catch((error) => this.onCaptureError(error))
      .finally(() => { this.sending = false; });
  }

  private async sendBitmap(bitmap: NonNullable<FrameCaptureService['latestBitmap']>): Promise<void> {
    const sent = await ndiOutputManager.sendFrame(bitmap.buffer, bitmap.width, bitmap.height, bitmap.format);
    if (!sent) throw new Error("NDI sender rejected the captured frame");
    this.frameCount++;
    this.lastCaptureTime = Date.now();
    this.errorCount = 0;
    this.captureTimes.push(this.lastCaptureTime);
    while (this.captureTimes.length && this.lastCaptureTime - this.captureTimes[0] > 5000) this.captureTimes.shift();
  }

  private onCaptureError(error: unknown): void {
    this.errorCount++;
    this.totalErrorCount++;
    logger.error("Frame capture error", {
      errorMessage: error instanceof Error ? error.message : String(error),
      errorCount: this.errorCount,
    });
    if (this.errorCount > 10) {
      logger.error("Too many frame capture errors - stopping capture");
      this.stop();
    }
  }

  /**
   * Stop capturing frames
   */
  public stop(): void {
    try {
      if (!this.isCapturing) {
        return;
      }

      if (this.captureInterval) {
        clearInterval(this.captureInterval);
        clearTimeout(this.captureInterval);
        this.captureInterval = null;
      }

      this.isCapturing = false;
      if (this.window && !this.window.isDestroyed() && this.window.webContents.isOffscreen?.()) {
        this.window.webContents.removeListener('paint', this.onPaint);
        this.window.webContents.stopPainting();
      }
      this.latestPaint = null;
      this.convertedPaint = null;
      this.latestBitmap = null;

      logger.info("Frame capture stopped", {
        totalFrames: this.frameCount,
        errors: this.errorCount,
      });
    } catch (error) {
      logger.error("Error stopping frame capture", { error });
    }
  }

  /**
   * Capture a single frame from the window
   */
  private async captureFrame(): Promise<void> {
    // Guard: Skip if already capturing a frame (prevents overlapping async operations)
    if (this.isCapturingFrame) {
      this.skippedFrameCount++;
      logger.debug(
        "Skipping frame capture - previous capture still in progress",
        {
          frameCount: this.frameCount,
        },
      );
      return;
    }

    this.isCapturingFrame = true;

    try {
      if (!this.window || this.window.isDestroyed()) {
        logger.warn("Cannot capture frame - window not available");
        this.stop();
        return;
      }

      // Note: We DO NOT skip if window is not visible
      // NDI output needs to work even when graphics window is hidden
      // Electron can capture from hidden windows

      const startTime = Date.now();

      // Determine target output dimensions (for NDI)
      // These are the configured graphics output dimensions from settings
      const targetWidth = this.options.targetWidth;
      const targetHeight = this.options.targetHeight;

      // Track the current frame number BEFORE any operations
      // This ensures consistent frame numbering in logs
      const currentFrameNumber = this.frameCount;

      // Log first 10 frames and then every 50th frame to verify continuous capture
      const shouldLog =
        currentFrameNumber < 10 || currentFrameNumber % 50 === 0;

      if (shouldLog) {
        logger.info("Capturing frame", {
          frameNumber: currentFrameNumber,
          windowVisible: this.window.isVisible(),
          targetDimensions:
            targetWidth && targetHeight
              ? `${targetWidth}x${targetHeight}`
              : "auto",
        });
      }

      // Capture the entire window
      // NOTE: Removed the requestAnimationFrame synchronization because it was blocking
      // and causing overlapping async operations. The browser should have already painted
      // by the time we capture (since we're on a timer interval).
      const offscreen = this.window.webContents.isOffscreen?.();
      // Wait for Chromium's first frame instead of taking a screenshot every output tick.
      if (offscreen && !this.latestPaint) return;
      const image = offscreen ? this.latestPaint! : await this.window.webContents.capturePage();

      // Convert image buffer to bitmap for NDI
      // This handles HiDPI/Retina scaling and resizes to target dimensions
      // Note: toBitmap() returns BGRA on macOS, RGBA on other platforms
      const bitmapData = offscreen && image === this.convertedPaint && this.latestBitmap
        ? this.latestBitmap
        : await this.convertToBitmap(image, targetWidth, targetHeight);
      if (!this.isCapturing) return;
      if (offscreen) {
        this.convertedPaint = image;
        this.latestBitmap = bitmapData;
      }

      if (shouldLog) {
        logger.info("Frame converted to bitmap", {
          frameNumber: currentFrameNumber,
          bitmapBufferSize: bitmapData.buffer.length,
          outputDimensions: `${bitmapData.width}x${bitmapData.height}`,
          format: bitmapData.format,
        });
      }

      // Send frame to NDI using actual dimensions and format (handles HiDPI scaling)
      const sent = await ndiOutputManager.sendFrame(
        bitmapData.buffer,
        bitmapData.width,
        bitmapData.height,
        bitmapData.format,
      );

      if (sent) {
        this.frameCount++;
        this.lastCaptureTime = Date.now();
        this.errorCount = 0; // Reset error count on success

        const captureTime = Date.now() - startTime;
        this.lastCaptureDurationMs = captureTime;
        this.captureTimes.push(this.lastCaptureTime);
        this.captureTimes = this.captureTimes.filter(
          (t) => this.lastCaptureTime - t <= 5000,
        );

        if (shouldLog) {
          logger.info("Frame sent to NDI successfully", {
            frameNumber: currentFrameNumber,
            captureTime,
            totalFramesSent: this.frameCount,
            fps: this.options.fps,
          });
        }
      } else {
        // Log if frame was not sent
        logger.warn("Frame was not sent to NDI", {
          frameNumber: currentFrameNumber,
          captureTime: Date.now() - startTime,
          reason: "NDI sendFrame returned false",
        });
        throw new Error("NDI sender rejected the captured frame");
      }
    } finally {
      // Always release the guard, even if there was an error
      this.isCapturingFrame = false;
    }
  }

  /**
   * Convert nativeImage to bitmap buffer
   *
   * This handles:
   * - HiDPI/Retina displays (automatically scales to target dimensions)
   * - Resizing to match configured output resolution
   * - Platform-specific color format detection (BGRA on macOS, RGBA on others)
   *
   * @param image - Electron nativeImage from capturePage()
   * @param targetWidth - Target output width (from config)
   * @param targetHeight - Target output height (from config)
   */
  private async convertToBitmap(
    image: Electron.NativeImage,
    targetWidth?: number,
    targetHeight?: number,
  ): Promise<{
    buffer: Buffer;
    width: number;
    height: number;
    format: "RGBA" | "BGRA";
  }> {
    try {
      // Get the actual size of the captured image (may be scaled on HiDPI displays)
      const size = image.getSize();
      const capturedWidth = size.width;
      const capturedHeight = size.height;

      // Determine final output dimensions
      const outputWidth = targetWidth || capturedWidth;
      const outputHeight = targetHeight || capturedHeight;

      // Log first frame details
      if (this.frameCount === 0) {
        logger.info("Frame conversion details", {
          capturedDimensions: `${capturedWidth}x${capturedHeight}`,
          targetDimensions:
            targetWidth && targetHeight
              ? `${targetWidth}x${targetHeight}`
              : "auto",
          outputDimensions: `${outputWidth}x${outputHeight}`,
          needsResize:
            capturedWidth !== outputWidth || capturedHeight !== outputHeight,
        });
      }

      // Resize image if dimensions don't match target
      let finalImage = image;
      if (
        targetWidth &&
        targetHeight &&
        (capturedWidth !== targetWidth || capturedHeight !== targetHeight)
      ) {
        finalImage = image.resize({
          width: targetWidth,
          height: targetHeight,
          quality: "best",
        });

        // Log resize on first frame
        if (this.frameCount === 0) {
          logger.info("Resizing frame to target dimensions", {
            from: `${capturedWidth}x${capturedHeight}`,
            to: `${targetWidth}x${targetHeight}`,
          });
        }
      }

      // Get bitmap
      // Note: Electron's toBitmap() returns BGRA format on all platforms (little-endian processors)
      // According to Electron docs: "the pixel data is effectively stored in 32bit BGRA format"
      // on little-endian processors (Intel/AMD x86/x64 on macOS, Windows, Linux)
      const bitmap = finalImage.toBitmap();

      // Get color format from NDI config (defaults to BGRA)
      // Users can change this in settings if they experience color issues
      const ndiConfig = ndiOutputManager.getConfig();
      const format = ndiConfig.colorFormat || "BGRA";

      // Verify size matches expected
      const expectedSize = outputWidth * outputHeight * 4; // 4 bytes per pixel (RGBA or BGRA)
      if (bitmap.length !== expectedSize) {
        logger.error("Bitmap size mismatch - this should not happen!", {
          expected: expectedSize,
          actual: bitmap.length,
          outputWidth,
          outputHeight,
          format,
        });
        throw new Error(
          `Bitmap size mismatch: expected ${expectedSize}, got ${bitmap.length}`,
        );
      }

      return {
        buffer: bitmap,
        width: outputWidth,
        height: outputHeight,
        format,
      };
    } catch (error) {
      logger.error("Failed to convert image to RGBA", {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Get capture status
   */
  public getStatus() {
    return {
      isCapturing: this.isCapturing,
      frameCount: this.frameCount,
      errorCount: this.totalErrorCount,
      consecutiveErrors: this.errorCount,
      skippedFrameCount: this.skippedFrameCount,
      measuredFps:
        this.captureTimes.length > 1 && Date.now() - this.lastCaptureTime < 2000
          ? ((this.captureTimes.length - 1) * 1000) /
            Math.max(
              1,
              this.captureTimes[this.captureTimes.length - 1] -
                this.captureTimes[0],
            )
          : 0,
      lastCaptureDurationMs: this.lastCaptureDurationMs,
      lastCaptureTime: this.lastCaptureTime,
      fps: this.options.fps,
      format: this.options.format,
    };
  }

  /**
   * Update capture options
   * Note: Requires restart of capture to take effect
   */
  public updateOptions(options: Partial<FrameCaptureOptions>): void {
    const wasCapturing = this.isCapturing;

    if (wasCapturing) {
      this.stop();
    }

    this.options = { ...this.options, ...options };

    if (wasCapturing) {
      this.start();
    }

    logger.info("Frame capture options updated", { options: this.options });
  }

  /**
   * Shutdown frame capture service
   */
  public shutdown(): void {
    this.stop();
    this.window = null;
    logger.info("Frame Capture Service shutdown complete");
  }
}

// Export singleton instance
export const frameCaptureService = FrameCaptureService.getInstance();

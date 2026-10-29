/**
 * NDI Output Manager
 * Manages NDI sender lifecycle and configuration
 * 
 * This manager handles:
 * - NDI sender creation and destruction
 * - Configuration management
 * - Status tracking and reporting
 * - Graceful degradation when NDI SDK not available
 */

import { getLogger } from '../utils/logger';
import { getGrandioseModule, checkNDIAvailability } from '../utils/ndi-check';
import type { NDISenderConfig, NDISenderStatus } from '../../shared/types/ndi';

const logger = getLogger();

/**
 * NDI Output Manager (Singleton)
 */
class NDIOutputManager {
  private static instance: NDIOutputManager | null = null;
  
  private grandiose: any | null = null;
  private sender: any | null = null;
  private config: NDISenderConfig;
  private isInitialized: boolean = false;
  private frameCount: number = 0;
  private lastFrameTime: number = 0;

  private constructor() {
    // Default configuration
    this.config = {
      enabled: false,
      name: 'TV-Grafik NDI Output',
      fps: 30,
      colorFormat: 'BGRA',
      groups: [],
      // Frames are paced by the renderer's paints; NDI clocking would block each send and drop frames
      clockVideo: false,
      clockAudio: false
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): NDIOutputManager {
    if (!NDIOutputManager.instance) {
      NDIOutputManager.instance = new NDIOutputManager();
    }
    return NDIOutputManager.instance;
  }

  /**
   * Initialize NDI output
   * This will check if NDI SDK is available and create a sender if enabled
   */
  public async initialize(config?: Partial<NDISenderConfig>): Promise<boolean> {
    try {
      // Check NDI availability
      const availability = checkNDIAvailability();
      
      if (!availability.available) {
        logger.info('NDI SDK not available - NDI output disabled', {
          error: availability.error
        });
        this.isInitialized = false;
        return false;
      }

      // Get grandiose module
      this.grandiose = getGrandioseModule();
      
      if (!this.grandiose) {
        logger.warn('Failed to load grandiose module');
        this.isInitialized = false;
        return false;
      }

      // Update configuration
      if (config) {
        this.config = { ...this.config, ...config };
      }

      logger.info('NDI Output Manager initialized', {
        ndiVersion: availability.version,
        config: this.config
      });

      this.isInitialized = true;

      // NOTE: Do NOT auto-start NDI sender during initialization
      // The sender will be created when the user explicitly clicks "Start NDI Output"
      // This prevents NDI from starting without frame capture enabled

      return true;

    } catch (error) {
      logger.error('Failed to initialize NDI Output Manager', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorType: error instanceof Error ? error.constructor.name : typeof error
      });
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Create NDI sender
   */
  private async createSender(): Promise<boolean> {
    try {
      if (!this.isInitialized || !this.grandiose) {
        logger.warn('Cannot create NDI sender - not initialized');
        return false;
      }

      if (this.sender) {
        logger.warn('NDI sender already exists - destroying old sender');
        await this.destroySender();
      }

      // Create sender configuration
      // Note: Only include groups if it's a non-empty array or string
      const senderConfig: any = {
        name: this.config.name,
        clockVideo: this.config.clockVideo,
        clockAudio: this.config.clockAudio
      };

      // Only add groups if specified and non-empty
      if (this.config.groups && this.config.groups.length > 0) {
        senderConfig.groups = this.config.groups;
      }

      logger.info('Creating NDI sender', { config: senderConfig });

      // Create sender using grandiose
      // IMPORTANT: Despite the TypeScript definitions, grandiose.send() returns a PROMISE
      // The C++ implementation creates the sender asynchronously and resolves with the sender object
      // See grandiose_send.cc line 212: napi_create_promise() and line 125: napi_resolve_deferred()
      this.sender = await this.grandiose.send(senderConfig);

      if (!this.sender) {
        throw new Error('Failed to create NDI sender - grandiose.send() returned null/undefined');
      }

      this.frameCount = 0;
      this.lastFrameTime = Date.now();

      // Log detailed sender object information for debugging
      logger.info('NDI sender created successfully', {
        name: this.config.name,
        senderObject: typeof this.sender,
        senderKeys: Object.keys(this.sender),
        hasVideoMethod: typeof this.sender.video === 'function',
        hasAudioMethod: typeof this.sender.audio === 'function',
        videoType: typeof this.sender.video,
        audioType: typeof this.sender.audio,
        embeddedType: this.sender.embedded ? typeof this.sender.embedded : 'undefined'
      });

      return true;

    } catch (error) {
      logger.error('Failed to create NDI sender', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        config: this.config,
        grandioseAvailable: !!this.grandiose,
        grandioseHasSend: this.grandiose && typeof this.grandiose.send === 'function'
      });
      this.sender = null;
      return false;
    }
  }

  /**
   * Destroy NDI sender
   */
  private async destroySender(): Promise<void> {
    try {
      if (!this.sender) {
        return;
      }

      logger.info('Destroying NDI sender');

      // Destroy sender
      if (typeof this.sender.destroy === 'function') {
        await this.sender.destroy();
      }

      this.sender = null;
      this.frameCount = 0;
      this.lastFrameTime = 0;

      logger.info('NDI sender destroyed');

    } catch (error) {
      logger.error('Error destroying NDI sender', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      this.sender = null;
    }
  }

  /**
   * Start NDI output
   */
  public async start(): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        logger.warn('Cannot start NDI output - not initialized');
        return false;
      }

      this.config.enabled = true;

      if (!this.sender) {
        return await this.createSender();
      }

      logger.info('NDI output started');
      return true;

    } catch (error) {
      logger.error('Failed to start NDI output', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      return false;
    }
  }

  /**
   * Stop NDI output
   */
  public async stop(): Promise<void> {
    try {
      this.config.enabled = false;
      await this.destroySender();
      logger.info('NDI output stopped');
    } catch (error) {
      logger.error('Error stopping NDI output', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
    }
  }

  /**
   * Send video frame to NDI
   *
   * @param frameData - Frame data as Buffer (RGBA, BGRA, or UYVY format)
   * @param width - Frame width in pixels
   * @param height - Frame height in pixels
   * @param format - Color format ('RGBA', 'BGRA', or 'UYVY')
   */
  public async sendFrame(
    frameData: Buffer,
    width: number,
    height: number,
    format: 'RGBA' | 'BGRA' | 'UYVY' = 'RGBA'
  ): Promise<boolean> {
    try {
      if (!this.sender) {
        logger.warn('Cannot send frame - NDI sender not created', {
          frameCount: this.frameCount,
          enabled: this.config.enabled
        });
        return false;
      }

      if (!this.config.enabled) {
        logger.warn('Cannot send frame - NDI output not enabled', {
          frameCount: this.frameCount
        });
        return false;
      }

      // Verify sender object structure
      if (typeof this.sender !== 'object') {
        logger.error('NDI sender is not an object', {
          senderType: typeof this.sender,
          sender: this.sender,
          frameCount: this.frameCount
        });
        return false;
      }

      // Check if sender has video method
      if (typeof this.sender.video !== 'function') {
        logger.error('NDI sender.video is not a function', {
          senderType: typeof this.sender,
          videoType: typeof this.sender.video,
          senderKeys: Object.keys(this.sender),
          hasEmbedded: 'embedded' in this.sender,
          embeddedType: this.sender.embedded ? typeof this.sender.embedded : 'undefined',
          frameCount: this.frameCount
        });
        return false;
      }

      // Calculate frame timing
      const now = Date.now();

      // NOTE: Frame rate throttling is now handled by FrameCaptureService
      // We removed the throttling here to avoid double-throttling which was causing
      // frames to be rejected even though they were captured at the correct rate.
      // The FrameCaptureService uses setInterval to control the capture rate,
      // so we should accept all frames that are sent to us.

      // REMOVED: Throttle frames to configured FPS
      // if (now - this.lastFrameTime < frameDuration) {
      //   return false; // Skip frame to maintain FPS
      // }

      // Log first frame details
      if (this.frameCount === 0) {
        logger.info('Sending first NDI frame', {
          width,
          height,
          format,
          dataSize: frameData.length,
          fps: this.config.fps
        });
      }

      // Prepare video frame with fourCC format
      // IMPORTANT: Use BGRA/RGBA to maintain full alpha channel support
      // Graphics overlays require transparency to composite over other video sources
      // FourCC values: RGBA = 1094862674, BGRA = 1095911234, UYVY = 1498831189
      let fourCC: number;
      if (format === 'RGBA') {
        fourCC = 1094862674; // RGBA with alpha channel
      } else if (format === 'BGRA') {
        fourCC = 1095911234; // BGRA with alpha channel
      } else {
        fourCC = 1498831189; // UYVY
      }

      const videoFrame = {
        xres: width,
        yres: height,
        frameRateN: this.config.fps * 1000,
        frameRateD: 1000,
        fourCC: fourCC,
        pictureAspectRatio: width / height,
        frameFormatType: this.grandiose.FORMAT_TYPE_PROGRESSIVE,
        // timecode omitted: NDI 6 synthesizes it (the binding takes number | bigint)
        data: frameData,
        lineStrideBytes: width * (format === 'UYVY' ? 2 : 4) // UYVY = 2 bytes/pixel, RGBA/BGRA = 4 bytes/pixel
      };

      // Log frame details before sending (first frame only)
      if (this.frameCount === 0) {
        logger.info('Video frame prepared', {
          xres: videoFrame.xres,
          yres: videoFrame.yres,
          fourCC: videoFrame.fourCC,
          dataLength: videoFrame.data.length,
          lineStrideBytes: videoFrame.lineStrideBytes,
          expectedDataSize: width * height * 4,
          frameFormatType: videoFrame.frameFormatType
        });
      }

      // Send frame
      try {
        await this.sender.video(videoFrame);
      } catch (videoError) {
        logger.error('NDI sender.video() threw an error', {
          error: videoError instanceof Error ? videoError.message : String(videoError),
          stack: videoError instanceof Error ? videoError.stack : undefined,
          frameCount: this.frameCount,
          width,
          height,
          format,
          dataSize: frameData.length
        });
        return false;
      }

      this.frameCount++;
      this.lastFrameTime = now;

      // Log first frame success
      if (this.frameCount === 1) {
        logger.info('First NDI frame sent successfully');
      }

      return true;

    } catch (error) {
      logger.error('Failed to send NDI frame (outer catch)', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        frameCount: this.frameCount,
        width,
        height,
        bufferSize: frameData.length,
        expectedSize: width * height * 4
      });
      return false;
    }
  }

  /**
   * Update configuration
   */
  public async updateConfig(config: Partial<NDISenderConfig>): Promise<boolean> {
    try {
      const wasEnabled = this.config.enabled;
      const oldName = this.config.name;

      // Update configuration
      this.config = { ...this.config, ...config };

      // If name changed or critical settings changed, recreate sender
      if (this.sender && (oldName !== this.config.name || config.groups !== undefined)) {
        await this.destroySender();
        if (this.config.enabled) {
          await this.createSender();
        }
      }

      // Handle enable/disable
      if (!wasEnabled && this.config.enabled) {
        await this.start();
      } else if (wasEnabled && !this.config.enabled) {
        await this.stop();
      }

      logger.info('NDI configuration updated', { config: this.config });
      return true;

    } catch (error) {
      logger.error('Failed to update NDI configuration', {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined
      });
      return false;
    }
  }

  /**
   * Get current status
   */
  public getStatus(): NDISenderStatus {
    return {
      initialized: this.isInitialized,
      enabled: this.config.enabled,
      active: this.sender !== null,
      name: this.config.name,
      frameCount: this.frameCount,
      fps: this.config.fps,
      lastFrameTime: this.lastFrameTime
    };
  }

  /**
   * Get current configuration
   */
  public getConfig(): NDISenderConfig {
    return { ...this.config };
  }

  /**
   * Shutdown NDI output
   */
  public async shutdown(): Promise<void> {
    try {
      await this.stop();
      this.isInitialized = false;
      this.grandiose = null;
      logger.info('NDI Output Manager shutdown complete');
    } catch (error) {
      logger.error('Error during NDI shutdown', { error });
    }
  }
}

// Export singleton instance
export const ndiOutputManager = NDIOutputManager.getInstance();


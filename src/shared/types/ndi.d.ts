/**
 * NDI Type Definitions
 * Extended type definitions for grandiose NDI library
 */

// Re-export all grandiose types
export * from 'grandiose';

/**
 * NDI availability status
 */
export interface NDIAvailability {
  available: boolean;
  error?: string;
  version?: string;
}

/**
 * NDI sender configuration
 */
export interface NDISenderConfig {
  enabled: boolean;
  name: string;
  fps: number;
  colorFormat?: 'BGRA' | 'RGBA';
  groups?: string[];
  clockVideo?: boolean;
  clockAudio?: boolean;
}

/**
 * NDI sender status
 */
export interface NDISenderStatus {
  initialized: boolean;
  enabled: boolean;
  active: boolean;
  name: string;
  frameCount: number;
  fps: number;
  lastFrameTime: number;
}

/**
 * NDI frame capture options
 */
export interface NDIFrameCaptureOptions {
  width: number;
  height: number;
  fps: number;
  fourCC?: number; // FourCC format code
}


/**
 * Winston Logger Configuration
 * SPX-inspired logging with rotating file streams
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';
import * as rfs from 'rotating-file-stream';
import { app } from 'electron';

let logger: winston.Logger;
let logDirectory: string | null = null;

/**
 * Get the appropriate log directory based on environment
 * In production: Use Electron's logs directory (e.g., ~/Library/Logs/OL-Grafik on macOS)
 * In development: Use LOG folder in project root
 */
function getLogDirectory(): string {
  // If already determined, return cached value
  if (logDirectory) {
    return logDirectory;
  }

  // Use app.isPackaged to detect production vs development
  // This is the recommended Electron best practice
  const isProduction = app.isPackaged;

  if (isProduction) {
    // Production: Use Electron's logs directory
    // This is platform-specific:
    // - macOS: ~/Library/Logs/OL-Grafik
    // - Windows: %USERPROFILE%\AppData\Roaming\OL-Grafik\logs
    // - Linux: ~/.config/OL-Grafik/logs
    logDirectory = app.getPath('logs');
  } else {
    // Development: Use LOG folder in project root for easier debugging
    logDirectory = path.join(process.cwd(), 'LOG');
  }

  return logDirectory;
}

export function initLogger(customLogDir?: string): winston.Logger {
  if (logger) {
    return logger;
  }

  // Determine log directory
  const logDir = customLogDir || process.env.LOG_DIR || getLogDirectory();

  // Ensure log directory exists
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  } catch (error) {
    // If we can't create the log directory, fall back to console-only logging
    console.error('[Logger] Failed to create log directory:', logDir, error);
    logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          let msg = `${timestamp} [${level}] ${message}`;
          if (Object.keys(meta).length > 0) {
            msg += ` ${JSON.stringify(meta)}`;
          }
          return msg;
        })
      ),
      transports: [
        new winston.transports.Console()
      ]
    });
    logger.warn('Logger initialized in console-only mode due to log directory error', {
      attemptedLogDir: logDir,
      error: error instanceof Error ? error.message : String(error)
    });
    return logger;
  }

  // Create rotating file stream
  const accessLogStream = rfs.createStream('access.log', {
    interval: '1d', // rotate daily
    path: logDir,
    maxFiles: 30 // keep 30 days
  });

  const errorLogStream = rfs.createStream('error.log', {
    interval: '1d',
    path: logDir,
    maxFiles: 30
  });

  // Custom format
  const customFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  );

  const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      let msg = `${timestamp} [${level}] ${message}`;
      if (Object.keys(meta).length > 0) {
        msg += ` ${JSON.stringify(meta)}`;
      }
      return msg;
    })
  );

  // Create logger
  logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: customFormat,
    transports: [
      // Console output
      new winston.transports.Console({
        format: consoleFormat
      }),
      // All logs to access.log
      new winston.transports.Stream({
        stream: accessLogStream
      }),
      // Error logs to error.log
      new winston.transports.Stream({
        stream: errorLogStream,
        level: 'error'
      })
    ]
  });

  logger.info('Logger initialized', { logDir });

  return logger;
}

export function getLogger(): winston.Logger {
  if (!logger) {
    return initLogger();
  }
  return logger;
}

// Export logger instance for convenience
export { logger };

export default { initLogger, getLogger };


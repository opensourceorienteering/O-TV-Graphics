/**
 * NDI Availability Checker
 * Detects whether the NDI SDK is available on the system
 */

import { getLogger } from './logger';
import type { NDIAvailability } from '../../shared/types/ndi';

const logger = getLogger();

let ndiAvailability: NDIAvailability | null = null;
let grandioseModule: any = null;

/**
 * Check if NDI SDK is available on the system
 * This function attempts to load the grandiose module and checks if it can be initialized
 *
 * Now that grandiose is a core dependency, this function distinguishes between:
 * 1. Package not installed (installation failed)
 * 2. Package installed but NDI Runtime not on system
 * 3. Everything working correctly
 *
 * @returns NDI availability status
 */
export function checkNDIAvailability(): NDIAvailability {
  // Return cached result if already checked
  if (ndiAvailability !== null) {
    return ndiAvailability;
  }

  logger.info('Checking NDI SDK availability...');

  try {
    // Attempt to require grandiose
    // This will fail if:
    // 1. grandiose package is not installed (npm install failed)
    // 2. grandiose native module failed to compile
    // 3. NDI Runtime is not installed on the system
    // 4. Platform is not supported
    //
    // In packaged apps, grandiose should be in app.asar.unpacked/node_modules/grandiose
    // Electron automatically handles this when asarUnpack is configured correctly
    grandioseModule = require('@stagetimerio/grandiose');

    logger.info('Grandiose package loaded successfully');

    // Try to get version to verify NDI Runtime is installed and working
    if (typeof grandioseModule.version === 'function') {
      try {
        const version = grandioseModule.version();
        logger.info('NDI SDK available and working', { version });

        ndiAvailability = {
          available: true,
          version
        };
      } catch (versionError) {
        // Package loaded but can't get version - likely NDI Runtime not installed
        const versionErrorMsg = versionError instanceof Error ? versionError.message : 'Unknown error';
        logger.warn('Grandiose loaded but NDI Runtime may not be installed', { error: versionErrorMsg });

        ndiAvailability = {
          available: false,
          error: 'NDI Runtime not detected. Please install NDI Runtime from https://ndi.video/tools/',
          version: undefined
        };
      }
    } else {
      // Package loaded but version() function not available
      logger.warn('Grandiose loaded but version() function not available - assuming NDI is working');
      ndiAvailability = {
        available: true,
        version: 'unknown'
      };
    }

    return ndiAvailability;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Provide more helpful error messages based on the error type
    let userFriendlyError = errorMessage;

    if (errorMessage.includes('Cannot find module')) {
      userFriendlyError = 'Grandiose package not installed. Run "npm install" to install dependencies.';
      logger.error('Grandiose package not found - installation may have failed', { error: errorMessage });
    } else if (errorMessage.includes('was compiled against a different Node.js version')) {
      userFriendlyError = 'Grandiose was compiled for a different Node.js version. Run "npm rebuild @stagetimerio/grandiose" to recompile.';
      logger.error('Grandiose version mismatch', { error: errorMessage });
    } else if (errorMessage.includes('The specified module could not be found') ||
               errorMessage.includes('libndi') ||
               errorMessage.includes('Processing.NDI.Lib')) {
      userFriendlyError = 'NDI Runtime not found. Please install NDI Runtime from https://ndi.video/tools/';
      logger.warn('NDI Runtime not installed on system', { error: errorMessage });
    } else {
      logger.warn('NDI SDK not available', { error: errorMessage });
    }

    ndiAvailability = {
      available: false,
      error: userFriendlyError
    };

    return ndiAvailability;
  }
}

/**
 * Get the grandiose module if available
 * Returns null if NDI is not available
 * 
 * @returns Grandiose module or null
 */
export function getGrandioseModule(): any | null {
  const availability = checkNDIAvailability();
  
  if (!availability.available) {
    return null;
  }

  return grandioseModule;
}

/**
 * Check if the CPU supports NDI
 * Returns false if NDI SDK is not available
 * 
 * @returns true if CPU is supported, false otherwise
 */
export function isSupportedCPU(): boolean {
  const grandiose = getGrandioseModule();
  
  if (!grandiose) {
    return false;
  }

  try {
    if (typeof grandiose.isSupportedCPU === 'function') {
      return grandiose.isSupportedCPU();
    }
    
    // If function doesn't exist, assume CPU is supported
    return true;
  } catch (error) {
    logger.error('Error checking CPU support', { 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
    return false;
  }
}

/**
 * Get NDI SDK version string
 * Returns null if NDI SDK is not available
 * 
 * @returns Version string or null
 */
export function getNDIVersion(): string | null {
  const availability = checkNDIAvailability();
  return availability.version || null;
}

/**
 * Reset the NDI availability cache
 * Useful for testing or if NDI SDK is installed after app startup
 */
export function resetNDIAvailabilityCache(): void {
  ndiAvailability = null;
  grandioseModule = null;
  logger.debug('NDI availability cache reset');
}


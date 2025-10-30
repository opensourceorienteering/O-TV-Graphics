/**
 * Node.js version validation
 *
 * OL-Grafik requires Node.js v18-v20 due to NDI (grandiose) compatibility.
 * This module checks the Node.js version on startup and provides clear
 * error messages if the version is incompatible.
 *
 * Grandiose package compatibility:
 * - Requires Node.js >= 16.0
 * - Does NOT support Node.js v22+ (native module compilation issues)
 * - OL-Grafik supports Node.js v18.x, v19.x, and v20.x
 *
 * NOTE: This module does NOT use the logger because it runs before logger initialization.
 * All logging is done to console.error instead.
 */

import { app, dialog } from 'electron';

const MIN_NODE_MAJOR = 18;
const MAX_NODE_MAJOR = 20;

interface VersionCheckResult {
  compatible: boolean;
  currentVersion: string;
  majorVersion: number;
  errorMessage?: string;
  recommendation?: string;
}

/**
 * Parse semantic version string into major, minor, patch
 */
function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const cleaned = version.replace(/^v/, '');
  const parts = cleaned.split('.').map(p => parseInt(p, 10));
  
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0
  };
}

/**
 * Check if the current Node.js version is compatible with OL-Grafik
 */
export function checkNodeVersion(): VersionCheckResult {
  const currentVersion = process.version; // e.g., "v20.11.0"
  const parsed = parseVersion(currentVersion);
  const majorVersion = parsed.major;

  console.log('[version-check] Checking Node.js version compatibility', {
    currentVersion,
    minMajor: MIN_NODE_MAJOR,
    maxMajor: MAX_NODE_MAJOR
  });

  // Check if version is compatible (v18.x, v19.x, or v20.x)
  if (majorVersion >= MIN_NODE_MAJOR && majorVersion <= MAX_NODE_MAJOR) {
    console.log('[version-check] Node.js version is compatible', { version: currentVersion });
    return {
      compatible: true,
      currentVersion,
      majorVersion
    };
  }

  // Version is incompatible
  let errorMessage: string;
  let recommendation: string;

  if (majorVersion < MIN_NODE_MAJOR) {
    // Too old
    errorMessage = `Node.js ${currentVersion} is too old. OL-Grafik requires Node.js v${MIN_NODE_MAJOR}.x - v${MAX_NODE_MAJOR}.x for NDI support.`;
    recommendation = `Please upgrade to Node.js v${MAX_NODE_MAJOR} LTS:\n\n` +
      `• Download from: https://nodejs.org/\n` +
      `• Or use nvm: nvm install ${MAX_NODE_MAJOR} && nvm use ${MAX_NODE_MAJOR}\n\n` +
      `Note: This error is caused by Electron bundling Node.js ${currentVersion}.\n` +
      `You may need to upgrade Electron to a version that bundles Node.js v${MIN_NODE_MAJOR}+.`;
  } else {
    // Too new (v22+)
    errorMessage = `Node.js ${currentVersion} is not compatible. OL-Grafik requires Node.js v${MIN_NODE_MAJOR}.x - v${MAX_NODE_MAJOR}.x due to NDI (grandiose) package limitations.`;
    recommendation = `Please downgrade to Node.js v${MAX_NODE_MAJOR} LTS:\n\n` +
      `• Download from: https://nodejs.org/dist/latest-v${MAX_NODE_MAJOR}.x/\n` +
      `• Or use nvm: nvm install ${MAX_NODE_MAJOR} && nvm use ${MAX_NODE_MAJOR}\n\n` +
      `Why? The grandiose package (NDI bindings) does not support Node.js v22+ due to\n` +
      `native module compatibility issues. Node.js v${MAX_NODE_MAJOR} LTS is supported until April 2026.\n\n` +
      `Note: This error is caused by Electron bundling Node.js ${currentVersion}.\n` +
      `You may need to downgrade Electron to a version that bundles Node.js v${MIN_NODE_MAJOR}-v${MAX_NODE_MAJOR}.`;
  }

  console.error('[version-check] Node.js version is incompatible', {
    currentVersion,
    majorVersion,
    minMajor: MIN_NODE_MAJOR,
    maxMajor: MAX_NODE_MAJOR,
    errorMessage
  });

  return {
    compatible: false,
    currentVersion,
    majorVersion,
    errorMessage,
    recommendation
  };
}

/**
 * Validate Node.js version and exit if incompatible
 * Shows a dialog to the user explaining the issue
 */
export function validateNodeVersionOrExit(): void {
  const result = checkNodeVersion();

  if (!result.compatible) {
    console.error('[version-check] Application cannot start due to incompatible Node.js version');

    // Show error dialog to user
    const message = `${result.errorMessage}\n\n${result.recommendation}`;

    dialog.showErrorBox(
      'Incompatible Node.js Version',
      message
    );

    // Log detailed error
    console.error('[version-check] Exiting application due to Node.js version incompatibility', {
      currentVersion: result.currentVersion,
      requiredVersion: `v${MIN_NODE_MAJOR}-v${MAX_NODE_MAJOR}`
    });

    // Exit the application
    app.exit(1);
  }
}

/**
 * Get a user-friendly version compatibility message
 */
export function getVersionCompatibilityMessage(): string {
  const result = checkNodeVersion();
  
  if (result.compatible) {
    return `✅ Node.js ${result.currentVersion} is compatible`;
  } else {
    return `❌ ${result.errorMessage}`;
  }
}


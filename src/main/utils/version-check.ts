/**
 * Node.js version validation
 *
 * The main process runs on the Node.js runtime bundled with Electron.
 * Split Control needs Node.js 22 or newer: Electron 44 bundles Node.js 24.
 *
 * NDI bindings (@stagetimerio/grandiose) are a Node-API addon, so there is
 * no upper version limit any more.
 *
 * NOTE: This module does NOT use the logger because it runs before logger initialization.
 * All logging is done to console.error instead.
 */

import { app, dialog } from 'electron';

const MIN_NODE_MAJOR = 22;

interface VersionCheckResult {
  compatible: boolean;
  currentVersion: string;
  majorVersion: number;
  errorMessage?: string;
  recommendation?: string;
}

/**
 * Check if the current Node.js version is compatible with Split Control
 */
export function checkNodeVersion(): VersionCheckResult {
  const currentVersion = process.version; // e.g., "v24.11.0"
  const majorVersion = parseInt(currentVersion.replace(/^v/, '').split('.')[0], 10) || 0;

  if (majorVersion >= MIN_NODE_MAJOR) {
    console.log('[version-check] Node.js version is compatible', { version: currentVersion });
    return { compatible: true, currentVersion, majorVersion };
  }

  const errorMessage = `Node.js ${currentVersion} is too old. Split Control requires Node.js v${MIN_NODE_MAJOR} or newer.`;
  const recommendation =
    `This runtime is bundled with Electron. Upgrade Electron (npm install) so that it bundles ` +
    `Node.js v${MIN_NODE_MAJOR}+, or start from a current release of Split Control.`;

  console.error('[version-check] Node.js version is incompatible', {
    currentVersion,
    majorVersion,
    minMajor: MIN_NODE_MAJOR,
    errorMessage
  });

  return { compatible: false, currentVersion, majorVersion, errorMessage, recommendation };
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
      requiredVersion: `>=v${MIN_NODE_MAJOR}`
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


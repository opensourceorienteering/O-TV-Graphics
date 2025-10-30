#!/usr/bin/env node

/**
 * Rebuild native modules for Electron
 * This script is called by electron-builder before packaging
 *
 * Can be called in two ways:
 * 1. As a hook from electron-builder (receives context parameter)
 * 2. Directly from command line (no parameters)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Main rebuild function
 * @param {object} context - electron-builder context (optional)
 */
async function rebuildNativeModules(context) {
  console.log('🔧 Rebuilding native modules for Electron...');

  // If called from electron-builder, log the platform being built
  // PackContext structure: { outDir, appOutDir, packager, electronPlatformName, arch, targets }
  if (context) {
    try {
      // Debug: Log all context properties
      console.log('📦 Context received from electron-builder');
      console.log('   Keys:', Object.keys(context).join(', '));

      // Get platform name from context
      // electronPlatformName is a string like 'darwin', 'win32', 'linux'
      const platformName = context.electronPlatformName ||
                          context.packager?.platform?.name ||
                          'unknown';
      const arch = context.arch || 'unknown';
      console.log(`📦 Building for platform: ${platformName} (${arch})`);
    } catch (err) {
      // If we can't determine the platform, just continue
      console.log('📦 Building for electron-builder');
      console.log('   Error:', err.message);
    }
  }

  try {
    // Get Electron version from package.json
    const packageJson = require(path.join(__dirname, '..', 'package.json'));
    const electronVersion = packageJson.devDependencies.electron.replace('^', '');

    console.log(`📦 Target Electron version: ${electronVersion}`);

    // Check if grandiose is installed
    const grandioseDir = path.join(__dirname, '..', 'node_modules', 'grandiose');
    if (!fs.existsSync(grandioseDir)) {
      console.warn('⚠️  Grandiose not found - skipping rebuild');
      return;
    }

    // Determine target platform and arch for cross-compilation
    let targetPlatform = process.platform; // default to current platform
    let targetArch = process.arch; // default to current arch
    let isCrossCompiling = false;

    if (context) {
      // Map electron-builder platform names to node platform names
      const platformMap = {
        'win32': 'win32',
        'darwin': 'darwin',
        'linux': 'linux',
        'mas': 'darwin'
      };

      // Map electron-builder arch enum to node arch names
      // Arch enum: 0 = ia32, 1 = x64, 2 = armv7l, 3 = arm64, 4 = universal
      const archMap = {
        0: 'ia32',
        1: 'x64',
        2: 'armv7l',
        3: 'arm64',
        4: 'x64' // universal defaults to x64
      };

      targetPlatform = platformMap[context.electronPlatformName] || process.platform;
      targetArch = archMap[context.arch] || process.arch;

      isCrossCompiling = (targetPlatform !== process.platform);

      if (isCrossCompiling) {
        console.log(`⚠️  Cross-compiling from ${process.platform} to ${targetPlatform}-${targetArch}`);
        console.log(`⚠️  WARNING: Cross-compiling native modules is not reliable!`);
        console.log(`⚠️  For production builds, build on the target platform (Windows).`);
        console.log(`⚠️  Skipping rebuild - will use existing grandiose.node`);
        console.log(`⚠️  The packaged app may not work correctly on Windows!`);
        return; // Skip rebuild for cross-compilation
      }

      console.log(`🎯 Building for: ${targetPlatform}-${targetArch}`);
    }

    // Build the electron-rebuild command with platform and arch
    const rebuildCmd = `npx electron-rebuild -f -w grandiose --arch=${targetArch}`;

    console.log('🔨 Running electron-rebuild...');
    console.log(`   Command: ${rebuildCmd}`);

    execSync(rebuildCmd, {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit'
    });

    console.log('✅ Native modules rebuilt successfully');

    // Verify the rebuild
    const grandioseNodePath = path.join(grandioseDir, 'build', 'Release', 'grandiose.node');
    if (fs.existsSync(grandioseNodePath)) {
      const stats = fs.statSync(grandioseNodePath);
      console.log(`✅ grandiose.node found (${(stats.size / 1024).toFixed(2)} KB)`);
    } else {
      console.error('❌ grandiose.node not found after rebuild!');
      throw new Error('grandiose.node not found after rebuild');
    }

  } catch (error) {
    console.error('❌ Failed to rebuild native modules:', error.message);
    throw error;
  }
}

// Export as default for electron-builder hook
exports.default = rebuildNativeModules;

// If called directly from command line, run the function
if (require.main === module) {
  rebuildNativeModules(null).catch(error => {
    process.exit(1);
  });
}


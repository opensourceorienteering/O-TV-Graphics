#!/usr/bin/env node

/**
 * Post-install script to verify grandiose (NDI) package installation
 * This script runs after npm install to check if the grandiose native module
 * was successfully compiled and provides helpful feedback to developers.
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('');
  log(`${'='.repeat(70)}`, 'cyan');
  log(`  ${title}`, 'bright');
  log(`${'='.repeat(70)}`, 'cyan');
}

function logWarning(message) {
  console.log('');
  log(`${'!'.repeat(70)}`, 'yellow');
  log(`  ⚠️  ${message}`, 'yellow');
  log(`${'!'.repeat(70)}`, 'yellow');
  console.log('');
}

function checkGrandioseInstallation() {
  logSection('NDI (Grandiose) Package Verification');

  let grandioseInstalled = false;
  let grandioseWorking = false;
  let ndiVersion = null;
  let errorMessage = null;

  // Step 1: Check if grandiose package exists in node_modules
  const grandiosePackagePath = path.join(__dirname, '..', 'node_modules', 'grandiose');
  
  if (fs.existsSync(grandiosePackagePath)) {
    log('✅ Grandiose package found in node_modules', 'green');
    grandioseInstalled = true;

    // Step 2: Try to require grandiose
    try {
      const grandiose = require('grandiose');
      log('✅ Grandiose native module loaded successfully', 'green');
      
      // Step 3: Try to get NDI version
      try {
        if (typeof grandiose.version === 'function') {
          ndiVersion = grandiose.version();
          log(`✅ NDI SDK detected: ${ndiVersion}`, 'green');
          grandioseWorking = true;
        } else {
          log('⚠️  Grandiose loaded but version() not available', 'yellow');
          grandioseWorking = true; // Still consider it working
        }
      } catch (versionError) {
        log('⚠️  Could not detect NDI SDK version', 'yellow');
        log(`   ${versionError.message}`, 'gray');
        grandioseWorking = true; // Module loaded, just can't get version
      }
    } catch (requireError) {
      log('❌ Failed to load grandiose native module', 'red');
      log(`   ${requireError.message}`, 'gray');
      errorMessage = requireError.message;
      grandioseWorking = false;
    }
  } else {
    log('❌ Grandiose package not found in node_modules', 'red');
    grandioseInstalled = false;
  }

  // Print summary and recommendations
  console.log('');
  log('─'.repeat(70), 'gray');
  log('Summary:', 'bright');
  log('─'.repeat(70), 'gray');

  if (grandioseWorking) {
    log('✅ NDI support is READY', 'green');
    log('   The application will start normally.', 'green');
    if (ndiVersion) {
      log(`   NDI SDK Version: ${ndiVersion}`, 'cyan');
    }
  } else if (grandioseInstalled && !grandioseWorking) {
    logWarning('NDI SUPPORT IS NOT WORKING - NDI OUTPUT WILL BE DISABLED');

    log('⚠️  NDI support is PARTIALLY AVAILABLE', 'yellow');
    log('   The grandiose package is installed but the native module failed to load.', 'yellow');
    log('   This usually means the NDI Runtime is not installed on your system.', 'yellow');
    console.log('');
    log('   ⚠️  THE APPLICATION WILL START BUT NDI OUTPUT WILL BE DISABLED', 'yellow');
    console.log('');
    log('   To enable NDI output:', 'bright');
    log('   1. Download and install NDI Runtime from:', 'gray');
    log('      https://ndi.link/NDIRedistV5', 'cyan');
    log('   2. Restart your terminal/IDE', 'gray');
    log('   3. Run: npm install', 'gray');
    log('   4. Start the application', 'gray');
  } else {
    logWarning('NDI INSTALLATION FAILED - NDI OUTPUT WILL BE DISABLED');

    log('❌ NDI support is NOT AVAILABLE', 'red');
    log('   The grandiose package failed to install.', 'red');
    console.log('');
    log('   ⚠️  THE APPLICATION WILL START BUT NDI OUTPUT WILL BE DISABLED', 'yellow');
    console.log('');
    log('   Common causes:', 'bright');
    log('   • Node.js version incompatibility (MUST use Node.js v18-v20)', 'gray');
    log('   • Missing build tools (node-gyp, Python, C++ compiler)', 'gray');
    log('   • NDI Runtime not installed on your system', 'gray');
    log('   • Platform not supported (Windows, macOS, Linux required)', 'gray');
    console.log('');

    // Check Node.js version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

    if (majorVersion < 18 || majorVersion >= 22) {
      log('   ❌ CRITICAL: Wrong Node.js Version!', 'red');
      log(`   You are using Node.js ${nodeVersion}`, 'gray');
      log('   OL-Grafik REQUIRES Node.js v18.x - v20.x', 'red');
      console.log('');
      log('   SOLUTION: Install Node.js v20 LTS (recommended):', 'bright');
      log('   • Using nvm (recommended): nvm install 20 && nvm use 20', 'cyan');
      log('   • Direct download: https://nodejs.org/dist/latest-v20.x/', 'cyan');
      console.log('');
    }

    log('   To fix this:', 'bright');

    const platform = process.platform;
    if (platform === 'darwin') {
      log('   macOS:', 'cyan');
      log('   1. Install Node.js v18-v20 (v20 LTS recommended)', 'gray');
      log('   2. Install Xcode Command Line Tools: xcode-select --install', 'gray');
      log('   3. Install NDI Runtime from: https://ndi.link/NDIRedistV5', 'gray');
      log('   4. Delete node_modules and package-lock.json', 'gray');
      log('   5. Run: npm install', 'gray');
    } else if (platform === 'win32') {
      log('   Windows:', 'cyan');
      log('   1. Install Node.js v18-v20 (v20 LTS recommended)', 'gray');
      log('   2. Install Visual Studio Build Tools', 'gray');
      log('   3. Install NDI Runtime from: https://ndi.link/NDIRedistV5', 'gray');
      log('   4. Delete node_modules and package-lock.json', 'gray');
      log('   5. Run: npm install', 'gray');
    } else if (platform === 'linux') {
      log('   Linux:', 'cyan');
      log('   1. Install Node.js v18-v20 (v20 LTS recommended)', 'gray');
      log('   2. Install build-essential: sudo apt-get install build-essential', 'gray');
      log('   3. Install NDI Runtime from: https://ndi.link/NDIRedistV5', 'gray');
      log('   4. Delete node_modules and package-lock.json', 'gray');
      log('   5. Run: npm install', 'gray');
    }
  }

  console.log('');
  log('─'.repeat(70), 'gray');
  if (grandioseWorking) {
    log('✅ You can now start the application with: npm run dev', 'green');
  } else {
    log('⚠️  IMPORTANT: NDI is REQUIRED for OL-Grafik to function.', 'yellow');
    log('   The application will NOT start until NDI is properly configured.', 'yellow');
  }
  log('─'.repeat(70), 'gray');
  console.log('');

  // Don't fail the installation - just provide information
  // The app should still work without NDI
  process.exit(0);
}

// Run the check
try {
  checkGrandioseInstallation();
} catch (error) {
  log('❌ Error during grandiose verification:', 'red');
  log(`   ${error.message}`, 'gray');
  console.log('');
  log('The application will continue to work without NDI support.', 'yellow');
  console.log('');
  process.exit(0); // Don't fail the installation
}


#!/usr/bin/env node

/**
 * Post-install check for the NDI bindings (@stagetimerio/grandiose).
 *
 * NDI output is optional: this script only reports status and never fails
 * the install.
 */

const PKG = '@stagetimerio/grandiose';

const c = { reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m' };
const log = (msg, color = 'reset') => console.log(`${c[color]}${msg}${c.reset}`);

function main() {
  console.log('');
  log('NDI bindings check', 'cyan');

  let grandiose;
  try {
    grandiose = require(PKG);
  } catch (error) {
    log(`⚠️  ${PKG} could not be loaded - NDI output will be disabled.`, 'yellow');
    log(`   ${error.message.split('\n')[0]}`, 'gray');
    console.log('');
    log('   npm 11+ skips install scripts that are not approved. To build the addon:', 'reset');
    log(`     npm install-scripts approve ${PKG}`, 'cyan');
    log(`     npm rebuild ${PKG}`, 'cyan');
    log('   The build needs a C++ toolchain (Xcode CLT, VS Build Tools or build-essential)', 'gray');
    log('   and downloads the NDI 6 SDK automatically.', 'gray');
    console.log('');
    return;
  }

  try {
    const version = typeof grandiose.version === 'function' ? grandiose.version() : 'unknown';
    log(`✅ NDI ready: ${version}`, 'green');
  } catch (error) {
    log(`⚠️  Addon loaded but the NDI runtime did not initialise: ${error.message}`, 'yellow');
    log('   Install NDI Tools from https://ndi.video/tools/', 'gray');
  }
  console.log('');
}

try {
  main();
} catch (error) {
  log(`⚠️  NDI check failed: ${error.message}`, 'yellow');
}
process.exit(0);

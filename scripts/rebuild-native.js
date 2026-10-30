#!/usr/bin/env node

/**
 * electron-builder beforePack hook: verify the NDI native addon is present.
 *
 * @stagetimerio/grandiose is a Node-API (N-API) addon. Node-API is ABI-stable,
 * so the binary built during `npm install` loads in both Node.js and Electron
 * without an electron-rebuild step. Its install script also bundles the NDI 6
 * runtime library (libndi / Processing.NDI.Lib) next to the addon in `dist/`.
 *
 * Native addons cannot be cross-compiled reliably: build each platform's
 * installer on that platform (or in CI on a matching runner).
 */

const path = require('path');
const fs = require('fs');

const DIST_DIR = path.join(__dirname, '..', 'node_modules', '@stagetimerio', 'grandiose', 'dist');

const PLATFORM_LIBS = {
  darwin: ['libndi.dylib'],
  win32: ['Processing.NDI.Lib.x64.dll'],
  linux: ['libndi.so.6', 'libndi.so']
};

const PLATFORM_NAMES = { win32: 'win32', darwin: 'darwin', linux: 'linux', mas: 'darwin' };

// REQUIRE_NDI=1 (set in CI): a package without working NDI fails the build instead of warning
const REQUIRED = process.env.REQUIRE_NDI === '1';
const problem = (message) => {
  if (REQUIRED) throw new Error(`${message} (REQUIRE_NDI=1)`);
  console.warn(`⚠️  ${message}`);
};

async function verifyNativeModules(context) {
  const target = (context && PLATFORM_NAMES[context.electronPlatformName]) || process.platform;
  console.log(`🔧 Verifying NDI native addon for ${target}...`);

  if (target !== process.platform) {
    problem(`Packaging for ${target} on ${process.platform}: NDI output will not work in this package. Build on the target platform instead.`);
    return;
  }

  const addon = path.join(DIST_DIR, 'grandiose.node');
  if (!fs.existsSync(addon)) {
    problem('grandiose.node not found - the package would run without NDI output. Run "npm rebuild @stagetimerio/grandiose".');
    return;
  }
  console.log(`✅ grandiose.node found (${(fs.statSync(addon).size / 1024).toFixed(0)} KB)`);

  const libs = PLATFORM_LIBS[target] || [];
  const found = libs.find(lib => fs.existsSync(path.join(DIST_DIR, lib)));
  if (found) {
    console.log(`✅ NDI runtime bundled: ${found}`);
  } else {
    problem('NDI runtime library not found next to the addon - users would need NDI Tools installed.');
  }
}

// electron-builder hook
exports.default = verifyNativeModules;

if (require.main === module) {
  verifyNativeModules(null).catch(error => {
    console.error('❌', error.message);
    process.exit(1);
  });
}

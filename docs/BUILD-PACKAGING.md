# Build and Packaging Guide

## Overview

OL-Grafik is an Electron application that includes native Node.js modules (specifically `grandiose` for NDI support). This guide explains how to properly build and package the application to ensure native modules work correctly in the packaged application.

## The Native Module Challenge

### The Problem

Native Node.js modules (like `grandiose`) are compiled C++ addons that must match:
1. **Node.js version** - The exact Node.js version's ABI (Application Binary Interface)
2. **Architecture** - The CPU architecture (x64, x86, ARM, etc.)
3. **Platform** - The operating system (Windows, macOS, Linux)

When you run `npm install` during development, native modules are compiled for your **system's Node.js version**. However, Electron embeds its own Node.js runtime, which may be a different version.

**Example:**
- Your system: Node.js 20.x
- Electron 28.3.3: Node.js 18.18.2

If you package the app without rebuilding native modules, you'll get errors like:
- Windows: "grandiose.node is not a valid Win32 application"
- macOS/Linux: "Module version mismatch" or similar errors

### The Solution

We use `@electron/rebuild` to recompile native modules for the exact Node.js version embedded in Electron **before** packaging the application.

## Build Configuration

### electron-builder.json

The `electron-builder.json` configuration includes these critical settings:

```json
{
  "asarUnpack": [
    "node_modules/grandiose/**/*"
  ],
  "npmRebuild": true,
  "buildDependenciesFromSource": false,
  "nodeGypRebuild": false
}
```

**Explanation:**
- `asarUnpack`: Extracts `grandiose` from the ASAR archive so the native module can be loaded
- `npmRebuild`: Tells electron-builder to rebuild native modules
- `buildDependenciesFromSource`: We don't need to rebuild from source (we use prebuilt binaries when available)
- `nodeGypRebuild`: We use `@electron/rebuild` instead of node-gyp directly

### package.json Scripts

```json
{
  "scripts": {
    "build": "tsc && vite build && npm run rebuild:electron && electron-builder",
    "electron:build": "vite build && npm run rebuild:electron && electron-builder",
    "rebuild:electron": "electron-rebuild -f -w grandiose"
  }
}
```

**Explanation:**
- `rebuild:electron`: Rebuilds only the `grandiose` module for Electron's Node.js version
  - `-f`: Force rebuild even if already built
  - `-w grandiose`: Only rebuild the `grandiose` module (faster than rebuilding all modules)
- `build` and `electron:build`: Run the rebuild step **before** electron-builder packages the app

## Building the Application

### Prerequisites

1. **Node.js**: Version 18.x, 19.x, 20.x, or 21.x (as specified in package.json)
2. **npm**: Version 9.0.0 or higher
3. **Build tools**:
   - **Windows**: Visual Studio Build Tools or Visual Studio with C++ workload
   - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
   - **Linux**: `build-essential` package (`sudo apt-get install build-essential`)

### Development Build

For development (not packaged):

```bash
npm install
npm run dev
```

The `postinstall` script will verify grandiose installation and show warnings if NDI Runtime is not available.

### Production Build

To create a packaged application:

```bash
# Install dependencies
npm install

# Build and package
npm run build
```

This will:
1. Compile TypeScript (`tsc`)
2. Build the renderer process with Vite (`vite build`)
3. Rebuild native modules for Electron (`npm run rebuild:electron`)
4. Package the application with electron-builder (`electron-builder`)

The packaged application will be in the `release/` directory.

### Platform-Specific Builds

To build for a specific platform:

```bash
# Windows
npm run build -- --win

# macOS
npm run build -- --mac

# Linux
npm run build -- --linux
```

## Troubleshooting

### "grandiose.node is not a valid Win32 application"

**Cause:** Native module was compiled for the wrong Node.js version or architecture.

**Solution:**
1. Make sure you ran `npm run rebuild:electron` before packaging
2. Check that the build script includes the rebuild step
3. Verify Electron version matches the configuration

### "Module version mismatch"

**Cause:** Similar to above - native module ABI doesn't match Electron's Node.js version.

**Solution:**
1. Delete `node_modules` and reinstall: `rm -rf node_modules && npm install`
2. Run `npm run rebuild:electron` manually
3. Rebuild the package

### Build fails on Windows

**Cause:** Missing Visual Studio Build Tools.

**Solution:**
1. Install Visual Studio Build Tools: https://visualstudio.microsoft.com/downloads/
2. Select "Desktop development with C++" workload
3. Restart your terminal and try again

### Build fails on macOS

**Cause:** Missing Xcode Command Line Tools.

**Solution:**
```bash
xcode-select --install
```

### Build fails on Linux

**Cause:** Missing build tools.

**Solution:**
```bash
sudo apt-get update
sudo apt-get install build-essential
```

## NDI Support

### Optional Dependency

NDI support (via `grandiose`) is **optional**. The application will:
- ✅ Start normally even if NDI Runtime is not installed
- ⚠️ Show a warning dialog on startup if NDI is unavailable
- ❌ Disable NDI output features (but all other features work)

### Installing NDI Runtime

Users who want NDI output should:
1. Download NDI Runtime from https://ndi.link/NDIRedistV5
2. Install NDI Runtime
3. Restart OL-Grafik

The application will automatically detect NDI Runtime on next startup.

### Verifying NDI Installation

During development, you can verify grandiose installation:

```bash
node scripts/verify-grandiose.js
```

This will show:
- ✅ If grandiose is properly installed
- ⚠️ If grandiose is installed but NDI Runtime is missing
- ❌ If grandiose failed to install

## CI/CD Considerations

When building in CI/CD pipelines:

1. **Install build tools** in your CI environment
2. **Use the same Node.js version** across all build steps
3. **Run the full build script** (`npm run build`) - don't skip the rebuild step
4. **Cache `node_modules` carefully** - native modules may need rebuilding even with cache

### Example GitHub Actions Workflow

```yaml
name: Build

on: [push]

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
        node-version: [20.x]

    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: ${{ matrix.node-version }}
      
      - name: Install dependencies
        run: npm ci
      
      - name: Build application
        run: npm run build
      
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: release-${{ matrix.os }}
          path: release/
```

## Version Information

- **Electron**: 28.3.3
- **Embedded Node.js**: 18.18.2
- **Native Modules**: grandiose (NDI SDK wrapper)

When upgrading Electron, verify the embedded Node.js version and test native module compatibility.

## References

- [Electron Documentation](https://www.electronjs.org/docs)
- [electron-builder Documentation](https://www.electron.build/)
- [@electron/rebuild](https://github.com/electron/rebuild)
- [NDI SDK](https://ndi.tv/)
- [grandiose](https://github.com/Streampunk/grandiose)


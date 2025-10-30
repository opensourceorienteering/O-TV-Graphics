# NDI Setup Guide

This document explains how to set up NDI (Network Device Interface) support in OL-Grafik.

## Overview

OL-Grafik uses the `grandiose` npm package to provide NDI output capabilities. NDI allows you to send video output over a network to other NDI-compatible devices and software.

⚠️ **CRITICAL: NDI is REQUIRED** - OL-Grafik will not start without NDI properly configured. This is a hard requirement for the application.

## Requirements

To run OL-Grafik, you need **ALL** of the following:

1. **Node.js v20.x** - REQUIRED (v20.0.0 to v21.99.99)
2. **NDI Runtime** - REQUIRED (Installed on your operating system)
3. **Grandiose package** - REQUIRED (Node.js bindings for NDI, installed via npm)

### Why Node.js v20?

The `grandiose` package (NDI bindings) uses native modules that are only compatible with Node.js v20.x. Node.js v22+ has breaking changes in the V8 API that prevent grandiose from compiling.

**Node.js v20 LTS is supported until April 2026**, making it a stable choice for production use.

## Installation

### Step 0: Install Node.js v20 (CRITICAL)

**You MUST use Node.js v20.x** - the application will not work with other versions.

#### Using nvm (Recommended)

```bash
# Install nvm if you don't have it
# macOS/Linux: https://github.com/nvm-sh/nvm
# Windows: https://github.com/coreybutler/nvm-windows

# Install Node.js v20 LTS
nvm install 20

# Use Node.js v20
nvm use 20

# Set as default
nvm alias default 20

# Verify version
node --version  # Should show v20.x.x
```

#### Direct Download

Download Node.js v20 LTS from:
- **Latest v20.x:** https://nodejs.org/dist/latest-v20.x/
- **Official site:** https://nodejs.org/ (select "LTS" version, ensure it's v20.x)

### Step 1: Install Build Tools (First Time Only)

The `grandiose` package is a native Node.js module that needs to be compiled during installation. You need build tools installed on your system.

#### macOS
```bash
# Install Xcode Command Line Tools
xcode-select --install
```

#### Windows
1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
2. During installation, select "Desktop development with C++"

#### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install build-essential
```

### Step 2: Install NDI Runtime

Download and install the NDI Runtime for your platform:

**Download:** [https://ndi.link/NDIRedistV5](https://ndi.link/NDIRedistV5)

- **macOS:** Install the `.pkg` file
- **Windows:** Install the `.exe` file
- **Linux:** Follow the installation instructions for your distribution

**Important:** After installing NDI Runtime, restart your terminal/IDE (or your entire computer) to ensure the NDI libraries are properly loaded.

### Step 3: Install Dependencies

```bash
npm install
```

During installation, you'll see output from the `verify-grandiose.js` script that checks if NDI is properly set up.

### Step 4: Verify Installation

After running `npm install`, you should see one of these messages:

✅ **Success (REQUIRED):**
```
✅ NDI support is READY
   The application will be able to use NDI output features.
   NDI SDK Version: 5.x.x
```

**If you see this, you're good to go! The application will start normally.**

⚠️ **Partial Success (NDI Runtime not installed) - APPLICATION WILL NOT START:**
```
⚠️ NDI support is PARTIALLY AVAILABLE
   The grandiose package is installed but the native module failed to load.
   This usually means the NDI Runtime is not installed on your system.
```

**Action required:** Install NDI Runtime (Step 2) and run `npm install` again.

❌ **Failed (Build tools or other issues) - APPLICATION WILL NOT START:**
```
❌ NDI support is NOT AVAILABLE
   The grandiose package failed to install.
```

**Action required:** Follow troubleshooting steps below.

## Troubleshooting

### Issue: "Incompatible Node.js Version" Error on Startup

**Symptom:** Application shows error dialog: "Node.js vX.X.X is not compatible. OL-Grafik requires Node.js v20.x..."

**Cause:** You're using Node.js v22+ or an older version.

**Solution:**
1. Install Node.js v20 using nvm (see Step 0 above)
2. Verify version: `node --version` (should show v20.x.x)
3. Delete `node_modules` and `package-lock.json`
4. Run `npm install` again
5. Restart the application

### Issue: "NDI Required" Error on Startup

**Symptom:** Application shows error dialog: "NDI is required for OL-Grafik to function..."

**Cause:** NDI is not available (either grandiose not installed or NDI Runtime missing).

**Solution:**
1. Verify Node.js version: `node --version` (must be v20.x.x)
2. Install NDI Runtime from https://ndi.link/NDIRedistV5
3. Restart your terminal/IDE
4. Delete `node_modules` and `package-lock.json`
5. Run `npm install` again
6. Check the post-install output for NDI status
7. Restart the application

### Issue: "Grandiose package not installed"

**Cause:** The `grandiose` package failed to install during `npm install`.

**Solution:**
1. **FIRST:** Verify you're using Node.js v20.x: `node --version`
2. Ensure build tools are installed (see Step 1 above)
3. Install NDI Runtime (see Step 2 above)
4. Delete `node_modules` and `package-lock.json`
5. Run `npm install` again

### Issue: "NDI Runtime not detected"

**Cause:** The `grandiose` package is installed, but the NDI Runtime is not found on your system.

**Solution:**
1. Install NDI Runtime from [https://ndi.link/NDIRedistV5](https://ndi.link/NDIRedistV5)
2. Restart your computer (or at least your terminal/IDE)
3. Run `npm install` to rebuild the grandiose package
4. Restart the application

### Issue: "Compiled against a different Node.js version"

**Cause:** You upgraded Node.js after installing dependencies.

**Solution:**
```bash
npm rebuild grandiose
```

### Issue: Build fails on macOS with "gyp: No Xcode or CLT version detected"

**Cause:** Xcode Command Line Tools not installed or not properly configured.

**Solution:**
```bash
# Remove existing installation
sudo rm -rf /Library/Developer/CommandLineTools

# Reinstall
xcode-select --install

# Verify installation
xcode-select -p
# Should output: /Library/Developer/CommandLineTools

# Try installing again
npm install
```

### Issue: Build fails on Windows

**Cause:** Visual Studio Build Tools not installed or Python not found.

**Solution:**
1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
2. Install [Python 3.x](https://www.python.org/downloads/)
3. Run `npm install` again

## Using NDI in OL-Grafik

Once NDI is properly set up:

1. Launch OL-Grafik with `npm run dev`
2. Navigate to the **Output** page
3. Look at the **NDI Output** panel
4. You should see "NDI Available" status
5. Click **Settings** to configure NDI output
6. Click **Start** to begin sending NDI output

### NDI Configuration Options

- **Source Name:** The name that will appear in NDI receivers (default: "OL-Grafik Graphics Output")
- **Frame Rate:** Output frame rate (default: 30 fps)
- **Groups:** NDI groups for network organization (optional)

## Testing NDI

To test if NDI is working:

1. Navigate to the **Output** page
2. Click the test tube icon (🧪) in the NDI Output panel header
3. A modal will appear with detailed diagnostic information
4. Review the test results to see what's working and what's not

## Running Without NDI

✅ **The application will run with graceful degradation** if NDI is not available.

If NDI is not available:
- ⚠️ The application will show a warning dialog on startup
- ✅ The application will continue to run normally
- ❌ NDI output will be disabled
- ℹ️ All other features (Web output, templates, data sources) will work normally
- ✅ You can install NDI Runtime later and restart to enable NDI output

To enable NDI output:
1. Install NDI Runtime from https://ndi.link/NDIRedistV5
2. Restart the application
3. NDI output will be automatically enabled

## Architecture Notes

### Why is grandiose a core dependency?

`grandiose` is a **core** dependency (not optional) because:
- NDI is a critical feature for OL-Grafik's broadcast workflow
- The application is designed for professional production environments
- npm will always try to install it
- The post-install script provides clear feedback
- Better error messages help developers troubleshoot
- However, the app will run with graceful degradation if NDI Runtime is not installed

### Why Node.js v20?

Node.js v20 is required because:
- The `grandiose` package uses native modules (C++ bindings)
- These native modules depend on the V8 JavaScript engine API
- Node.js v22+ introduced breaking changes to the V8 API
- The `segfault-handler` dependency (used by grandiose) is incompatible with v22+
- Node.js v20 LTS is stable and supported until April 2026

### No Graceful Degradation

Unlike typical optional features, NDI is **required**:

1. **Detection:** On startup, the app checks if NDI is available
2. **Validation:** If NDI is not available, the app shows an error dialog
3. **Exit:** The application exits immediately if NDI is missing
4. **No Fallback:** There is no fallback mode - NDI must be working

## Platform Support

NDI is supported on:
- ✅ macOS (Intel and Apple Silicon)
- ✅ Windows (64-bit)
- ✅ Linux (Ubuntu, Debian, CentOS, etc.)

## Additional Resources

- [NDI Official Website](https://ndi.tv/)
- [NDI Downloads](https://ndi.link/NDIRedistV5)
- [Grandiose GitHub](https://github.com/Streampunk/grandiose)
- [NDI Documentation](https://docs.ndi.tv/)

## Support

If you encounter issues with NDI setup:

1. Run the NDI test (🧪 button in Output page)
2. Check the application logs in the `LOG` directory
3. Check the terminal output from `npm install`
4. Review this guide's troubleshooting section
5. Open an issue on GitHub with:
   - Your operating system and version
   - Node.js version (`node --version`)
   - npm install output
   - NDI test results
   - Application logs


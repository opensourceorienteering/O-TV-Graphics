# OL-Grafik

Cross-platform graphics software for orienteering competitions, built with modern web technologies.

## Features

- **OGRAF Standard Support**: Full support for EBU's Open Graphics Format v1
- **Legacy Template Support**: Backward compatibility with SPX-GC templates
- **LiveResults Integration**: Real-time data from orienteering competitions
- **Multi-Output**: Web output (OBS/vMix) and NDI support
- **Cross-Platform**: Runs on Windows, macOS, and Linux
- **Real-Time Control**: WebSocket-based communication for instant updates
- **Project Management**: SPX-inspired project and rundown organization

## Technology Stack

- **Framework**: Electron 28+
- **Backend**: Node.js + Express
- **Frontend**: React 18 + TypeScript
- **Real-time**: Socket.io
- **Build**: Vite
- **State Management**: Zustand
- **Logging**: Winston

## Getting Started

### Prerequisites

⚠️ **IMPORTANT: Node.js Version Requirement**

- **Node.js v18.x - v21.x** (REQUIRED - v18.0.0 to v21.99.99)
  - **Recommended**: Node.js v20 LTS
  - **Supported**: Node.js v18.x, v19.x, v20.x, v21.x
  - **Not supported**: Node.js v22+ (grandiose compilation issues)
- npm >= 9.0.0
- **NDI Runtime** (OPTIONAL - only needed for NDI output)

**Why these Node.js versions?** OL-Grafik includes optional NDI (Network Device Interface) support for professional broadcast output. The NDI bindings (grandiose package) support Node.js v16-v21 but fail to compile on Node.js v22+ due to native module compatibility issues. Node.js v20 LTS is recommended and supported until April 2026.

**Note for Electron users**: Electron bundles its own Node.js runtime. The current version (Electron 28.3.3) bundles Node.js v18.18.2, which is fully compatible.

### Installation

#### Step 1: Install Node.js v18-v20

If you're using **nvm** (recommended):
```bash
# Install Node.js v20 LTS (recommended)
nvm install 20

# Use Node.js v20
nvm use 20

# Verify version
node --version  # Should show v18.x.x, v19.x.x, or v20.x.x
```

If you're **not using nvm**:
- Download Node.js v20 LTS from: https://nodejs.org/dist/latest-v20.x/

#### Step 2: Install NDI Runtime (Optional)

**NDI Runtime is OPTIONAL** - OL-Grafik works perfectly without it. Only install if you need NDI output.

1. Download NDI Runtime from: [https://ndi.link/NDIRedistV5](https://ndi.link/NDIRedistV5)
2. Install for your platform (macOS, Windows, or Linux)
3. Restart your terminal/IDE after installation

If you skip this step, the application will show a warning on startup but will continue to run normally with all other features available.

#### Step 3: Install Dependencies

```bash
# Install dependencies (including grandiose/NDI)
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

**Note:** During `npm install`, you'll see output about NDI (grandiose) package installation. If installation fails, see the [NDI Setup Guide](docs/NDI-SETUP.md) for troubleshooting.

### Development

```bash
# Start Vite dev server + Electron
npm run electron:dev

# Type checking
npm run type-check

# Linting
npm run lint

# Run tests
npm test
```

## Project Structure

```
ol-grafik/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── data/            # Data layer (LiveResults, WebSocket)
│   │   ├── templates/       # Template management (OGRAF, SPX)
│   │   ├── graphics/        # Graphics engine
│   │   ├── output/          # Output layer (Web, NDI)
│   │   ├── plugins/         # Plugin system
│   │   ├── utils/           # Utilities (logger, config)
│   │   └── windows/         # Window management
│   ├── renderer/
│   │   ├── control/         # Control panel UI (React)
│   │   └── graphics/        # Graphics renderer
│   ├── preload/             # Preload scripts
│   └── shared/              # Shared types and utilities
├── templates/               # Template storage
│   ├── ograf/              # OGRAF templates
│   └── legacy/             # SPX templates
├── DATAROOT/               # User data (projects, rundowns)
├── plugins/                # User plugins
└── LOG/                    # Application logs
```

## Configuration

Configuration is stored in `config.json` in the application root:

```json
{
  "general": {
    "hostname": "TV-Grafik",
    "port": 5657,
    "wsPort": 5656,
    "dataroot": "./DATAROOT",
    "loglevel": "info"
  },
  "liveresults": {
    "baseUrl": "http://your-liveresults-server",
    "cacheInterval": 15000
  },
  "output": {
    "ndi": {
      "enabled": false,
      "name": "TV-Grafik Output",
      "fps": 50
    },
    "web": {
      "enabled": true,
      "cors": true
    }
  }
}
```

## NDI Output (Optional)

ℹ️ **NDI is OPTIONAL** - OL-Grafik works perfectly without NDI. The application will start normally and show a warning if NDI is not available, but all other features will work.

**To enable NDI output:**
1. ✅ Node.js v18-v21 (see Prerequisites above)
2. ✅ NDI Runtime installed from [ndi.link/NDIRedistV5](https://ndi.link/NDIRedistV5)
3. ✅ Grandiose package installed via `npm install`
4. ✅ Restart OL-Grafik after installing NDI Runtime

**If you see an NDI warning on startup:**
- This is normal if you haven't installed NDI Runtime
- All other features (Web output, templates, LiveResults) work normally
- To enable NDI: Install NDI Runtime and restart the application
- See [NDI Setup Guide](docs/NDI-SETUP.md) for detailed instructions

**For detailed setup instructions, troubleshooting, and platform-specific guides, see:**
📖 [NDI Setup Guide](docs/NDI-SETUP.md)

**Quick status check:**
- After `npm install`, check the terminal output for NDI status
- The application will show a warning dialog if NDI is not available (you can dismiss it)
- In the app, go to Output page → NDI Output panel to configure NDI
- Click the test button (🧪) to run diagnostics

## OGRAF Template Development

OL-Grafik supports the EBU OGRAF v1 specification. Example template structure:

```
my-graphic/
├── my-graphic.ograf.json    # Manifest
├── graphic.mjs              # Web Component
├── styles.css
└── assets/
    └── logo.png
```

See the [OGRAF Specification](https://ograf.ebu.io/v1/specification/) for details.

## LiveResults Integration

TV-Grafik integrates with the Swedish LiveResults API to provide real-time orienteering competition data.

### Features:
- **Automatic Data Fetching**: Connect to live competitions with one click
- **Smart Caching**: Hash-based validation reduces API calls
- **Auto-Fill Templates**: Automatically populate graphics with live data
- **18 Professional Templates**: Complete coverage of individual and relay competitions
- **Project-Level Defaults**: Set competition once, use across all graphics
- **Item-Level Overrides**: Support multi-event broadcasts

### Supported Templates:
- **General**: Lower Third
- **Individual**: Start List, Results, Split Times, Lower Third
- **Relay**: Start List, Results, Split Times, Lower Third (Team & Runner)

See [LiveResults User Guide](docs/LIVERESULTS_USER_GUIDE.md) for detailed usage instructions.

## Keyboard Shortcuts

- `Space` - Play/Stop selected item
- `Esc` - Stop all graphics
- `Enter` - Edit selected item
- `Ctrl+S` - Save rundown
- `Ctrl+N` - New item
- `↑/↓` - Navigate items
- `Shift+?` - Show keyboard shortcuts help

## Output Methods

### Web Output
Access graphics at `http://localhost:5657/output` for use with:
- OBS Studio (Browser Source)
- vMix (Web Input)
- CasparCG (HTML Producer)

### NDI Output
Enable NDI in settings for direct video output to NDI-compatible systems.

## Architecture

TV-Grafik follows a hybrid architecture combining:
- **OGRAF Standard**: Primary template format for future compatibility
- **SPX Patterns**: Proven project/rundown structure and UI/UX patterns
- **Electron**: Cross-platform desktop application framework

## Development Status

### ✅ Phase 1-3: Foundation & Core Features (COMPLETE)

**Phase 1: Foundation**
- ✅ Project structure and TypeScript configuration
- ✅ Electron + Vite build system
- ✅ WebSocket and web servers
- ✅ Logger and configuration management
- ✅ Type definitions (OGRAF, SPX, LiveResults)

**Phase 2: OGRAF & Template System**
- ✅ OGRAF v1 template manager with validation
- ✅ Template discovery and loading
- ✅ Graphics playback engine
- ✅ Project and rundown management
- ✅ WebSocket-based graphics control

**Phase 3: LiveResults Integration**
- ✅ LiveResults API client with caching
- ✅ 18 professional orienteering graphics templates
- ✅ Automatic data mapping (LiveResultsMapper)
- ✅ Project-level competition selection
- ✅ Item-level competition/class selection
- ✅ Auto-fill template fields from live data
- ✅ Comprehensive UI components (CompetitionSelector, ClassSelector)

**Phase 4: Enhanced UI/UX**
- ✅ Keyboard shortcuts system
- ✅ 2-column rundown editor layout
- ✅ Dynamic template field editor
- ✅ Preview panel with show/hide toggle
- ✅ Color-coded items by template type
- ✅ Inline item editing

### 🚧 Phase 5: Real-Time Updates (NEXT)
- ⏳ Automatic data refresh/polling
- ⏳ Real-time graphics updates
- ⏳ Polling configuration UI
- ⏳ Data freshness indicators
- ⏳ Live event support

## Contributing

This is a custom application for orienteering competitions. For questions or contributions, please contact the development team.

## License

MIT License - See LICENSE file for details

## Acknowledgments

- **EBU OGRAF**: For the open graphics standard
- **SPX-GC**: For inspiration on architecture and UX patterns
- **LiveResults**: For the orienteering competition data API

---

## Documentation

- **[Build & Packaging Guide](docs/BUILD-PACKAGING.md)** - How to build and package the application (IMPORTANT for Windows users)
- **[NDI Setup Guide](docs/NDI-SETUP.md)** - NDI installation and troubleshooting
- **[LiveResults User Guide](docs/LIVERESULTS_USER_GUIDE.md)** - Complete guide for using LiveResults integration
- **[LiveResults Developer Guide](docs/LIVERESULTS_DEVELOPER_GUIDE.md)** - Technical documentation for developers
- **[Phase 3 Completion Summary](LIVERESULTS_INTEGRATION_PHASE3_COMPLETE.md)** - Detailed Phase 3 implementation notes
- **[Template Library Reference](TEMPLATE_LIBRARY_REFERENCE.md)** - Complete template documentation

---

**Version**: 1.0.0
**Status**: Phase 4 Complete - LiveResults Integration & Enhanced UI
**Last Updated**: 2025-10-17


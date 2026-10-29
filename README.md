# Split Control

*Orienteering Graphics* (formerly OL-Grafik)

Cross-platform broadcast graphics for orienteering competitions. Split Control plays EBU OGraf HTML graphics fed with live results, and outputs them to OBS, vMix or CasparCG over HTTP, or as an NDI source with alpha.

## Event workflow

The control app opens on **Events**, grouped into folders. Every event has two states:

- **Plan:** event details, look, data connection and test, start lists with favourite runners and virtual bibs, and output. The checklist shows preparation status.
- **Live desk:** choose a graphic, fill its fields (or recall a favourite saved for that graphic), check it in Preview, then **Show**, **Update** or **Hide**. Every graphic is triggered by hand; there is no cue list or "next". Ctrl/Cmd+K opens a command palette (`0 2 105` = runner identity, class 2, bib 105) with recent commands.
- **Monitors:** Program and Preview can run in the desk, in separate windows, or together in one window on another screen. Preview never affects the output.
- **Start lists:** import IOF XML/CSV, refresh from the event source, mark favourites, assign virtual bibs and export a PDF.
- **Companion:** HTTP actions, Socket.IO tally and a local module with favourite buttons plus Show / Update / Hide / Hide all. See [control and monitors](docs/CONTROL-API.md) and [module packaging](companion/README.md).

New events can follow shared folder defaults with event overrides. Existing and duplicated events remain independent until linked; a duplicated event keeps the source's desk favourites. Shared changes wait while graphics are on air. Output configuration is shared by the running app.

See [UX progress and remaining field tests](docs/UX-IMPLEMENTATION-STATUS.md).

## Features

- **Template sets: IOF, ČO and Classic.** Each set is a complete look with 13 competition graphics plus an output test pattern: results, start list, standings and runner lower thirds, split comparison, position history chart, podium, next starters, race clock, course facts, weather, event title and name strap. A project picks one set, and graphics from different sets can't be mixed. See [templates/sets](templates/sets/README.md).
- **Broadcast rules built in.** The club/flag rule follows national or international events. Playing a graphic takes clashing graphics off air (a results table removes the lower third, but the clock stays). Club logos ship with the app and only change with a new version, so nothing contacts Eventor during a broadcast.
- **Director start alerts** at `http://<host>:5657/director`. Pick classes, star favourites, and get a beep and flash before they start. It works on any device on the network.
- **EBU OGraf v1 graphics.** Templates are standard OGraf packages: an `.ograf.json` manifest plus an ES module whose default export is the Web Component. Third-party OGraf graphics load unmodified, and ours load in other OGraf renderers.
- **Live orienteering data.**
  - The Liveresultat REST API (`api.orienteering.services`) is the default, with instant push updates.
  - The legacy `api.php` API is still supported.
  - MeOS directly, through its built-in information server: results, radio splits and relay legs with no internet, receiver or database.
  - MeOS Online Protocol (MOP) databases, for setups that already run a MOP receiver.
  - IOF XML 3.0 result or start list files from any timing software.
- **Web output** for OBS Browser Source, vMix Web Input and CasparCG HTML producer.
- **NDI 6 output** with alpha, through `@stagetimerio/grandiose`. It is optional.
- **Projects and rundowns**, inspired by SPX-GC, with live auto-update of graphics while they are on air.
- **Runs on Windows, macOS and Linux.**

## Technology stack

| Area | Choice |
|---|---|
| App shell | Electron 44 (Node.js 24, Chromium) |
| UI | React 19, React Router 7, Zustand 5 |
| Server | Express 5, Socket.IO 4 |
| Build | Vite 8 (Rolldown), TypeScript 6 |
| Tests and lint | Vitest 5, ESLint 10 flat config |
| NDI | `@stagetimerio/grandiose` (Node-API, NDI SDK 6.3) |

## Getting started

### Prerequisites

- **Node.js 22 or newer.** Node.js 24 LTS is recommended.
- **npm 10 or newer.**
- **A C++ toolchain**, needed once to build the NDI addon. NDI is optional, so the app still runs if the build fails. See the [NDI Setup Guide](docs/NDI-SETUP.md).

### Install and run

```bash
npm install
cp config.example.json config.json   # optional; without it, built-in defaults are used
npm run dev
```

The NDI bindings download the NDI 6 SDK during install, so no separate NDI runtime install is needed. npm 11+ only runs approved install scripts; the grandiose build is approved in `package.json`.

> **VS Code terminals** set `ELECTRON_RUN_AS_NODE=1`, which stops Electron from opening windows. If `npm run dev` starts but shows no window, run `env -u ELECTRON_RUN_AS_NODE npm run dev`.

### Scripts

```bash
npm run dev          # Vite dev server + Electron
npm run type-check   # tsc --noEmit
npm run lint         # ESLint
npm test             # Vitest (watch); npm test -- --run for a single run
npm run build        # type-check, build and package with electron-builder
```

## Project structure

```
ol-grafik/
├── src/
│   ├── main/            # Electron main process
│   │   ├── data/        # LiveResults client (REST + legacy), data sources, transformer
│   │   ├── templates/   # OGraf discovery and manifest validation
│   │   ├── playback/    # Playback engine and live auto-update
│   │   ├── output/      # Web server, NDI output, frame capture
│   │   ├── projects/    # Projects and rundowns
│   │   └── ipc/         # IPC handlers
│   ├── renderer/
│   │   ├── control/     # Control panel (React)
│   │   ├── graphics/    # OGraf renderer and module loader
│   │   └── web-output/  # Browser-source output page
│   ├── preload/
│   └── shared/types/
├── templates/           # OGraf graphics packages
├── docs/
├── DATAROOT/            # Projects and rundowns (git-ignored)
└── LOG/                 # Logs (git-ignored)
```

## Configuration

`config.json` in the application root is local and git-ignored. Start from [config.example.json](config.example.json). The main settings:

```json
{
  "general": { "port": 5657, "wsPort": 5656, "dataroot": "./DATAROOT" },
  "dataSources": [
    {
      "id": "liveresults-default",
      "type": "liveresults",
      "name": "LiveResults",
      "enabled": true,
      "config": { "baseUrl": "https://api.orienteering.services", "cacheInterval": 10000, "api": "rest" }
    }
  ],
  "output": { "ndi": { "enabled": false, "name": "Grafik", "fps": 50 }, "web": { "enabled": true } }
}
```

## Live results

Split Control talks to [Liveresultat](https://liveresultat.orientering.se) through one client with two backends:

| `api` | Base URL | Notes |
|---|---|---|
| `rest` (default) | `https://api.orienteering.services` | ETag/`If-None-Match` with 304 responses. Poll at most every 10 s. Valid JSON. [API docs](https://liveresultat.orientering.se/beta/docs) |
| `legacy` | `https://liveresultat.orientering.se` | `api.php?method=...` with a 15 s server cache. It doesn't escape quotes in names, which can break whole responses. |

`auto` picks `rest` when the base URL host is `api.orienteering.services`. Competition IDs are the same in both APIs. REST responses are mapped to the legacy shapes, so templates and the transformer work with either backend.

Timing software can publish to Liveresultat directly. MeOS uses MOP, and other systems can upload IOF XML 3.0 or JSON. See [Live results and MeOS (MOP)](docs/LIVERESULTS_USER_GUIDE.md) and the [developer guide](docs/LIVERESULTS_DEVELOPER_GUIDE.md).

## Templates

Graphics come in **template sets** (`templates/sets/<set>/`). Choose a project's set in Project View → Project graphics.

| Set | Look |
|---|---|
| `iof` | IOF TV graphics (IOF TV Manual for Broadcasters): red rank and time boxes, blue bars, uppercase Franklin Gothic, the three-layer slide |
| `cz` | Czech orienteering streams, after [co-stream-gfx](https://github.com/thejoeejoee/co-stream-gfx) (used with permission): orange and beige, italic headers with the control-circle mark |
| `classic` | The original Split Control look, including `countdown-timer`, `results-list-paginated`, `split-time-lower-third` and `split-time-lower-third-runner` |

Fonts are open-licensed stand-ins: Libre Franklin for ITC Franklin Gothic, and Albert Sans for GT Planar. If you have the licensed originals installed, they are used. Flags come from flag-icons (MIT).

**Club logos** ship with the app (`club-logos/`) and are matched to clubs by name. Users never fetch them from Eventor; maintainers refresh them before a release with `npm run logos:fetch` (see [Build & Packaging](docs/BUILD-PACKAGING.md)). Operators can add or replace logos as `DATAROOT/club-logos/manual/<Club name>.png` (Settings → Data → Open logo folder).

See the [Template Developer Guide](docs/TEMPLATE-DEVELOPER-GUIDE.md) and the [OGraf specification](https://ograf.ebu.io/v1/specification/). A graphic module must `export default` its class. The renderer registers it under a unique tag, so an edited template can be reloaded without restarting.

## Output

- **Web:** `http://localhost:5657/output`, for OBS Browser Source, vMix Web Input or CasparCG HTML.
- **NDI:** enable it on the Output page. See the [NDI Setup Guide](docs/NDI-SETUP.md).

## Keyboard shortcuts

- `Space`: play or stop the selected item
- `Esc`: stop all graphics
- `Enter`: edit the selected item
- `Ctrl+S`: save the rundown
- `Ctrl+N`: new item
- `↑/↓`: move between items
- `Shift+?`: show shortcut help

## OGraf Server API

Split Control implements the [EBU OGraf Server API v1](https://github.com/ebu/ograf/blob/main/v1/specification/open-api/server-api.yaml) at `http://<host>:5657/ograf/v1`. External OGraf controllers can list graphics and load, play, update, stop, run custom actions on and clear them on the program output (renderer `program`, render target `{ "output": "program" }`). Graphics started from a rundown are listed and can be cleared, but play/stop/update stay with the rundown. There is no authentication, so only expose port 5657 on a trusted network.

```bash
curl http://localhost:5657/ograf/v1/graphics
curl -X POST http://localhost:5657/ograf/v1/renderers/program/target/graphicInstance/load \
  -H 'content-type: application/json' \
  -d '{"renderTarget":{"output":"program"},"graphicId":"countdown-timer","params":{"data":{"title":"Start","targetTime":"11:30:00"}}}'
```

## Status

Implemented: template sets (IOF, ČO, Classic) with clash rules and the club/flag rule, Eventor club logos, director start alerts, OGraf v1 graphics and the OGraf Server API v1, projects and rundowns, live data from Liveresultat (REST with push, and legacy), MeOS (information server or MOP database) and IOF XML 3.0 files, live auto-update while on air, web output, and NDI 6 output.

Not yet implemented:

- Manual and CSV data sources. They are declared in the types but not registered.
- GPS tracking input. Tracking providers (Livelox, Loggator, Sportrec and others) each have their own API, and none is a shared standard yet.

## Documentation

- [Build & Packaging Guide](docs/BUILD-PACKAGING.md)
- [NDI Setup Guide](docs/NDI-SETUP.md)
- [LiveResults User Guide](docs/LIVERESULTS_USER_GUIDE.md)
- [LiveResults Developer Guide](docs/LIVERESULTS_DEVELOPER_GUIDE.md)
- [Template Developer Guide](docs/TEMPLATE-DEVELOPER-GUIDE.md)
- [Data Source Plugin API](docs/data-source-plugin-api.md)

## Acknowledgments

- **EBU OGraf**, for the open graphics standard
- **SPX-GC**, for architecture and UX inspiration
- **Liveresultat / LiveResults**, for the orienteering results API
- **Stagetimer**, for maintaining the grandiose NDI bindings

## License

MIT

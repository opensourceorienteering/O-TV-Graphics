# Build & Packaging Guide

## Overview

Split Control is an Electron application with one native module: [`@stagetimerio/grandiose`](https://github.com/stagetimerio/grandiose), the NDI bindings. It is a Node-API addon, so the binary built by `npm install` is ABI-stable and loads in Electron without a rebuild. The install script also bundles the NDI 6 runtime library next to the addon.

See the [NDI Setup Guide](NDI-SETUP.md) for NDI-specific details.

## Prerequisites

1. **Node.js 22 or newer.** Node.js 24 LTS is recommended.
2. **npm 10 or newer.** With npm 11+, the grandiose build script must be approved in `allowScripts`. The repository already approves it.
3. **Build tools**, needed once to compile the addon:
   - **Windows:** Visual Studio Build Tools with the "Desktop development with C++" workload
   - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
   - **Linux:** `build-essential`

## Development

```bash
npm install
npm run dev
```

The `postinstall` script reports whether NDI is ready. Run it again at any time with `node scripts/verify-grandiose.js`.

## Production build

```bash
npm install
npm run build
```

This will:

1. Type-check (`tsc`).
2. Build the renderer, main and preload bundles with Vite 8, which uses Rolldown.
3. Run the `beforePack` hook (`scripts/rebuild-native.js`), which verifies `grandiose.node` and the NDI library.
4. Package with electron-builder into `release/<version>/`.

### Platform-specific builds

```bash
npm run build -- --win
npm run build -- --mac
npm run build -- --linux
```

Native addons can't be cross-compiled. Build each platform on that platform. If you package for another platform, the hook prints a warning and NDI won't work in that package.

## Packaging configuration

`electron-builder.json` ships the addon outside the asar archive:

```json
"files": [
  "dist", "dist-electron", "templates",
  "node_modules/@stagetimerio/grandiose/package.json",
  "node_modules/@stagetimerio/grandiose/dist/**/*"
],
"asarUnpack": ["node_modules/@stagetimerio/grandiose/dist/**/*"]
```

Everything else in the main process is bundled by Vite. The NDI package is marked external in `vite.config.ts`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `grandiose.node not found` during packaging | Run `npm rebuild @stagetimerio/grandiose`, then build again. |
| npm warns that install scripts aren't covered by allowScripts | Run `npm install-scripts approve @stagetimerio/grandiose` and then `npm rebuild @stagetimerio/grandiose`. |
| `electron .` behaves like plain Node in a terminal inside VS Code | VS Code sets `ELECTRON_RUN_AS_NODE=1`. Unset it: `env -u ELECTRON_RUN_AS_NODE npm run dev`. |
| Dev server reports a busy port | Split Control uses port 5175 and refuses startup if occupied. Stop the process using 5175 or configure that process to use another port. |
| Build fails on Windows, macOS or Linux | Install the build tools listed above. |

## CI example (GitHub Actions)

```yaml
name: Build
on: [push]
jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm test -- --run
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: release-${{ matrix.os }}
          path: release/
```

## Version information

| Component | Version |
|---|---|
| Electron | 44.x (bundles Node.js 24) |
| NDI SDK | 6.3 (bundled by @stagetimerio/grandiose) |
| Vite | 8 |
| TypeScript | 6.0 |

When you upgrade Electron, keep its bundled Node.js at 22 or newer. `src/main/utils/version-check.ts` refuses to start on anything older.


## Club logos (before a release)

Club logos ship with the app in `club-logos/<eventor host>/` (`index.json` + `logos/`), so users
never fetch them from Eventor and logos only change with a new build. Fetching them in bulk has
been cleared with SOFT; only maintainers do it, before a release.

```bash
EVENTOR_API_KEY=<key> npm run logos:fetch                      # Swedish Eventor, 48 px logos
EVENTOR_NO_API_KEY=<key> npm run logos:fetch:no                 # Norwegian Eventor
EVENTOR_AU_API_KEY=<key> npm run logos:fetch:au                 # Australian Eventor
npm run logos:fetch -- --eventor https://example-eventor.test  # another Eventor
npm run logos:fetch -- --limit 20                              # try a few first
npm run logos:fetch -- --force                                 # fetch all again
```

Keys may also be stored as `eventor.apiKeys.se`, `eventor.apiKeys.no` and
`eventor.apiKeys.au` in the local `config.json`. The older `eventor.apiKey` remains the
Swedish-key fallback.

- The club list comes from the Eventor API.
- Eventor only serves logo images to web browsers (a Cloudflare browser check), so the script
  opens a normal Chromium window on Eventor and fetches the logos through it, one at a time with
  a short pause (`--delay`, default 250 ms). If Eventor shows a check, complete it in the window.
- Re-running only fetches missing logos. 48 × 48 px (`LargeIcon`) is the largest size Eventor serves.
- Commit `club-logos/` so every build includes the same logos. `electron-builder.json` packages it.

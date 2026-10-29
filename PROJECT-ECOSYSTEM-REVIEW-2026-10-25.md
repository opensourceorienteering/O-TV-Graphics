# Project and Orienteering Broadcast Ecosystem Review

**Review date:** 25 October 2026  
**Repository baseline:** `5b462cf` (5 November 2025)  
**Scope:** Project freshness, live orienteering timing/data, graphics standards, and broadcast output  
**Changes made:** None; this document records a review, not implementation work.

## Summary

The core direction remains sound: LiveResults, browser-based graphics, and OGraf graphics v1 are still relevant. The most important areas to revisit are the unsupported runtime baseline, the newer OGraf renderer-control standard, breadth of timing-system integration, and out-of-date setup/status documentation.

## Findings

| Priority | Finding | Evidence and impact |
|---|---|---|
| **High** | **The runtime baseline is end-of-life.** The app is locked to Electron 28.3.3 / Chromium 120 and rejects Node.js 22+, while setup guidance recommends Node.js 20. Node.js 18, 20, and 21 are now end-of-life; Node.js 22 and 24 are LTS. Electron supports only its latest three stable major versions. | The [package manifest](./package.json) sets the runtime engine range; [package-lock.json](./package-lock.json) resolves Electron 28.3.3. The [README](./README.md) and [NDI setup guide](./docs/NDI-SETUP.md) prescribe older runtimes. See the [Node.js release schedule](https://nodejs.org/en/about/previous-releases) and [Electron release/support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines). |
| **Medium–High** | **OGraf interoperability now includes a stable renderer-control API.** OL-Grafik supports OGraf graphics v1, but EBU published the stable OGraf Server API v1 on 13 August 2026. The app uses its own Socket.IO graphics control; its HTTP graphics-control route is still a stub. Supporting the API could improve interoperability with third-party OGraf controllers and renderers without replacing the current template format. | See [OGraf types](./src/shared/types/ograf.ts), the [HTTP route in WebServer](./src/main/output/WebServer.ts), and the [EBU OGraf project](https://github.com/ebu/ograf) (version history and specifications). |
| **Medium** | **Timing-system integration is narrow compared with the maintained IOF data standard.** Built-in sources are LiveResults and a MySQL/MOP-style schema. The shared types list manual and CSV sources, but the built-in registry does not implement them. The IOF IT Commission continues to maintain IOF XML v3; no IOF XML v3 connector was found in the sources reviewed. This limits portability between event timing/result systems. | See [built-in source registration](./src/main/data/sources/index.ts), [shared data-source types](./src/shared/types/dataSource.ts), and the [IOF IT Commission remit](https://orienteering.sport/iof/it/it-commission/). |
| **Medium** | **A data-source API gap and a 15-second refresh floor remain.** `LiveResultsDataSource.getResults()` currently logs that it is unimplemented and returns an empty array, despite results fetching elsewhere in the application. Playback auto-update itself is implemented, so the README's “Phase 5 — NEXT” status is stale. Playback starts polling every 15 seconds and the client enforces that minimum, which may be too slow for some broadcast use cases. | See [`LiveResultsDataSource.getResults`](./src/main/data/sources/LiveResultsDataSource.ts), the [PlaybackEngine update listener](./src/main/playback/PlaybackEngine.ts), and [LiveResultsClient polling](./src/main/data/LiveResultsClient.ts). |
| **Medium** | **NDI guidance and the frame-capture path need a compatibility/performance review.** The setup documentation still prescribes Node.js 20 and NDI Runtime 5. Current NDI SDK documentation describes NDI 6.3. OL-Grafik captures the graphics window and converts a bitmap for each outgoing frame; this may be sufficient, but should be benchmarked and validated against supported runtimes and the current `grandiose` binding before upgrading. | See the [NDI setup guide](./docs/NDI-SETUP.md), [FrameCaptureService](./src/main/output/FrameCaptureService.ts), [NDIOutputManager](./src/main/output/NDIOutputManager.ts), [NDI SDK documentation](https://docs.ndi.video/all/developing-with-ndi/sdk.md), and [NDI release notes](https://docs.ndi.video/all/using-ndi/ndi-tools/release-notes.md). |
| **Low** | **Project documentation and local configuration are behind or environment-specific.** The README still lists real-time updates as upcoming even though playback subscribes to result updates. NDI setup material needs a current compatibility pass. The tracked `config.json` includes machine-specific data/log paths and duplicate local simulator entries, which should not be production defaults. | See [README status](./README.md), [NDI setup guide](./docs/NDI-SETUP.md), and [config.json](./config.json). |

## What remains current

- **LiveResults is still active.** Its competition endpoint returned current competition data during this review; replacing it is not inherently necessary: [LiveResults API](https://liveresultat.orientering.se/api.php?method=getcompetitions).
- **OGraf graphics v1 remains stable.** The newer Server API expands renderer/controller interoperability; it does not make the existing graphics specification obsolete. See the [OGraf project and version history](https://github.com/ebu/ograf).
- **Browser-based graphics remain a valid output approach.** OBS continues to support Browser Source on Windows, macOS, and Linux: [OBS Browser Source documentation](https://obsproject.com/kb/browser-source).

## Recommended order of work

1. Update Electron/Node.js support and make native NDI builds reproducible across the platforms OL-Grafik supports.
2. Decide whether OGraf Server API compatibility is a product goal. If so, implement it alongside the existing control protocol.
3. Complete or narrow the advertised data-source contract, then prioritize IOF XML v3 and any event timing connectors needed by target users.
4. Review polling interval behavior against broadcast requirements; test faster refresh rates with the relevant data provider before changing defaults.
5. Correct the README/setup guides and move developer-specific paths and simulator configuration out of production defaults.

## Review limits

This was a repository and ecosystem review, not a full code audit. No source files were modified, and tests/builds were not run. Runtime/native-module compatibility, OGraf Server API conformance, data-source coverage, and NDI throughput require implementation-level validation before changes are made.

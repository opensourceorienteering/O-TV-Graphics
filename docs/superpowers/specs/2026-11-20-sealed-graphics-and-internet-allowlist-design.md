# Sealed graphics and an internet allowlist — design

Status: agreed in conversation on 20 November 2026. Follows the security and performance review of
the `c/vigilant-hawking-dpm43k` branch (finding S1) and builds on
[the graphics library design](2026-11-20-graphics-library-and-import-helper-design.md).

## Why

A look is code. Today any graphic can call nearly every function of the app through the preload
bridge (`window.electronAPI`, about 150 channels). It can take over playback, delete events, change
data sources, import further looks and open web pages in the operator's browser. That is true in
the graphics window (program output and NDI) and in the monitors inside the operator window
(Live desk Program/Preview, Plan's theme preview, and the new library preview). The library preview
makes it worse: opening a look's page runs its code straight away, exactly when a downloaded look
is least trusted.

We also want graphics that use outside sources, starting with a GPS viewer or map: the provider's
viewer in a frame, map tiles, data requests. The app's content rules block these today, except in
OBS and vMix, where nothing is blocked at all.

## Goals

1. **Sealed everywhere.** Graphic code can't reach any app function, in any output or monitor.
2. **One internet allowlist**, managed by the operator in Settings. Graphics may load from this
   computer plus the allowed addresses, and nothing else.
3. **The same rules on every output:** the app's preview monitors, its graphics window and NDI,
   and the web output used by OBS and vMix. What the preview shows is what airs.
4. **Imports say what they need.** A look that declares internet addresses shows them at import,
   and offers to add them to the allowlist.
5. **Lock down two sensitive functions,** in case something else ever gets through: opening a web
   page in the browser, and importing a file without a dialog.

## Non-goals

- Fetching GPS data in the app as a data feed. That's a possible later milestone, and this design
  doesn't block it.
- Limiting what a look draws on air, or its CPU and memory use.
- Per-look allowlists. One list applies to every graphic.
- Changing the operator UI's own content rules, beyond what sealing needs.

## Anti-goals

- A built-in look or a normal graphic that stops working. None of the built-in looks loads
  anything from the internet (checked: the only outside address in `templates/sets` is the
  `$schema` string). They must work exactly as before.
- An allowlist that also widens what the operator UI may load. It applies only to graphics pages.
- A graphic that works in OBS but is blocked in the app, or the reverse.

## Decisions made together

| Topic | Decision |
|---|---|
| Seal the output too, not just the library preview | Yes: every place graphics run |
| Lock "open web page" | By caller (only the app's own screens), not by address, so future links (a GPS viewer, say) still work |
| Outside sources for graphics | Graphics load them directly (a provider's viewer, map tiles), limited to an allowlist |
| Where the list lives | A Settings page where the operator adds and removes addresses |
| Does the list also apply to the OBS and vMix web output? | Yes, the same list everywhere |

## Approaches considered (sealing the monitors in the operator window)

- **A. Sealed frame on the web server's address (chosen).** The monitors show an `<iframe>` of a
  new page served by the app's web server (`http://localhost:<port>/preview-frame`). That page runs
  the existing `OGrafRenderer` and takes its commands from the operator window by `postMessage`.
  Electron doesn't run the preload in subframes (`nodeIntegrationInSubFrames` is off), so the frame
  has no `window.electronAPI`. It reuses the renderer as it is, and the frame is thrown away with
  everything a graphic loaded, which also fixes the module build-up the review found (P2).
- **B. A separate BrowserWindow (or WebContentsView) per monitor without the preload.** Rejected:
  heavier, awkward to lay out inside the operator UI, and one per monitor.
- **C. Keep running graphics in the operator window, but freeze `window.electronAPI` behind a
  check.** Rejected: graphic code shares the page, so any check in the page can be bypassed.

The graphics window needs no frame. It never uses the bridge (`src/renderer/graphics` has no
reference to `electronAPI`), so it simply stops getting the preload.

## The design

### 1. Graphics window: no bridge

In `src/main/windows/index.ts`, create the graphics window without `preload`, with `sandbox: true`
(and `contextIsolation: true`, `nodeIntegration: false` as now). It keeps loading
`graphics.html` and talking to the app over its WebSocket. NDI captures this window as before.

### 2. Sealed preview frame for monitors

- A new page, `preview-frame.html` (a Vite entry like `web-output.html`), served by the web server
  at `/preview-frame`. In development it redirects to the Vite dev server, as `/output` does.
- It hosts one `OGrafRenderer` filling a 1920×1080 stage with a transparent background. The parent
  scales the iframe, as `Monitor.tsx` scales its stage today.
- **Messages from the parent** (`postMessage`), each with a request id:
  `load {id, manifest, templateId, data}`, `play {id, options}`, `stop {id}`,
  `update {id, data}`, `clear`. The frame answers `{requestId, ok, result | error}`.
- **Origin checks:** the frame accepts messages only from the operator window's origin. The
  parent accepts replies only from the web server's origin and from that iframe's
  `contentWindow`.
- **One parent-side helper,** `SealedRenderer`, has the same methods `PreviewSession` and the
  monitors use today (`loadGraphic`, `playGraphic`, `stopGraphic`, `updateGraphic`, `isLoaded`,
  `clearAll`). It sends the messages and resolves on the replies. `PreviewSession`, `Monitor.tsx`
  (preview), `DeskMonitor.tsx` and `LibraryPreview.tsx` switch to it.
- **The operator window's CSP** already allows `frame-src` for the web server's origin.

### 3. The allowlist

- **Stored** in the app config: a new `graphics.allowedOrigins: string[]` in `AppConfig`, default
  `[]`. It is read live, so no restart is needed.
- **An entry** is `https://host` or `https://*.host`: https only, no path, no port, lower case,
  stored normalised. Invalid entries are refused in the UI with a reason.
- **Settings page:** a new section, **Internet access for graphics**, sketched below, with a list,
  an add field, Remove per entry, and a warning that allowed addresses can show anything in your
  graphics and see what graphics send them.

```
Settings › Internet access for graphics
  Graphics can only load from this computer, plus the addresses below.
  ┌───────────────────────────────────────────────┬──────────┐
  │ https://www.livelox.com                       │ Remove   │
  │ https://*.tile.openstreetmap.org              │ Remove   │
  └───────────────────────────────────────────────┴──────────┘
  [ https://…                    ]  [Add address]
  ⚠ Allowed addresses can show anything in your graphics and see what graphics send them.
```

- **Where it applies:** the content rules of graphics pages only, namely `graphics.html`,
  `web-output.html` (and `/output/:id`), and `preview-frame.html`. Their CSP adds the allowed
  origins to `script-src`, `style-src`, `img-src`, `font-src`, `media-src`, `frame-src` and
  `connect-src`. For `connect-src`, also add the matching `wss://` form of each origin.
- **How it's applied:**
  - In the app (graphics window, preview frame): the existing `session.webRequest.onHeadersReceived`
    builds the graphics CSP for those URLs and keeps today's CSP for everything else.
  - For OBS and vMix: the web server sets the same CSP header on the web output and preview frame
    HTML responses, built by the same shared function. This adds rules to the web output, which
    had none.
- **Takes effect** for documents loaded afterwards. Graphics already on air keep the rules they
  were loaded with until their page reloads. The Settings page says so.

### 4. Imports say what they need

- **A graphic manifest may declare** `"v_olgrafik_internet": ["https://www.livelox.com"]`
  (same entry format). The OGraf `renderRequirements[].accessToPublicInternet` stays informational.
- **The import confirmation** lists every address the zip's graphics declare that isn't on the
  allowlist, with a checkbox per address (checked by default): "Allow these addresses for
  graphics". Confirming the import adds the checked addresses.
- **Every import confirmation** also gets one line: "Looks contain code. Only import looks from
  people you trust."

### 5. Two functions locked down

- **`window:openExternal`** accepts calls only from the operator window's main frame (check
  `event.senderFrame` is the main window's `webContents.mainFrame`). Graphics and frames are
  refused. There is no address list.
- **`templates:import`** accepts only the exact path most recently returned by
  `templates:pickImport` (or by the file-association route from the library design, when that
  exists), and only once.

## What a reasonable operator expects (edge cases)

- An address added in Settings works in the next preview and the next Show, without a restart.
- A graphic that tries a blocked address doesn't crash the output. The browser just refuses that
  request.
- A wrong entry (`http://…`, a path, a typo with spaces) is refused with a reason, not saved.
- The web output for OBS still works on another computer on the network (`http://192.168.x.y:5657/output`):
  its CSP allows its own origin (`'self'`) and its WebSocket host, not just `localhost`.
- Live desk, Plan and library previews look and update the same as before sealing.

## Order of work

1. Graphics window without the bridge.
2. The sealed preview frame and `SealedRenderer`; switch the library preview, then the monitors.
3. The allowlist: config, shared CSP builder, Electron handler, web server header, Settings page.
4. Import declarations, and the import warning line.
5. Lock `window:openExternal` and `templates:import`.

Each step ships on its own and is checked in the real app, as in the end-to-end runs.

## Left to the builder

- The message protocol's exact field names, within the operations listed.
- Where the shared CSP builder lives (it must be usable by both `index.ts` and `WebServer.ts`).
- Dev-mode parity for the web output served from Vite (adding the CSP there too is welcome but not
  required; production is what airs).
- Styling of the Settings section within the existing settings layout.

# Sealed Graphics and Internet Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graphic code can no longer reach the app's preload bridge anywhere it runs. Graphics may load from this computer plus an operator-managed allowlist, under the same rules on every output. Imports state what they need, and two sensitive IPC channels are locked.

**Architecture:**
- **Graphics window:** loses the preload and gets popup and navigation guards.
- **Monitors and the library preview:** render through a `SealedRenderer`, which drives an `<iframe>` of a new `preview-frame.html` page on the web server's address by `postMessage`.
- **Content rules:** one shared CSP builder makes the rules for graphics pages, including the allowlist. Electron's header hook and the web server both use it.
- **Allowlist:** stored in the config with its own IPC, so stale settings saves can't drop it.

**Tech Stack:** Electron, TypeScript, React, Express, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-sealed-graphics-and-internet-allowlist-design.md`

## Global Constraints

- **Allowlist entries:** `https://host` or `https://*.host`. Lower case; no path, port, query or `http:`. Stored normalised. Default `[]`.
- **Graphics pages** (they get the graphics CSP): `graphics.html`, `web-output.html` (served at `/output` and `/output/:id`), `template-preview.html` (`/preview`) and `preview-frame.html` (`/preview-frame`).
- **Allowed origins** go into `script-src`, `style-src`, `img-src`, `font-src`, `media-src`, `frame-src` and `connect-src`. `connect-src` also gets each origin's `wss://` form.
- **The operator UI's CSP** gets nothing from the allowlist.
- **The preview frame always loads from `http://127.0.0.1:<web port>/preview-frame`.** In dev, the web server redirects it to `http://127.0.0.1:5175/preview-frame.html`.
- **Messages:** the frame accepts only `event.source === window.parent`. The parent accepts only `event.source === iframe.contentWindow`.
- **Import warning copy, exact:** "Looks contain code. Only import looks from people you trust."
- **Declared needs:** manifest field `v_olgrafik_internet: string[]` (same entry format).
- **New strings:** every user-facing string goes through `tr()` with `sv` and `nb` in `src/renderer/control/i18n/messages.ts`.
- **Baseline:** `npx vitest run` passes 54 files and 610 tests, and `npx tsc --noEmit -p tsconfig.json` prints nothing.

## Review Focus

1. **The OBS web output opened from another computer** (`http://192.168.x.y:5657/output`) still connects and shows graphics. Its CSP allows `'self'` and its WebSocket host, not just `localhost`. Pinned in Task 2 (`buildGraphicsCsp` with a LAN host).
2. **A graphic loads in the preview frame while the operator window is `file://`** (production). It still works, because the message checks use `event.source`, not origin strings. Pinned in Task 5 (`SealedRenderer` ignores a reply from another window).
3. **Live desk Preview gets a new draft every 300 ms poll.** It still shows only the newest draft and never the previous graphic. Pinned in Task 6 (DeskMonitor through `SealedRenderer`: `clear` before `load`), and checked in the app in Task 9.
4. **The settings page is saved with an old copy of the config** while the allowlist was changed elsewhere. The allowlist survives. Pinned in Task 3 (`settings:update` keeps `graphicsAllowedOrigins`).
5. **A user types `HTTPS://Maps.Example.com/`** or `http://x`. It's stored as `https://maps.example.com`, or refused with a reason. Pinned in Task 2 (`normalizeAllowedOrigin`).

---

### Task 1: Graphics window without the bridge; no popups or navigation

**Files:**
- Create: `src/main/windows/guards.ts`
- Modify: `src/main/windows/index.ts:102-115` (graphics window `webPreferences`), and wherever windows are created (`createMainWindow`, `createGraphicsWindow`, the monitor windows in `src/main/ipc/eventHandlers.ts:578-591`) to call `guardWindow(win)`
- Test: `src/main/windows/__tests__/guards.test.ts`

**Interfaces:**
- Produces:
  - `graphicsWindowPreferences(): Electron.WebPreferences` returns `{ nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true, backgroundThrottling: false }`, with no `preload`.
  - `allowNavigation(currentUrl: string, targetUrl: string): boolean` is true only when both URLs have the same origin and pathname. Query and hash may differ.
  - `guardWindow(win: BrowserWindow): void` installs `setWindowOpenHandler(() => ({ action: 'deny' }))` and a `will-navigate` handler that calls `preventDefault()` when `allowNavigation` is false.

- [ ] **Step 1: Write the failing tests**

```ts
it('gives the graphics window no preload and a sandbox', () => {
  const p = graphicsWindowPreferences();
  expect(p.preload).toBeUndefined();
  expect(p).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true });
});
it('keeps a window on its own page', () => {
  expect(allowNavigation('file:///app/dist/index.html#/live', 'file:///app/dist/index.html#/events')).toBe(true);
  expect(allowNavigation('http://localhost:5175/graphics.html?a=1', 'http://localhost:5175/graphics.html?a=2')).toBe(true);
  expect(allowNavigation('file:///app/dist/graphics.html', 'https://evil.example/')).toBe(false);
  expect(allowNavigation('http://localhost:5175/', 'http://localhost:5175/other.html')).toBe(false);
});
it('denies every popup and blocks navigation away', () => {
  const handlers: Record<string, any> = {};
  const win: any = { webContents: { setWindowOpenHandler: (h: any) => (handlers.open = h), on: (n: string, h: any) => (handlers[n] = h), getURL: () => 'file:///a/index.html' } };
  guardWindow(win);
  expect(handlers.open({ url: 'https://x.example' })).toEqual({ action: 'deny' });
  const e = { preventDefault: vi.fn() };
  handlers['will-navigate'](e, 'https://x.example');
  expect(e.preventDefault).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/main/windows/__tests__/guards.test.ts`
Expected: FAIL, the module doesn't exist.

- [ ] **Step 3: Implement it.**
  - Write `guards.ts`.
  - Use `graphicsWindowPreferences()` in `createGraphicsWindow`.
  - Call `guardWindow` on the main window, the graphics window and each monitor window.

- [ ] **Step 4: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, and the type check prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/main/windows src/main/ipc/eventHandlers.ts
git commit -m "Windows: graphics window without the preload; no popups or navigation away"
```

### Task 2: Shared CSP builder and allowlist entry rules

**Files:**
- Create: `src/main/security/csp.ts`
- Modify: `src/main/index.ts:390-456` (`setupContentSecurityPolicy` uses the builder)
- Modify: `src/main/output/WebServer.ts` (set the header on the `/output`, `/output/:id`, `/preview` and `/preview-frame` HTML responses)
- Test: `src/main/security/__tests__/csp.test.ts`, `src/main/output/__tests__/WebServerCsp.test.ts`

**Interfaces:**
- Produces:
  - `normalizeAllowedOrigin(input: string): { ok: true; value: string } | { ok: false; reason: string }`
  - `isGraphicsPage(url: string): boolean`: true for paths ending in `/graphics.html`, `/web-output.html`, `/template-preview.html` or `/preview-frame.html`, and for the paths `/output`, `/output/<id>`, `/preview` and `/preview-frame`.
  - `buildAppCsp(o: { dev: boolean; webPort: number; wsPort: number }): string` gives today's directives exactly, moved from `index.ts`.
  - `buildGraphicsCsp(o: { dev: boolean; webPort: number; wsPort: number; wsHost: string; allowed: string[] }): string`. It is `buildAppCsp` with the allowed origins added (see Global Constraints), plus `'self'` and `ws://<wsHost>:<wsPort>` in `connect-src`.

- [ ] **Step 1: Write the failing tests**

```ts
it.each([
  ['HTTPS://Maps.Example.com/', 'https://maps.example.com'],
  ['https://*.tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
])('normalises %s', (input, value) => expect(normalizeAllowedOrigin(input)).toEqual({ ok: true, value }));
it.each(['http://x.example', 'https://x.example/path', 'https://x.example:8443', 'https://', 'maps example', 'https://*.'])(
  'refuses %s with a reason', (input) => expect(normalizeAllowedOrigin(input)).toMatchObject({ ok: false, reason: expect.any(String) }));
it('recognises graphics pages', () => {
  expect(isGraphicsPage('file:///a/dist/graphics.html?webPort=5657')).toBe(true);
  expect(isGraphicsPage('http://127.0.0.1:5657/output/abc')).toBe(true);
  expect(isGraphicsPage('http://localhost:5175/')).toBe(false);
});
it('adds allowed origins to graphics pages only', () => {
  const g = buildGraphicsCsp({ dev: false, webPort: 5657, wsPort: 5656, wsHost: '192.168.1.20', allowed: ['https://www.livelox.com'] });
  for (const d of ['script-src', 'img-src', 'frame-src', 'connect-src']) expect(directive(g, d)).toContain('https://www.livelox.com');
  expect(directive(g, 'connect-src')).toContain('wss://www.livelox.com');
  expect(directive(g, 'connect-src')).toContain('ws://192.168.1.20:5656');
  expect(buildAppCsp({ dev: false, webPort: 5657, wsPort: 5656 })).not.toContain('livelox');
});
```

`directive(csp, name)` is a local test helper that returns that directive's sources.

`WebServerCsp.test.ts` follows the pattern in `ControlApi.test.ts`: real Express, `listen(0)`. It asserts:
- `GET /output` has a `content-security-policy` header containing an allowed origin from a mocked `getConfig().graphicsAllowedOrigins`;
- `GET /api/output/info` has no such header.

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/main/security src/main/output/__tests__/WebServerCsp.test.ts`
Expected: FAIL, the modules don't exist and the header is missing.

- [ ] **Step 3: Implement it.**
  - **Normalising entries:** parse with `new URL`, but check for a `*.` prefix before parsing. Require the `https:` protocol and a pathname of `/` with no search or hash, and lower-case the host.
  - **In `index.ts`:** pick `buildGraphicsCsp` when `isGraphicsPage(details.url)` and `details.resourceType === 'mainFrame' || 'subFrame'`. Read `getConfig().graphicsAllowedOrigins ?? []` on every call, so no restart is needed.
  - **In `WebServer.ts`:** set the header in each listed route before `sendFile` or redirect, with `wsHost` from `req.hostname`.

- [ ] **Step 4: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, and the type check prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/main/security src/main/index.ts src/main/output/WebServer.ts src/main/output/__tests__/WebServerCsp.test.ts
git commit -m "Security: one CSP builder; graphics pages get the internet allowlist, in the app and on the web output"
```

### Task 3: Allowlist storage and IPC

**Files:**
- Modify: `src/main/utils/config.ts` (`AppConfig.graphicsAllowedOrigins?: string[]`; keep it in `mergeConfig`)
- Modify: `src/main/ipc/settingsHandlers.ts` (`mergeConfig` keeps `current.graphicsAllowedOrigins`; add handlers)
- Modify: `src/preload/index.ts` (allow the two channels)
- Test: `src/main/ipc/__tests__/settingsHandlers.test.ts` (new; mock `electron` the way `outputHandlers.test.ts` does)

**Interfaces:**
- Consumes: `normalizeAllowedOrigin` (Task 2).
- Produces IPC:
  - `graphicsAccess:get` → `{ success: true, data: string[] }`
  - `graphicsAccess:set(list: string[])` → `{ success: true, data: { saved: string[]; rejected: Array<{ input: string; reason: string }> } }`. It saves only the valid, de-duplicated, sorted entries, and never fails the whole call over one bad entry.

- [ ] **Step 1: Write the failing tests**
  - Set `['HTTPS://B.example', 'https://a.example', 'http://bad', 'https://a.example']`. Expect `saved` to be `['https://a.example', 'https://b.example']`, with one rejection for `http://bad`, and expect `saveConfig` to have been called with those.
  - Then call `settings:update` with an object that has no `graphicsAllowedOrigins`, and expect the saved config still to hold both entries.

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/main/ipc/__tests__/settingsHandlers.test.ts`
Expected: FAIL, the handlers don't exist.

- [ ] **Step 3: Implement the field, the two handlers and the preload entries.**

- [ ] **Step 4: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, and the type check prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/main/utils/config.ts src/main/ipc/settingsHandlers.ts src/main/ipc/__tests__/settingsHandlers.test.ts src/preload/index.ts
git commit -m "Settings: store the graphics internet allowlist with its own IPC"
```

### Task 4: Settings page "Internet access for graphics"

**Files:**
- Create: `src/renderer/control/components/GraphicsInternetAccess.tsx`
- Modify: `src/renderer/control/pages/SettingsView.tsx` (new tab `internet`: label "Internet access", detail "Addresses graphics may use", icon `Globe` from lucide-react)
- Modify: `src/renderer/control/i18n/messages.ts`

**Interfaces:**
- Consumes: `graphicsAccess:get` and `graphicsAccess:set` (Task 3).

- [ ] **Step 1: Build the section** to the spec's sketch:
  - an intro line ("Graphics can only load from this computer, plus the addresses below.");
  - the list with **Remove** per entry;
  - an input with **Add address**;
  - the warning ("Allowed addresses can show anything in your graphics and see what graphics send them.");
  - a note ("Applies to graphics loaded from now on. A graphic already on air keeps its rules until it is shown again.").

  Add and Remove call `graphicsAccess:set` straight away; the page's own Save button isn't used. A rejected entry shows its `reason` under the input, and the input keeps the text.

- [ ] **Step 2: Type check and build**

Run: `npx tsc --noEmit -p tsconfig.json && npx vite build`
Expected: no type errors, build succeeds. (The app check is in Task 9.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/control/components/GraphicsInternetAccess.tsx src/renderer/control/pages/SettingsView.tsx src/renderer/control/i18n/messages.ts
git commit -m "Settings: Internet access for graphics"
```

### Task 5: Sealed preview frame and SealedRenderer

**Files:**
- Create: `preview-frame.html` (root, like `web-output.html`)
- Create: `src/renderer/preview-frame/main.ts`, `src/renderer/preview-frame/frameProtocol.ts`
- Create: `src/renderer/control/sealed/SealedRenderer.ts`
- Modify: `vite.config.ts` (add the `previewFrame` input)
- Modify: `src/main/output/WebServer.ts` (`GET /preview-frame`: in dev, redirect to `http://127.0.0.1:5175/preview-frame.html` plus the query; in production, send `dist/preview-frame.html`; the CSP from Task 2)
- Test: `src/renderer/preview-frame/__tests__/frameProtocol.test.ts`, `src/renderer/control/sealed/__tests__/SealedRenderer.test.ts`

**Interfaces:**
- Produces:
  - `type FrameRequest = { requestId: number } & ({ op: 'load'; id: string; manifest: OGrafManifest; directory: string; data: unknown } | { op: 'play'; id: string; options?: PlayActionOptions } | { op: 'stop'; id: string } | { op: 'update'; id: string; data: unknown } | { op: 'clear' })`
  - `type FrameReply = { requestId: number; ok: true; result?: unknown } | { requestId: number; ok: false; error: string }`
  - The frame posts `{ ready: true }` to its parent once loaded.
  - `handleFrameRequest(renderer: Pick<OGrafRenderer, 'loadGraphic' | 'playGraphic' | 'stopGraphic' | 'updateGraphic' | 'clearAll'>, req: FrameRequest): Promise<FrameReply>` in `frameProtocol.ts` turns errors into `ok: false`.
  - `class SealedRenderer implements PreviewRenderer`, with `PreviewRenderer` from `src/renderer/control/library/previewSession.ts`. The constructor is `(host: HTMLElement, frameUrl: string)`. It creates the iframe (`title="Graphics preview"`, 1920×1080, transparent) and keeps a `Set` of loaded ids, so `isLoaded` stays synchronous. `load` reloads the iframe first when `directory` differs from the last one loaded. It also has `dispose(): void`.
  - `previewFrameUrl(webPort: number): string` returns `http://127.0.0.1:${webPort}/preview-frame`.

- [ ] **Step 1: Write the failing tests**
  - **`frameProtocol`:** with a fake renderer whose `loadGraphic` throws `new Error('Bad module')`, expect `{ requestId: 1, ok: false, error: 'Bad module' }`. Expect `clear` to call `clearAll`.
  - **`SealedRenderer`:** with a fake iframe whose `contentWindow.postMessage` records messages:
    - `loadGraphic` resolves when a reply with the same `requestId` arrives from that `contentWindow`, and `isLoaded('x')` is true afterwards;
    - a reply carrying the same `requestId` but from a different `source` is ignored (the promise stays pending);
    - a second `loadGraphic` with another `directory` reloads the frame (the `src` is set again) before sending.

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/renderer/preview-frame src/renderer/control/sealed`
Expected: FAIL, the modules don't exist.

- [ ] **Step 3: Implement the frame page, the protocol, `SealedRenderer`, the Vite entry and the route.**

- [ ] **Step 4: Run the full suite, the type check and a build**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npx vite build`
Expected: all pass, no type errors, and the build outputs `dist/preview-frame.html`.

- [ ] **Step 5: Commit**

```bash
git add preview-frame.html src/renderer/preview-frame src/renderer/control/sealed vite.config.ts src/main/output/WebServer.ts
git commit -m "Preview: a sealed frame on the web server's address, driven by postMessage"
```

### Task 6: Monitors and library preview use the sealed frame

**Files:**
- Modify: `src/renderer/control/library/LibraryPreview.tsx`, `src/renderer/control/events/Monitor.tsx` (preview kind), `src/renderer/control/desk/DeskMonitor.tsx` (`PreviewVideo`)
- Test: `src/renderer/control/library/__tests__/previewSession.test.ts` (unchanged; it must still pass)

**Interfaces:**
- Consumes: `SealedRenderer` and `previewFrameUrl` (Task 5).

- [ ] **Step 1: Replace each `new OGrafRenderer(host, origin)` with `new SealedRenderer(host, previewFrameUrl(webPort))`.** Each monitor keeps one `SealedRenderer` for its lifetime.
  - `PreviewVideo`'s per-draft `retire()` becomes `await sealed.clearAll()` before the next `loadGraphic`.
  - Nothing in `src/renderer/control` may import `OGrafRenderer` after this task. Check with `grep -rn "OGrafRenderer" src/renderer/control` (no output expected).

- [ ] **Step 2: Run the full suite, the type check and a build**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npx vite build && grep -rn "OGrafRenderer" src/renderer/control`
Expected: all pass, and the grep prints nothing.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/control/library/LibraryPreview.tsx src/renderer/control/events/Monitor.tsx src/renderer/control/desk/DeskMonitor.tsx
git commit -m "Monitors and library preview render graphics in the sealed frame"
```

### Task 7: Imports declare internet needs; import warning

**Files:**
- Modify: `src/main/templates/TemplatePackages.ts` (`ImportPreview.internet: string[]`: the normalised `v_olgrafik_internet` entries across the zip's manifests that aren't in `getConfig().graphicsAllowedOrigins`, sorted and de-duplicated; invalid entries are left out)
- Modify: `src/main/ipc/templateHandlers.ts` (`templates:import(filePath, allow?: string[])` adds each valid `allow` entry to the allowlist after a successful import)
- Create: `src/renderer/control/library/ImportConfirm.tsx` (a dialog replacing `confirm(importQuestion(...))` in `TemplatesView.tsx`: today's lines, the exact warning copy, then a checkbox per `internet` address, checked by default)
- Modify: `src/renderer/control/pages/TemplatesView.tsx`, `src/renderer/control/i18n/messages.ts`
- Test: `src/main/templates/__tests__/TemplatePackages.test.ts`

- [ ] **Step 1: Write the failing test.**
  - A zip whose graphic manifest has `v_olgrafik_internet: ['https://Maps.Example.com', 'http://bad']`, with the config allowlist `['https://tiles.example']`, gives `previewTemplateZip(...).internet` equal to `['https://maps.example.com']`.
  - With the allowlist already containing it, `internet` is `[]`.

- [ ] **Step 2: Run it and check that it fails**

Run: `npx vitest run src/main/templates/__tests__/TemplatePackages.test.ts`
Expected: FAIL, `internet` is undefined.

- [ ] **Step 3: Implement the preview field, the import parameter and the dialog.**

- [ ] **Step 4: Run the full suite, the type check and a build**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npx vite build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/templates src/main/ipc/templateHandlers.ts src/renderer/control/library/ImportConfirm.tsx src/renderer/control/pages/TemplatesView.tsx src/renderer/control/i18n/messages.ts
git commit -m "Import: show the addresses a look needs and the code warning"
```

### Task 8: Lock window:openExternal and templates:import

**Files:**
- Modify: `src/main/ipc/windowHandlers.ts:150` and `src/main/ipc/templateHandlers.ts:164-190`
- Create: `src/main/security/callers.ts`
- Test: `src/main/security/__tests__/callers.test.ts`, plus the `templates:import` cases in a new `src/main/ipc/__tests__/templateHandlers.test.ts`

**Interfaces:**
- Produces:
  - `isOperatorMainFrame(event: { sender: WebContents; senderFrame: WebFrameMain | null }, operatorWindows: () => BrowserWindow[]): boolean` is true when `senderFrame === sender.mainFrame` and the sender belongs to one of the operator windows. The operator windows are the main window and the pop-out monitor windows; export a getter for them from `src/main/windows/index.ts` and `eventHandlers.ts`.
  - `templates:import` accepts only the path that the last `templates:pickImport` returned, and consumes it. Any other path, or a second call, gets `{ success: false, error: 'Choose the file in Import look… first' }`.

- [ ] **Step 1: Write the failing tests**
  - `isOperatorMainFrame` is false when `senderFrame` is a subframe, and false for a `sender` that isn't in the list.
  - `templates:import('/tmp/other.zip')` without a matching pick fails with that error.

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/main/security src/main/ipc/__tests__/templateHandlers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement both locks.**

- [ ] **Step 4: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/security src/main/ipc/windowHandlers.ts src/main/ipc/templateHandlers.ts src/main/ipc/__tests__/templateHandlers.test.ts src/main/windows/index.ts src/main/ipc/eventHandlers.ts
git commit -m "Security: open web pages only from operator screens; import only the picked file"
```

### Task 9: Check it in the real app

- [ ] **Step 1: Build a probe look.** In `DATAROOT/templates/sets/standard/` (ignored by git), add a copy of `standard-name-strap` named `probe-strap`. In its `graphic.js` view, write the following on screen:
  - `typeof window.electronAPI`;
  - whether an `<img src="https://www.google.com/favicon.ico">` loads;
  - whether `window.open('https://example.com')` returned null.
- [ ] **Step 2: Run the built app with the replay**, as in the earlier end-to-end runs. Show the probe:
  - in the Library preview;
  - in Plan's preview;
  - in the Live desk Preview and on air;
  - in the graphics window;
  - on the web output at `http://localhost:5657/output`, opened in plain Chromium.

  Expected everywhere: `electronAPI` is `undefined`, the image is blocked, and `window.open` is blocked.
- [ ] **Step 3: Add `https://www.google.com` in Settings → Internet access.** Show the probe again. Expected: the image loads in every place, without a restart.
- [ ] **Step 4: Check regressions** with the results table on the replay: live update, paging, Hide, and a late web output connection. All should behave as in the earlier run.
- [ ] **Step 5: Remove the probe** and report the screenshots.

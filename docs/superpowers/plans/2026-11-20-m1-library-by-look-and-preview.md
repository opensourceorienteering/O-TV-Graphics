# Milestone 1: Library by Look and Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix how the renderer loads OGraf graphics. Then turn the Graphics library into a list of looks, each with its own page, where any graphic can be played in a preview on a simulated race.

**Architecture:**
- **Renderer and discovery fixes** come first: Tasks 1 and 4 of the interop plan, which this plan reuses.
- **Sample data** reuses the website's simulated race (`site/preview/sim.js`) and sample feeds (`site/preview/feeds.js`) through typed declaration files, wrapped by a small builder that shapes data for a template.
- **The library** is split into plain-logic helpers (unit tested) and three React views: home, look page and preview. The preview uses `OGrafRenderer` in the control window, as `Monitor.tsx` does.

**Tech Stack:** TypeScript, React, Electron, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-11-20-graphics-library-and-import-helper-design.md`, sections 1 and 2 plus Prerequisites.

## Global Constraints

- Baseline: `npx vitest run` passes 51 files and 583 tests; `npx tsc --noEmit -p tsconfig.json` prints nothing.
- Vitest runs only `src/**/__tests__/**/*.test.ts` in a node environment. React components have no unit tests, so logic goes in `.ts` helpers.
- User-facing strings go through `tr()` from `src/renderer/control/i18n`. Add each new string to `src/renderer/control/i18n/messages.ts` with `sv` and `nb`.
- Look metadata comes from `TemplateSetInfo` (`src/shared/types/ograf.ts:229`). The look `custom` (`CUSTOM_TEMPLATE_SET`) is never shown as a look card.
- The preview never touches real output: no IPC that plays, shows or updates on the output engine.
- Keep the existing Import, Get more looks, Open folder, Scan library, Export and Remove actions working.

## Review Focus

1. **No looks at all** (empty templates folder): the home page shows the existing "No graphics found" message with Scan library. Pinned in Task 4 (`lookCards([])`).
2. **A graphic with desk warnings in a normal look** appears both in its look and under Needs attention. Pinned in Task 4.
3. **The race runs past its end** (preview left open): the simulated time wraps to the race start and the preview keeps updating. Pinned in Task 3 (`raceTimeAt`).
4. **A graphic fails to load in the preview** (bad module, throws in `load`): the frame shows the error text and the controls stay usable. Pinned in Task 5 by catching around `loadGraphic` and the manual check.
5. **Search with a look open**: searching from the home page lists matches from every look, and each result names its look. Pinned in Task 4 (`searchGraphics`).

---

### Task 1: Renderer sends the OGraf v1 parameters

Implement **Task 1 of `docs/superpowers/plans/2026-11-19-ograf-studio-interop.md`** exactly as written, except Step 5 (the manual Studio check), which moves to Task 6 here.

### Task 2: Find a graphic whose manifest isn't named after its folder

Implement **Task 4 of `docs/superpowers/plans/2026-11-19-ograf-studio-interop.md`** exactly as written.

### Task 3: Sample race data for templates

**Files:**
- Create: `site/preview/sim.d.ts`, `site/preview/feeds.d.ts` (types for the existing JS; the JS files don't change)
- Create: `src/renderer/control/library/sampleData.ts`
- Test: `src/renderer/control/library/__tests__/sampleData.test.ts`

**Interfaces:**
- Produces:
  - `raceTimeAt(race: SampleRace, startedAt: number, now: number, speed: number): number` returns the simulated time `race.firstStart + ((now - startedAt) * speed) % (race.end - race.firstStart)`.
  - `sampleGraphicData(template: OGrafTemplateInfo, race: SampleRace, simNow: number): Record<string, unknown>`:
    - timing comes from `race.data(simNow, 'F')`;
    - feeds come from `graphicFeedData({ desk: template.desk, schema: template.manifest.schema }, timing)`;
    - when `template.desk?.params.includes('runner')`, the last started runner goes in as `runnerName`, `runnerClub` and `runnerBib`;
    - `clockOffsetMs = simNow - Date.now()`;
    - `presentation: { language: 'en', identity: 'club', international: false, logoMode: 'template' }`.
  - `SampleRace` is the type `createRace()` returns, declared in `sim.d.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
const race = createRace({ seed: 7, firstStart: Date.UTC(2026, 6, 18, 12) });
it('wraps simulated time to the race start after the end', () => {
  const span = race.end - race.firstStart;
  expect(raceTimeAt(race, 0, span / 20 + 1000, 20)).toBe(race.firstStart + 20_000);
});
it('gives a timing graphic results at the finish late in the race', () => {
  const t = tpl({ params: ['class', 'control'], feeds: ['timing'] });
  const data = sampleGraphicData(t, race, race.end - 60_000);
  expect((data.results as unknown[]).length).toBe(12);
  expect(data.className).toBe('D21');
});
it('fills the runner for graphics that ask for one', () => {
  const data = sampleGraphicData(tpl({ params: ['runner'], feeds: ['timing'] }), race, race.firstStart + 3 * 60_000);
  expect(data.runnerName).toBe('Simona Aebersold');
});
it('uses schema defaults for typed fields', () => {
  const t = tpl({ params: [], feeds: [] }, { headline: { type: 'string', default: 'Jane Doe' } });
  expect(sampleGraphicData(t, race, race.firstStart).headline).toBe('Jane Doe');
});
```

`tpl(desk, properties = {})` is a local helper. It builds an `OGrafTemplateInfo` with `desk: { key: 'k', kind: 'k', label: 'K', short: 'K', required: [], live: false, ...desk }` and `manifest.schema = { type: 'object', properties }`.

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/renderer/control/library/__tests__/sampleData.test.ts`
Expected: FAIL, the module doesn't exist.

- [ ] **Step 3: Implement it.** Write `sim.d.ts` (`createRace`, `raceEvents`, `SampleRace` with `className`, `controls`, `runners`, `firstStart`, `end`, `data(at, controlCode?)`) and `feeds.d.ts` (`sampleFeeds`, `graphicFeedData`). Then write `sampleData.ts`, importing `../../../../site/preview/sim.js` and `feeds.js`.

- [ ] **Step 4: Run the tests, the type check and a build**

Run: `npx vitest run src/renderer/control/library && npx tsc --noEmit -p tsconfig.json && npx vite build`
Expected: the tests pass, the type check prints nothing, and the build succeeds (proving Vite bundles the site JS).

- [ ] **Step 5: Commit**

```bash
git add site/preview/sim.d.ts site/preview/feeds.d.ts src/renderer/control/library
git commit -m "Library: sample race data for previews, shared with the website"
```

### Task 4: Library model: look cards, needs attention, search

**Files:**
- Create: `src/renderer/control/library/libraryModel.ts`
- Test: `src/renderer/control/library/__tests__/libraryModel.test.ts`

**Interfaces:**
- Produces:
  - `interface LookCard { set: TemplateSetInfo; graphics: OGrafTemplateInfo[] }`
  - `lookCards(sets: TemplateSetInfo[], templates: OGrafTemplateInfo[]): LookCard[]` returns every set except `custom` and `system`, built-in first then imported, each sorted by name, with its graphics sorted by `manifest.name`.
  - `needsAttention(templates: OGrafTemplateInfo[]): OGrafTemplateInfo[]` returns graphics with `setId === 'custom'`, or with `deskWarnings?.length`, sorted by name.
  - `searchGraphics(templates: OGrafTemplateInfo[], sets: TemplateSetInfo[], query: string): Array<{ template: OGrafTemplateInfo; lookName: string }>` matches name, description and id, case-insensitive, and gives `lookName` from the set (`custom` → `'Not in a look'`). An empty query returns `[]`.

- [ ] **Step 1: Write the failing tests** for:
  - the ordering and the exclusion of `custom`;
  - `lookCards([], [])` → `[]`;
  - `needsAttention` including a `standard` graphic with `deskWarnings: ['x']` and a `custom` graphic;
  - `searchGraphics(..., 'strap')` returning `lookName: 'Standard'` for a Standard graphic, and `'Not in a look'` for a custom one;
  - an empty query giving `[]`.

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/renderer/control/library/__tests__/libraryModel.test.ts`
Expected: FAIL, the module doesn't exist.

- [ ] **Step 3: Implement the three functions.**

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/renderer/control/library`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/control/library
git commit -m "Library: model for look cards, needs attention and search"
```

### Task 5: Library views: home, look page, preview

**Files:**
- Create: `src/renderer/control/library/LibraryHome.tsx`, `LookPage.tsx`, `LibraryPreview.tsx`, `library.css`
- Modify: `src/renderer/control/pages/TemplatesView.tsx` (keeps data loading and the import, export and remove actions; renders home or look page)
- Modify: `src/renderer/control/i18n/messages.ts`

**Interfaces:**
- Consumes: `lookCards`, `needsAttention`, `searchGraphics` (Task 4); `sampleGraphicData`, `raceTimeAt` (Task 3); `OGrafRenderer` (`loadGraphic`, `playGraphic`, `stopGraphic`, `updateGraphic`, `clearAll`).
- Produces:
  - `<LibraryHome cards needs onOpen(lookId) onSearchOpen(lookId, templateId) />`
  - `<LookPage card onBack onExport onRemove />`
  - `<LibraryPreview template />`

- [ ] **Step 1: Home.**
  - A grid of look cards showing: logo (`logoPreview`), name, source badge, graphic count, colour dots (`colors`), fonts, and the approved-events badge.
  - When `needsAttention` is non-empty, a "Needs attention" strip with the count and the graphic names. Its **Fix…** button is disabled with the tooltip "The import helper comes in a later version" until Milestone 3.
  - The search box: with text, it replaces the grid with `searchGraphics` results; clicking one opens its look with that graphic selected.

- [ ] **Step 2: Look page.**
  - A back link, the look heading (with the same badges as today), and Export and Remove, as the current group heading has them.
  - Graphic tiles showing name, `v_olgrafik_kind` and today's badges (timing data, steps).
  - Selecting a tile shows `LibraryPreview` beside the grid. The first graphic is selected when the page opens.

- [ ] **Step 3: Preview.**
  - A 1920×1080 stage scaled into a 16:9 frame, using the same ResizeObserver scaling as `Monitor.tsx`.
  - `new OGrafRenderer(host, origin)`, with the origin from `call("output:getWebInfo")` as Monitor does.
  - Load with `sampleGraphicData`, then:
    - **Show** → `playGraphic(id, {})`;
    - **Next** → `playGraphic(id, { delta: 1 })`;
    - **Hide** → `stopGraphic`.
  - A 1×/20× toggle. A one-second timer calls `updateGraphic(id, sampleGraphicData(template, race, raceTimeAt(...)))` while the graphic is shown.
  - Errors from load or play are shown under the frame, and the buttons stay enabled.
  - "Data used: …" lists `template.desk?.feeds`, or "typed fields only".
  - Clean up on unmount and when the template changes (`clearAll`, then remove the host).

- [ ] **Step 4: Type check, tests and build**

Run: `npx tsc --noEmit -p tsconfig.json && npx vitest run && npx vite build`
Expected: no type errors, all tests pass, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/control/library src/renderer/control/pages/TemplatesView.tsx src/renderer/control/i18n/messages.ts
git commit -m "Graphics library: looks as cards, a page per look, and a preview on a sample race"
```

### Task 6: See it running

- [ ] **Step 1: Run the app** using the `run` skill (Electron dev build). Take screenshots of:
  - the library home;
  - Standard's look page, with the Results graphic shown in the preview at 20×;
  - an imported Studio `lower-third.ograf.zip` (from ografstudio.org) showing under Needs attention.
- [ ] **Step 2:** If the app can't be launched in this environment, say so, and list these checks for a person to do instead.
- [ ] **Step 3: Commit** any fixes found, with messages that name the fix.

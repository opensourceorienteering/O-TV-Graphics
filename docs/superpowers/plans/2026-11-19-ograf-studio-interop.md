# OGraf Studio Interop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graphics exported from OGraf Studio (ografstudio.org) import into Split Control, load as the OGraf v1 spec requires, and can be shown from the Live desk.

**Architecture:** Four small changes. The renderer passes the `load()` and `playAction()` parameters that OGraf v1 requires. A standalone imported graphic (look `custom`) with no desk declaration gets a generic desk entry built from its manifest. The import preview lists facts the operator should see before importing a third-party graphic: its licences and the resolution and frame rate it was made for. Discovery finds a graphic whose manifest is not named after its folder.

**Tech Stack:** TypeScript, Electron, React, Vitest.

**Spec:** the Findings section below (compatibility test run on 2026-11-19).

## Findings

Test packages: `lower-third`, `rankings`, `scoreboard` and `ticker`, from `https://ografstudio.org/graphics/<name>.ograf.zip` (OGraf Studio 0.34.0 exports).

1. **Import works.** `previewTemplateZip` and `importTemplateZip` accept all four packages. Each package becomes one graphic in the look `custom`, and the manifests validate.
2. **They can't be used in Live.** Their manifests have no `v_olgrafik_kind` or `v_olgrafik_desk`, so `resolveDeskDeclaration()` returns `desk: undefined`. In addition, `Desk.entriesFor()` lists only graphics in the event's own look, never graphics in `custom`.
3. **Our renderer breaks the OGraf v1 `load()` contract.** The spec says `load(params: { data, renderType: "realtime" | "non-realtime", renderCharacteristics })`. `OGrafRenderer.loadGraphic` sends `{ data }` only (`src/renderer/graphics/ograf-renderer.ts:134`, type `LoadOptions` in `src/shared/types/ograf.ts:156`). Studio's runtime treats any `renderType` other than `"realtime"` as non-realtime: Rules, text, chart and loop animations don't run. A template with Functions (the Rankings example) throws `"Template Functions require real-time interactive playback."`, and a coordinated set throws `"Unsupported render type."`.
4. **`playAction` may be sent with neither `goto` nor `delta`.** `playGraphic(id, options = {})` passes `{}` through, but the spec requires one of the two.
5. **Exports carry AGPL-3.0.** Every package contains `licenses/OGRAF-STUDIO-AGPL-3.0.txt`, and Split Control is MIT. Users may load these packages. We must not bundle them into our own looks, and the import preview should say which licences a package carries.
6. **Fixed render requirements.** The packages declare `renderRequirements` of exactly 1920×1080 at exactly 25 fps.
7. **A Studio graphic inside a look is not found.** Discovery reads only `<folder>/<folder>.ograf.json` (`src/main/templates/OGrafManager.ts:189`). Studio names its manifest `project-<uuid>-rt.ograf.json`, and the spec allows any `*.ograf.json` name. A look containing an unrenamed Studio folder imports with that graphic silently missing. After renaming the manifest to match the folder, the graphic loads and its `v_olgrafik_desk` resolves with no warnings (verified).
8. Not tested: executing a Studio graphic in a browser. That step was blocked in this session, so a manual check is part of Task 1.

## Global Constraints

- OGraf v1 graphics spec: `https://ograf.ebu.io/v1/specification/` (`load` requires `data`, `renderType`, `renderCharacteristics`; `playAction` requires `goto` or `delta`).
- Our own templates (`templates/sets/_core/graphic.js`) ignore `renderType`; nothing they do may change.
- Live always plays in realtime: `renderType` is always `"realtime"`.
- `CUSTOM_TEMPLATE_SET = 'custom'` (`src/shared/types/ograf.ts:247`) holds standalone imported graphics.
- Existing behaviour of `resolveDeskDeclaration()` stays as it is, including `resolveDeskDeclaration(manifest()).desk === undefined` in `src/shared/__tests__/deskDeclaration.test.ts`. Graphics *inside a look* that have no declaration remain hidden from Live.
- Do not add any OGraf Studio package or code to this repository: they are AGPL-3.0.
- Full suite baseline before this work: 51 files and 583 tests pass (`npx vitest run`).

## Review Focus

1. **A `custom` graphic whose id clashes with a desk key in the look.** The generic key is `ograf:<manifest.id>`, which no built-in key uses. Pinned in Task 2 (`generic keys never collide with look keys`).
2. **A schema with arrays and objects (Rankings: `contestants`, `juries`).** Only `string`, `number` and `boolean` properties become inspector fields; arrays keep their manifest defaults. Pinned in Task 2.
3. **A manifest with no `schema` at all.** It still gets a desk entry, with `fields: []`. Pinned in Task 2.
4. **A caller that already sends `goto` or `delta`.** Their values pass through unchanged; `delta: 1` is added only when neither is set. Pinned in Task 1.
5. **A package with no `licenses/` folder or no `renderRequirements`.** No notes are shown and nothing fails. Pinned in Task 3.

---

### Task 1: Renderer sends the OGraf v1 parameters

**Files:**
- Modify: `src/shared/types/ograf.ts:156-158` (`LoadOptions`)
- Modify: `src/renderer/graphics/ograf-renderer.ts:134` (load call), `:169-182` (`playGraphic`)
- Test: `src/renderer/graphics/__tests__/rendererCleanup.test.ts` (reuse its element mock; add a `describe('OGraf v1 parameters')` block)

**Interfaces:**
- Produces: `LoadOptions = { data: any; renderType: 'realtime' | 'non-realtime'; renderCharacteristics: RenderCharacteristics }` and `RenderCharacteristics = { resolution?: { width: number; height: number }; frameRate?: number }`, both in `src/shared/types/ograf.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it('loads graphics in realtime with render characteristics', async () => {
  const renderer = new OGrafRenderer(container);
  await renderer.loadGraphic('g', manifest, 'test', { a: 1 });
  expect(element.load).toHaveBeenCalledWith({
    data: { a: 1 }, renderType: 'realtime',
    renderCharacteristics: { resolution: { width: 1920, height: 1080 } },
  });
});
it('plays the next step when neither goto nor delta is given', async () => {
  const renderer = new OGrafRenderer(container);
  await renderer.loadGraphic('g', manifest, 'test', {});
  await renderer.playGraphic('g');
  expect(element.playAction).toHaveBeenLastCalledWith({ delta: 1 });
  await renderer.playGraphic('g', { goto: 0, skipAnimation: true });
  expect(element.playAction).toHaveBeenLastCalledWith({ goto: 0, skipAnimation: true });
});
```

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/renderer/graphics/__tests__/rendererCleanup.test.ts`
Expected: FAIL. `load` was called with `{ data: { a: 1 } }`, and `playAction` with `{}`.

- [ ] **Step 3: Implement it.** Widen `LoadOptions` and add `RenderCharacteristics`. In `loadGraphic`, call `load({ data, renderType: 'realtime', renderCharacteristics: { resolution: { width: 1920, height: 1080 } } })`. Use 1920×1080 as a module constant `OUTPUT_RESOLUTION`; the graphics window is always that size. In `playGraphic`, send `options.goto === undefined && options.delta === undefined ? { ...options, delta: 1 } : options`.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all files pass, 585 tests (583 plus 2).

- [ ] **Step 5: Manual check (needs a person).** Import `rankings.ograf.zip` from ografstudio.org in a dev build, show it from Live after Task 2 lands, and confirm that it loads without the "Template Functions require real-time" error, animates in, and responds to a title change sent with Update. Record the result in the PR description.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/ograf.ts src/renderer/graphics/ograf-renderer.ts src/renderer/graphics/__tests__/rendererCleanup.test.ts
git commit -m "Renderer: send renderType, renderCharacteristics and a default delta (OGraf v1)"
```

### Task 2: Standalone imported graphics appear in Live

**Files:**
- Modify: `src/shared/deskDeclaration.ts` (add two exports)
- Modify: `src/main/events/Desk.ts:40-46` (`entriesFor`), `:436-441` (`commandDefinitions`)
- Modify: `src/main/ipc/eventHandlers.ts:424`
- Test: `src/shared/__tests__/deskDeclaration.test.ts`, `src/main/events/__tests__/Desk.test.ts`

**Interfaces:**
- Produces, in `src/shared/deskDeclaration.ts`:
  - `genericDeskEntry(manifest: OGrafManifest): DeskTemplate` returns `{ key: 'ograf:' + manifest.id, kind: 'ograf:' + manifest.id, label: manifest.name, short: manifest.name, params: [], required: [], live: false, fields }`. `fields` holds the top-level `schema.properties` keys whose `type` is `'string'`, `'number'` or `'boolean'`, in manifest order, and is `[]` when there is no schema.
  - `deskEntryFor(t: Pick<OGrafTemplateInfo, 'desk' | 'manifest' | 'setId'>): DeskTemplate | undefined` returns `t.desk ?? resolveDeskDeclaration(t.manifest).desk ?? (t.setId === CUSTOM_TEMPLATE_SET ? genericDeskEntry(t.manifest) : undefined)`.

- [ ] **Step 1: Write the failing tests** in `deskDeclaration.test.ts`

```ts
describe('generic desk entries for standalone OGraf graphics', () => {
  const studio = manifest({ id: 'project-1-rt', name: 'Rankings', schema: { type: 'object', properties: {
    title: { type: 'string' }, points_scale: { type: 'number' }, live_tag: { type: 'boolean' }, contestants: { type: 'array' } } } });
  it('offers simple fields and leaves arrays to their defaults', () => {
    expect(genericDeskEntry(studio)).toMatchObject({ key: 'ograf:project-1-rt', label: 'Rankings', live: false, params: [], fields: ['title', 'points_scale', 'live_tag'] });
  });
  it('works without a schema', () => {
    expect(genericDeskEntry(manifest()).fields).toEqual([]);
  });
  it('is used only for the custom look', () => {
    expect(deskEntryFor({ manifest: studio, setId: 'custom' })?.key).toBe('ograf:project-1-rt');
    expect(deskEntryFor({ manifest: studio, setId: 'standard' })).toBeUndefined();
  });
  it('generic keys never collide with look keys', () => {
    expect(DESK_TEMPLATES.some(t => t.key.startsWith('ograf:'))).toBe(false);
  });
});
```

In `Desk.test.ts`, add a template with `setId: 'custom'` and no `v_olgrafik_kind` to the mocked `templates` array. Assert that `deskDefinitions(project)` for an event using look `iof` includes `ograf:<id>` alongside the `iof` entries.

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/shared/__tests__/deskDeclaration.test.ts src/main/events/__tests__/Desk.test.ts`
Expected: FAIL. `genericDeskEntry` is not exported, and the custom graphic is missing from `deskDefinitions`.

- [ ] **Step 3: Implement it.** Add the two functions. In `entriesFor`, include templates whose `setId` is the project's look **or** `CUSTOM_TEMPLATE_SET`, look templates first so they win duplicate keys. Use `deskEntryFor(template)`. Replace the other two `t.desk ?? resolveDeskDeclaration(t.manifest).desk` call sites with `deskEntryFor(t)`.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all pass. Existing Desk tests are unchanged, because their mock has no `custom` graphics apart from the new one.

- [ ] **Step 5: Commit**

```bash
git add src/shared/deskDeclaration.ts src/main/events/Desk.ts src/main/ipc/eventHandlers.ts src/shared/__tests__/deskDeclaration.test.ts src/main/events/__tests__/Desk.test.ts
git commit -m "Live: offer standalone imported OGraf graphics with a generic desk entry"
```

### Task 3: Import preview shows licences and render requirements

**Files:**
- Modify: `src/main/templates/TemplatePackages.ts` (`ImportPreview` at `:47`, `previewContents`)
- Modify: `src/renderer/control/pages/TemplatesView.tsx` (the import confirmation that lists `preview.graphics`)
- Modify: `src/renderer/control/i18n/messages.ts` (new strings)
- Test: `src/main/templates/__tests__/TemplatePackages.test.ts`

**Interfaces:**
- Produces: `ImportPreview.graphics[n].notes?: string[]`. Notes, in this order:
  - `Licences: <names>`, where names are the file names under `licenses/` in that graphic's folder with `.txt` removed, comma-separated.
  - `Made for <w>×<h> at <fps> fps`, from `renderRequirements[0]`, using `exact`, then `ideal`, then `max`, for each value present. Only the parts that are present are shown.

- [ ] **Step 1: Write the failing test.** Build the zip with `zipSync` as the existing tests do, containing `g.ograf.json` (with `renderRequirements: [{ resolution: { width: { exact: 1920 }, height: { exact: 1080 } }, frameRate: { exact: 25 } }]`), `main.js` and `licenses/OGRAF-STUDIO-AGPL-3.0.txt`. Expect:

```ts
expect(previewTemplateZip(manager, zip).graphics[0].notes).toEqual([
  'Licences: OGRAF-STUDIO-AGPL-3.0', 'Made for 1920×1080 at 25 fps',
]);
```

Add a second case: a graphic with neither a `licenses/` folder nor `renderRequirements` gives `notes: undefined`.

- [ ] **Step 2: Run it and check that it fails**

Run: `npx vitest run src/main/templates/__tests__/TemplatePackages.test.ts`
Expected: FAIL, `notes` is undefined.

- [ ] **Step 3: Implement it.** Compute the notes in `previewContents` from the unpacked files. Show them under each graphic in the TemplatesView import confirmation as muted text, passing the fixed prefixes through `tr()`.

- [ ] **Step 4: Run the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: all pass, and the type check prints nothing.

- [ ] **Step 5: Commit**

```bash
git add src/main/templates/TemplatePackages.ts src/main/templates/__tests__/TemplatePackages.test.ts src/renderer/control/pages/TemplatesView.tsx src/renderer/control/i18n/messages.ts
git commit -m "Graphics library: show licences and render requirements before import"
```

### Task 4: Find a graphic whose manifest isn't named after its folder

**Files:**
- Modify: `src/main/templates/OGrafManager.ts:186-200` (manifest lookup per candidate folder)
- Modify: `docs/DESIGN-IN-OGRAF-STUDIO.md` (step 5: renaming the manifest file becomes optional; the `id` and the datasource file name still go together)
- Test: `src/main/templates/__tests__/TemplatePackages.test.ts`

**Interfaces:**
- Consumes: nothing new. Lookup order per folder: `<folder>.ograf.json`, then `manifest.json` (existing), then the folder's only `*.ograf.json` file. If there are two or more and none is named after the folder, skip the folder and log a warning naming the folder and the files.

- [ ] **Step 1: Write the failing tests.** Import a look zip that contains `mylook/set.json` plus a graphic folder `mylook/strap/` holding `project-1-rt.ograf.json` (a valid manifest with `v_olgrafik_set: 'mylook'`) and `main.js`. Expect `manager.getAllTemplates().some(t => t.directoryName === 'sets/mylook/strap')` to be `true`. In a second case, the folder holds two `*.ograf.json` files and expect it to be skipped.

- [ ] **Step 2: Run them and check that they fail**

Run: `npx vitest run src/main/templates/__tests__/TemplatePackages.test.ts`
Expected: FAIL, the graphic is not found.

- [ ] **Step 3: Implement the lookup order above.**

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/main/templates/OGrafManager.ts src/main/templates/__tests__/TemplatePackages.test.ts docs/DESIGN-IN-OGRAF-STUDIO.md
git commit -m "Templates: find a graphic's only .ograf.json whatever its name"
```

---

## Follow-up plans (separate, one per subsystem)

These come from what OGraf Studio does well. Each one needs its own short design before a plan is written.

1. **Custom actions on the Live desk.** Show a manifest's `customActions` (for example Rankings' "Next vote") as buttons on the inspector for an on-air graphic, sent through the existing `customAction` path. This is the next step after Task 2.
2. **Results rows that move.** Give each row of the results and split tables a stable key (the runner id) and slide rows from their old place to their new place when a runner moves up or down, instead of redrawing the table. Studio does this with keyed repeating lists.
3. **Update only what changed.** When new timing data arrives, cross-fade only the cells whose value changed. Add a policy for data that arrives mid-transition: finish the current fade first, or jump to the newest data. This matters when radio-control times arrive in bursts.
4. **Zones become lanes.** Today `v_olgrafik_zone` clashes are fixed rules. Studio lets the designer group graphics into lanes that replace each other, with a house transition per lane. Decide whether our looks need that much control.
5. **Live preview on the local network.** A fixed URL and QR code for a director or commentator view of what is on air. This builds on the existing web output.
6. **A helper that adopts a Studio export.** Given an `.ograf.zip`, a look and a kind, it would rename the files, add the `v_olgrafik_*` fields and copy a matching datasource file, automating step 5 of `docs/DESIGN-IN-OGRAF-STUDIO.md`. Worth doing once someone has made a few graphics by hand.
7. **Try-it pages for looks.** On the website's looks page, run each look's graphics with test data so visitors can take them in and out before downloading.

# Milestone 3a: Look Files and Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Looks travel as `.splitlook` files that open with a double-click. Graphics added to a built-in look (and "use instead of" overrides) live beside it, survive app updates, and travel as small `extends` files.

**Architecture:**
- **Discovery:** reads `<user>/additions/<lookId>/<graphic>/` as graphics of that look, plus `overrides.json` in the additions folder or in an imported look's folder.
- **Desk:** skips a replaced graphic and gives its desk key to the graphic that replaces it.
- **Export:** a built-in look exports only its additions, with `"extends"` in `set.json`. Import routes such a file into `additions/`.
- **Opening files:** the OS file association hands `.splitlook` paths to the running app, which opens the import confirmation.

**Tech Stack:** Electron, TypeScript, React, fflate, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-graphics-library-and-import-helper-design.md`, sections 3 and 6, and the builder-check decisions in section 5 ("Kind", "Use instead of").

## Global Constraints

- **Additions folder:** `<user templates dir>/additions/<lookId>/<graphicFolder>/`, where the user templates dir is `<dataroot>/templates`.
- **Overrides file:** `overrides.json` = `{ "replaces": { "<new graphic id>": "<replaced graphic id>" } }`. It lives in `additions/<lookId>/` for built-in looks, and in `sets/<lookId>/` for imported looks.
- **Export file:** `<Look name>.splitlook`, a zip. A built-in look's file holds only `<lookId>/set.json` (`{ id, name, extends: "<lookId>" }`), its additions and `overrides.json`. An imported look's file is today's zip with the new extension.
- **Import accepts** `.splitlook`, `.zip` and `.ograf.zip`.
- **Addition for a look this computer doesn't have:** it is installed and listed under Needs attention (set `custom`).
- **Baseline:** 68 files, 691 tests; type check clean.

## Review Focus

1. **An `extends` file for a look the computer doesn't have:** the graphics show under Needs attention, and nothing is lost. Pinned in Task 1.
2. **Importing the same `extends` file twice:** the additions are replaced, not duplicated. Pinned in Task 3.
3. **Removing an addition that replaced a built-in graphic:** the original comes back in Live. Pinned in Task 4.
4. **A `.splitlook` opened while the app is closed (Windows: the path is in the first `argv`):** the import confirmation appears once the library has loaded. Pinned in Task 5 (`lookFileFromArgv`) and checked in Task 7.
5. **An imported look with its own `overrides.json`:** it is honoured exactly as built-in additions are. Pinned in Task 2.

---

### Task 1: Discovery of additions and overrides

**Files:** Modify `src/main/templates/OGrafManager.ts`, `src/shared/types/ograf.ts`. Test `src/main/templates/__tests__/additions.test.ts`.

**Interfaces — Produces:**
- `OGrafTemplateInfo.addition?: true`
- `TemplateSetInfo.additions?: number`
- `OGrafManager.getReplacements(setId: string): Record<string, string>`: the new graphic id mapped to the id it replaces, read from both override files.

- [ ] Test: a user dir with `additions/standard/guest-strap/guest-strap.ograf.json` loads that graphic with `setId: 'standard'`, `addition: true` and `directoryName: 'additions/standard/guest-strap'`, and Standard's `additions` is 1.
- [ ] Test: `additions/nowhere/x/` loads with `setId: 'custom'`.
- [ ] Test: `getReplacements('standard')` returns the contents of `overrides.json`.
- [ ] Test: the top-level scan never lists `additions` itself as a custom graphic.
- [ ] Implement, run `npx vitest run`, and commit.

### Task 2: Desk honours replacements

**Files:** Modify `src/shared/deskDeclaration.ts` (`deskEntriesForLook`) and `src/main/events/Desk.ts`. Test `src/main/events/__tests__/Desk.test.ts`.

**Interfaces — Produces:**
- `deskEntriesForLook(templates: OGrafTemplateInfo[], replaces: Record<string, string>): Map<string, { def: DeskTemplate; template: OGrafTemplateInfo }>`
  - A replaced graphic is left out.
  - The replacing graphic's `def.key` becomes the replaced graphic's key. Everything else in its def is its own.

- [ ] Test: with `replaces: { 'guest-strap': 'iof-free-text' }`, the entries hold key `free-text` mapped to template `guest-strap`, and `iof-free-text` is absent.
- [ ] Implement, then use it in `entriesFor` with `getTemplateManager().getReplacements(look)`. Run the suite and commit.

### Task 3: `.splitlook` export and `extends` import

**Files:** Modify `src/main/templates/TemplatePackages.ts` and `src/main/ipc/templateHandlers.ts` (export: default name and filter; pick: filters `splitlook`, `zip`). Test `src/main/templates/__tests__/TemplatePackages.test.ts`.

**Interfaces — Produces:**
- `ZipContents.extensions: Array<{ lookId: string; graphics: ZipGraphic[]; replaces: Record<string, string> }>`
- `ImportPreview.additions: Array<{ lookId: string; lookName: string | null; graphics: number }>`, where `lookName` is `null` when the look isn't installed.
- `exportLookZip(manager, setId)`:
  - **built-in look:** additions-only, as in Global Constraints. It throws `This look has no additions to export` when there are none.
  - **imported look:** unchanged.
- `importTemplateZip` installs each extension's graphics into `additions/<lookId>/<folder>`, replacing a folder with the same name, and merges `replaces` into `additions/<lookId>/overrides.json`.

- [ ] Test: round trip. Install an addition and an override for Standard, export Standard, then import into a fresh user dir. The addition and the override are both there, and `sets/standard` was not created in the user dir.
- [ ] Test: importing the same file twice leaves one addition.
- [ ] Test: exporting Standard with no additions throws the message above.
- [ ] Implement, run the suite, and commit.

### Task 4: Remove an addition

**Files:** Modify `TemplatePackages.ts` (`removeAddition(manager, lookId, graphicId)`), `templateHandlers.ts` (IPC `templates:removeAddition`), and `src/preload/index.ts`. Test in `TemplatePackages.test.ts`.

- [ ] Test: removing an addition that replaced `standard-free-text` deletes its folder and its override entry. Afterwards `getReplacements('standard')` is `{}`, and the desk entries hold the original again (via `deskEntriesForLook`).
- [ ] Implement, run the suite, and commit.

### Task 5: Open `.splitlook` from the OS

**Files:**
- Create `src/main/utils/lookFiles.ts`.
- Modify `src/main/index.ts`, `src/main/utils/singleInstance.ts` (pass `argv` to a handler), `electron-builder.json` (`fileAssociations`), and `templateHandlers.ts` (IPC `templates:pendingOpen`, which returns `{ filePath, preview }` or `null` and registers the path with the import lock).
- Modify `TemplatesView.tsx` and `App.tsx` (navigate to the library on `fromMain { type: 'openLookFile' }`).
- Test `src/main/utils/__tests__/lookFiles.test.ts`.

**Interfaces — Produces:**
- `lookFileFromArgv(argv: string[]): string | null`: the last argument ending in `.splitlook` (case-insensitive) that exists on disk.
- `fileAssociations: [{ "ext": "splitlook", "name": "Split Control look", "role": "Viewer" }]`.

- [ ] Test `lookFileFromArgv` with a temp file, a missing file, and no file.
- [ ] Implement:
  - first start: use `process.argv`;
  - `second-instance`: use its argv;
  - macOS: handle `open-file`;
  - keep the path pending until the library asks for it.
- [ ] Run the suite and commit.

### Task 6: Library shows additions and replacements

**Files:** Modify `LibraryHome.tsx`, `LookPage.tsx`, `TemplatesView.tsx` and `library.css`, plus `messages.ts`. Test `src/renderer/control/library/__tests__/libraryModel.test.ts`.

**Interfaces — Produces:**
- `replacedBy(templates: OGrafTemplateInfo[], replaces: Record<string, string>): Map<string, string>`: replaced id → replacing graphic's name.
- Look cards show `+N` additions.
- Tiles mark additions with ⊕ and a **Remove** button, and show "Replaced by …" on the replaced graphic.
- **Export…** is hidden for a built-in look with no additions.
- The look page gets the replacements from IPC `templates:getReplacements(setId)`.

- [ ] Test `replacedBy`. Implement, then run the type check, the tests and the build. Commit.

### Task 7: Check it in the real app

- [ ] With a hand-made addition and override for Standard:
  - the library shows ⊕, "Replaced by" and `+1`;
  - Live offers the addition under the replaced key.
- [ ] Export Standard, remove the addition, then import the `.splitlook` file through the app's import path. Everything comes back.
- [ ] Remove the addition again; the original graphic is back in Live.

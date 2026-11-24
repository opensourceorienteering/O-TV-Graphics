# Milestone 3b-2: Import Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Graphics that Live can't offer yet are listed under Needs attention. That covers outside graphics without a look, graphics whose desk entry has warnings, and look graphics with no Live entry (Name strap, Runner lower third). **Fix…** opens a helper with three steps: match the graphic's fields to our data (or keep them typed in Live), check it in a preview, then choose where it goes and its name. Finishing makes the graphic available in Live.

**Spec:** `docs/superpowers/specs/2026-11-20-graphics-library-and-import-helper-design.md`, sections 4–6. The field map from 3b-1 does the data work.

## Builder decisions (differences from the spec, and why)

- **No `_pending` folder.**
  - Import already installs a loose graphic in the user templates folder. Discovery lists it under the custom set, so it shows under Needs attention and never in Live. That is the "kept, not lost, nothing half-configured reaches Live" the spec asks for, without a second storage place.
  - After an import that brought graphics needing attention, the helper opens straight away on them. Cancel leaves them under Needs attention.
- **Graphics already in a look** (built-in or imported) can't be moved, and the app's own files are never edited. For them the helper writes a **desk patch**: `desk.json` beside the look (`additions/<look>/desk.json` for a built-in look, `sets/<look>/desk.json` for an imported one), holding `{ "<graphic id>": { "v_olgrafik_desk": {…}, "v_olgrafik_fieldMap": {…}, "v_olgrafik_zone": "lower" } }`. Discovery merges it into the manifest. The Where step is fixed to the graphic's own look.
- **"Keep as typed in Live"** is the Data step with every field left as Typed in Live. One button sets that.
- **Runner and class values for a mapped graphic.** Live already holds the runner the operator picked (`runnerName`, `runnerClub`, `runnerBib`) and the class/timing point. For graphics with a field map, these go along with the typed fields, so the map can read them without a data-source file. A data-source file is generated only when a list is matched to runners at a timing point.

## Global Constraints

- **Our keys and row keys:** as in `src/shared/fieldMap.ts`.
- **Inputs follow from the matches:**
  - runner data → `runner` input, required;
  - runners at a timing point → `class` (required) and `control` inputs, and the `timing` feed;
  - class name only → `class`;
  - timing point name → `control`;
  - event, course or weather data → that feed.
- **Kind:**
  - an outside graphic gets `<lookId>-<slug of label>` (unique in the look);
  - a look graphic keeps its own kind.
  - The desk `fields` are the graphic keys left as Typed in Live. No behaviours.
- **Conflicts, rechecked on every change:**
  - the same label as another graphic in that look → must rename;
  - a new look's name or id already used → must rename;
  - the same graphic id or folder → made unique silently (`-2`, `-3`, …).

## Tasks

### Task 1: Desk patches in discovery
- `OGrafManager` merges `desk.json` patches into the manifest before it resolves the desk entry. Only `v_olgrafik_desk`, `v_olgrafik_fieldMap` and `v_olgrafik_zone` are taken from a patch.
- **Test:** a patch gives the Standard Name strap a desk entry and zone, and other keys in the patch are ignored.

### Task 2: Needs attention includes look graphics with no Live entry
- `needsAttention` adds graphics in a look whose `desk` is undefined.
- **Test** in `libraryModel.test.ts`.

### Task 3: Live sends picked values to mapped graphics, and the Preview monitor maps too
- **In Desk:**
  - `writeDraft` and `deskPreviewData` add `runnerName`, `runnerClub`, `runnerBib`, `className` and `controlName` from the draft's values to the fields of a graphic that has a field map;
  - `deskPreviewData` applies the field map.
- **Test** in `Desk.test.ts`.

### Task 4: Helper model (pure, renderer)
- **File:** `src/renderer/control/library/helperModel.ts`.
- **Functions:**
  - `fieldRows(schema)`: one row per top-level property: key, title, type, example, and for a list its row properties;
  - `suggest(row)`: from the key and title words (name/headline/athlete → runnerName, club/team → runnerClub, …, rank/pos/place → position, time, behind/gap/diff → diff);
  - `typeWarning(row, choice)`: a number or boolean field given text → suggest the seconds version;
  - `deriveInputs(choices)`: `{ inputs, required, feeds }`;
  - `buildDesk({ label, kind, choices, rows })` and `buildFieldMap(choices)`;
  - `kindFor(lookId, label, taken)`;
  - `conflicts({ look, label, newLookName, looks, templates })`.
- **Tests** for each.

### Task 5: Finishing (main)
- **File:** `src/main/templates/ImportHelper.ts`, `finishGraphic(manager, request)`.
- **Graphic in a look:** write or merge the desk patch, and `replaces` into `overrides.json`.
- **Loose graphic:**
  - move its folder to the destination, with a unique id and folder;
  - rewrite its manifest (id, kind, zone, desk, field map);
  - write a datasource file when a list is matched;
  - destinations: an existing built-in look → `additions/<look>/<id>/`; an imported look → `sets/<look>/<id>/`; a new look → `sets/<newId>/` with `set.json` (`id`, `name`), plus `set.js` and `theme.css` copied from Standard.
- Then rediscover.
- **Validation:** every name is checked with the same id rules as import, and nothing is written outside the user templates folder.
- **IPC:** `templates:finishHelper`.
- **Tests:**
  - a patch for a built-in graphic;
  - a loose graphic moved into Standard's additions with its manifest rewritten;
  - a new look created;
  - unique ids;
  - path refusal.

### Task 6: Helper UI
- **File:** `ImportHelper.tsx`, a modal with steps Data → Check → Where and name, one graphic at a time ("2 of 3").
  - **Data:**
    - rows with a select of Typed in Live and our data;
    - lists get their row matching;
    - a sample value from the sample race beside each;
    - "Matched automatically" marks;
    - Needs a choice blocks Next;
    - Keep all typed in Live.
  - **Check:** `LibraryPreview` on the template with the map and desk applied; any preview error is shown.
  - **Where and name:** look (existing or new), label, short label, position, Use instead of (pre-selected when the inputs match), and the conflict messages.
- **Fix…** in Needs attention opens it on the listed graphics. After an import that brought graphics needing attention, it opens on those.
- Translations.

### Task 7: Check in the real app
- Import a loose OGraf graphic (Studio-style fields `headline`, `subheadline`, and a list `contestants`) and map it:
  - `headline` → runner name;
  - `contestants` → runners at a timing point.
- Finish into Standard. Live offers it, and Show sends mapped data.
- Fix the Standard Name strap with "Keep as typed in Live"; Live offers it.

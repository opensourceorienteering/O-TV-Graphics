# Graphics library, look files and import helper — design

Status: agreed in conversation on 20 November 2026. Builds on
[the OGraf Studio interop plan](../plans/2026-11-19-ograf-studio-interop.md) and
[Designing graphics in OGraf Studio](../../DESIGN-IN-OGRAF-STUDIO.md).

## Why

The Graphics library is one long page of every graphic in every look, and importing is a single
yes/no dialog. Outside graphics, from OGraf Studio or any other OGraf tool, import but then
silently land in the hidden "custom" set, which Live doesn't offer. Turning them into something
the operator can use means editing JSON by hand, as described in the Studio guide.

We want:
- the library organised the way people think about it, by **look**;
- to **see** a graphic before using it;
- outside graphics made usable through a guided tool, without hand-editing.

## Goals

1. **Library by look.** The home page shows looks as cards. Opening a look shows its graphics.
2. **Preview with sample data.** Any graphic in the library can be played in a preview frame on
   a simulated race, with Show, Next and Hide.
3. **Look files.** Looks are exported as `.splitlook` files (zip inside), and double-clicking one
   imports it.
4. **Complete looks import with no questions.** A look that meets the completeness test (below)
   imports after the existing plain confirmation, with nothing else asked.
5. **Import helper** for everything else: match the graphic's fields and lists to Split Control
   data, check it, then choose the look and name it.
6. **Additions to built-in looks.** A graphic added to Standard (or any built-in look) is stored
   separately and survives app updates to that look.

## Non-goals

- Editing a graphic's design. That's what OGraf Studio is for.
- Changing an outside graphic's files. Matches are stored next to them; their code is never
  modified (this also keeps us clear of AGPL obligations on our own code).
- Paging (Next page) for outside graphics with lists. They show as many rows as they were
  designed for.
- Mapping data for external controllers using the OGraf Server API. They send the graphic's own
  keys, as before.
- Live operators using the helper on race day. It's a preparation tool.

## Anti-goals

- An import that "succeeds" but leaves a graphic Live can't offer. After this work, every
  imported graphic is either in a look and usable, or listed under **Needs attention**.
- A helper that asks about things that are already fine. It asks only about what failed.
- Breaking existing look zips, or the looks already on the website.

## Decisions made together

| Topic | Decision |
|---|---|
| Library layout | Looks as cards, then a page per look with its graphics and a preview |
| Preview data | Simulated race, plus sample event/course/weather data |
| Built-in look additions | Option A: stored separately, kept across app updates, included when that look is exported |
| Look file extension | `.splitlook` (zip inside). `.zip` and `.ograf.zip` are still accepted on import |
| Helper step order | 1 Data → 2 Check → 3 Where and name (look, label and position in one step, with conflict checks) |
| Lists | Mapped in the first version |
| Matching UI | Modelled on Mailchimp's column matching: real example values on both sides, automatic matches marked, "Needs a choice" highlighted, a matched count |
| Where matches live | Approach A, below |

## Approaches considered (the data mapping)

- **A. The app translates the data (chosen).** The helper stores the matches in the graphic's
  manifest as `v_olgrafik_fieldMap`. The app renames values to the graphic's keys before sending
  them. The graphic is untouched; the matches can be re-edited and travel in `.splitlook` files.
  The desk's checks, the preview and Live all read the same mapping.
- **B. Generated wrapper code** around each graphic. Rejected: it generates code into looks,
  every change means regenerating it, and a wrapper bug ships inside every imported graphic.
- **C. The graphics window translates.** Rejected: the desk wouldn't know which inputs a graphic
  needs, and the preview would need a second copy of the logic.

## The design

### 1. Library home: looks

```
Graphics library                         [Import…]  [Get more looks]
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│ ▓▓ Standard      │ │ ▓▓ Bold          │ │ ▓▓ Club look     │
│ Built in · 20 +1 │ │ Built in · 20    │ │ Imported · 6     │
│ ● ● ●  Inter     │ │ ● ● ●  Oswald    │ │ ● ●              │
└──────────────────┘ └──────────────────┘ └──────────────────┘
⚠ Needs attention: 2 graphics not in a look yet   [Fix…]
```

- Each card shows the look's name, logo (`logoPreview`), source (built in / imported), number of
  graphics, additions (`+1`), colours and fonts, and "Only use at approved events" when set.
  All of this exists in `TemplateSetInfo` today.
- **Needs attention** lists graphics in the `custom` set, plus graphics with desk warnings.
  **Fix…** opens the import helper on them.
- The existing search ("Name or ID") stays, and searches across all looks. Results show which
  look each graphic is in.

### 2. Look page and preview

```
← Looks   Standard · Built in              [Export…]  [Remove] (imported only)
┌──────────┐┌──────────┐┌──────────┐   ┌────────────────────────┐
│ Results  ││ Start    ││ Guest    │   │  [16:9 live preview]   │
│ [thumb]  ││ list     ││ strap ⊕  │   │                        │
└──────────┘└──────────┘└──────────┘   │ Show  Next  Hide       │
                                       │ Sample race ▸ 1× / 20× │
                                       │ Data used: timing, event│
                                       └────────────────────────┘
```

- The graphic tiles show name, kind and the badges that exist today (timing data, steps).
  Additions carry a mark (⊕) and can be removed or reopened in the helper.
- **Preview:** a 1920×1080 frame scaled to fit, rendering the graphic through the same OGraf
  loading path as output, with `renderType: "realtime"`. It never touches any real output.
- **Sample data:** the website's simulated race (`site/preview/sim.js`, `createRace` and
  `raceData`) and sample feeds (`site/preview/feeds.js`). The data a graphic gets follows its
  declared feeds and schema defaults, as `graphicFeedData()` does on the website, with its
  `v_olgrafik_fieldMap` applied. The race runs at 1× or 20×, so timing graphics update live.
- Choosing a class or timing point is not needed: the preview uses the race's class and picks
  a timing point that gives a full list (the finish, late in the race).

### 3. Look files: `.splitlook`

- **Export…** saves `<Look name>.splitlook`. For an imported or new look, the content is today's
  look zip, with its graphics and overrides.
- **Exporting a built-in look's additions** *(builder-check decision)*: a built-in look is
  already on every machine, so its `.splitlook` carries **only the additions** and their
  overrides, with `"extends": "<lookId>"` in its `set.json`. Importing such a file installs the
  additions under `additions/<lookId>/`, so the receiving machine's look keeps following app
  updates. If that machine doesn't have the look, the graphics go to Needs attention. A built-in
  look with no additions has nothing to export, so the button is hidden.
- Register `.splitlook` as a file type in `electron-builder.json` (`fileAssociations`) on
  Windows and macOS. Opening one sends it to the running app: on Windows through the existing
  single-instance `second-instance` handler, on macOS through `open-file`. The app opens the
  Graphics library and starts the import.
- Import accepts `.splitlook`, `.zip` and `.ograf.zip`.
- The website's looks page switches its downloads to `.splitlook` once a release supports it.

### 4. Import: complete or helper

A zip or look file is **complete** when:
1. it contains a look (`set.json` with `id` and `name`);
2. every graphic in it is found and its manifest validates;
3. every graphic has a valid desk entry (a known kind, or a `v_olgrafik_desk` with no warnings);
4. every graphic whose desk entry uses the `timing` feed has its `<id>.datasource.json`;
5. every `v_olgrafik_fieldMap` refers to existing schema fields and known data.

A complete look imports with today's confirmation ("Import this zip?"). Anything else opens the
helper on the graphics that fail, with the rest of the zip kept as it is. Loose graphics with no
look (Studio exports) always go through the helper.

### 5. Import helper

A window that goes through the incomplete graphics one at a time ("2 of 3").

**Step 1 · Data: match the graphic's fields to Split Control data**

```
1 Data · Match the graphic's fields to Split Control data        6 of 8 matched
 In the graphic          Example in graphic     Split Control data
 ✓ headline             "Jane Doe"             [Runner name ▾]   Tove Alexandersson
   Matched automatically                                         Kasper Fosser
 ✓ subheadline          "Senior reporter"      [Runner club ▾]   Stora Tuna OK
 ⚠ style                "news"                 [Choose… ▾]       Needs a choice
 ○ live_tag             true                   [Typed in Live ▾]
 ▾ contestants · list, 12 rows        [Runners at a timing point ▾]
   ✓ name               "Lisbon"               [Runner name ▾]   Tove Alexandersson
   ⚠ points             12 (number)            [Time in seconds ▾]  2052
     Time is text, so the number version is used
```

- One row per top-level field in the graphic's `schema.properties`. The left side shows the
  graphic's default or example. The right side shows two or three values from the sample race.
- Each field can be **Typed in Live** (the operator fills it in) or one of our **standard data**:

  | Group | Values (our data key) |
  |---|---|
  | Runner (the one the operator picks) | name `runnerName`, club `runnerClub`, bib `runnerBib` |
  | Class and timing point | class `className`, timing point name `controlName` |
  | Event (`event` feed) | title `title`, series `series`, place `place`, date `date` |
  | Course (`course` feed) | the course fields from `feeds.js` |
  | Weather (`weather` feed) | the weather fields from `feeds.js` |

- **A list field** (`type: array` with object items) can be matched to **Runners at a timing
  point** (our `results`). Its row fields are then matched to: name, club, country, bib, place
  (`position`), time, behind (`diff`), status, start time, plus **time in seconds** and
  **behind in seconds** (numbers, for graphics that expect a number). A list can also stay
  **Typed in Live**, which keeps its default.
- **Automatic suggestions** come from the key and title, for example `name`, `headline`,
  `athlete` → runner name; `club`, `team` → club; `rank`, `pos`, `place` → place. They are
  marked "Matched automatically" and can be changed.
- **Type check:** when the graphic expects a number or boolean and our value is text, show a
  warning and suggest the number version where there is one.
- Fields that are neither matched nor typed show **Needs a choice**. Next is blocked only by
  those.
- **The inputs Live asks for follow from the matches:** runner data → `runner` input (required);
  runners at a timing point → `class` (required) and `control` inputs and the `timing` feed;
  class name only → `class`; event, course or weather data → that feed.

**Step 2 · Check**

- The preview from section 2, using the matches just made, with Show, Next and Hide.
- Automatic checks, each shown as ✓ or ⚠: the graphic loads; it shows without an error; it
  hides; its `renderRequirements` (if any) are listed for information.

**Step 3 · Where and name**

```
3 Where     ◉ Add to look [Standard ▾]   ○ New look [________]
            Label in Live [Guest name strap]    Position [Lower ▾]
            ⚠ Standard already has "Runner name strap", which also asks for a runner
            Use instead of [Runner name strap ▾]   (or: nothing, add alongside)
```

- Look: an existing look (built-in or imported) or a new one. A new look gets its name here, and
  a copy of `set.json`, `set.js` and `theme.css` from Standard, so its own graphics and future
  imports have a base.
- Label (shown in Live), short label (defaults to the label) and position (`v_olgrafik_zone`).
- **Kind** *(builder-check decision)*: an outside graphic always gets a kind of its own,
  `<lookId>-<slug of label>`. It never takes on a built-in kind, so it never silently inherits
  a Split Control graphic's behaviours (`holdOnAir`, `freeze`, `titleFromClass`, paging). Its
  `v_olgrafik_desk` is written in full by the helper: `inputs`, `required` and `feeds` from
  step 1, `fields` = the graphic keys left as Typed in Live, no behaviours.
- **Use instead of** *(builder-check decision)*: a dropdown "Use instead of: [nothing ▾]",
  listing the look's graphics. The helper pre-selects a graphic whose inputs match (for
  example, a runner name strap when step 1 matched runner data) and shows the warning above.
  Choosing one makes the new graphic take over that graphic's desk **key**, so command numbers
  and favourites carry over. See section 6 for what happens to the replaced graphic.
- Conflict checks, rechecked on every change:
  - same **label** as a graphic in that look → must rename;
  - inputs matching an existing graphic → the "Use instead of" suggestion above;
  - same **id or folder name** → the app makes them unique without asking;
  - **new look name** already used → must rename.

**Finish** writes the result (below) and shows the graphic in its look page.

### 6. What the helper writes

For each graphic, in the user's templates folder (`<dataroot>/templates`):

- the graphic's files, unchanged, in a folder named after its new id;
- its manifest, renamed to `<id>.ograf.json`, with `id`, `v_olgrafik_set`, `v_olgrafik_kind`,
  `v_olgrafik_zone`, `v_olgrafik_desk` and `v_olgrafik_fieldMap` set;
- `<id>.datasource.json` when it uses timing data, **generated from the step 1 matches**
  *(builder-check decision)*: a `class-selector` when a list or class name is matched; a
  `control-point-selector` (with Finish) when runners at a timing point are matched; a
  `runner-search` when runner data is matched; field mappings for `className`, `results` and
  `controlName` as needed. It follows the shape of `standard-runner-lower-third.datasource.json`
  and `standard-results.datasource.json`;
- additions to a **built-in** look go to `<dataroot>/templates/additions/<lookId>/<id>/`.
  Discovery loads them as graphics of that look. They are kept when the app updates. If the app
  no longer ships that look, they appear under Needs attention. Additions to an **imported**
  look go straight into that look's folder.
- **Replaced graphics** *(builder-check decision)*: "Use instead of" writes
  `<dataroot>/templates/additions/<lookId>/overrides.json`, for example
  `{ "replaces": { "<new id>": "<replaced id>" } }` (for an imported look, the same file goes in
  the look's folder). Desk resolution skips a replaced graphic, so the new one owns the key. The
  library still shows the replaced graphic, marked "Replaced by Guest name strap". Removing the
  addition removes its override and brings the original back. Overrides survive app updates
  like additions do.

**Transactions and cancelling** *(builder-check decision)*:
- Each graphic is written when you press **Finish** on it, not before.
- For a look zip, the look itself and its complete graphics are installed when the first
  graphic is finished. If every graphic needs the helper, that happens when the first one is
  done.
- Graphics not finished (Cancel, or closing the window) are kept with their original files in
  `<dataroot>/templates/_pending/<id>/`, which discovery skips because of the leading
  underscore, together with the look they came from. They show under **Needs attention**, and
  **Fix…** reopens the helper on them. Nothing is lost and nothing half-configured reaches Live.
- The original zip itself is not kept.

### 7. `v_olgrafik_fieldMap`

A manifest property, mapping the graphic's key to our data:

```json
"v_olgrafik_fieldMap": {
  "headline": "runnerName",
  "subheadline": "runnerClub",
  "contestants": { "from": "results", "items": {
    "name": "name", "points": "timeSeconds", "rank": "position" } }
}
```

- A string value means "this graphic key gets the value of our key".
- An object value maps a list: `from` is our list, `items` maps each row's keys.
- Derived values (`timeSeconds`, `diffSeconds`) are computed from `time` and `diff` while
  mapping.
- Keys not in the map pass through as they are, so typed fields keep working unchanged.
- Applied to every app-built data path: Show, Update, live timing updates, the Live Preview
  monitor, Plan's theme preview and the library preview. Not applied to the OGraf Server API.
- `resolveDeskDeclaration()` validates it: unknown target keys, unknown our-keys and a list
  mapped to a non-list produce desk warnings.
- Desk `fields` refers to the **graphic's** keys (what the operator types). The `required`
  inputs come from the inputs derived in step 1.

## Prerequisites

From [the interop plan](../plans/2026-11-19-ograf-studio-interop.md):
- **Task 1** (renderer sends `renderType` and a default `delta`): the preview and outside
  graphics depend on it.
- **Task 4** (discovery finds a graphic's only `*.ograf.json`): needed for loose imports.
- **Task 2** (generic desk entry for the custom set) is **replaced** by Needs attention and the
  helper. Drop it.
- **Task 3** (licences and render requirements in the import preview) moves into the helper's
  Check step and the complete-look confirmation.

## Order of work

1. Interop plan Tasks 1 and 4.
2. Library home and look pages, with the preview.
3. `.splitlook` export, file association and import routing (complete or helper).
4. Additions to built-in looks.
5. `v_olgrafik_fieldMap`: validation and applying it everywhere.
6. The import helper UI.

Each part ships on its own. Parts 2 and 3 are useful with no helper at all.

## Left to the builder

- Component structure, styling and how the library and helper windows are laid out, within the
  sketches above and the app's existing `studio-*` styles.
- How to bring `sim.js` and `feeds.js` into the app (shared module or a copy).
- The exact suggestion rules, beyond the examples given.
- Test layout, following the repository's existing Vitest and `test:templates` patterns.

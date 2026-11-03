# Graphics declare what the app offers for them

Status: steps 1–4 implemented.

## Starting point

Before the rebuild, every look had the same 17 graphics, and the app had one fixed list of what the Live
desk offered (`DESK_TEMPLATES` in `src/shared/desk.ts`): names, command-palette parameters,
fields, and how each graphic behaved. A look couldn't leave a graphic out cleanly or add a new one
(a relay overview, a leg summary, a sponsor bug) without changing the app.

The goal: the app keeps a **standard set of building blocks**, and each graphic in a look says
which ones it uses. A look can then:

- **leave a graphic out**, and the desk, command numbers and Companion simply don't offer it;
- **add a new graphic** that the app has never heard of, as long as it is built from the standard
  blocks (inputs, data feeds, behaviours). It appears in the Live desk with the right controls.

Data the app doesn't fetch at all (GPS tracking, for example) still needs app work: it becomes a
new building block that every look can then use.

## Before the rebuild

| Piece | Where | Per graphic already? |
|---|---|---|
| Timing data and the controls to pick it (class, timing point, runner) | `<graphic>.datasource.json` | Yes |
| Screen zone for clashes | `v_olgrafik_zone` in the manifest | Yes |
| Typed fields and their defaults | `schema` in the manifest | Yes |
| What the graphic is (kind) | `v_olgrafik_kind` in the manifest | Yes |
| Desk entry: name, palette parameters, required inputs, which fields Live shows, live-update default | `DESK_TEMPLATES` | **No: fixed list of 15** |
| Behaviours tied to a desk key | Desk.ts, LiveDesk.tsx, command.ts, desk.ts, eventHandlers.ts, EventTemplates.tsx | **No: hard-coded by key** |
| Drawing | `_core/views.js` | **No: only the 17 known kinds** |

The hard-coded behaviours are:

- Runner focus: "S" means the start in the palette, follows the next starter, can freeze the clock
  only away from the start.
- Live split: the running clock can be frozen.
- Course parameters and Weather fill in fields by themselves (course facts, the weather reading),
  and Weather is re-read every few minutes while it is on air.
- Race title fills its fields from the event; Results, Podium and Course take their title from
  the class; Weather its title from the event's location.
- Start list and Results share a rows-per-page setting.
- The Plan theme preview decides per kind whether real data is good enough to show, or uses
  sample data (results, split times or start times).

## The building blocks

Defined once in `src/shared/capabilities.ts`.

**Inputs** (palette parameters, in order): `class`, `runner`, `control`, `page`.

**Feeds** (data the app fills in):

| Feed | Gives the graphic |
|---|---|
| `timing` | results, split times, start list for the chosen class (through `.datasource.json`) |
| `course` | length, climb, controls, winning time … for the class (course-info fields) |
| `weather` | condition, temperature, wind, humidity at the event; re-read while on air |
| `event` | title, series, place, date from the event setup |

**Behaviours**:

| Behaviour | Meaning |
|---|---|
| `startControl` | the control input accepts "S" for the start (no control = start) |
| `followNextStarter` | the runner follows the next starter until the operator picks one |
| `freeze` | the running clock of a runner on the way can be stopped by hand (`T`) |
| `titleFromClass` | an empty title shows the class name |
| `titleFromLocation` | an empty title shows the event's location |
| `manualSteps` | advances only through operator actions, ignoring automatic page timers |
| `holdOnAir` | keeps the data it went on air with until Update (live-updates default off) |
| `rowsPartner:<key>` | shares the rows-per-page setting with another graphic |

**Preview data** (what the Plan theme preview needs to show it with real data, else samples):
`results`, `splits`, `starts`, or none.

## Steps

1. **Building blocks in the app (no visible change).** Add `capabilities.ts`. Give every
   `DESK_TEMPLATES` entry its feeds, behaviours and preview data, and replace every
   `key === '…'` check in the app with a check of the behaviour. Behaviour stays the same; the
   tests prove it. After this, nothing outside `desk.ts` knows the graphics by name.
   *Done.* Step 3 also removed Companion’s fixed graphic list and the desk’s hard-coded
   initial graphic.
   Runner focus is the one graphic that can follow the next starter (one follow state in Live).
2. **Graphics declare their desk entry.** A manifest may carry `v_olgrafik_desk` with label,
   short name, inputs, required inputs, fields, feeds, behaviours and preview data. Known kinds
   default to today's entry, so existing looks need nothing. The app validates declarations
   against the building blocks and ignores unknown ones (with a warning in Graphics library).
   *Done.* Declarations are resolved into `OGrafTemplateInfo.desk` at template load time;
   `deskWarnings` appear in Graphics library. The Live desk consumes these in step 3.
3. **The desk follows the event's look.** The Live list, command numbers, favourites, Companion
   and the HTTP API list the graphics of the event's look. Command numbers and favourites are
   kept per desk key; a key the look doesn't have is shown as unavailable rather than dropped,
   so switching looks back and forth loses nothing.
   *Done.* Live, palette, template settings and remote runner preparation use the look's
   declarations. The control state includes a graphic catalogue (`GET /api/control/graphics`),
   used by Companion. Saved command keys and favourites survive absent graphics; new keys get
   persisted free numbers. Unavailable favourites remain visible in Live.
4. **New graphics bring their own drawing.** `createGraphic` accepts a view function, so a new
   kind uses the shared lifecycle (animation states, pages, clocks, live patching) with its own
   markup. The preview site simulates data for every feed.
   *Done.* `createGraphic(kind, set, view)` accepts a synchronous drawing callback. Rendering
   and time-dependent redraws use it; existing two-argument graphics keep the built-in views.
   Plan respects declared preview data, and the browser preview carries declarations/schema
   defaults for built-in and uploaded looks and supplies timing, course, weather and event data.

## Risks

- Command numbers and favourites are stored by desk key. Step 3 must keep them when a look lacks
  a key, and give new keys free numbers without moving existing ones.
- Companion buttons and the HTTP API name graphics by key; they must list per look.
- Old looks (imported zips) without declarations must keep working: defaults by kind.
- A wrong declaration must not break the desk: validate and fall back.

## Declaring a desk entry

Add `v_olgrafik_kind` and `v_olgrafik_desk` to the graphic's `.ograf.json` manifest:

```json
{
  "v_olgrafik_kind": "relay-overview",
  "v_olgrafik_desk": {
    "label": "Relay overview",
    "short": "Relay",
    "inputs": ["class", "page"],
    "required": ["class"],
    "fields": ["title"],
    "feeds": ["timing"],
    "behaviours": ["holdOnAir", "titleFromClass"],
    "previewData": "results"
  }
}
```

`title` must also exist in the manifest's `schema.properties`. For a new kind, the kind
and label are required; inputs, required inputs, fields, feeds and behaviours default to empty.
The stable desk `key` defaults to the kind, and `short` defaults to the label. `live` is derived
from the timing feed. `settingsFields` lists schema fields shown only in template settings;
`rowsPartner` names a desk key with which to share the rows-per-page setting.

For known kinds, omitted properties inherit the existing desk entry. Empty arrays clear an
inherited list; `previewData: null` clears an inherited preview requirement. Legacy fallback
manifest IDs also retain their defaults. Required inputs must appear in `inputs`; `startControl`
needs `control`, and `freeze` / `followNextStarter` need `runner`.

Unknown properties, unsupported blocks, duplicate list entries, missing schema fields and
invalid combinations produce warnings. The whole declaration falls back to the known kind's
entry, or has no desk entry for a new kind. The graphic itself remains available in the library.
Use the `rowsPartner` property rather than a `rowsPartner:<key>` behaviour string.

## Bringing a new drawing

A hand-made graphic's `graphic.js` can import the lifecycle and provide its own view:

```js
import { createGraphic } from '../../_core/graphic.js';
import { esc } from '../../_core/util.js';
import set from '../set.js';

function relayOverview(data, ctx) {
  const results = Array.isArray(data.results) ? data.results : [];
  const rows = Math.max(1, Number(data.rowsPerPage) || 6);
  const steps = Math.max(1, Math.ceil(results.length / rows));
  const page = Math.min(ctx.step, steps);
  const shown = results.slice((page - 1) * rows, page * rows);
  return {
    steps,
    html: `<div class="panel panel--relay-overview">
      <div class="hdr"><span>${esc(data.title || data.className)}</span></div>
      <div class="rows">${shown.map(r => `<div class="row" data-key="${esc(r.bib || r.name)}">
        <span class="c-name">${esc(r.name)}</span>
        <span class="c-time">${esc(r.time)}</span>
      </div>`).join('')}</div>
    </div>`,
  };
}

export default createGraphic('relay-overview', set, relayOverview);
```

The callback takes the graphic data and the look configuration plus `kind` and one-based
`step`. It returns `{ html, steps? }`; it must be synchronous. Escape data inserted into HTML
with `esc`. Style the new kind in the look's `theme.css`, including its animation states.
Existing shared markup classes can use the theme's usual table styling.

The lifecycle handles Show/Hide, page changes, updates, logo settings, scaling and cleanup.
Stable `data-key` values let live patches keep rows in place. Return an optional `pageKey`
to identify the visible page: Next/Previous patches steps with the same `pageKey` in place,
so focus changes crossfade without replaying page animations. A changed `pageKey` uses the
usual page transition. The usual `[data-tick]` elements
get clock updates every 250 ms. A view whose choice of rows changes with time may return
`rekey: true` and a stable `key`: the lifecycle redraws when that key changes. Use `now(data)`
from `_core/util.js` for simulated/frozen time. Keep a key unchanged while the shown content's
identity stays the same.

The browser preview's built catalogue and uploaded zip catalogue retain the manifest's desk
entry and schema. Unknown kinds receive the declared feeds and schema defaults, with manual
JSON overrides still available. Timing samples follow the simulated race; the other feeds
provide representative event, course and weather values. Plan theme previews use a declared
`previewData` requirement when deciding whether timing results are usable or need samples.

## Verification

On 2026-11-03, the catalogue has 156 packages: 155 graphics across nine looks and the system
output test pattern. All 156 passed, with zero missing assets or renderer errors. The full
regression suite passed 542 tests, and type checking, the production build and site build passed.
The [recorded browser report](validation/template-rendering-2026-11-03.json) includes per-template
geometry and step counts. `npm run test:templates` runs their actual JavaScript, CSS, fonts and
images in an isolated real Chromium renderer. It covers loading, Show, paging, updates,
custom logo/identity, empty data, Hide and Dispose; it saves screenshots and a JSON report.
SOFT focus and normal start-list placement are checked explicitly. See the
[developer guide](TEMPLATE-DEVELOPMENT.md) for commands, output paths and test boundaries.

The connected backend test imports an unknown kind, discovers its declaration, parses its
command, prepares Preview without activating output, exercises HTTP Show/Update/Page/Hide,
and checks retained favourites and command numbers across look switches. Disk managers and
playback are real; renderer replies and hardware status are simulated in that test.

The browser matrix verifies actual template rendering, while the backend tests verify the
control path. Full click-through operator UI automation, physical Companion controls, NDI
capture quality and motion smoothness remain manual checks. Synthetic race data is used; the
matrix is not a live external timing-provider test or a pixel-baseline comparison.

The SOFT look's [Runner presentations](RUNNER-PRESENTATIONS.md) is the first hand-made
example: it uses a schema `v_olgrafik_control: "runner-multi-select"` on a string-array field
for its Live picker, `manualSteps` for operator-controlled advances and `pageKey` for focus
changes within a visible page.

SOFT’s [Finish watch](FINISH-WATCH.md) uses the optional all-class timing scope and two
control fields. Its prewarning reveals the runner; total race time and placing refer to the
measuring point. Registered rows hold briefly, then leave.

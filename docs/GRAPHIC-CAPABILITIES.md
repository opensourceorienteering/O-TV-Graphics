# Graphics declare what the app offers for them

Status: step 1 done; steps 2–4 proposed.

## Why

Every look today has the same 17 graphics, and the app has one fixed list of what the Live
desk offers (`DESK_TEMPLATES` in `src/shared/desk.ts`): names, command-palette parameters,
fields, and how each graphic behaves. A look can't leave a graphic out cleanly or add a new one
(a relay overview, a leg summary, a sponsor bug) without changing the app.

The goal: the app keeps a **standard set of building blocks**, and each graphic in a look says
which ones it uses. A look can then:

- **leave a graphic out**, and the desk, command numbers and Companion simply don't offer it;
- **add a new graphic** that the app has never heard of, as long as it is built from the standard
  blocks (inputs, data feeds, behaviours). It appears in the Live desk with the right controls.

Data the app doesn't fetch at all (GPS tracking, for example) still needs app work: it becomes a
new building block that every look can then use.

## What exists today

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
| `holdOnAir` | keeps the data it went on air with until Update (live-updates default off) |
| `rowsPartner:<key>` | shares the rows-per-page setting with another graphic |

**Preview data** (what the Plan theme preview needs to show it with real data, else samples):
`results`, `splits`, `starts`, or none.

## Steps

1. **Building blocks in the app (no visible change).** Add `capabilities.ts`. Give every
   `DESK_TEMPLATES` entry its feeds, behaviours and preview data, and replace every
   `key === '…'` check in the app with a check of the behaviour. Behaviour stays the same; the
   tests prove it. After this, nothing outside `desk.ts` knows the graphics by name.
   *Done.* Left for step 3: the Companion module keeps its own list of graphics
   (`companion/src/main.js`), and the desk opens on Runner identity by default.
   Runner focus is the one graphic that can follow the next starter (one follow state in Live).
2. **Graphics declare their desk entry.** A manifest may carry `v_olgrafik_desk` with label,
   short name, inputs, required inputs, fields, feeds, behaviours and preview data. Known kinds
   default to today's entry, so existing looks need nothing. The app validates declarations
   against the building blocks and ignores unknown ones (with a warning in Graphics library).
3. **The desk follows the event's look.** The Live list, command numbers, favourites, Companion
   and the HTTP API list the graphics of the event's look. Command numbers and favourites are
   kept per desk key; a key the look doesn't have is shown as unavailable rather than dropped,
   so switching looks back and forth loses nothing.
4. **New graphics bring their own drawing.** `createGraphic` accepts a view function, so a new
   kind uses the shared lifecycle (animation states, pages, clocks, live patching) with its own
   markup. The preview site simulates data for every feed.

## Risks

- Command numbers and favourites are stored by desk key. Step 3 must keep them when a look lacks
  a key, and give new keys free numbers without moving existing ones.
- Companion buttons and the HTTP API name graphics by key; they must list per look.
- Old looks (imported zips) without declarations must keep working: defaults by kind.
- A wrong declaration must not break the desk: validate and fall back.

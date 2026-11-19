# Designing graphics in OGraf Studio

[OGraf Studio](https://ografstudio.org) is a free visual editor for EBU OGraf graphics. You
draw and animate a graphic in your browser and export it as an `.ograf.zip` package. This guide
explains how to make a graphic there that works in Split Control, including in the Live desk,
with timing data, and as part of a look.

Short version: **it works, with some finishing by hand.** Studio can't write our own manifest
additions (`v_olgrafik_*`) or our timing-data file, so you add those after export. A Studio
graphic also keeps its own fixed design: it doesn't pick up the event's theme colours, logos,
club/flag setting or language the way our own looks do.

> **Status (19 November 2026).** Tested: Studio's packages import, and a Studio graphic placed
> in a look gets its Live desk entry. Not yet tested: playing a Studio graphic on air in Split
> Control, and a Studio graphic fed by timing data. Split Control first needs the fix in
> [the interop plan](superpowers/plans/2026-11-19-ograf-studio-interop.md), Task 1: until then
> Studio's Rules and text animations don't run, and graphics that use Functions don't load at
> all.

## What you can make

| Graphic | Possible? | How |
|---|---|---|
| Name strap, sponsor, title card, anything the operator types | Yes | Data fields the operator fills in from Live |
| Runner name strap (operator picks a runner) | Yes | Fields named `runnerName`, `runnerClub`, `runnerBib` plus a timing-data file |
| Event title | Yes | Fields named `title`, `series`, `place`, `date`, and the `event` feed |
| Results or start list | Partly | A list field named `results`. Shows the first rows only: no Next page |
| Course facts, weather | Likely | Same idea with the `course` or `weather` feed. Untested |
| Running clocks, relays, finish watch, runner presentations | No | These need our own graphic code (`_core`) |
| Event theme colours, logo mode, club/flag/both, English/Swedish labels | No | Design these into the graphic in Studio instead |

## 1. Set up the composition

- Canvas **1920 × 1080**, transparent background (new compositions start transparent).
- Frame rate: your production's (usually 25 or 50). Playback follows the clock, so this changes
  only how frames are snapped while you edit.
- Keep text inside the action-safe area (Studio's broadcast QA checks this). Our own graphics
  use the 93 % action-safe edge.

## 2. Name your data fields exactly like our data

Split Control sends a graphic its data by **field key**. In Studio, add each field under
**Data → Fields** and give it one of the keys below. The label can be anything; only the key
must match. Keys are case-sensitive.

| Key | Type | Filled by |
|---|---|---|
| any key you choose (`headline`, `text` …) | Text, Number, Boolean | The operator, in Live |
| `title`, `series`, `place`, `date` | Text | The event setup (`event` feed) |
| `runnerName`, `runnerClub`, `runnerBib` | Text | The runner the operator picks |
| `className` | Text | The chosen class |
| `controlName` | Text | The chosen timing point ("Finish", "Radio 2" …) |
| `results` | List | Timing data, one item per runner (below) |

Each item in `results` has these keys, which you define as the list's item fields in
**Data → Lists**:

| Key | Example | Notes |
|---|---|---|
| `position` | `1` | Empty while the runner has no place yet |
| `name` | `Tove Alexandersson` | Given name first |
| `club` | `Stora Tuna OK` | |
| `country` | `SWE` | Nation code, when the source has it |
| `bib` | `101` | |
| `time` | `34:12` | Already formatted; `--:--` when there is none |
| `diff` | `+1:24` | Behind the leader; empty for the leader |
| `statusCode` | `0` | 0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 OT |
| `startTime` | `10:42:00` | The runner's start |

Tips for lists:

- Set **Max items** to the number of rows you have room for. Split Control sends every runner
  in the class, and the list shows the first ones.
- Give the list a stable key: `name`. Rows then slide to their new place when the order
  changes.
- Use a **Rule** on `statusCode` to show "DNF", "MP" and so on instead of the time. Inside a
  list row, a rule on the list's field reads that row's own runner.

Don't send data the other way: Studio's **Data → Connections** polling is for previews in
Studio only and isn't included in the export. Split Control supplies the data.

## 3. Test with our sample data

In the [developer preview](https://opensourceorienteering.github.io/O-TV-Graphics/developers.html),
open a graphic of the same kind and copy the **More data (JSON)** box. In Studio, import it under
**Data → Test data** and step through it. Try the longest name and club you expect, and names
with accents.

## 4. Export

1. **Preview & Export → Run broadcast QA**, then fix what it reports.
2. **File → Export…**: format **OGraf ZIP**, profile **Real-time playout**.
3. Keep the `.ogs` file. It is your editable source, and the export can't always be turned back
   into it.

## 5. Add Split Control's parts

Unzip the export. You get something like this:

```
project-295afc43-…-rt.ograf.json   the manifest
main.js                            the graphic
assets/  licenses/                 fonts, images, licence texts
project-295afc43-…_thumb.png
Lower third.html                   a stand-alone preview page; delete it
```

**Rename consistently.** Split Control finds a graphic only when its manifest is named after
its folder, and the timing-data file is named after the manifest's `id`. Pick one name, such as
`mylook-guest-strap`, and use it for all three: the folder, the manifest file
(`mylook-guest-strap.ograf.json`) and the `"id"` inside the manifest. Studio's code doesn't use
the id, so changing it is safe.

**Add our fields to the manifest**, next to the existing ones:

```json
"v_olgrafik_set": "mylook",
"v_olgrafik_kind": "guest-strap",
"v_olgrafik_zone": "lower",
"v_olgrafik_desk": {
  "label": "Guest name strap",
  "short": "Guest",
  "fields": ["headline", "subheadline"]
}
```

- `v_olgrafik_zone`: where it sits (`main`, `lower`, `side`, `corner`, `full`). Graphics in
  clashing zones replace each other on air.
- `fields`: the keys the operator fills in, all of them in the manifest's `schema`.
- For data the app fills in, add `inputs`, `required` and `feeds`, for example
  `"inputs": ["class", "runner"], "required": ["runner"], "feeds": ["timing"]`. The full list of
  inputs, feeds and behaviours is in [Graphic capabilities](GRAPHIC-CAPABILITIES.md).

**For timing data, add `<id>.datasource.json`** next to the manifest. Start from a standard
graphic of the same kind and keep only the mappings for fields your graphic has. For example,
copy `templates/sets/standard/standard-runner-lower-third/standard-runner-lower-third.datasource.json`
for a runner strap, or `standard-results.datasource.json` for a results list.

## 6. Put it in a look and import it

Put the folder in your look (`templates/sets/mylook/mylook-guest-strap/`), zip the look and
import it in **Graphics library → Import look…**. Graphics library lists any problems with the
desk entry. Then open an event using the look: the graphic is in Live under its label.

Without a look, you can also import the `.ograf.zip` on its own. It then lands in the look
"custom", which Live doesn't offer yet (the plan's Task 2 changes that).

## 7. Licences

Every Studio export includes Studio's playback code under **AGPL-3.0**
(`licenses/OGRAF-STUDIO-AGPL-3.0.txt`). Split Control is MIT. You may use these graphics in your
productions. If you share a look that contains one, keep the `licenses/` folder and share the
`.ogs` source with it. Don't add Studio-made graphics to the looks in this repository without
agreeing on the licence first.

## Using Studio's AI assistant

Studio's built-in assistant and its MCP server can build a graphic from a description. Give it
the field keys from step 2 and an example `results` item, and ask for the field keys to match
exactly.

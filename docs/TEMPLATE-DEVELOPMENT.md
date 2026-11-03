# Developing graphic templates

New to graphics development? Start with the [beginner walkthrough](https://opensourceorienteering.github.io/O-TV-Graphics/developers.html#first-graphic)
for a complete welcome-card example, then use the [command and option tables](https://opensourceorienteering.github.io/O-TV-Graphics/developers.html#reference).

A look is a directory in `templates/sets/<look>/` with `set.json`, `set.js`, `theme.css`,
bundled fonts and one directory per OGraf graphic. Looks may omit graphics or add their own.
The standard catalogue currently supplies 17 reusable drawings; SOFT also has a hand-made
Runner presentations graphic. A graphic does not need a new app-side kind to appear in Live.

## Choose the appropriate extension point

- To restyle a standard graphic, keep `createGraphic('results', set)` (or another built-in
  kind) and edit the look's CSS/configuration.
- To add a graphic with different markup, use `createGraphic(kind, set, view)` in its own
  package and declare its desk controls in the manifest.
- To fetch a new type of external data, implement a new app-side feed first. A declaration
  only selects building blocks the app already understands.

The generator (`npm run generate:sets`) maintains the standard catalogue. Add hand-made
packages alongside generated packages; use unique manifest IDs and avoid a generated folder
name so regeneration leaves the package intact. Only Standard ships with the app; download
and import other looks through Graphics library.

## Declare the Live desk entry

A graphic manifest uses the normal OGraf fields and may add:

```json
{
  "v_olgrafik_set": "my-look",
  "v_olgrafik_kind": "relay-overview",
  "v_olgrafik_zone": "main",
  "v_olgrafik_desk": {
    "key": "relay-overview",
    "label": "Relay overview",
    "short": "Relay",
    "inputs": ["class", "page"],
    "required": ["class"],
    "fields": ["title", "rowsPerPage"],
    "feeds": ["timing"],
    "behaviours": ["holdOnAir", "titleFromClass"],
    "previewData": "results"
  }
}
```

Declare `title` and `rowsPerPage` in `schema.properties` as well. `inputs` determines palette
parameter order; `required` must be a subset. `fields` selects manual Live inspector fields;
`settingsFields` selects fields available only in template settings. Timing fields still come
from `<manifest-id>.datasource.json`: select the timing feed and provide the datasource mapping.
`live` is derived from the timing feed, rather than declared separately.

Known kinds inherit the existing desk entry when declarations/properties are absent, so old
look zips continue to work. Unknown kinds need a kind and label. Arrays replace inherited
arrays; `[]` clears them. `previewData: null` clears an inherited preview requirement. Invalid
or unsupported declarations fall back as a whole and appear as warnings in Graphics library;
the drawing itself can still load. See [the capability reference](GRAPHIC-CAPABILITIES.md)
for feeds, behaviours, dependencies, fallback IDs and rows partners.

The event's look determines availability. Stable desk keys retain command numbers and saved
favourites across look switches. New keys get free numbers; unavailable keys remain reserved.
Companion and `GET /api/control/graphics` use the live event's catalogue. Avoid changing a key
after publishing it, and use only one graphic for each desk key in a look.

## Supply a drawing

```js
import { createGraphic } from '../../_core/graphic.js';
import { esc } from '../../_core/util.js';
import set from '../set.js';

function relayOverview(data, context) {
  return {
    html: `<div class="panel panel--table"><div class="hdr">
      <span class="hdr-title">${esc(data.title || data.className)}</span>
    </div><div class="rows"><div class="row"><span class="c-name">
      ${esc(data.runnerName || 'Relay overview')}
    </span></div></div></div>`,
    steps: 1,
  };
}
export default createGraphic('relay-overview', set, relayOverview);
```

The synchronous view receives data and the look configuration plus `kind` and one-based
`step`. Return `html` and optional `steps`, `pageKey`, `key` and `rekey`:

- `steps`: total operator steps, at least one. Use manifest `stepCount: -1` for dynamic steps.
- `pageKey`: identity of the visible page. Steps sharing a page key patch in place; a different
  key uses the page transition. This supports focus steps without moving the entire list.
- `rekey` and `key`: time-dependent content redraws when the key changes. Use `now(data)` from
  `_core/util.js` so clocks respect simulated and frozen time.

Stable `data-key` row attributes preserve DOM identity through live updates. Escape dynamic
HTML with `esc`. Use the existing name/identity/time utilities rather than duplicating their
formatting rules. The lifecycle supplies Show, Hide, paging, ticking, live patches, scaling,
logo modes and disposal; it does not invent markup or placement for a new kind.

**New kinds need placement CSS.** Built-in positioning selectors name built-in kinds. Reuse
the look's tokens explicitly, for example:

```css
.gfx--relay-overview .panel {
  top: var(--table-top, 144px);
  left: var(--table-x, 480px);
  right: var(--table-x, 480px);
}
```

Keep row heights and list layout fixed during focus changes. Animate transform/opacity for
lifts and fades, and keep a clear focused state when reduced motion is enabled.

## Runner selection and manual steps

SOFT's `sof-runner-presentations/` is a complete custom-view example. A string-array schema
property may use `v_olgrafik_control: "runner-multi-select"` for a Live runner picker and
`v_olgrafik_default: "favourites"` to default to start-list favourites. Selection keys are
`JSON.stringify([runner.name, runner.club])`. Omit a schema default for automatic favourites;
an explicit array (including an empty array) overrides the automatic selection. Timing rows
receive the event's `favourite` flag through start-list enrichment.

`manualSteps` disables automatic page timers; `holdOnAir` defaults timing updates to held.
The presentation view uses `pageKey` so Next can lift the next chosen runner on a page before
switching pages. See [the operator sequence](RUNNER-PRESENTATIONS.md).

## Package and verify

Bundle every asset/font the look needs. `set.json.logo` supplies the library/Plan preview;
`set.js.logo` supplies template logo boxes at runtime. Standard, Bold, Brutal, Signal and
Contours use the Split Control SVG. Federation looks keep their own artwork. Keep `_core/`
out of look zips: the app supplies its compatible shared runtime.

Run from the repository root:

```sh
npm run type-check
npm test -- --run
npm run test:templates
npx vite build
bash scripts/build-site.sh /tmp/split-control-site
```

`test:templates` uses a hidden real Chromium window through Electron and a temporary loopback
server. It discovers every `.ograf.json`, imports its actual JS, loads CSS/fonts/images and
exercises Show, Next/Previous/last step, live updates, custom-logo/identity variants, empty
data, Hide and Dispose. It checks geometry and saves screenshots and `report.json` under
`os.tmpdir()/split-control-template-tests`; set `TEMPLATE_TEST_OUTPUT` to override this.
Finite transitions are finished before screenshots; this checks resolved states, not motion
smoothness or golden-image pixel matching. The SOFT focus state and start-list geometry have
explicit assertions. The test uses synthetic race data, not live timing or physical NDI.

The Vitest connected graphics test separately covers zip import, real disk managers, palette
parsing, HTTP controls and retained favourites/numbers; renderer replies are simulated there.
Together these cover the backend and browser runtime boundaries. They do not automate clicks
through the full Electron operator UI or physical Companion/NDI devices. Review screenshots
and use the app's Live desk for those final checks. Development uses port 5174 with strict
port binding, so another Vite project on 5173 cannot appear in the Electron window.

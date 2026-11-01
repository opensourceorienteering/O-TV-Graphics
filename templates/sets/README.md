# Template sets

A template set is a family of graphics that share one look. A project uses exactly one set,
so looks are never mixed in a production (the app refuses to add or play a graphic from
another set).

| Set | Look |
|---|---|
| `standard` | Standard (ships with the app): floating ink cards, a gradient accent, number chips and springy motion |
| `iof` | IOF TV graphics: red rank/time boxes, blue bars, uppercase Franklin Gothic, three-layer slide |
| `iof2` | IOF 2.0: F1-style timing tower for results and start lists, a scorebug clock top left with the IOF logo, solid near-black bars, Barlow Condensed, IOF Red wipes |
| `contours` | Contours: tinted glass plates in deep blue, drifting map contour lines (`contours.svg`), red chips and accents, uppercase family names |
| `cz` | ČO: orange and beige, after the Czech orienteering streams, italic headers with the control-circle mark |
| `classic` | The original OL-Grafik look (brick red + teal), including the original four graphics |
| `bold`, `brutal`, `signal` | Huge condensed type; neubrutalism; dark glass with an RGB-split edge |
| `sof` | Svensk Orientering, after the federation's graphic manual (version 1.0, 2026): Sverigeblå plates on the Skymningsblå gradient, Sverigegul numbers and the yellow line, triangle elements, Plus Jakarta Sans, the federation logo (`sof/logo.svg`, from the manual, unaltered) on the title card |

## Shipping and sharing looks

Only `standard` (with `_core/`) ships inside the app. The other looks are downloads: the
website's Looks page and each release offer every set as a zip, made by
`scripts/zip-looks.sh`. In the app, **Graphics library → Import look…** installs a zip and
**Export…** saves one.

- A look zip holds one set folder (`<set>/set.json`, `set.js`, `theme.css`, `fonts/`,
  `<set>-<kind>/`…); the files may also sit at the top of the zip. One zip may hold several
  looks, and OGraf graphics outside any set.
- Imported looks go to `DATAROOT/templates/sets/<set>/` and are served at the same
  `/templates/sets/<set>/` URL as built-in ones, so their graphics load the app's `_core/`.
  Keep `_core/` compatible with older looks, or ask people to download the looks again.
- An imported set with the id of a built-in set is used instead of it until it is removed.
- Graphic ids must be unique across every installed look; an import that clashes is refused.

## Layout

```
sets/
├── _core/                 shared code for every set (not a set)
│   ├── graphic.js         OGraf Web Component base: lifecycle, pages, clocks, scaling
│   ├── views.js           data -> markup for every graphic kind
│   ├── util.js            times, names, club/flag rule, club logos
│   ├── nations.js         IOC/ISO codes and names -> flags
│   ├── base.css           placement and structure shared by all themes
│   └── flags/             flag-icons SVGs (MIT)
└── <set>/
    ├── set.json           name, description, colours (read by the app)
    ├── set.js             durations, labels, name styles (read by the graphics)
    ├── theme.css          the look and the motion
    ├── fonts/             fonts.css + woff2 files (OFL)
    └── <set>-<kind>/      one OGraf package per graphic (generated)
```

The packages in `<set>-<kind>/` are generated from one catalogue:

```bash
npm run generate:sets
```

Edit `scripts/generate-template-sets.js` to add a graphic kind or a field, `_core/views.js`
for markup, and a set's `theme.css` for its look. Hand-made graphics in a set folder (like
classic's originals) are left alone by the generator; any folder with a `<name>.ograf.json`
is picked up.

## Adding a set

1. Copy a set folder (e.g. `cz`) to `sets/<new-id>/`, delete the `cz-*` graphic folders.
2. Edit `set.json`, `set.js` (change `id`) and `theme.css`.
3. Add the set to `SETS` in `scripts/generate-template-sets.js` and run `npm run generate:sets`.
4. Reload templates in the app (Graphics library → Scan library); pick the set in Plan → Theme.
   To try it in an installed app, zip the set folder and import it.

Graphic ids must be unique across sets (the generator prefixes them with the set id).

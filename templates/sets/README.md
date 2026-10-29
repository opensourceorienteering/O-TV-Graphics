# Template sets

A template set is a family of graphics that share one look. A project uses exactly one set,
so looks are never mixed in a production (the app refuses to add or play a graphic from
another set).

| Set | Look |
|---|---|
| `standard` | OL-Grafik Standard: the app's dark operator-console language, with charcoal surfaces, orange accents and restrained status colours |
| `iof` | IOF TV graphics: red rank/time boxes, blue bars, uppercase Franklin Gothic, three-layer slide |
| `cz` | Czech orienteering streams (ČO): orange/beige, italic headers with the control-circle mark; after [co-stream-gfx](https://github.com/thejoeejoee/co-stream-gfx), used with permission |
| `classic` | The original OL-Grafik look (brick red + teal), including the original four graphics |

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
4. Reload templates in the app; pick the set in Project View → Project graphics.

Graphic ids must be unique across sets (the generator prefixes them with the set id).

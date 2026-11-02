# Split Control

*Orienteering graphics for live broadcasts* (formerly OL-Grafik)

Split Control puts live orienteering results on screen: start lists, live splits at radio
controls, results, runner comparisons and more. It reads live timing data (Liveresultat,
MeOS or IOF XML), renders broadcast graphics and sends them to your production as a browser
source (OBS, vMix, CasparCG) or as an NDI source with transparency.

It runs on Windows, macOS and Linux.

## Download

Get Split Control from the website: **<https://opensourceorienteering.github.io/O-TV-Graphics/>**.
It also has the [manual](https://opensourceorienteering.github.io/O-TV-Graphics/manual.html),
the [looks](https://opensourceorienteering.github.io/O-TV-Graphics/looks.html) to download, a
[developer guide](https://opensourceorienteering.github.io/O-TV-Graphics/developers.html) with
a preview tool, and an [FAQ](https://opensourceorienteering.github.io/O-TV-Graphics/faq.html).

Until the first release, test builds are on the
[Build page](https://github.com/opensourceorienteering/O-TV-Graphics/actions/workflows/build.yml?query=branch%3Amain+is%3Asuccess):
under **Artifacts**, download `split-control-mac-arm64` (Apple Silicon Macs) or
`split-control-windows-x64` (Windows installer and portable `.exe`). You need to be signed in
to GitHub to download artifacts.

The builds are not signed yet:

- **Windows:** SmartScreen warns on first launch. Choose **More info → Run anyway**.
- **macOS:** the first launch is blocked. Right-click the app and choose **Open**.

## How it works

Everything is organised in **events**, which can be grouped in folders (a multi-day event, a
season). Each event has two modes.

### Plan

Prepare the event step by step. A checklist shows what is ready.

1. **Data source & event info:** the timing source and competition, the date and place.
2. **Output:** the outputs the event uses in Live (web output, NDI). They turn on
   automatically when the event opens in Live.
3. **Theme:** the look, colours, logos, language and how runners are shown (club, flag or
   both).
4. **Templates:** the order of graphics in the Live list, default values for each graphic,
   and which graphics to show in Live.
5. **Start lists:** refresh from the data source or import IOF XML or CSV, mark favourite
   runners, assign virtual bibs when the event has none, shorten club names, and export a PDF.
6. **Radio controls** (optional): rename controls whose names don't read well on air, for
   the whole competition or per class.
7. **Final check:** test everything, export or import settings, and go live.

### Live

The Live desk is for running the broadcast. Every graphic is triggered by hand; there is no
running order.

- **Prepare, then send:** choose a graphic, fill in its fields or recall a favourite, check
  it in **Preview**, then **Show**, **Update** or **Hide**. Preview never affects the output.
- **Live data:** graphics on air follow new results as they come in. Results tables and the
  podium can hold their data until you press Update.
- **Monitors:** Program and Preview can sit in the desk, in their own windows, or together
  on another screen.

| Key | Action |
|---|---|
| `Space` | Show / hide the selected graphic |
| `U` | Update the graphic on air with the draft |
| `H` | Hide the last graphic shown |
| `T` | Freeze / resume the running time on air (when you see the runner pass) |
| `Esc` | Hide all (in a field: leave the field) |
| `←` / `→` | Previous / next page on Program |
| `0`–`9` | Choose a graphic by its number |
| `F` | Save the draft as a favourite |
| `Ctrl/Cmd+K` | Command palette (also from a field) |
| `↑` / `↓` | Choose a graphic in the list |

**Command palette.** Type a graphic number and its parameters, for example:

- `2 3 105`: runner identity, class 3, bib 105
- `1 3 F`: live split, class 3, at the finish
- `2 F1`: runner identity, favourite F1

A hint line shows the whole command for the chosen graphic and what each part accepts.
Command numbers are the same in every event and are set in **Settings → Controls**.
Virtual bibs are found by their number alone: `105` finds V105.

## Features

- **Nine looks**, each with the same 17 graphics:
  - live split at a radio control, and a runner lower third
  - runner identity, runner focus with a running clock, and a name strap
  - start list and start group (next starters)
  - results with live position changes
  - runner split comparison and position history chart
  - podium
  - race title, course facts, weather, identity plate and commentators
  - timer

  An event uses one look. **Standard ships with the app**; the others are downloads on the
  [Looks page](https://opensourceorienteering.github.io/O-TV-Graphics/looks.html) (or
  attached to each release). Import a look's zip in **Graphics library → Import look…**;
  **Export…** saves any look as a zip to share it or move it to another computer.

  | Look | Style |
  |---|---|
  | **IOF** ⚠️ | IOF TV graphics style (IOF TV Manual for Broadcasters): red rank and time boxes, blue bars, uppercase Franklin Gothic |
  | **IOF inspired** | Inspired by the IOF brand, not an approved IOF graphic: frosted plates tinted from IOF Blue with the brand pattern drifting inside, a band of light on entry, red-over-green hairlines, Franklin Gothic Heavy, large centred results and a scorebug clock with the IOF logo |
  | **Contours** | Tinted glass in deep blue with map contour lines drifting behind, red rank chips and accents, uppercase family names |
  | **ČO** ⚠️ | Orange and beige, after the Czech orienteering streams: italic headers with the control-circle mark |
  | **Standard** | Modern and playful: floating cards with a gradient accent |
  | **Bold** | Huge condensed uppercase names on ink bands |
  | **Brutal** | Neubrutalism: flat bright fills, thick outlines, hard shadows |
  | **Signal** | Dark glass cards with an RGB-split edge |
  | **Svensk Orientering** ⚠️ | After Svensk Orientering's graphic manual (2026): Sverigeblå and Sverigegul, the yellow line, triangle elements and 45° corners, the federation logo, Plus Jakarta Sans |

  ⚠️ **Only use at approved events.** IOF, ČO and Svensk Orientering follow their federations'
  graphics; use them only at events the federation has approved. The app and the Looks page
  mark them.

  The sources of every look are in [`templates/sets/`](templates/sets/). To build your own,
  see the [developer guide](https://opensourceorienteering.github.io/O-TV-Graphics/developers.html);
  its [preview tool](https://opensourceorienteering.github.io/O-TV-Graphics/preview/) runs any
  look in the browser with a simulated race.

- **Broadcast rules built in.**
  - Clubs, flags or both, following national or international events.
  - Showing a graphic takes clashing graphics off air (a results table removes a lower
    third, but the clock stays).
  - Labels in English, Swedish, Norwegian or Czech.
- **Club logos ship with the app**, so nothing contacts Eventor during a broadcast. Add or
  replace logos as `DATAROOT/club-logos/manual/<Club name>.png` (**Plan → Theme** opens the
  folder).
- **Live data:**
  - the **Liveresultat REST API** (`api.orienteering.services`), the default, with instant
    push updates;
  - the legacy Liveresultat `api.php`;
  - **MeOS** directly, through its built-in information server: no internet or database
    needed;
  - **MeOS Online Protocol (MOP)** databases;
  - **IOF XML 3.0** result or start list files from any timing software.
- **Outputs:** a web output page for OBS Browser Source, vMix Web Input and CasparCG HTML,
  and **NDI 6** with transparency.
- **Director start alerts:** a page for the director on any device on the network,
  `http://<computer>:5657/director`.
  - Upcoming starters of chosen classes, with favourites starred.
  - Sounds for favourites, each one on or off: a heads-up (45 s before the start by
    default), start imminent (10 s by default) and start beeps.
- **Remote control:** an HTTP control API, a local [Bitfocus Companion module](companion/README.md)
  with favourite buttons and Show / Update / Hide, and the
  [EBU OGraf Server API v1](https://github.com/ebu/ograf) at `http://<computer>:5657/ograf/v1`.
  None of these have authentication: only use them on a trusted network.
- **Replay a finished race as if it were live**, to rehearse or train operators. See
  [Replay a race](docs/REPLAY-A-RACE.md).
- **Standard EBU OGraf v1 graphics.** Third-party OGraf graphics load unchanged, and ours
  work in other OGraf renderers.

## Outputs

| Output | How |
|---|---|
| **Web** | `http://<computer>:5657/output` as a browser source. Transparent background; 1920 × 1080 by default. |
| **NDI** | Choose it in **Plan → Output**. The source is called "Split Control NDI Output" by default. |

These are app-wide settings: the ports and resolution are in **Settings → General**, and
the NDI name and frame rate in **Settings → Output defaults**.

## Development

### Prerequisites

- **Node.js 22 or newer.** Node.js 24 LTS is recommended.
- **npm 10 or newer.** With npm 11+, install scripts must be approved; the NDI addon's build
  is already approved in `package.json`.
- **Build tools for the NDI addon:**
  - Windows: Visual Studio Build Tools with "Desktop development with C++".
  - macOS: Xcode Command Line Tools.
  - Linux: `build-essential`.

  NDI is optional: the app runs without it.

### Run

```bash
npm install
npm run dev
```

`npm install` downloads the NDI 6 SDK and builds the NDI addon. No separate NDI install is
needed.

> **VS Code terminals** set `ELECTRON_RUN_AS_NODE=1`, which stops Electron from opening a
> window. Use `env -u ELECTRON_RUN_AS_NODE npm run dev`.

Only one Split Control runs at a time. A new `npm run dev` takes over from an older dev
app, and a dev app quits when its dev server stops.

### Scripts

```bash
npm run dev              # Vite dev server + Electron
npm run type-check       # TypeScript
npm run lint             # ESLint
npx vitest run           # tests, once (npm test watches)
npm run build            # type-check, bundle and package for this platform
npm run generate:sets    # regenerate the template set packages from templates/sets/_core
scripts/zip-looks.sh out # zip every look for download (what the website and releases offer)
npm run companion:package
```

### Builds

[`.github/workflows/build.yml`](.github/workflows/build.yml) builds macOS (Apple Silicon)
and Windows (x64) packages on GitHub, each on its own platform, because the NDI addon can't
be cross-compiled. It runs on pushes to `main`, on version tags (`v1.2.0`) and from the
Actions tab.

**To publish a release**, set the version in `package.json`, commit, then push a matching tag:

```bash
git tag v1.2.0
git push origin v1.2.0
```

The build then creates a GitHub release with the installers and every look as a zip
(`Split-Control-look-<set>.zip`), and the website's download
buttons link to it. A tag with a suffix (`v1.2.0-beta.1`) makes a pre-release, which the
website doesn't offer.

### Website

The website (downloads, looks, manual, developer guide with the preview tool, FAQ) is plain
HTML in [`site/`](site/). [`scripts/build-site.sh`](scripts/build-site.sh) adds every look,
zipped for download and unzipped for the preview, and
[`.github/workflows/pages.yml`](.github/workflows/pages.yml) publishes it to GitHub Pages when
`site/` or a look changes on `main`. Try it locally:

```bash
scripts/build-site.sh _site && npx serve _site
```

See the [Build & Packaging Guide](docs/BUILD-PACKAGING.md) for local builds and
club logos.

### Where things are stored

| | Development (`npm run dev`) | Installed app |
|---|---|---|
| Settings | `config.json` in the project folder (git-ignored; start from [config.example.json](config.example.json)) | `config.json` in the app data folder |
| Events | `DATAROOT/` in the project folder (git-ignored) | `DATAROOT/` in the app data folder |
| Imported looks | `DATAROOT/templates/` | `DATAROOT/templates/` in the app data folder |

The app data folder is `~/Library/Application Support/OL-Grafik` on macOS and
`%APPDATA%\OL-Grafik` on Windows. It keeps its old name so existing events survive the
rename.

### Project structure

```
├── src/
│   ├── main/            Electron main process
│   │   ├── data/        Live data client (Liveresultat REST + legacy), data sources
│   │   ├── events/      Events, Plan, Live desk, start lists, control
│   │   ├── output/      Web server, NDI, control, director and OGraf APIs
│   │   ├── playback/    Playback engine and live updates
│   │   ├── templates/   OGraf discovery and validation, template sets
│   │   └── ipc/         IPC handlers
│   ├── renderer/
│   │   ├── control/     Control app (React): events, Plan, Live desk, settings
│   │   ├── graphics/    Graphics renderer
│   │   └── web-output/  Browser source page
│   ├── preload/
│   └── shared/          Types and logic shared by main and renderer
├── templates/sets/      Looks (template sets); shared code in _core/. Only standard/ ships
│                        with the app; the others are zipped for download
├── club-logos/          Bundled Eventor club logos
├── companion/           Bitfocus Companion module
├── public/              Director page and other static pages
├── site/                Website (GitHub Pages): downloads, looks, manual, developer guide,
│                        preview tool, FAQ
├── scripts/             Packaging, template sets, club logos, race replay
└── docs/
```

## Documentation

- [Manual](https://opensourceorienteering.github.io/O-TV-Graphics/manual.html) and
  [FAQ](https://opensourceorienteering.github.io/O-TV-Graphics/faq.html) on the website
- [Developer guide](https://opensourceorienteering.github.io/O-TV-Graphics/developers.html):
  build and test your own looks
- [Replay a race](docs/REPLAY-A-RACE.md): rehearse with a finished race played back live
- [Build & Packaging Guide](docs/BUILD-PACKAGING.md)
- [Template sets](templates/sets/README.md)
- [Companion module](companion/README.md)

## Not yet implemented

- Manual and CSV data sources for live results (start lists can already be imported from
  CSV).
- GPS tracking. Tracking providers (Livelox, Loggator and others) each have their own API,
  and there is no shared standard yet.

## Acknowledgments

- [EBU OGraf](https://ograf.ebu.io), the open graphics standard
- [Liveresultat](https://liveresultat.orientering.se), for the orienteering results API
- [Stagetimer](https://github.com/stagetimerio/grandiose), for the grandiose NDI bindings

## License

The package is marked MIT in `package.json`, but the repository has no LICENSE file yet.

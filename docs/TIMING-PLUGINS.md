# Timing plugins

Split Control reads live timing data through **timing plugins**. A plugin connects one kind of
timing source (a timing program, a database, a file, an online service) to a fixed set of
**base tags** that every graphic uses. Graphics never need to know which source the data came
from.

There are two kinds of plugin:

- **SQL profile:** a YAML file of queries for a MySQL/MariaDB database. You write no code:
  Split Control owns the database driver, the connection settings and the safety rules, and the
  profile says what to read.
- **Code plugin:** a small JavaScript module, for sources that are not a database or need logic
  that SQL cannot express (an HTTP API, a file format, a push connection).

The sources built into Split Control are plugins too: **Liveresultat**
([`liveresultat/`](../src/main/data/timing/liveresultat)), **MeOS (information server)**,
**MySQL/MariaDB (MeOS Online Protocol)**, which is the SQL profile
[`meos-mop.yaml`](../src/main/data/timing/profiles/meos-mop.yaml), and **IOF XML 3.0 file**.
Inside, Split Control knows no source's own format: everything arrives as the model below.

## How it fits together

```
 timing source ──► plugin ──► facts (timing SDK model) ──► timing hub ──► standings ──► base tags ──► graphics
                    SQL profile or code                     caching, polling,  (ms, epoch)   results[].position,
                                                            push, ranking                    name, club, time,
                                                                                             diff, splitTimes …
```

A plugin **reports facts**: who started when, who finished in what time, who passed which radio
control when, and their status. Split Control works out everything that follows from those facts,
the same way for every source: places and ties, time behind, split places and time behind,
progress, relay team-perspective times, start and running clocks. Never compute places in a
plugin.

The one exception is an **official results service** whose published standings are the ones the
public sees (Liveresultat is one). Such a source passes its own standings with the facts; see
[Official standings](#official-standings).

## Installing a plugin

1. In **Settings → Data sources**, press **Open plugins folder** under *Timing plugins*.
   The folder is `timing-plugins` in Split Control's user data folder (`%APPDATA%\OL-Grafik` on
   Windows, `~/Library/Application Support/OL-Grafik` on macOS, `~/.config/OL-Grafik` on Linux).
2. Copy the plugin into it: an SQL profile file (`something.yaml`), a folder with a
   `profile.yaml`, or a code plugin folder (with `index.js`, or a `package.json` whose `main`
   points at the plugin).
3. Press **Reload**. The plugin is listed with its version and the extra fields it provides.
   A plugin that cannot load is listed with the reason, and the others still load.
4. **Add data source** now offers the plugin as a type, with its settings form.

> Plugins run inside Split Control with full access to the computer. Only install plugins
> you trust. SQL profiles are safer: they can only run read-only `SELECT` queries.

A plugin's `id` is saved as the source type in events. Keep it stable between versions. A
plugin cannot use the id of a built-in source (`meos`, `mysql`, `iofxml`, `liveresults`).

## The timing SDK model (version 1)

The full contract, with comments, is in [`src/shared/timing-sdk/index.ts`](../src/shared/timing-sdk/index.ts).

- **Instants** (start, finish, passing time) are epoch milliseconds, UTC.
  **Durations** are milliseconds. SQL profiles convert units for you (`units`).
- **Ids** are strings and must be stable: saved events refer to competition ids, and graphics
  follow runners by id.

| Type | Fields |
|---|---|
| `Competition` | `id`, `name`, `date` (`YYYY-MM-DD`), `timezone` (IANA), `organiser`, `location`, `ext` |
| `ClassInfo` | `id`, `name`, `order`, `kind` (`individual` / `relay`), `legs`, `course` (`lengthM`, `climbM`, `controls`), `radioControls`, `ext` |
| `Control` | `id`, `code`, `visit` (1 = first visit), `name`, `leg` (relays), `ext` |
| `Entry` | `id`, `classId`, `name` (`full`, `given`, `family`), `club` (`name`, `short`, `country`), `bib`, `country`, `status`, `ranked`, `start`, `finish`, `time`, `passings`, `team`, `changedAt`, `ext` |
| `Passing` | `controlId`, and `at` (instant) or `time` (the runner's own running time); relays may give `teamTime` instead |
| `Entry.team` | `id`, `name`, `bib`, `start` (the team's start), `leg`, `time` (team total at the end of this leg, if known) |
| `Competition.clockShiftHours` | only for sources that give a clock shift instead of a time zone (Liveresultat's legacy `timediff`) |

**Status** is one of `notStarted`, `running`, `ok`, `okNoTime`, `mispunch`, `dnf`, `dsq`,
`overtime`, `dns`, `cancelled`, `movedUp`, `notCompeting` (left out of every list).
`ranked: false` shows a runner who is out of competition without a place.

### Official standings

Optional, and only for a source whose own published standings must be shown exactly as published.
Give each entry a `standing` (`place`, `tied`, `behind`, `progress`) and each passing a `standing`
(`place`, `behind`, and `status` = the runner's status at that control). When any entry of a class
has one, Split Control keeps the source's order and standings for that class and works nothing
out. A source that gives a time of 0 (for example for a runner who did not start) keeps it.

**Relays:** report one entry per runner and leg, with `team`. Split Control shows each leg as
the class `<Class>-<leg>`, timed from the team's start, with the team name as the club.
`time` is the runner's own leg time; give `team.time` when the source knows the team's total.

## Base tags

What graphics bind to (in `.datasource.json` field mappings, see
[TEMPLATE-DEVELOPMENT.md](TEMPLATE-DEVELOPMENT.md)). Every source provides them; the full,
test-checked list is the [base tag library](BASE-TAGS.md) (generated from
`src/shared/baseTags.ts`). A plugin never produces base tags itself: it reports facts, and
Split Control makes the tags from them, the same way for every source.

## Extra fields

When a source has data that is not a base tag (GPS speed, heart rate, a class sponsor), put it in
`ext` and declare it in the plugin's `extFields`:

```js
extFields: [
  { key: 'heartRate', on: 'entry', type: 'number', label: 'Heart rate', unit: 'bpm' },
  { key: 'sponsor',   on: 'class', type: 'string', label: 'Class sponsor' }
]
```

Graphics read them under the plugin's id, so two plugins never collide and no plugin can
overwrite a base tag:

- per runner: `results[].x.<plugin-id>.<key>`, e.g. `results[0].x.json-file.heartRate`
- per class or competition: `x.<plugin-id>.<key>`, e.g. a field mapping
  `{ "templateField": "sponsor", "apiPath": "x.my-plugin.sponsor" }`
  (a class field wins over a competition field with the same key)

A graphic that needs extra fields lists them in its desk declaration
([GRAPHIC-CAPABILITIES.md](GRAPHIC-CAPABILITIES.md)) as `sourceFields`. The Live desk then marks
the graphic, and says which fields are missing, when the event's source does not provide them.

## SQL profiles

A profile is a YAML file. Complete examples:
[`meos-mop.yaml`](../src/main/data/timing/profiles/meos-mop.yaml) (the built-in MeOS MOP source,
individual and relay) and [`examples/simple-club-db.yaml`](timing-plugins/examples/simple-club-db.yaml).

```yaml
id: club-db                 # lowercase letters, digits, hyphens; saved in events
name: Club timing database
version: 1.0.0
sdk: ^1.0
driver: mysql               # MySQL and MariaDB
timezone: Europe/Stockholm  # default event zone; the source's settings can override it
pollMs: 2000                # fastest useful poll interval (minimum 1000)

units:
  time: seconds             # durations: ms | hundredths | tenths | seconds
  clock: datetime           # instants: datetime | epochMs | epochSeconds | sinceMidnight
                            #   sinceMidnight = time units since 00:00 of the competition day

statusMap:                  # source status value -> SDK status (omit if the column holds SDK statuses)
  OK: ok
  GUEST: { status: ok, ranked: false }
  default: { ifPassings: running, else: notStarted }

transforms:
  controlId: { visitEncoding: { base: 100000 } }   # id = control + base * (visit - 1), as MeOS does

options:                    # extra settings in the source's form; queries read them as :name
  type: object
  properties:
    season: { type: integer, title: Season, default: 2026 }

extFields:
  - { key: guest, on: entry, type: boolean, label: Guest runner }

queries:
  competitions: SELECT …    # required
  classes: SELECT …         # required
  entries: SELECT …         # required
  radioControls: SELECT …   # optional
  relayEntries: SELECT …    # optional: used instead of entries for relay classes
  passings: SELECT …        # optional: radio punches of the entries
  latestPassings: SELECT …  # optional: newest passings first, for the passings feed
```

**Column names choose the field.** Use `AS` to name each column after the SDK field; quote dotted
names with backticks: `` o.name AS `club.name` ``, `` t.st AS `team.start` ``. A column named
`ext.<key>` becomes an extra field. Columns with other names are ignored.

| Query | Parameters | Columns |
|---|---|---|
| `competitions` | options | `id`, `name`, `date`, `timezone`, `organiser`, `location`, `ext.*` |
| `classes` | `:competitionId` | `id`, `name`, `order`, `legs` (above 0 = relay), `` `course.lengthM` ``, `` `course.climbM` ``, `` `course.controls` ``, `ext.*` |
| `radioControls` | `:competitionId`, and `:classId` to run once per class | `classId` (when run for the whole competition), `id`, `code`, `visit`, `name`, `leg` |
| `entries` / `relayEntries` | `:competitionId`, `:classId` | `id`, `` `name.full` `` or `` `name.given` `` + `` `name.family` ``, `` `club.name` ``, `` `club.short` ``, `` `club.country` ``, `bib`, `country`, `status`, `ranked`, `start`, `finish`, `time`, `changedAt`, `ext.*`; relays also `` `team.id` ``, `` `team.name` ``, `` `team.bib` ``, `` `team.start` ``, `` `team.leg` ``, `` `team.time` `` |
| `passings` | `:competitionId`, `:classId`, `:entryIds` (use `IN (:entryIds)`) | `entryId`, `controlId`, `time` or `at` |
| `latestPassings` | `:competitionId`, `:limit` | `entryId`, `classId`, `controlId`, `at` |

Every query can also read the profile's `options` as `:name`. Connection settings (host, user,
password) are never visible to queries.

**Safety.** Split Control checks every query when the profile loads and again when it runs:
only a single `SELECT` (or `WITH … SELECT`) is allowed, and no `INTO`, locks or sleeps. The
connection itself is opened read-only, each query has a 10-second timeout, and a query that
returns more than 50,000 rows fails. Parameters are always sent as bound values, never pasted
into the SQL. Use a database user that can only `SELECT` all the same.

**Testing a profile.** Add a source of the profile's type, press **Test**, then pick the
competition in an event. A query error names the query and quotes the database's message. The
built-in profile is tested against a real MeOS database dump in
[`meosMopProfile.test.ts`](../src/main/data/timing/__tests__/meosMopProfile.test.ts); the same
approach (load a dump into SQLite) works for your own profile.

## Code plugins

A code plugin is a CommonJS module exporting `{ manifest, create }`. A complete example that reads
a JSON file, watches it for changes and provides an extra field:
[`examples/json-file`](timing-plugins/examples/json-file/index.js).

```js
module.exports = {
  manifest: {
    id: 'my-source',
    name: 'My timing source',
    version: '1.0.0',
    sdk: '^1.0',
    configSchema: {               // the settings form
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', title: 'Server', format: 'url' },
        apiKey: { type: 'string', title: 'API key', format: 'password' },
        pollIntervalMs: { type: 'integer', title: 'Poll interval (ms)', default: 2000, minimum: 500 }
      }
    },
    capabilities: { push: false, minPollMs: 2000, passings: false, relays: true, courses: false },
    extFields: []
  },

  create(config, ctx) {
    return {
      async connect() { /* throw an Error telling the operator what to fix */ },
      close() {},
      async competitions() { return [/* Competition */]; },
      async classes(competitionId) { return [/* ClassInfo */]; },
      async entries(competitionId, classId) { return [/* Entry: every runner, every leg */]; },
      // Optional:
      // async passings(competitionId, limit) { return [/* LatestPassing, newest first */]; }
      // async competition(competitionId) { /* one competition, cheaper than the list */ }
      // async classDetails(competitionId, classId) { /* radioControls / course known only with the entries */ }
      // watch(competitionId, classIds) { /* push sources: the classes being polled now */ }
      // minPollMs() { /* fastest useful poll interval when it depends on the connection */ }
      // async clockOffsetMs() { /* the source's clock minus this computer's */ }
      // describe(competitionId) { return { api: 'rest', pushConnected: true }; } // status display
    };
  }
};
```

`ctx` gives the plugin:

- `ctx.log.debug/info/warn/error(message, meta)`: writes to Split Control's log, tagged with the
  plugin id.
- `ctx.changed(competitionId, classId?)`: for push sources (`capabilities.push`). Split Control
  refetches the class (or the whole competition) at once. Polling continues as the fallback.
- `ctx.fetch`: the standard `fetch`.
- `ctx.mysql({ host, port, database, user, password, ssl })`: Split Control's own read-only
  MySQL/MariaDB connection with named parameters (`query(sql, { name: value })`), so a plugin
  does not have to bundle a database driver.

Split Control caches, polls and detects changes; a plugin only has to answer the four calls. Calls
can come often (every poll), so cache in the plugin when the source is slow, as the MeOS information
server plugin does. Calls for the same class that overlap share one call to the plugin.

Settings are filled with the schema's defaults and number fields are converted before `create`
is called. Required settings are checked when the source connects, with a message that names the
setting.

### Versions

`sdk` is the range of timing SDK versions the plugin was written for. Split Control loads a plugin
when the major version matches (this release implements **1.0.0**). Within a major version the
model only grows: new optional fields, never renamed or removed ones.

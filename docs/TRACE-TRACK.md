# Trace / Track (GPS) in Split Control

[Trace / Track](https://github.com/opensourceorienteering/GPS-Trace-Track) tracks runners by GPS for
orienteering TV. Split Control reads its data API and puts each runner's heart rate, pace, speed,
position and signal next to the official results, so graphics can show them beside places and times.

Trace / Track is an **additional source**: the event's timing source (Liveresultat, MeOS, IOF XML …)
still decides who is in a class, places, times and statuses. Trace / Track only adds its own fields,
under `results[].x['trace-track']`. Its GPS passings and finishes are estimates and are never used
as results. See [Additional sources](TIMING-PLUGINS.md#additional-sources-gps-and-other-extra-data).

## Set it up

1. **In Trace / Track Admin**, open the event › **Overview** › **Data for other software** and
   create a read key, named after Split Control. The key (`ttr_…`) is shown once: copy it. It reads
   only that event and stops working when you revoke it there. The panel also shows the **event ID**.
2. **In Split Control**, **Settings → Data sources → Add data source**, type **Trace / Track (GPS)**:
   - **Server**: `https://tracetrack.openorienteering.com`, or your own server's address.
   - **Event ID** and **Read key** from step 1. The key is stored in plain text in `config.json`,
     like other data source passwords.
   - **Timeline**: `program` (default) gives each runner as Trace / Track's Program map shows them,
     with its broadcast delay or replay, so graphics match the map. `live` gives the live time.
   - **Follow the live stream** (default on): graphics update as soon as Trace / Track sends new
     values (every **Update every** interval, 1–10 s). Polling stays as the fallback.
   - **Virtual standings (experimental)**: see below. Off by default.
   - Press **Test**.
3. **In the event**, **Plan → Choose event data → Additional sources → Add**, choose the Trace / Track
   source. Leave **Competition id** empty (a Trace / Track source has one event).

Runners are matched to the timing source's by **bib**, then **name and club**, then **name** when it
is unique on both sides. Relay runners match with their team's name and bib. Classes do not have to
be named alike. A runner Trace / Track does not know simply gets no fields.

If Trace / Track is slow or offline, graphics still go out with the official results and the last
values Trace / Track sent (after at most 3 seconds).

## Fields for graphics

Every value Trace / Track does not have (no position yet, no heart-rate strap …) is left out, so a
graphic can tell "no data" from zero. The plugin id has a hyphen: in a graphic's JavaScript, read
the fields as `runner.x?.['trace-track']?.heartRate`.

| Field | Type | Unit | Meaning |
|---|---|---|---|
| `heartRate` | number | bpm | Heart rate |
| `maxHeartRate` | number | bpm | Highest heart rate since the start |
| `averageHeartRate` | number | bpm | Average heart rate since the start |
| `speed` | number | m/s | Speed |
| `speedKmh` | number | km/h | Speed |
| `pace` | number | s/km | Pace |
| `paceText` | string |  | Pace as min:ss per km |
| `heading` | number | ° from north | Direction of travel |
| `lat` | number |  | Latitude |
| `lon` | number |  | Longitude |
| `positionTime` | number | epoch ms | Time of the position |
| `signal` | string |  | GPS signal: live, lost or none |
| `signalAge` | number | s | Seconds since the last position |
| `battery` | number | % | Tracker battery |
| `accuracy` | number | m | GPS accuracy |
| `onProgram` | boolean |  | Shown on Trace / Track's Program map now |
| `lowerThird` | boolean |  | In Trace / Track's lower third now |
| `color` | string |  | The runner's colour on the map |
| `time` | number | epoch ms | The moment the values describe |

### Virtual standings (experimental)

With **Virtual standings** on, Split Control also reads Trace / Track's class analysis (one request
per class each update). These are **estimates from GPS, never results**: Trace / Track compares
runners at a common point on the course, by straight lines between controls. They need calibration
on recorded races before on-air use, and a value is left out whenever Trace / Track withholds it
(stale GPS, an unsupported comparison, a runner off the course).

| Field | Type | Unit | Meaning |
|---|---|---|---|
| `virtualRank` | number |  | Estimated rank: behind the best time to where the runner is now (experimental) |
| `virtualGap` | number | ms | Estimated time behind the best to where the runner is now (experimental) |
| `virtualFieldSize` | number |  | Runners compared for the estimated rank |
| `progressPercent` | number | % | Course progress, straight control to control (experimental) |
| `progressState` | string |  | tracking, gps-finished, timing-finished or unavailable |
| `lastControl` | number |  | Last control passed by GPS (course index) |
| `nextControl` | number |  | Next control (course index) |
| `arrivalTime` | number | epoch ms | Estimated arrival at the next control (experimental) |
| `arrivalIn` | number | ms | Time to the estimated arrival |
| `paceRecent` | number | s/km | Pace over the last minute |
| `paceChange` | number | s/km | Change from the minute before (negative: faster) |
| `legPace` | number | s/km | Pace on the current leg |
| `timeLost` | number | ms | Estimated time lost on completed legs (experimental) |
| `courseDistance` | number | m | Course metres covered, straight control to control (experimental) |
| `courseLength` | number | m | Course length, straight control to control |

### The class leader's progress (experimental)

With **Virtual standings** on, Split Control also reads Trace / Track's `leader-progress` for each
class and adds the leader under the class's own fields, `x['trace-track']` (not on a runner). The
leader is whoever leads the virtual standings at a point at least one other runner has also reached;
before anyone has been compared, the runner furthest along (`leaderBasis` says which).

| Field | Type | Unit | Meaning |
|---|---|---|---|
| `leaderName` | string |  | The class leader (experimental) |
| `leaderId` | string |  | The class leader's Trace / Track runner id |
| `leaderPercent` | number | % | The class leader's course progress (experimental) |
| `leaderDistance` | number | m | The class leader's course metres covered |
| `leaderCourseLength` | number | m | The class leader's course length |
| `leaderState` | string |  | The leader's tracking, gps-finished or timing-finished |
| `leaderBasis` | string |  | standings: leads the virtual standings; furthest: furthest along (nobody compared yet) |
| `leaderGap` | number | ms | The leader's estimated gap (0 when leading the standings) |

## Using the fields in a graphic

List them in the graphic's desk declaration so the Live desk can say when the event's sources lack
them ([GRAPHIC-CAPABILITIES.md](GRAPHIC-CAPABILITIES.md)):

```json
"v_olgrafik_desk": { "label": "Runner pace", "inputs": ["class", "runner"], "feeds": ["timing"],
  "sourceFields": ["results[].x.trace-track.heartRate", "results[].x.trace-track.paceText"] }
```

The runner rows (`results`) already carry the fields; map `results` in `.datasource.json` as usual.

## GPS tower

**GPS tower** is a ready-made graphic for the virtual standings, in every look except IOF and ČO:
an F1-style tower with the class in Trace / Track's estimated order, the gap to the estimated
leader ("+1:01"), and a thin line under each row for the runner's course progress.

- It needs Trace / Track as an additional source with **Virtual standings** on; its desk entry
  lists `virtualRank` and `virtualGap` as source fields, so the Live desk says when they're missing.
- Rows: `virtualRank` order. The leader reads **Leader**; runners with `progressState`
  `timing-finished` carry the finish mark (F); runners whose `signal` is `lost` and whose rank
  Trace / Track withholds go to the bottom, dimmed, marked **GPS**.
- Positions are counted on the tower (1, 2, 3 …), so a rank Trace / Track withholds leaves no gap.
- Overtakes get an arrow (▲2, ▼1) for **Arrows shown** seconds (10). Only overtakes count: a
  runner joining or leaving the tower moves no one's arrow. Moves within that time add up.
- **Rows** sets the length (10); a runner picked in Live stays on the tower, highlighted.
- The header and footer say **Estimated**. It is an estimate from GPS, never a result.
- The website preview's simulated race sends the same fields, so a look can style the tower
  without a Trace / Track server.

**How the ranks are made.** Split Control asks Trace / Track for `comparison=own-point`: each
runner is ranked where they are now (the finish once finished), against the best time any runner
took to reach that point, and only a runner without a usable GPS crossing of their own point is
left out. A runner furthest out leads where they are until someone reaches that point faster,
like the first runner through a radio control. Trace / Track servers from before this option
(added with the GPS tower, November 2026) ignore it and rank everyone at one common point, the
least advanced runner's, which in an interval start means near the start: update Trace / Track
before using the tower. The response's `model.standings` says which one was used
(`behind-best-at-own-progress` or `elapsed-at-common-progress`).

## Course progress and Pace and heart rate

Two lower thirds for one runner, in every look except IOF and ČO:

- **Course progress**: the runner's progress along the course (`progressPercent`) as a bar, the
  class leader's progress (`x['trace-track'].leaderPercent`) marked on the same bar with their
  name, and the distance to go (`courseLength − courseDistance`), or Finish. Needs
  **Virtual standings** on. The leader's own bar has no marker. Says Estimated.
- **Pace and heart rate**: heart rate (the heart icon beats at the runner's rate), pace per km with
  the change over the last minute (▲ faster, ▼ slower; `paceChange` needs Virtual standings), speed,
  and average and highest heart rate below. Readings Trace / Track lacks are left out; with none it
  says GPS. Works without Virtual standings.

Both take a class and a runner in Live. The website preview's simulated race sends the fields.

## Checking it against a real Trace / Track server

The tests use a stand-in that follows Trace / Track's data API. Before an event, check against a
real server (an event replayed with Trace / Track's **Event testing** works well):

1. Create a read key for the event and add the data source; **Test** succeeds.
   A wrong key, another event's key and a wrong event ID each give their own message.
2. Add it as an additional source to an event whose timing source has the same runners.
3. Put a results graphic on air. In the preview's **More data (JSON)**, runners have
   `x["trace-track"]` with heart rate, pace and position; runners without a bib match by name.
4. Values change on air every few seconds without anything else changing (the stream is connected:
   the log shows no "stream interrupted").
5. Switch **Virtual standings** on: `virtualRank`, `progressPercent` and `arrivalIn` appear where
   Trace / Track computes them.
6. Revoke the key in Trace / Track Admin: the log says the stream ended, and the official results stay
   on air with the last values.
7. Stop the Trace / Track server: graphics keep updating from the timing source.

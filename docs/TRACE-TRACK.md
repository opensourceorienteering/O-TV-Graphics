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
| `virtualRank` | number |  | Estimated rank at a common course point (experimental) |
| `virtualGap` | number | ms | Estimated time behind at that point (experimental) |
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
- **Rows** sets the length (10); a runner picked in Live stays on the tower, highlighted.
- The header and footer say **Estimated**. It is an estimate from GPS, never a result.
- The website preview's simulated race sends the same fields, so a look can style the tower
  without a Trace / Track server.

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

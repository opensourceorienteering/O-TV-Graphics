# Base tags

<!-- Generated from src/shared/baseTags.ts by the base tag tests (UPDATE_BASE_TAGS=1). Do not edit by hand. -->

Every field Split Control gives graphics, whatever the timing source: Liveresultat, MeOS,
a MOP database, IOF XML or a timing plugin. Tests check that every built-in source gives
exactly these fields with these types. Fields a timing plugin adds are under `x.<plugin>`
and `results[].x.<plugin>` ([TIMING-PLUGINS.md](TIMING-PLUGINS.md#extra-fields)).

Map them in a graphic's `.datasource.json` ([TEMPLATE-DEVELOPMENT.md](TEMPLATE-DEVELOPMENT.md));
the preview tool's **More data (JSON)** box shows and edits them.

## Timing

Every graphic with the timing feed (a `.datasource.json` with `provider: "timing"`) gets these for the chosen class and timing point.

| Tag | Type | Description | When |
|---|---|---|---|
| `className` | string | The class shown. Relay legs are classes of their own ("Mixed-2"; show them with `classLabel()`). Empty when the graphic combines every class. Example: `H21`. | always |
| `competitionName` | string | The competition's name (the event's override when set). | when the source names the competition |
| `competitionDate` | string | The competition day, YYYY-MM-DD. Example: `2026-06-30`. | when the source knows it |
| `competitionTimeZone` | string | IANA time zone start times are read in. Example: `Europe/Stockholm`. | when the date is known |
| `competitionTimediff` | number (hours) | Extra hours on top of the zone (Liveresultat's legacy offset); almost always 0. | when the date is known |
| `raceLocation` | string | The event's place, from the event settings. | when set |
| `controlCode` | string | The timing point: "" or "F" for the finish, "Start" for start times, or a radio control's code (see `splitControls`). Example: `1062`. | always |
| `controlName` | string | "Finish", "Start" or the radio control's name. Example: `Radio 2`. | always |
| `splitControls` | array | The class's radio controls in course order. | always |
| `splitControls[].code` | number | Control code as Split Control numbers it: 1000 × visit + the code on the map (1062 = first visit to 62, 2062 = second). Example: `1062`. | always |
| `splitControls[].name` | string | The control's name (Plan → Radio controls can rename it). | always |
| `clockOffsetMs` | number (ms) | Timing source clock minus this computer's clock. Running time now = `Date.now() + clockOffsetMs - startTimeMs`. | always |
| `dataTimestamp` | number (epoch ms) | When this data was put together. | always |
| `x` | object | Fields timing plugins add for the class and competition: `x.<plugin>.<key>` (docs/TIMING-PLUGINS.md). | when the source's plugin declares class or competition fields |

## Runners: `results[]`

The runners of the class at the chosen timing point, in display order. Placed runners first; at a radio control, by place there; for start times, in start order.

| Tag | Type | Description | When |
|---|---|---|---|
| `results` | array | The runners (see the list below). | when the class has runners |
| `results[].position` | string / number | Place at the timing point: "1", "2" …, "=" for the same place as the runner before, "" when not placed (running, not started, MP, DNF …). In start lists the start order. Example: `1`. | always |
| `results[].name` | string | The runner. | always |
| `results[].club` | string | Club (short name when the source has one). Relays: the team. | always |
| `results[].country` | string | Nation code (IOC or ISO). Example: `SWE`. | when the source has it (IOF XML, MeOS) |
| `results[].bib` | string | Bib number, from the event's start list (Plan → Start lists). Virtual bibs never reach graphics. | when the start list has one |
| `results[].favourite` | boolean | Marked as a favourite in the event's start list. | when the runner is in the start list |
| `results[].note` | string | The operator's note from the start list. | when there is one |
| `results[].time` | string | Time at the timing point (h:mm:ss or m:ss); "--:--" for none; the start time in start lists. Example: `31:47`. | always |
| `results[].diff` | string | Behind the leader at the timing point ("+1:23"); "" for the leader and runners without a time. Example: `+1:23`. | always |
| `results[].status` | string | Status text for `statusCode`: "OK", "DNS", "DNF", "MP", "DSQ", "OT", "WO", "Moved up", or "" while not started or running. | always |
| `results[].statusCode` | number | Status: 0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 overtime, 9 not started, 10 running, 11 walkover / cancelled, 12 moved up, 20 OK without time. At a radio control, 0 for runners who have passed it. | always |
| `results[].progress` | number (%) | Share of the course done: radio controls passed, 100 once finished or out. | always |
| `results[].className` | string | The runner's class (useful when the graphic combines every class). | always |
| `results[].startTime` | string | Start time of day (h:mm:ss); "0:00" when unknown. Example: `10:02:00`. | except in start lists, where `time` is the start time |
| `results[].startTimeMs` | number (epoch ms) | The runner's own start (relays: the changeover). Use for running clocks. | when the start time and competition date are known |
| `results[].teamStartTimeMs` | number (epoch ms) | Relays: when the team started; times and splits count from it. `clockStartMs(r)` from `_core/util.js` picks the right start. | relay legs after the first, when the source knows the team's start |
| `results[].finishTimeMs` | number (ms) | The result as a duration (relays: from the team's start). | finished with status OK |
| `results[].clubLogo` | string | Address of the club's logo (bundled or Plan → Theme). | when there is a logo for the club |
| `results[].splitTimes` | array | Times at the radio controls (see below). | when the class has radio controls |
| `results[].x` | object | Fields timing plugins add for the runner: `results[].x.<plugin>.<key>`. | when the source's plugin declares runner fields |

## Split times: `results[].splitTimes[]`

A runner's times at the class's radio controls they have passed, in course order. Relays: from the team's start.

| Tag | Type | Description | When |
|---|---|---|---|
| `results[].splitTimes[].code` | number | The control (as in `splitControls`). | always |
| `results[].splitTimes[].time` | number (hundredths) | Time at the control. | always |
| `results[].splitTimes[].place` | number | Place at the control; 0 when not ranked there. | always |
| `results[].splitTimes[].timeplus` | number (hundredths) | Behind the best time at the control. | always |
| `results[].splitTimes[].status` | number | Status at the control (0 = passed normally). | always |

## Relay line-up: `relayLegs[]`

Only for graphics whose `.datasource.json` maps `relayLegs`: the selected runner's team on every leg of the relay. Times are hundredths of a second from the team's start.

| Tag | Type | Description | When |
|---|---|---|---|
| `relayLegs` | array | One item per leg, in leg order. | mapped, relay class, runner chosen |
| `relayLegs[].leg` | number | Leg number. | always |
| `relayLegs[].className` | string | The leg's class ("Mixed-2"). | always |
| `relayLegs[].controls` | array | The leg's radio controls in course order. | always |
| `relayLegs[].controls[].code` | number | Control code (as in `splitControls`). | always |
| `relayLegs[].controls[].name` | string | Control name. | always |
| `relayLegs[].runner` | object | The team's runner on the leg; null when not known yet. | always |
| `relayLegs[].runner.name` | string | The runner. | always |
| `relayLegs[].runner.club` | string | The team. | always |
| `relayLegs[].runner.status` | number | Status code (as `statusCode`). | always |
| `relayLegs[].runner.result` | number (hundredths) | The team's time at the end of the leg; 0 until then. | always |
| `relayLegs[].runner.place` | number | The team's place at the end of the leg; 0 when not placed (or tied). | always |
| `relayLegs[].runner.timeplus` | number (hundredths) | Behind the best team at the end of the leg. | always |
| `relayLegs[].runner.legTime` | number (hundredths) | The runner's own time on the leg; 0 until known. | always |
| `relayLegs[].runner.legPlace` | number | Rank of the leg time among all teams; 0 until known. | always |
| `relayLegs[].runner.legTimeplus` | number (hundredths) | Behind the fastest leg time. | always |
| `relayLegs[].runner.splits` | array | The team's times at the leg's radio controls. | always |
| `relayLegs[].runner.splits[].code` | number | Control code. | always |
| `relayLegs[].runner.splits[].time` | number (hundredths) | Time at the control. | always |
| `relayLegs[].runner.splits[].place` | number | Place at the control. | always |
| `relayLegs[].runner.splits[].timeplus` | number (hundredths) | Behind the best team at the control. | always |

## Runner in focus

Values the operator chose in Live (runner search, palette), passed on to the graphic.

| Tag | Type | Description | When |
|---|---|---|---|
| `runnerName` | string | The runner in focus (lower thirds, runner identity, focus steps). | when chosen |
| `runnerClub` | string | Their club or team. | when chosen |
| `runnerBib` | string | Their bib. | when chosen |

## Course (`course` feed)

Course facts for the chosen class, when the timing source has them (IOF XML), or typed by the operator.

| Tag | Type | Description | When |
|---|---|---|---|
| `title` | string | The class name, as the title. | with the course feed |
| `length` | string (km) | Course length, one decimal. Example: `5.4`. | when known |
| `climb` | string (m) | Climb. Example: `120`. | when known |
| `controls` | string | Number of controls. Example: `18`. | when known |

## Weather (`weather` feed)

Conditions at the venue, read again while the graphic is on air; the operator can type over them.

| Tag | Type | Description | When |
|---|---|---|---|
| `condition` | string | Conditions in words. | with the weather feed |
| `temperature` | string (°C) | Temperature. | with the weather feed |
| `wind` | string (m/s) | Wind speed. | with the weather feed |
| `humidity` | string (%) | Relative humidity. | with the weather feed |

## Event and theme (every graphic)

Added to every graphic's data.

| Tag | Type | Description | When |
|---|---|---|---|
| `event` | object | The event (Plan → Event info). | always |
| `event.name` | string | Event name (the override, the competition, or ""). | always |
| `event.location` | string | Place. | always |
| `event.date` | string | Date, YYYY-MM-DD. | always |
| `event.series` | string | Series or championship. | always |
| `event.organiser` | string | Organiser. | always |
| `event.timeZone` | string | IANA time zone set for the event ("" when not set). | always |
| `presentation` | object | The theme (Plan → Theme): `language`, `identity` (club, flag, both), `themeColors`, `logoMode`, `logoUrl`, `clubLogos`, `relayNames` … | always |

# TraceTrack GPS integration: a live estimated tower

Status: proposal (6 November 2026). Nothing here is built yet.

## Goal

An F1-style timing tower for orienteering: a class's runners in their **estimated** order
right now, with the gap to the leader, updating every second from GPS, and replaced by the
official time whenever a runner passes a radio control or the finish.

F1 does the same thing: timing loops give official times at fixed points, and between them
the tower is driven by car positions. In orienteering, radio controls are the timing loops
(Split Control already has them from Liveresultat, MeOS or IOF XML) and TraceTrack's GPS fills
the gaps between them.

## What TraceTrack has today

From `opensourceorienteering/GPS-Trace-Track` (commit `4355f3f`, 3 November 2026):

| Piece | Where | Useful for the tower |
|---|---|---|
| `EventPackage`: competitors (tracker id, name, club, country, class, start time) and controls (code, lat/lon, start/control/finish, sequence) | `packages/protocol` | The course and who is who |
| `Fix`: tracker id, time, lat/lon, accuracy | `packages/protocol` | Positions |
| `positionAt(track, time)` (interpolated, with a gap limit) and `passingNear(track, point, radius)` | `packages/core` | Where a runner is; when they passed a control |
| `/api/event`, `/api/tracks?from&to&class`, `/api/live` (server-sent events, Program state only), `POST /api/ingest` | `apps/server` (an experiment, loopback only) | A starting point for a feed |
| Requirements PLY-30 (estimated gap between two runners), **PLY-31 (order and gap to leader by progress along the course, marked as estimated)**, PLY-33 (official splits first, GPS as fallback), PLY-36 (time to beat) | `docs/requirements/project-requirements.md` | The tower is PLY-31 |

Not there yet: real tracker ingest (the desk runs on generated races), and any feed of
estimates. The tower can be built and rehearsed on TraceTrack's generated races before real
trackers exist.

## How to estimate who is fastest

### 1. Where on the course is each runner?

- **Leg:** the last control passed. Use the official split when the timing data has it (PLY-33);
  otherwise `passingNear` within about 30–50 m, in course order, so a runner can't "pass" a
  control out of sequence.
- **Progress within the leg:** two ways.
  - *Straight line* between the two controls: simple, but route choice breaks it. A runner
    going round a lake looks as if they are falling behind.
  - *Reference route* (recommended): compare with the track of a runner who has already run the
    leg, the leg's fastest so far. Find the point on the reference track nearest the runner,
    moving only forwards. The reference's elapsed time at that point says "the reference was here
    after 4:12".

### 2. The gap

For each runner: **gap = their elapsed time − the reference's elapsed time at the same place.**
Elapsed time is from the runner's own start (interval starts compare as a virtual mass start),
or from the team's start in a relay (`teamStartTimeMs`, already in Split Control's data).

Sorting by gap gives the estimated order: the smallest gap is the runner estimated fastest. The
same idea is behind Loggator's TimeDiff gauge, whose help notes it is not fully reliable and works
best when the runners follow the same path within about 50 m.

A projected finish is the reference's finish time plus the gap, once the reference has finished.

### 3. Trust, and keeping it calm on air

- **Confidence:** high when the runner is near the reference route (under about 50 m), the
  latest fix is fresh (under about 10 s) and accurate; low otherwise; none without a position.
  The tower marks low confidence (dimmed, "≈") and never shows a guess as fact.
- **Official beats estimated:** when a radio time arrives, the runner's gap at that control is
  the official one, marked as such, until GPS moves them on.
- **Smoothing:** a smoothed gap (about 1–2 s of exponential smoothing) and hysteresis on order
  changes (swap only when the gap difference holds for a few seconds), so rows don't flicker.
- **Delay:** trackers report a few seconds late, and the broadcast picture may be delayed too.
  Estimates are made for "now minus the tracker delay"; TraceTrack's video sync offset (DSK-74)
  applies to the tower as well.

## Where it should run

**TraceTrack computes, Split Control shows.** TraceTrack owns the tracks, the course geometry
and the operator's corrections, so the estimates belong in `packages/core` there. Split Control
reads one small feed and draws the tower in every look, next to its official timing data.

### The feed (proposed contract)

Server-sent events from TraceTrack, one message per class per second:

```json
{
  "version": 1,
  "event": "karlstad-2026", "class": "D21", "at": 1793865600000,
  "reference": { "competitor": "c17", "name": "Tove Alexandersson" },
  "runners": [
    {
      "competitor": "c17", "bib": "8", "name": "Tove Alexandersson", "club": "Stora Tuna OK", "country": "SWE",
      "leg": 6, "lastControl": "45", "progress": 0.62,
      "elapsedMs": 2172000, "gapMs": 0, "rank": 1,
      "confidence": "high", "official": false, "fixAgeMs": 2400
    }
  ]
}
```

The schema lives in TraceTrack's `packages/protocol` (zod), so both apps validate the same thing.
Split Control matches runners to its timing data by bib, then by name and club.

### In Split Control

- **Data source:** "TraceTrack" in Settings → Data sources (address of the TraceTrack server).
- **Building block:** a new feed, `tracking`, in `src/shared/capabilities.ts`. Graphics that map
  `trackingEstimates` in their `.datasource.json` get the class's latest message.
- **Graphic:** *GPS tower*, a new extra graphic in every look (`_core/extra-graphics.json`):
  - rank, places gained or lost, name, gap ("+0:12") or the leader's elapsed time;
  - an "EST" badge, with confidence shown;
  - official rows marked;
  - the selected runner highlighted.

  Rows move with the existing live reordering (FLIP), and it shows the top 10 or 20. Its zone is
  `side`, and it stays inside the action safe area like every graphic.
- **Preview:** the website preview's simulated race gains GPS-style estimates, so looks can be
  designed without TraceTrack running.

## Steps

1. **Agree the feed** in TraceTrack's `packages/protocol`: types, zod schema, an example message.
2. **Estimates engine** in TraceTrack `packages/core`, on its generated races: progress, reference
   matching, gaps, confidence, smoothing, with unit tests. Serve the feed from `apps/server`.
3. **Split Control:** the TraceTrack data source, the `tracking` feed, the GPS tower graphic in
   every look, and preview support.
4. **Field test** once TraceTrack has real tracker ingest: tune radii, confidence and smoothing
   on a recorded race before it goes on air.

Steps 1–3 can run on generated data now; step 4 waits for real ingest.

## Risks

- **No real ingest yet.** The tower can be built and rehearsed, not put on air.
- **GPS in forest** is often 5–15 m off and drops out; route-choice legs make any comparison
  rough. The tower must say "estimated" clearly, and official times must always win.
- **Tracker delay** of a few seconds: the tower shows the race slightly in the past, like the map.
- **Matching runners** between TraceTrack and the timing data needs bibs or clean names.

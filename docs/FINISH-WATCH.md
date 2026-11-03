# SOFT — Finish watch

Shows runners approaching a measuring point. The first radio is a **prewarning trigger**;
it does not start a new stopwatch. Each row shows the runner's name, class, total race time
and provisional place in that class. The measuring point can be another radio or **Finish**.

1. In an event using the updated Svensk Orientering look, open Live → **Finish watch**.
2. Leave **Class** on **All classes**, or select one class to filter the graphic.
3. Choose the **Prewarning control** and **Measuring point** (Finish by default). They must
   be different. Only competitors with a valid passing at the prewarning can appear.
4. **Show** the graphic before runners approach. Existing prewarned runners appear with
   ticking total race times. Historical completed runners are not replayed on initial Show.
5. When the measuring time arrives, the official cumulative time and place replace the
   ticking time/provisional place. The row remains for **Hold registered time**, default
   four seconds from receipt, then disappears. Other approaching runners stay visible.

**Important distinction:** a prewarning at 34:00 and a finish at 36:10 show a running race
clock approaching **36:10**, then freeze **36:10**. They never display the 2:10 interval.

An asterisk marks provisional placing. It compares the runner's current elapsed race time
with registered times at the measuring point, **within their own class**, including when all
classes share the graphic. The official place replaces it on registration. Timing data and
places can arrive late or be corrected; this is not a predicted finish placing.

Up to eight rows are shown by default (configurable, maximum twelve), in appearance order.
Additional runners wait for space; the footer reports the visible/active count. Set the
hold to zero to remove registered rows immediately. A missing start time shows a dash while
approaching, rather than inventing a running time. Final DNS/DNF/MP/DSQ/OT/WO statuses stop
the row and use the same hold. Explicit timing corrections can resume a runner's clock.

The graphic follows timing updates while on air. It requires split times at the prewarning,
start times for running clocks, and finish/split times at the measuring point. Detection
follows the source's polling/push cadence; the four-second hold starts when the graphic
receives the registered time, so late results still get a readable hold. All-class mode
subscribes to the event's known classes; refresh/update the graphic if new classes are added
mid-production. Choose the measuring point shared by the classes you intend to show.

## Implementation

The package is `templates/sets/sof/sof-finish-watch/`, declared only in SOFT. It uses:

- `api.classScope: "optional"` in its datasource: a missing class combines all classes;
  selected-class mode keeps the normal one-class data path.
- String schema fields with `v_olgrafik_control: "radio-control"`; the measuring field adds
  `v_olgrafik_includeFinish: true` and `v_olgrafik_distinctFrom: "triggerControl"`.
- Normal timing results enriched with class names, absolute start times and split times.
- A separate state machine per graphic element. Shared clock ticks update race time, placing
  and completion expiry without waiting for another timing request. Completed history is
  remembered so an expired row does not reappear on each poll.

The shared view callback runs with the graphic element as `this`; SOFT uses that to isolate
its state between Preview and Program. Keep mutable state out of a module-global singleton.

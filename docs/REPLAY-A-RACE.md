# Replay a finished race as if it were live

Use a replay to rehearse, train an operator or check a new look with real data, without
waiting for a live race. Split Control receives the race exactly as it would from
Liveresultat on race day:

- runners start,
- radio controls come in,
- results update,

but compressed, so a two-hour race plays in half an hour.

The replay runs on your own computer. It never sends anything to Liveresultat, and the real
competition is not affected.

## What you need

- **The Split Control project folder.** The replay tool is not part of the installed app.
- **Node.js 22 or newer.** Check with `node -v` in a terminal.
- **An internet connection the first time you replay a race.** The tool downloads the
  results once and keeps a copy, so later replays of the same race work offline.
- **The race's Liveresultat number.** It is the number at the end of the race's address:
  `liveresultat.orientering.se/beta/follow/33124` is race **33124**.

## 1. Start the replay

Open a terminal in the project folder and run:

```
node scripts/replay-liveresultat.js --competition 33124 --speed 4
```

When it is ready, it shows something like this:

```
Replaying SM, Medel, kval (Swedish League, #4, WRE) (33124) on http://127.0.0.1:5800
Original race time 13:58:00 is now (10:16:30 on 2026-10-30), 4x compressed. Original first start 14:00:00.
```

Leave the terminal open: the replay runs until you close it or press **Ctrl+C**.

### Choose the speed and where to begin

| Option | What it does | Example |
|---|---|---|
| `--speed` | How many times faster than the real race. All times are divided by it: a radio control passed 10 minutes after the start comes in 2.5 minutes after the start. | `--speed 4` |
| `--from` | The time in the original race to begin from. Without it, the replay begins 2 minutes before the first start. | `--from 16:20` |
| `--port` | Another port, if 5800 is taken. | `--port 5801` |
| `--refresh` | Download the results again instead of using the saved copy. | `--refresh` |

To find a good `--from`, open the race on Liveresultat and look at the start times of the
runners you want to follow. For example, `--from 16:20 --speed 4` on race 33124 reaches
Lucas Basset's start (16:28) after 2 minutes and his finish after about 10 minutes.

## 2. Add the replay as a data source (once)

1. In Split Control, open **Settings → Data sources** and choose **Add data source**.
2. Fill in:
   - **Type:** LiveResults
   - **Name:** e.g. `Replay`
   - **Base URL:** `http://127.0.0.1:5800` (with your port if you changed it)
   - **API:** **Automatic** works: Split Control asks the replay server which API it speaks.
     **REST** also works.
3. Save.

You only do this once. Later replays use the same data source, whatever race you replay.

## 3. Set up an event for the replay

Use a separate event, so your real event keeps its settings.

1. Create an event, e.g. `Replay – SM Medel`, and choose its look.
2. In **Plan → Data source & event info**:
   1. Choose **Replay** as the event data source.
   2. Under **Select Competition**, pick the race. The replay offers only the race you started.
   3. Choose **Test connection**.
3. Set the event's **Date** to **today**. The replay runs on today's date.
4. Open **Plan → Start lists** and choose **Refresh from event source**.
5. In **Plan → Output**, choose the outputs to use (web output, NDI).
6. Go to Live.

## 4. Run the replay

Work on the desk as on race day. While the replay runs:

- **Start times** are the race's real start times of day, compressed around the moment you
  started the replay. Start lists and "next starters" follow them.
- **Running clocks** run at normal speed. Clocks, split times and results are all divided by
  the speed: at `--speed 4`, a 30:07 winning time shows as 7:31.
- **Updates** arrive every 10 seconds, the same as from Liveresultat. At `--speed 4` that is
  every 40 seconds of the original race.
- **Places and time behind** are worked out for the moment you are at, as they were during
  the real race. A runner who led at a radio control can drop back later, exactly as it
  happened.

## 5. Replay again

To start over, press **Ctrl+C** in the terminal and run the command again. Every replay
begins from the `--from` time, at the moment you start it. The event, data source and
start list can stay; just choose **Refresh from event source** in **Plan → Start lists**
again, because the start times move with each new replay.

## Things to know

- **Runners who did not finish** (DNF, mispunch, disqualified) get their status at their
  finish time, or one (compressed) hour after their start if they have no finish time.
- **Only one race at a time.** To replay another race, stop the replay and start it with
  the other number.
- **Times are compressed, not exact.** Use `--speed 1` when the real times matter, for
  example to check how a results table looks with real winning times.

## Problems

| What you see | What to do |
|---|---|
| `fetch failed` or an `HTTP` error when starting | The first replay of a race downloads it and needs an internet connection. Check it and start again. Check the race number too. |
| `EADDRINUSE` when starting | Port 5800 is in use, perhaps by a replay that is still running. Close it, or start with `--port 5801` and use that port in the data source. |
| **Test connection** fails | Check that the replay is still running in its terminal, and that the data source's base URL and port match. |
| Saving the data source fails with `404` | The data source's **API** is set to **Legacy**. Choose **Automatic** or **REST**. |
| **Select Competition** shows no race | Check that the replay is running, then choose **Refresh competitions**. |
| Start times in the start list are in the past | The start list is from an earlier replay. Choose **Refresh from event source** in **Plan → Start lists**. |
| Nothing changes on the desk | Results arrive every 10 seconds. If nothing comes in for a minute, check the terminal for errors and the data status on the desk. |

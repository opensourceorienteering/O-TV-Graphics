import { describe, expect, it } from "vitest";
import { ResultsTransformer } from "../ResultsTransformer";
import type { ClassResults, ResultRow } from "../timing/model";

const clock = { date: "2026-06-01", timezone: "Europe/Stockholm", timediffHours: 0 };
const at = (h: number, m = 0) => Date.UTC(2026, 5, 1, h - 2, m); // local CEST
const row = (r: Partial<ResultRow> & Pick<ResultRow, "name" | "statusCode">): ResultRow => ({
  entryId: r.name, club: "", status: "ok", ranked: true, tied: false, progress: 0, splits: {}, ...r,
} as ResultRow);

// H21 mid-race: one finisher, one runner on course past control 62, one not there yet,
// one mispunch and one DNS
const classResult: ClassResults = {
  competitionId: 1,
  className: "H21",
  classId: "H21",
  controls: [{ key: 1062, id: "62", code: 62, name: "62" }],
  rows: [
    row({ name: "Finisher", club: "A", statusCode: 0, place: 1, time: 450_000, behind: 0, progress: 100, start: at(10),
      splits: { 1062: { time: 320_000, status: 0, place: 2, behind: 15_000 } } }),
    row({ name: "On course", club: "B", statusCode: 10, status: "running", progress: 75, start: at(10, 1),
      splits: { 1062: { time: 305_000, status: 0, place: 1, behind: 0 } } }),
    row({ name: "Not there yet", club: "C", statusCode: 10, status: "running", progress: 25, start: at(10, 2) }),
    row({ name: "Mispunch", club: "D", statusCode: 3, status: "mispunch", progress: 100, start: at(10, 3),
      splits: { 1062: { time: 310_000, status: 0, place: 3 } } }),
    row({ name: "No show", club: "E", statusCode: 1, status: "dns", progress: 0, start: at(10, 4) }),
  ],
};

const byName = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.name, r]));

describe("results for graphics", () => {
  it("only places runners with an OK result at the finish", () => {
    const rows = byName(ResultsTransformer.transformClassResults(classResult, { clock }).results);
    expect(rows["Finisher"]).toMatchObject({ position: "1", time: "7:30", startTime: "10:00:00" });
    for (const name of ["On course", "Not there yet", "Mispunch", "No show"]) expect(rows[name].position).toBe("");
  });

  it("ranks everyone who has passed a control there, still running or not", () => {
    const rows = ResultsTransformer.transformClassResults(classResult, { controlCode: "1062", clock }).results;
    const ranked = rows.filter((r: any) => r.statusCode === 0).map((r: any) => [r.position, r.name, r.time]);
    expect(ranked).toEqual([
      ["1", "On course", "5:05"],
      ["2", "Finisher", "5:20"],
      ["3", "Mispunch", "5:10"],
    ]);
    const r = byName(rows);
    expect(r["Not there yet"]).toMatchObject({ position: "", time: "--:--", statusCode: 10 });
    expect(r["No show"]).toMatchObject({ position: "", statusCode: 1 });
    expect(r["Finisher"].diff).toBe("+0:15");
  });

  it("lists start times in start order", () => {
    const rows = ResultsTransformer.transformClassResults(classResult, { controlCode: "Start", clock }).results;
    expect(rows.map((r: any) => [r.position, r.name, r.time])).toEqual([
      ["1", "Finisher", "10:00:00"],
      ["2", "On course", "10:01:00"],
      ["3", "Not there yet", "10:02:00"],
      ["4", "Mispunch", "10:03:00"],
      ["5", "No show", "10:04:00"],
    ]);
  });

  it('shows a tie as "="', () => {
    const tie: ClassResults = { ...classResult, rows: [classResult.rows[0], { ...classResult.rows[0], name: "Same time", tied: true }] };
    expect(ResultsTransformer.transformClassResults(tie, { clock }).results.map((r: any) => r.position)).toEqual(["1", "="]);
  });
});

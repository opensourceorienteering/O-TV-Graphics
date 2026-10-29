import { describe, expect, it, vi } from "vitest";
vi.mock("../../utils/logger", () => ({ getLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
import { LiveResultsTransformer } from "../LiveResultsTransformer";

// H21 mid-race: one finisher, one runner on course past control 62, one not there yet,
// one mispunch and one DNS
const classResult: any = {
  status: "OK",
  className: "H21",
  splitcontrols: [{ code: 1062, name: "62" }],
  results: [
    { place: "1", name: "Finisher", club: "A", result: "45000", status: 0, timeplus: "0", progress: 100, start: 3600000,
      splits: { 1062: 32000, "1062_status": 0, "1062_place": 2, "1062_timeplus": 1500 } },
    { place: "", name: "On course", club: "B", result: "", status: 10, timeplus: "", progress: 75, start: 3610000,
      splits: { 1062: 30500, "1062_status": 0, "1062_place": 1, "1062_timeplus": 0 } },
    { place: "", name: "Not there yet", club: "C", result: "", status: 10, timeplus: "", progress: 25, start: 3620000, splits: {} },
    { place: "", name: "Mispunch", club: "D", result: "41000", status: 3, timeplus: "", progress: 100, start: 3630000,
      splits: { 1062: 31000, "1062_status": 0, "1062_place": 3 } },
    { place: "", name: "No show", club: "E", result: "", status: 1, timeplus: "", progress: 0, start: 3640000, splits: {} },
  ],
};

const byName = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.name, r]));

describe("live results for graphics", () => {
  it("only places runners with an OK result at the finish", () => {
    const rows = byName(LiveResultsTransformer.transformClassResults(classResult).results);
    expect(rows["Finisher"].position).toBe("1");
    for (const name of ["On course", "Not there yet", "Mispunch", "No show"]) expect(rows[name].position).toBe("");
  });

  it("ranks everyone who has passed a control there, still running or not", () => {
    const rows = LiveResultsTransformer.transformClassResults(classResult, { controlCode: "1062" }).results;
    const ranked = rows.filter((r: any) => r.statusCode === 0).map((r: any) => [r.position, r.name, r.time]);
    expect(ranked).toEqual([
      ["1", "On course", "5:05"],
      ["2", "Finisher", "5:20"],
      ["3", "Mispunch", "5:10"],
    ]);
    const r = byName(rows);
    expect(r["Not there yet"]).toMatchObject({ position: "", time: "--:--", statusCode: 10 });
    expect(r["No show"]).toMatchObject({ position: "", statusCode: 1 });
  });
});

import { describe, expect, it } from "vitest";
import {
  BUILT_IN_DATA_SOURCES,
  mergeBuiltInDataSources,
} from "../builtInDataSources";

describe("built-in data sources", () => {
  it("restores packaged sources without removing custom sources", () => {
    const merged = mergeBuiltInDataSources([
      {
        id: "club-timing",
        name: "Club timing",
        type: "custom",
        enabled: true,
        config: { url: "http://timing.local" },
      },
    ]);

    expect(merged.map((source) => source.id)).toEqual([
      "liveresults-default",
      "liveresults-legacy",
      "club-timing",
    ]);
  });

  it("keeps only the enabled preference for canonical packaged sources", () => {
    const merged = mergeBuiltInDataSources([
      {
        id: "liveresults-default",
        name: "Changed name",
        type: "liveresults",
        enabled: false,
        config: { baseUrl: "https://wrong.example", api: "legacy" },
      },
    ]);
    const rest = merged[0];

    expect(rest.enabled).toBe(false);
    expect(rest.name).toBe("LiveResults REST");
    expect(rest.builtIn).toBe(true);
    expect(rest.config).toMatchObject({
      baseUrl: "https://api.orienteering.services",
      api: "rest",
    });
    expect(BUILT_IN_DATA_SOURCES).toHaveLength(2);
  });
});

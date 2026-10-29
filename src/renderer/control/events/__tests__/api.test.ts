import { afterEach, describe, expect, it, vi } from "vitest";
import { call } from "../api";
afterEach(() => vi.unstubAllGlobals());
describe("Event IPC response adapter", () => {
  it("reads legacy template responses and standard event responses", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        invoke: async (channel: string) => ({
          success: true,
          ...(channel === "templates:getAll"
            ? { templates: ["graphic"] }
            : channel === "templates:getSets"
              ? { sets: ["classic"] }
              : { data: { id: "event" } }),
        }),
      },
    });
    expect(await call("templates:getAll")).toEqual(["graphic"]);
    expect(await call("templates:getSets")).toEqual(["classic"]);
    expect(await call("event:get")).toEqual({ id: "event" });
  });
  it("preserves actionable IPC errors", async () => {
    vi.stubGlobal("window", {
      electronAPI: {
        invoke: async () => ({ success: false, error: "Choose a competition" }),
      },
    });
    await expect(call("event:test")).rejects.toThrow("Choose a competition");
  });
});

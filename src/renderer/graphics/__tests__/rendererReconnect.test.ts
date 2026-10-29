import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  dom: new Map<string, () => void>(),
  handlers: new Map<string, (...args: any[]) => any>(),
  loaded: new Map<string, unknown>(),
  gate: undefined as Promise<void> | undefined,
  calls: [] as string[],
  base: "",
  io: vi.fn(),
  emit: vi.fn(),
  connected: true,
}));
vi.mock("socket.io-client", () => ({
  io: (...args: any[]) => {
    mock.io(...args);
    return {
      get connected() {
        return mock.connected;
      },
      id: "socket",
      on: (name: string, fn: any) => mock.handlers.set(name, fn),
      emit: mock.emit,
      disconnect: vi.fn(),
    };
  },
}));
vi.mock("../ograf-renderer", () => ({
  OGrafRenderer: class {
    constructor(_container: unknown, base: string) {
      mock.base = base;
    }
    isLoaded(id: string) {
      return mock.loaded.has(id);
    }
    async clearAll() {
      mock.calls.push("clear");
      mock.loaded.clear();
    }
    async loadGraphic(
      id: string,
      _manifest: unknown,
      _template: unknown,
      data: unknown,
    ) {
      mock.calls.push("load");
      if (mock.gate) await mock.gate;
      mock.loaded.set(id, data);
      return { statusCode: 200 };
    }
    async playGraphic(_id: string, options: any) {
      mock.calls.push("play");
      return { statusCode: 200, currentStep: options?.goto || 2 };
    }
  },
}));
beforeEach(() => {
  vi.resetModules();
  mock.dom.clear();
  mock.handlers.clear();
  mock.loaded.clear();
  mock.calls = [];
  mock.gate = undefined;
  mock.connected = true;
  mock.emit.mockClear();
  mock.io.mockClear();
  vi.stubGlobal("window", {
    location: { hostname: "localhost", search: "?wsPort=6767&webPort=6768" },
    addEventListener: () => {},
  });
  vi.stubGlobal("document", {
    addEventListener: (name: string, fn: () => void) => mock.dom.set(name, fn),
    getElementById: () => ({}),
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function command(
  name: string,
  data: unknown = { title: "New" },
  options?: unknown,
) {
  return mock.handlers.get("SPXMessage2Client")!({
    spxcmd: "graphics:command",
    command: name,
    payload: {
      id: "result",
      manifest: { id: "template" },
      templateId: "template",
      data,
      options,
    },
  });
}
for (const entry of ["native graphics", "web / detached Program"]) {
  describe(`${entry} renderer connection lifecycle`, () => {
    const load = async () => {
      if (entry === "native graphics") await import("../main");
      else await import("../../web-output/main");
      mock.dom.get("DOMContentLoaded")!();
      await mock.handlers.get("connect")!();
    };
    it("uses configured ports and waits for loading before advancing playback", async () => {
      await load();
      expect(mock.io).toHaveBeenCalledWith(
        "http://localhost:6767",
        expect.objectContaining({ reconnectionAttempts: Infinity }),
      );
      expect(mock.base).toBe("http://localhost:6768");
      let release!: () => void;
      mock.gate = new Promise<void>((r) => {
        release = r;
      });
      const loading = command("load");
      const playing = command("play");
      await Promise.resolve();
      await Promise.resolve();
      expect(mock.calls).not.toContain("play");
      release();
      await Promise.all([loading, playing]);
      expect(mock.calls.slice(-2)).toEqual(["load", "play"]);
      expect(mock.emit).toHaveBeenCalledWith(
        "SPXMessage2Server",
        expect.objectContaining({
          spxcmd: "graphics:response",
          command: "play",
          result: {
            success: true,
            result: { statusCode: 200, currentStep: 2 },
          },
        }),
      );
    });
    it("drops stale acknowledgements, clears old data and replays the current snapshot after reconnect", async () => {
      await load();
      mock.emit.mockClear();
      let release!: () => void;
      mock.gate = new Promise<void>((r) => {
        release = r;
      });
      const loading = command("load", { title: "Old data" });
      await Promise.resolve();
      await Promise.resolve();
      mock.connected = false;
      mock.handlers.get("disconnect")!();
      mock.connected = true;
      const reconnect = mock.handlers.get("connect")!();
      release();
      await Promise.all([loading, reconnect]);
      mock.gate = undefined;
      expect(mock.loaded.size).toBe(0);
      expect(
        mock.emit.mock.calls.some(
          ([, message]) => message.spxcmd === "graphics:response",
        ),
      ).toBe(false);
      await command("load", { title: "Current data" });
      await command("play", undefined, { goto: 3, skipAnimation: true });
      expect(mock.loaded.get("result")).toEqual({ title: "Current data" });
      expect(mock.emit).toHaveBeenCalledWith(
        "SPXMessage2Server",
        expect.objectContaining({
          command: "play",
          result: {
            success: true,
            result: { statusCode: 200, currentStep: 3 },
          },
        }),
      );
    });
  });
}

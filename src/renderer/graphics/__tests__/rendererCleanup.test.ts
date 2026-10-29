import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../ograf-loader", () => ({
  defineOGrafGraphic: async () => "test-graphic",
}));
import { OGrafRenderer } from "../ograf-renderer";
let element: any, container: any;
const manifest: any = { id: "test", name: "Test", main: "graphic.js" };
beforeEach(() => {
  element = {
    style: {},
    parentNode: null,
    load: vi.fn(async () => ({ statusCode: 200 })),
    dispose: vi.fn(async () => ({ statusCode: 200 })),
    playAction: vi.fn(async () => ({ statusCode: 200, currentStep: 1 })),
  };
  container = {
    appendChild: (node: any) => {
      node.parentNode = container;
    },
    removeChild: vi.fn((node: any) => {
      node.parentNode = null;
    }),
  };
  vi.stubGlobal("document", { createElement: () => element });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Renderer recovery from third-party graphic lifecycle failures", () => {
  it("removes both cached state and DOM after a failed load, even when cleanup throws", async () => {
    const renderer = new OGrafRenderer(container);
    element.load.mockRejectedValueOnce(new Error("Bad graphic data"));
    element.dispose.mockRejectedValueOnce(new Error("Broken cleanup"));
    await expect(
      renderer.loadGraphic("g", manifest, "test", {}),
    ).rejects.toThrow("Bad graphic data");
    expect(renderer.isLoaded("g")).toBe(false);
    expect(element.parentNode).toBeNull();
    await expect(
      renderer.loadGraphic("g", manifest, "test", {}),
    ).resolves.toMatchObject({ statusCode: 200 });
  });
  it("detaches a graphic whose dispose method fails, preventing stale images on reconnect", async () => {
    const renderer = new OGrafRenderer(container);
    await renderer.loadGraphic("g", manifest, "test", {});
    element.dispose.mockRejectedValueOnce(new Error("Broken cleanup"));
    await renderer.clearAll();
    expect(renderer.getLoadedCount()).toBe(0);
    expect(element.parentNode).toBeNull();
  });
  it("does not delete a healthy graphic when a duplicate load is rejected", async () => {
    const renderer = new OGrafRenderer(container);
    await renderer.loadGraphic("g", manifest, "test", {});
    await expect(
      renderer.loadGraphic("g", manifest, "test", {}),
    ).rejects.toThrow("already loaded");
    expect(renderer.isLoaded("g")).toBe(true);
    expect(element.parentNode).toBe(container);
    expect(element.dispose).not.toHaveBeenCalled();
  });
  it("treats error return statuses as failures and permits a clean retry", async () => {
    const renderer = new OGrafRenderer(container);
    element.load.mockResolvedValueOnce({
      statusCode: 500,
      message: "Template rejected data",
    });
    await expect(
      renderer.loadGraphic("g", manifest, "test", {}),
    ).rejects.toThrow("Template rejected data");
    expect(renderer.isLoaded("g")).toBe(false);
    expect(element.parentNode).toBeNull();
    await renderer.loadGraphic("g", manifest, "test", {});
    element.playAction.mockResolvedValueOnce({
      statusCode: 503,
      currentStep: 0,
    });
    await expect(renderer.playGraphic("g")).rejects.toThrow("503");
    expect(renderer.getGraphic("g")?.isPlaying).toBe(false);
  });
});

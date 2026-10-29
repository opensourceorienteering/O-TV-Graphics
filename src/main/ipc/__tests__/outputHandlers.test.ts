import { describe, it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, any>(),
  captureStart: vi.fn(async () => false),
  captureStop: vi.fn(),
  senderStart: vi.fn(async () => true),
  active: false,
  capturing: false,
  stop: vi.fn(async () => {}),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (name: string, callback: any) => mock.handlers.set(name, callback),
  },
}));
vi.mock("../../utils/logger", () => ({
  getLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock("../../output/WebServer", () => ({ getWebServer: () => ({}) }));
vi.mock("../../utils/config", () => ({ getConfig: () => ({}) }));
vi.mock("../../utils/ndi-check", () => ({
  checkNDIAvailability: () => ({ available: true }),
}));
vi.mock("../../windows", () => ({
  getGraphicsDimensions: () => ({ width: 1920, height: 1080 }),
}));
vi.mock("../../output/NDIOutputManager", () => ({
  ndiOutputManager: {
    start: mock.senderStart,
    getStatus: () => ({ active: mock.active }),
    stop: mock.stop,
    getConfig: () => ({ fps: 50 }),
  },
}));
vi.mock("../../output/FrameCaptureService", () => ({
  frameCaptureService: {
    start: mock.captureStart,
    stop: mock.captureStop,
    getStatus: () => ({ isCapturing: mock.capturing }),
  },
}));
import { registerOutputHandlers } from "../outputHandlers";
beforeEach(() => {
  mock.stop.mockClear();
  mock.captureStart.mockReset().mockResolvedValue(false);
  mock.captureStop.mockClear();
  mock.senderStart.mockReset().mockResolvedValue(true);
  mock.active = false;
  mock.capturing = false;
  registerOutputHandlers();
});
describe("Starting NDI with frame capture", () => {
  it("stops the sender and reports failure when frame capture cannot start", async () => {
    const response = await mock.handlers.get("output:startNDI")();
    expect(response.success).toBe(false);
    expect(response.error).toContain("capture could not start");
    expect(mock.stop).toHaveBeenCalledOnce();
    expect(mock.captureStart).toHaveBeenCalledWith({
      fps: 50,
      targetWidth: 1920,
      targetHeight: 1080,
    });
  });
  it("does not stop an already running capture on repeated start requests", async () => {
    mock.active = true;
    mock.capturing = true;
    expect((await mock.handlers.get("output:startNDI")()).success).toBe(true);
    expect(mock.senderStart).not.toHaveBeenCalled();
    expect(mock.captureStart).not.toHaveBeenCalled();
    expect(mock.stop).not.toHaveBeenCalled();
  });
  it("coalesces concurrent starts and stops the sender if capture throws", async () => {
    let resolve!: (value: boolean) => void;
    mock.senderStart.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    mock.captureStart.mockRejectedValueOnce(new Error("Window closed"));
    const first = mock.handlers.get("output:startNDI")();
    const second = mock.handlers.get("output:startNDI")();
    expect(first).toBe(second);
    resolve(true);
    expect((await first).success).toBe(false);
    expect(mock.senderStart).toHaveBeenCalledOnce();
    expect(mock.stop).toHaveBeenCalledOnce();
    expect(mock.captureStop).toHaveBeenCalledOnce();
  });
  it("honours Stop when sender startup completes late", async () => {
    let resolve!: (value: boolean) => void;
    mock.senderStart.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const starting = mock.handlers.get("output:startNDI")();
    await mock.handlers.get("output:stopNDI")();
    resolve(true);
    const response = await starting;
    expect(response.success).toBe(false);
    expect(response.error).toContain("cancelled");
    expect(mock.captureStart).not.toHaveBeenCalled();
  });
});

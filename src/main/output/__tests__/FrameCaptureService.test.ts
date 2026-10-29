import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  send: vi.fn(async (..._args: any[]) => true),
  capture: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));
vi.mock("../NDIOutputManager", () => ({
  ndiOutputManager: {
    sendFrame: mock.send,
    getConfig: () => ({ colorFormat: "BGRA" }),
  },
}));
import { frameCaptureService as capture } from "../FrameCaptureService";
const image = {
  getSize: () => ({ width: 2, height: 2 }),
  getScaleFactors: () => [1],
  toBitmap: () => Buffer.alloc(16),
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  mock.send.mockReset().mockResolvedValue(true);
  mock.capture.mockReset().mockResolvedValue(image);
  capture.setWindow({
    isDestroyed: () => false,
    isVisible: () => false,
    webContents: { capturePage: mock.capture },
  } as any);
});
afterEach(() => {
  capture.stop();
  vi.useRealTimers();
});
describe("Capture throughput and failure reporting", () => {
  it("measures successful hidden-window captures and retains transient error totals", async () => {
    await capture.start({ fps: 50, targetWidth: 2, targetHeight: 2 });
    await vi.advanceTimersByTimeAsync(100);
    expect(capture.getStatus().measuredFps).toBe(50);
    mock.send.mockResolvedValueOnce(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(capture.getStatus().errorCount).toBe(1);
    expect(capture.getStatus().consecutiveErrors).toBe(0);
    expect(capture.getStatus().isCapturing).toBe(true);
  });
  it("counts backpressure instead of overlapping capture requests", async () => {
    let release!: (image: any) => void;
    mock.capture.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await capture.start({ fps: 50 });
    await vi.advanceTimersByTimeAsync(80);
    expect(mock.capture).toHaveBeenCalledOnce();
    expect(capture.getStatus().skippedFrameCount).toBe(3);
    release(image);
    await vi.advanceTimersByTimeAsync(20);
    expect(capture.getStatus().frameCount).toBeGreaterThan(0);
  });
  it("stops after repeated rejected sends and reports all failures", async () => {
    mock.send.mockResolvedValue(false);
    await capture.start({ fps: 50 });
    await vi.advanceTimersByTimeAsync(300);
    expect(capture.getStatus().isCapturing).toBe(false);
    expect(capture.getStatus().errorCount).toBe(11);
  });
});

describe('Offscreen frame capture', () => {
  it('reuses static frames, picks up the newest paint and detaches on stop', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const wc = {
      isOffscreen: () => true,
      on: vi.fn((name, fn) => handlers.set(name, fn)),
      removeListener: vi.fn((name) => handlers.delete(name)),
      setFrameRate: vi.fn(), startPainting: vi.fn(), stopPainting: vi.fn(), invalidate: vi.fn(),
      capturePage: mock.capture,
    };
    capture.setWindow({ isDestroyed: () => false, isVisible: () => false, webContents: wc } as any);
    await capture.start({ fps: 50, targetWidth: 2, targetHeight: 2 });
    await vi.advanceTimersByTimeAsync(40);
    expect(mock.send).not.toHaveBeenCalled();
    const first = { ...image, toBitmap: vi.fn(() => Buffer.alloc(16, 1)) };
    handlers.get('paint')!({}, {}, first);
    await vi.advanceTimersByTimeAsync(100);
    expect(mock.capture).not.toHaveBeenCalled();
    expect(mock.send).toHaveBeenCalledTimes(5);
    expect(first.toBitmap).toHaveBeenCalledOnce();
    const newest = { ...image, toBitmap: vi.fn(() => Buffer.alloc(16, 2)) };
    handlers.get('paint')!({}, {}, newest);
    await vi.advanceTimersByTimeAsync(20);
    expect(mock.send.mock.calls.at(-1)?.[0]).toEqual(Buffer.alloc(16, 2));
    capture.stop();
    expect(handlers.has('paint')).toBe(false);
    expect(wc.stopPainting).toHaveBeenCalledOnce();
    const sent = mock.send.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(mock.send).toHaveBeenCalledTimes(sent);
  });
});

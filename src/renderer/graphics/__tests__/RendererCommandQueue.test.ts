import { describe, expect, it } from "vitest";
import { RendererCommandQueue } from "../RendererCommandQueue";
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("Renderer command ordering and reconnect barriers", () => {
  it("waits for a slow load before playing that graphic", async () => {
    const queue = new RendererCommandQueue(),
      load = deferred(),
      calls: string[] = [];
    const first = queue.enqueue("result", async () => {
      calls.push("load");
      await load.promise;
    });
    const second = queue.enqueue("result", async () => {
      calls.push("play");
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["load"]);
    load.resolve();
    await Promise.all([first, second]);
    expect(calls).toEqual(["load", "play"]);
  });
  it("does not block unrelated graphics behind a slow load", async () => {
    const queue = new RendererCommandQueue(),
      load = deferred();
    let clock = false;
    const first = queue.enqueue("results", () => load.promise);
    await queue.enqueue("clock", async () => {
      clock = true;
    });
    expect(clock).toBe(true);
    load.resolve();
    await first;
  });
  it("clears after prior operations and before new reconnect snapshots", async () => {
    const queue = new RendererCommandQueue(),
      load = deferred(),
      clear = deferred(),
      calls: string[] = [];
    const first = queue.enqueue("result", async () => {
      await load.promise;
      calls.push("old");
    });
    const barrier = queue.barrier(async () => {
      calls.push("clear");
      await clear.promise;
    });
    const next = queue.enqueue("result", async () => {
      calls.push("snapshot");
    });
    load.resolve();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["old", "clear"]);
    clear.resolve();
    await Promise.all([barrier, next]);
    expect(calls).toEqual(["old", "clear", "snapshot"]);
  });
  it("recovers after failed loads and failed clears", async () => {
    const queue = new RendererCommandQueue();
    await expect(
      queue.enqueue("result", async () => {
        throw new Error("Offline");
      }),
    ).rejects.toThrow("Offline");
    await expect(
      queue.enqueue("result", async () => {}),
    ).resolves.toBeUndefined();
    await expect(
      queue.barrier(async () => {
        throw new Error("Clear failed");
      }),
    ).rejects.toThrow("Clear failed");
    await expect(
      queue.enqueue("result", async () => {}),
    ).resolves.toBeUndefined();
  });
});

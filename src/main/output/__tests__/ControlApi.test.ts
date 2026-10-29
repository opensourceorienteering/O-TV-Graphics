import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => {
  const state = {
    eventId: "event",
    onAir: [{ key: "runner-identity", label: "Runner identity", name: "Jan Novák", step: 1, since: 1 }],
    otherOnAir: 0,
    prepared: { key: "free-text", label: "Free text", name: "Welcome" },
  };
  return {
    state,
    show: vi.fn(async () => state),
    hide: vi.fn(async () => state),
    hideAll: vi.fn(async () => state),
    prepareFavorite: vi.fn(async () => state),
    prepareRunner: vi.fn(async (): Promise<any> => state),
  };
});
vi.mock("../../utils/logger", () => ({ getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("../../events/LiveControl", () => ({
  controlState: async () => mock.state,
  favorites: () => [{ id: "f1", label: "Welcome", key: "free-text", graphic: "Free text", draft: {} }],
  show: mock.show,
  update: vi.fn(async () => mock.state),
  hide: mock.hide,
  hideAll: mock.hideAll,
  page: vi.fn(async () => mock.state),
  prepareFavorite: mock.prepareFavorite,
  prepareRunner: mock.prepareRunner,
}));
import { createControlApiRouter } from "../ControlApi";
let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use("/api/control", createControlApiRouter());
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/control`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
describe("Companion control API", () => {
  it("provides tally per desk graphic and favourite buttons", async () => {
    expect(await (await fetch(`${base}/tally/runner-identity`)).json()).toEqual({
      onAir: true,
      name: "Jan Novák",
      step: 1,
    });
    expect((await (await fetch(`${base}/tally/podium`)).json()).onAir).toBe(false);
    const favorites = await (await fetch(`${base}/favorites`)).json();
    expect(favorites[0]).toMatchObject({ label: "Welcome", show: "/api/control/favorite/f1/show" });
  });
  it("maps buttons to the desk actions", async () => {
    const shown = await (await fetch(`${base}/show`, { method: "POST" })).json();
    expect(shown).toEqual({ ok: true, onAir: 1, prepared: "Welcome" });
    await fetch(`${base}/hide/runner-identity`, { method: "POST" });
    expect(mock.hide).toHaveBeenCalledWith("runner-identity");
    await fetch(`${base}/favorite/f1/show`, { method: "POST" });
    expect(mock.prepareFavorite).toHaveBeenCalledWith("f1", true);
    await fetch(`${base}/runner/V101/runner-splits`, { method: "POST" });
    expect(mock.prepareRunner).toHaveBeenCalledWith("V101", "runner-splits");
  });
  it("passes on why an action failed", async () => {
    mock.prepareRunner.mockRejectedValueOnce(
      Object.assign(new Error("No event is open in Live mode"), { status: 409 }),
    );
    const response = await fetch(`${base}/runner/V101/runner-identity`, { method: "POST" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("No event");
  });
  it("refuses actions from web pages on other sites, keeps state readable", async () => {
    mock.show.mockClear();
    mock.hideAll.mockClear();
    const drive = await fetch(`${base}/show`, {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(drive.status).toBe(403);
    const posted = await fetch(`${base}/hide-all`, {
      method: "POST",
      headers: { Origin: "https://example.com" },
    });
    expect(posted.status).toBe(403);
    expect(mock.show).not.toHaveBeenCalled();
    expect(mock.hideAll).not.toHaveBeenCalled();
    const state = await fetch(`${base}/state`, { headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(state.ok).toBe(true);
    expect(state.headers.get("access-control-allow-origin")).toBe("*");
  });
});

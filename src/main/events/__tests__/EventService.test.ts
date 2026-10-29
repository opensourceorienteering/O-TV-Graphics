import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
const mock = vi.hoisted(() => ({ root: "", onAir: [] as any[] }));
vi.mock("../../utils/config", () => ({
  getConfig: () => ({
    general: { dataroot: mock.root },
    output: { web: { enabled: true }, ndi: { enabled: false } },
  }),
}));
vi.mock("../../utils/logger", () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLogger: () => l };
});
vi.mock("../../templates/OGrafManager", () => ({
  getTemplateManager: () => ({
    getTemplateSets: () => [{ id: "classic" }, { id: "iof" }],
    getAllTemplates: () => [
      {
        manifest: {
          id: "results-list-paginated",
          name: "Classic results",
          v_olgrafik_kind: "results",
        },
        setId: "classic",
        directoryName: "sets/classic/results-list-paginated",
      },
      {
        manifest: {
          id: "split-time-lower-third-runner",
          name: "Runner lower third",
          v_olgrafik_kind: "runner-lower-third",
        },
        setId: "classic",
        directoryName: "sets/classic/split-time-lower-third-runner",
      },
      {
        manifest: {
          id: "iof-results",
          name: "IOF results",
          v_olgrafik_kind: "results",
        },
        setId: "iof",
        directoryName: "sets/iof/iof-results",
      },
      {
        manifest: {
          id: "iof-runner-lower-third",
          name: "IOF runner lower third",
          v_olgrafik_kind: "runner-lower-third",
        },
        setId: "iof",
        directoryName: "sets/iof/iof-runner-lower-third",
      },
      {
        manifest: {
          id: "classic-test-pattern",
          v_olgrafik_kind: "test-pattern",
        },
        setId: "classic",
        directoryName: "sets/classic/classic-test-pattern",
      },
    ],
  }),
}));
vi.mock("../../data/DataSourceRegistry", () => ({
  getDataSourceRegistry: () => ({ get: () => undefined }),
}));
vi.mock("../../playback/PlaybackEngine", () => ({ getPlaybackEngine: () => ({ getActiveGraphics: () => mock.onAir }) }));
import { initProjectManager } from "../../projects/ProjectManager";
import { initRundownManager } from "../../projects/RundownManager";
import * as events from "../EventService";
let pm: ReturnType<typeof initProjectManager>,
  rm: ReturnType<typeof initRundownManager>;
beforeAll(() => {
  mock.root = fs.mkdtempSync(path.join(os.tmpdir(), "ol-events-"));
  pm = initProjectManager(path.join(mock.root, "projects"));
  rm = initRundownManager();
});
afterAll(() => fs.rmSync(mock.root, { recursive: true, force: true }));
describe("Events over existing project files", () => {
  it("adopts old rundown data without changing IDs or losing cues", async () => {
    const p = await pm.createProject({ name: "Old race" });
    const r = await rm.createRundown({ projectId: p.id, name: "Finish" });
    r.dataSource = { sourceId: "source", baseUrl: "", competitionId: 123 };
    r.items.push({
      id: "existing",
      templateId: "timer",
      templatePath: "timer",
      fields: {},
      layer: "1",
      out: "animate",
      onair: false,
    });
    await rm.saveRundown(r);
    expect((await events.loadEvent(p.id)).dataSource?.competitionId).toBe(123);
    const pages = await events.getPages(p.id);
    expect(pages[0].id).toBe(r.id);
    expect(pages[0].items[0].id).toBe("existing");
  });
  it("copies folder defaults and the desk favourites of the source event", async () => {
    const folder = events.createFolder("Series");
    await events.updateFolder(folder.id, {
      defaults: {
        templateSet: "classic",
        presentation: { international: true },
        dataSource: { sourceId: "meos" },
        info: { timeZone: "Europe/Stockholm" },
      },
    });
    const first = await events.createEvent({
      name: "Stage 1",
      folderId: folder.id,
    });
    expect(first.settings?.presentation?.international).toBe(true);
    expect(first.dataSource?.sourceId).toBe("meos");
    const favourites = path.join(pm.getRundownsDir(first.id), "..", "desk-favorites.json");
    fs.writeFileSync(favourites, JSON.stringify({ "free-text": [{ id: "f1", label: "Welcome", draft: { key: "free-text", values: {}, fields: { text: "Hi" } } }] }));
    const second = await events.createEvent({
      name: "Stage 2",
      copyFrom: first.id,
    });
    const copied = JSON.parse(fs.readFileSync(path.join(pm.getRundownsDir(second.id), "..", "desk-favorites.json"), "utf8"));
    expect(copied["free-text"][0].label).toBe("Welcome");
  });
  it("imports start lists, preserves stars and virtual bibs on refresh, and includes them in PDF HTML", async () => {
    const event = await events.createEvent({ name: "Race" });
    await events.updateEvent(event.id, {
      info: { date: "2026-10-26", timeZone: "Europe/Stockholm" },
    });
    const file = path.join(mock.root, "start.csv");
    fs.writeFileSync(
      file,
      "class;name;club;start\nH21;Runner One;Club;10:00:00\nH21;Runner Two;Club;10:02:00\n",
    );
    const imported = await events.importStartListCsv(event.id, file);
    expect(imported.entries).toHaveLength(2);
    expect(imported.entries[0].startTimeMs).toBe(
      Date.parse("2026-10-26T09:00:00Z"),
    );
    events.updateStartListEntry(event.id, imported.entries[0].key, {
      favourite: true,
      note: "Champion",
    });
    events.assignVirtualBibs(event.id, { start: 101, perClassBlock: 100 });
    const refreshed = await events.importStartListCsv(event.id, file);
    expect(refreshed.entries[0]).toMatchObject({
      favourite: true,
      note: "Champion",
      virtualBib: "V101",
    });
    const html = events.startListHtml(event, refreshed);
    expect(html).toContain("V101");
    expect(html).toContain("★");
    // The printed start list shows the virtual bib; graphics never do
    const enriched = events.applyStartList(event.id, {
      className: "H21",
      results: [{ name: "Runner One", club: "Club" }],
    }).results[0];
    expect(enriched).toMatchObject({ favourite: true });
    expect(enriched.bib).toBeUndefined();
  });
  it("keeps output test cues off the operator cue pages", async () => {
    const event = await events.createEvent({ name: "Signal test" });
    const first = await events.testPatternCue(event.id);
    expect(await events.testPatternCue(event.id)).toEqual(first);
    expect(
      (await events.getPages(event.id)).some((p) => p.id === first.pageId),
    ).toBe(false);
  });
  it("does not reuse virtual bibs when numbering a selected class again", async () => {
    const event = await events.createEvent({ name: "Bib safety" });
    const file = path.join(mock.root, "bibs.csv");
    fs.writeFileSync(
      file,
      "class,name,club\nH21,Runner One,Club\nD21,Runner Two,Club\n",
    );
    await events.importStartListCsv(event.id, file);
    events.assignVirtualBibs(event.id, { start: 101, perClassBlock: 100 });
    fs.writeFileSync(
      file,
      "class,name,club\nH21,Runner One,Club\nD21,New Runner,Club\nD21,Runner Two,Club\n",
    );
    await events.importStartListCsv(event.id, file);
    const list = events.assignVirtualBibs(event.id, {
      classes: ["D21"],
      start: 101,
      perClassBlock: 100,
    });
    const bibs = list.entries.map((e) => e.virtualBib);
    expect(new Set(bibs).size).toBe(3);
    expect(list.entries.find((e) => e.name === "Runner Two")?.virtualBib).toBe(
      "V201",
    );
    expect(list.entries.find((e) => e.name === "New Runner")?.virtualBib).toBe(
      "V202",
    );
  });

  it("updates linked events, preserves overrides and defers folder changes in Live", async () => {
    const folder = events.createFolder("Linked series");
    await events.updateFolder(folder.id, {
      defaults: {
        templateSet: "classic",
        presentation: { logoUrl: "/assets/old.png", identity: "club" },
        dataSource: { sourceId: "one" },
      },
    });
    const linked = await events.createEvent({
      name: "Linked stage",
      folderId: folder.id,
    });
    await events.updateEvent(linked.id, {
      dataSource: { sourceId: "one", competitionId: 42 },
    });
    await events.updateFolder(folder.id, {
      defaults: {
        templateSet: "classic",
        presentation: { logoUrl: "/assets/new.png", identity: "flag" },
        dataSource: { sourceId: "one" },
      },
    });
    let current = await events.loadEvent(linked.id);
    expect(current.settings?.presentation).toMatchObject({
      logoUrl: "/assets/new.png",
      identity: "flag",
    });
    expect(current.dataSource?.competitionId).toBe(42);
    await events.updateEvent(linked.id, {
      settings: {
        ...current.settings,
        presentation: {
          ...current.settings?.presentation,
          logoUrl: "/assets/override.png",
        },
      },
    });
    events.setLiveEvent(linked.id);
    await events.updateFolder(folder.id, {
      defaults: {
        templateSet: "classic",
        presentation: { logoUrl: "/assets/later.png", identity: "both" },
        dataSource: { sourceId: "two" },
      },
    });
    current = await events.loadEvent(linked.id);
    expect(current.settings?.presentation?.identity).toBe("flag");
    expect(current.dataSource?.sourceId).toBe("one");
    events.setLiveEvent(null);
    current = await events.loadEvent(linked.id);
    expect(current.settings?.presentation).toMatchObject({
      logoUrl: "/assets/override.png",
      identity: "both",
    });
    expect(current.folderInheritance?.branding).toBe(false);
    expect(current.dataSource?.sourceId).toBe("two");
    expect(current.dataSource?.competitionId).toBeUndefined();
    expect((await events.getPages(linked.id))[0].dataSource?.sourceId).toBe(
      "two",
    );
  });
  it("invalidates a saved data test when the competition changes and really clears page sources", async () => {
    const event = await events.createEvent({ name: "Data changes" });
    await events.updateEvent(event.id, {
      dataSource: { sourceId: "source", competitionId: 1 },
    });
    const stored = await pm.loadProject(event.id);
    stored.dataSource!.lastCheck = { ok: true, at: Date.now() };
    await pm.saveProject(stored);
    const changed = await events.updateEvent(event.id, {
      dataSource: { ...stored.dataSource!, competitionId: 2 },
    });
    expect(changed.dataSource?.lastCheck).toBeUndefined();
    await events.updateEvent(event.id, { dataSource: { sourceId: "" } });
    expect((await events.getPages(event.id))[0].dataSource).toBeUndefined();
  });
  it('also defers shared defaults while graphics remain on air outside Live', async () => {
    const folder = events.createFolder('On-air protection');
    await events.updateFolder(folder.id, { defaults: { presentation: { logoUrl: '/assets/one.png' } } });
    const event = await events.createEvent({ name: 'Race', folderId: folder.id });
    mock.onAir = [{ projectId: event.id, isPlaying: true }];
    await events.updateFolder(folder.id, { defaults: { presentation: { logoUrl: '/assets/two.png' } } });
    expect((await events.loadEvent(event.id)).settings?.presentation?.logoUrl).toBe('/assets/one.png');
    mock.onAir = [];
    expect((await events.loadEvent(event.id)).settings?.presentation?.logoUrl).toBe('/assets/two.png');
  });
});

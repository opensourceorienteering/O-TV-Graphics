import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  handlers: new Map<string, (...a: any[]) => any>(),
  windows: [] as any[],
  mapped: vi.fn(async () => ({ results: [{ name: "Runner" }] })),
  startList: { entries: [], updated: 0 } as any,
  templateKind: "results",
  play: vi.fn(),
  navigation: vi.fn(async (..._args: any[]) => {}),
  packaged: false,
  activate: vi.fn(async (_wanted: any) => ({ web: true, ndi: false, errors: [] as string[] })),
  deactivate: vi.fn(async () => {}),
  project: {
    id: "event",
    name: "Race",
    info: { date: "2026-10-26" },
    settings: { presentation: { identity: "flag" } },
  },
}));
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return mock.packaged;
    },
  },
  screen: {
    getAllDisplays: () => [
      { id: 1, workArea: { x: 0, y: 0, width: 1400, height: 900 } },
      { id: 2, workArea: { x: 1400, y: 0, width: 1920, height: 1080 } },
    ],
    getPrimaryDisplay: () => ({ id: 1 }),
  },
  ipcMain: { handle: (name: string, fn: any) => mock.handlers.set(name, fn) },
  dialog: {},
  BrowserWindow: class {
    options: any;
    destroyed = false;
    callbacks = new Map();
    focus = vi.fn();
    webContents = { send: vi.fn() };
    constructor(options: any) {
      this.options = options;
      mock.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    loadURL = vi.fn(async (...args: any[]) => mock.navigation(...args));
    loadFile = vi.fn(async (...args: any[]) => mock.navigation(...args));
    on(name: string, cb: any) {
      this.callbacks.set(name, cb);
    }
    close() {
      this.destroyed = true;
      this.callbacks.get("closed")?.();
    }
    static getAllWindows() {
      return mock.windows;
    }
  },
}));
vi.mock("../../utils/logger", () => ({ getLogger: () => ({ warn: vi.fn() }) }));
vi.mock("../../projects/ProjectManager", () => ({
  getProjectManager: () => ({}),
}));
vi.mock("../../projects/RundownManager", () => ({
  getRundownManager: () => ({
    loadRundown: async () => ({
      id: "page",
      items: [
        {
          id: "cue",
          templateId: "tpl",
          fields: { title: "Prepared" },
          liveResultsData: { dataSourceValues: { className: "H21" } },
        },
      ],
      dataSource: { competitionId: 1, sourceId: "source" },
    }),
  }),
}));
vi.mock("../../data/DataSourceRegistry", () => ({
  getDataSourceRegistry: () => ({}),
}));
vi.mock("../../data/DataSourceFieldMapper", () => ({
  DataSourceFieldMapper: { fetchAndMapData: mock.mapped },
}));
vi.mock("../../templates/OGrafManager", () => ({
  getTemplateManager: () => ({
    getAllTemplates: () => [
      {
        manifest: {
          id: "tpl",
          name: "Results",
          v_olgrafik_kind: mock.templateKind,
        },
        setId: "standard",
        directoryName: "sets/standard/results",
        dataSourceConfig: {},
      },
    ],
  }),
}));
vi.mock("../outputHandlers", () => ({
  activateLiveOutputs: mock.activate,
  deactivateLiveOutputs: mock.deactivate,
}));
vi.mock("../../events/EventService", () => ({
  setLiveEvent: () => {},
  getLiveEventId: () => null,
  liveOutputsFor: (p: any) => p.liveOutputs ?? { web: true, ndi: false },
  loadEvent: async () => mock.project,
  loadStartList: () => mock.startList,
  applyStartList: (_id: string, data: any) => data,
}));
// Real preview store (LiveControl); the desk builds the preview data
vi.mock("../../events/Desk", () => ({
  deskPreviewData: async (_id: string, draft: any) => {
    if (draft.key === "missing") throw new Error("Graphic is not installed");
    return {
      template: { manifest: { id: "tpl", name: "Results" } },
      data: { ...draft.fields, ...(await mock.mapped()), presentation: mock.project.settings.presentation, event: { name: mock.project.name } },
    };
  },
  deskShow: mock.play,
}));
vi.mock("../../utils/config", () => ({ getConfig: () => ({ output: { web: { enabled: true } } }) }));
vi.mock("../../output/NDIOutputManager", () => ({ ndiOutputManager: { getStatus: () => ({ active: false }) } }));
import { registerEventHandlers } from "../eventHandlers";
const invoke = (name: string, ...args: any[]) =>
  mock.handlers.get(name)!(null, ...args);

describe("Event monitor and preview IPC", () => {
  beforeEach(() => {
    mock.handlers.clear();
    mock.packaged = false;
    mock.navigation.mockReset().mockResolvedValue(undefined);
    mock.mapped
      .mockReset()
      .mockResolvedValue({ results: [{ name: "Runner" }] });
    mock.startList = { entries: [], updated: 0 };
    mock.templateKind = "results";
    delete (mock.project as any).dataSource;
    registerEventHandlers();
  });
  it("opens independent monitors on the secondary screen, reuses them and docks them", async () => {
    await invoke("window:openMonitor", "program");
    await invoke("window:openMonitor", "preview");
    const [program, preview] = mock.windows.slice(-2);
    expect(program.options.x).toBeGreaterThanOrEqual(1400);
    expect(program.options.webPreferences.contextIsolation).toBe(true);
    expect(program.loadURL).toHaveBeenCalledWith(
      "http://localhost:5173/?monitor=program",
    );
    expect(preview.loadURL).toHaveBeenCalledWith(
      "http://localhost:5173/?monitor=preview",
    );
    await invoke("window:openMonitor", "program");
    expect(program.focus).toHaveBeenCalledOnce();
    expect((await invoke("window:monitors")).data).toEqual([
      "program",
      "preview",
    ]);
    await invoke("window:closeMonitor", "program");
    expect((await invoke("window:monitors")).data).toEqual(["preview"]);
    preview.close();
    expect((await invoke("window:monitors")).data).toEqual([]);
  });
  it("prepares preview data without issuing any program playback action", async () => {
    const result = await invoke("preview:draft", "event", { key: "results", values: { className: "H21" }, fields: { title: "Prepared" } });
    expect(result.success).toBe(true);
    expect(result.data.payload.name).toBe("Results table");
    expect(result.data.payload.data).toMatchObject({
      title: "Prepared",
      results: [{ name: "Runner" }],
      presentation: { identity: "flag" },
      event: { name: "Race" },
    });
    expect((await invoke("preview:get")).data).toEqual(result.data);
    expect(mock.play).not.toHaveBeenCalled();
  });
  it("uses start-list runners as synthetic results only in the theme preview", async () => {
    (mock.project as any).dataSource = {
      sourceId: "liveresults-default",
      competitionId: 42,
    };
    mock.startList = {
      updated: 1,
      entries: [
        {
          key: "h21|anna|ok",
          className: "H21",
          name: "Anna Runner",
          club: "OK Test",
          bib: "17",
        },
        {
          key: "h21|bea|ifk",
          className: "H21",
          name: "Bea Runner",
          club: "IFK Test",
          bib: "23",
        },
      ],
    };
    mock.mapped.mockResolvedValueOnce({
      results: [{ name: "Anna Runner", time: "--:--", statusCode: 0 }],
    });

    const result = await invoke("preview:template", "event", "tpl", "H21");

    expect(result.success).toBe(true);
    expect(result.data.payload.name).toBe("Start-list preview · Results");
    expect(result.data.payload.data.results).toMatchObject([
      { position: 1, name: "Anna Runner", bib: "17", statusCode: 0 },
      { position: 2, name: "Bea Runner", bib: "23", statusCode: 0 },
    ]);
    expect(mock.play).not.toHaveBeenCalled();
  });
  it("keeps theme previews available with mock results when data fetching fails", async () => {
    (mock.project as any).dataSource = {
      sourceId: "liveresults-default",
      competitionId: 42,
    };
    mock.mapped.mockRejectedValueOnce(new Error("No results yet"));

    const result = await invoke("preview:template", "event", "tpl", "H21");

    expect(result.success).toBe(true);
    expect(result.data.payload.name).toBe("Sample data · Results");
    expect(result.data.payload.data.results).toHaveLength(6);
    expect(mock.play).not.toHaveBeenCalled();
  });
  it("supplies controls and split histories when split data is missing", async () => {
    mock.templateKind = "runner-splits";
    mock.mapped.mockResolvedValueOnce({
      results: [{ name: "Finished Runner", time: "35:42", statusCode: 0 }],
      splitControls: [],
    });

    const result = await invoke("preview:template", "event", "tpl", "H21");

    expect(result.success).toBe(true);
    expect(result.data.payload.data.splitControls).toHaveLength(4);
    expect(result.data.payload.data.results[0].splitTimes).toHaveLength(4);
    expect(result.data.payload.data.runnerName).toBe("Alex Andersson");
    expect(mock.play).not.toHaveBeenCalled();
  });
  it("clears stale preview when a new selection fails", async () => {
    await invoke("preview:draft", "event", { key: "results", values: {}, fields: {} });
    const result = await invoke("preview:draft", "event", { key: "missing", values: {}, fields: {} });
    expect(result.success).toBe(false);
    expect((await invoke("preview:get")).data.payload).toBeNull();
  });
  it("rejects arbitrary monitor types", async () => {
    expect((await invoke("window:openMonitor", "unknown")).success).toBe(false);
  });
  it("cleans up failed monitor navigation so Pop out can be retried", async () => {
    mock.navigation.mockRejectedValueOnce(new Error("Server unavailable"));
    expect((await invoke("window:openMonitor", "program")).success).toBe(false);
    expect((await invoke("window:monitors")).data).toEqual([]);
    expect((await invoke("window:openMonitor", "program")).success).toBe(true);
    await invoke("window:closeMonitor", "program");
  });
  it("loads packaged monitors from the bundled file with an explicit monitor query", async () => {
    mock.packaged = true;
    await invoke("window:openMonitor", "preview");
    const window = mock.windows[mock.windows.length - 1];
    expect(window.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/dist[\\/]index\.html$/), // either path separator (Windows)
      { search: "monitor=preview" },
    );
    expect(window.loadURL).not.toHaveBeenCalled();
    await invoke("window:closeMonitor", "preview");
  });
  it("keeps the newest preview when a slower previous selection finishes later", async () => {
    let release!: (value: any) => void;
    mock.mapped.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const draft = { key: "results", values: {}, fields: {} };
    const slow = invoke("preview:draft", "event", draft);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    mock.mapped.mockResolvedValueOnce({ results: [{ name: "Newest" }] });
    const newest = await invoke("preview:draft", "event", draft);
    release({ results: [{ name: "Old" }] });
    await slow;
    expect((await invoke("preview:get")).data).toEqual(newest.data);
    expect(newest.data.payload.data.results[0].name).toBe("Newest");
  });
});

describe("Entering and leaving Live", () => {
  beforeEach(() => {
    mock.handlers.clear();
    mock.activate.mockClear();
    mock.deactivate.mockClear();
    registerEventHandlers();
  });

  it("turns on the outputs the event chose in Plan and reports the ones that failed", async () => {
    (mock.project as any).liveOutputs = { web: false, ndi: true };
    mock.activate.mockResolvedValueOnce({ web: false, ndi: false, errors: ["NDI output could not start: no SDK"] });
    const res = await invoke("live:enter", "event");
    expect(mock.activate).toHaveBeenCalledWith({ web: false, ndi: true });
    expect(res.success).toBe(true);
    expect(res.data.outputErrors).toEqual(["NDI output could not start: no SDK"]);
    delete (mock.project as any).liveOutputs;
  });

  it("turns Live outputs off when Live ends", async () => {
    await invoke("live:exit");
    expect(mock.deactivate).toHaveBeenCalledOnce();
  });
});


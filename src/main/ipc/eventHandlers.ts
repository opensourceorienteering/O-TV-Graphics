import { timingClasses, mapTimingClasses } from '../data/timingScope';
import { resolveDeskDeclaration } from '../../shared/deskDeclaration';
/**
 * IPC for events (folders, Plan sections, start lists) and Live mode.
 */

import { DEFAULT_TEMPLATE_SET } from "../../shared/types/spx";
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from "electron";
import fs from "fs";
import path from "path";
import { getLogger } from "../utils/logger";
import { getProjectManager } from "../projects/ProjectManager";
import { getDataSourceRegistry } from "../data/DataSourceRegistry";
import * as events from "../events/EventService";
import * as live from "../events/LiveControl";
import * as desk from "../events/Desk";
import * as transfer from "../events/SettingsTransfer";
import * as clubNames from "../data/clubNames";
import { lookupWeather } from "../data/Weather";
import type { DeskDraft } from "../../shared/desk";
import { DataSourceFieldMapper } from "../data/DataSourceFieldMapper";
import { zonedWallTimeToEpochMs } from "../data/liveTime";
import { getTemplateManager } from "../templates/OGrafManager";
import { activateLiveOutputs, deactivateLiveOutputs } from "./outputHandlers";
import type { StartListEntry } from "../../shared/types/event";
import { previewDataForKind, type PreviewData } from "../../shared/capabilities";

const logger = getLogger();

/**
 * While an event is in Live its timing connection is re-tested in the background (on entry
 * when the last test is older than 10 minutes, then every 10 minutes), so the operator
 * never has to press "Test connection" during a broadcast.
 */
let dataTestTimer: ReturnType<typeof setInterval> | null = null;
function keepDataTested(projectId: string | null) {
  if (dataTestTimer) clearInterval(dataTestTimer);
  dataTestTimer = null;
  if (!projectId) return;
  const test = async (onlyIfOld: boolean) => {
    try {
      const project = await events.loadEvent(projectId);
      const last = project.dataSource?.lastCheck?.at ?? 0;
      if (!project.dataSource?.sourceId || !project.dataSource.competitionId) return;
      if (onlyIfOld && Date.now() - last < 10 * 60_000) return;
      await events.testEventData(projectId);
    } catch (error) {
      logger.debug("Background data test failed", { error: String(error) });
    }
  };
  void test(true);
  dataTestTimer = setInterval(() => void test(false), 10 * 60_000);
  dataTestTimer.unref?.();
}

/** Wrap a handler: { success, data } or { success: false, error } */
function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { success: true, data: await fn(...args) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`IPC ${channel} failed`, { error: message });
      return { success: false, error: message };
    }
  });
}

async function eventClient(projectId: string) {
  const project = await events.loadEvent(projectId);
  const ds = project.dataSource;
  if (!ds?.sourceId || !ds.competitionId)
    throw new Error(
      "This event has no data source or competition yet (Settings → Data)",
    );
  const instance: any = getDataSourceRegistry().get(ds.sourceId);
  if (!instance) throw new Error(`Data source "${ds.sourceId}" is not set up`);
  if (!instance.initialized) await instance.initialize();
  const client =
    typeof instance.getClient === "function" ? instance.getClient() : null;
  if (!client) throw new Error("This data source has no live results");
  return { client, competitionId: ds.competitionId as number };
}

// Pop-out monitor windows (Program / Preview on another screen)
const monitors = new Map<string, BrowserWindow>();
let liveEntryVersion = 0;

const PREVIEW_SPLIT_CONTROLS = [
  { code: 31, name: "Radio 1", short: "R1" },
  { code: 45, name: "Radio 2", short: "R2" },
  { code: 62, name: "Arena passage", short: "Arena" },
  { code: 78, name: "Radio 3", short: "R3" },
];

const MOCK_PREVIEW_RUNNERS: StartListEntry[] = [
  { key: "mock-1", className: "H21", name: "Alex Andersson", club: "OK Orion", country: "SWE", bib: "31" },
  { key: "mock-2", className: "H21", name: "Mikael Berg", club: "IFK Göteborg", country: "SWE", bib: "47" },
  { key: "mock-3", className: "H21", name: "Jonas Lind", club: "Tampereen Pyrintö", country: "FIN", bib: "12" },
  { key: "mock-4", className: "H21", name: "Emil Novak", club: "OK Kamenice", country: "CZE", bib: "56" },
  { key: "mock-5", className: "H21", name: "Lars Nilsen", club: "Nydalens SK", country: "NOR", bib: "8" },
  { key: "mock-6", className: "H21", name: "Paul Martin", club: "Kalevan Rasti", country: "FIN", bib: "22" },
];

/** Synthetic result rows for the Plan theme preview only. */
function previewResults(entries: StartListEntry[]) {
  const nextStart = Math.ceil((Date.now() + 5 * 60_000) / 60_000) * 60_000;
  return entries.slice(0, 10).map((entry, index) => {
    const seconds = 35 * 60 + 42 + index * 17 + Math.floor(index / 2) * 6;
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    return {
      position: index + 1,
      place: index + 1,
      name: entry.name,
      club: entry.club,
      country: entry.country || ["SWE", "FIN", "NOR", "CZE"][index % 4],
      bib: entry.bib || undefined, // never a virtual bib: those are for operators only
      time: `${minutes}:${remainder}`,
      diff: index ? `+${Math.floor((seconds - 2142) / 60)}:${String((seconds - 2142) % 60).padStart(2, "0")}` : "",
      statusCode: 0,
      progress: 100,
      startTimeMs: entry.startTimeMs || nextStart + Math.floor(index / 2) * 2 * 60_000,
      startTime: new Date(
        entry.startTimeMs || nextStart + Math.floor(index / 2) * 2 * 60_000,
      ).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      splitTimes: PREVIEW_SPLIT_CONTROLS.map((control, controlIndex) => ({
        code: control.code,
        time: (11 * 60 + controlIndex * 7 * 60 + index * 14) * 100,
        place: ((index + controlIndex * 2) % Math.min(entries.length, 8)) + 1,
        timeplus: index ? (index * 13 + controlIndex * 4) * 100 : 0,
        status: 0,
      })),
    };
  });
}

function hasUsablePreviewData(needs: PreviewData | undefined, mapped: Record<string, any>) {
  const results = Array.isArray(mapped.results) ? mapped.results : [];
  if (!results.length) return false;
  if (needs === "splits")
    return (
      Array.isArray(mapped.splitControls) &&
      mapped.splitControls.length > 0 &&
      results.some(
        (result: any) =>
          Array.isArray(result?.splitTimes) && result.splitTimes.length > 0,
      )
    );
  if (needs === "starts")
    return results.some(
      (result: any) =>
        Number.isFinite(result?.startTimeMs) || !!result?.startTime,
    );
  return results.some((result: any) => {
    const time = String(result?.time || "").trim();
    return (
      (!!time && time !== "--:--" && time !== "0:00") ||
      Number(result?.statusCode || 0) !== 0
    );
  });
}

export function registerEventHandlers(): void {
  // --- folders ---
  handle("folder:list", () => events.listFolders());
  handle("folder:create", (name: string) => events.createFolder(name));
  handle("folder:update", (id: string, updates: any) =>
    events.updateFolder(id, updates),
  );
  handle("folder:delete", (id: string) => events.deleteFolder(id));

  // --- events ---
  handle("event:list", () => events.listEvents());
  handle(
    "event:create",
    (options: {
      name: string;
      folderId?: string;
      copyFrom?: string;
      templateSet?: string;
    }) => events.createEvent(options),
  );
  handle("event:get", async (id: string) => ({
    event: await events.loadEvent(id),
    pages: await events.getPages(id),
    summary: await events.summarize(id),
  }));
  handle("event:update", (id: string, updates: any) =>
    events.updateEvent(id, updates),
  );
  handle("event:delete", async (id: string) => {
    if (events.getLiveEventId() === id)
      throw new Error("This event is in Live. End Live on the desk before deleting it.");
    await getProjectManager().deleteProject(id);
  });
  handle("event:test", (id: string) => events.testEventData(id));
  handle("event:classes", async (id: string) => {
    const { client, competitionId } = await eventClient(id);
    return (await client.getClasses(competitionId)).data.map(
      (c: any) => c.className,
    );
  });
  handle("event:controls", async (id: string, className: string) => {
    const { client, competitionId } = await eventClient(id);
    const classes = await timingClasses(client, competitionId, className);
    const snapshots = await mapTimingClasses<any>(classes, name => client.getClassResults(competitionId, name, { maxAgeMs: 30_000 }));
    // Names as graphics show them (Plan → Radio controls), with the data source's name
    const names = events.loadStartList(id).controlNames;
    const controls = snapshots.flatMap((res, index) => (res.data.splitcontrols ?? []).map((c: any) => {
      const code = typeof c === "object" ? c.code : c;
      const sourceName = typeof c === "object" ? c.name : `Control ${c}`;
      return { code, name: events.controlNameFor(names, classes[index], code) || sourceName, sourceName };
    }));
    return [...new Map(controls.map(c => [String(c.code), c])).values()];
  });

  // --- start lists ---
  handle("startlist:get", (id: string) => events.loadStartList(id));
  handle("startlist:refresh", (id: string, classes?: string[]) =>
    events.refreshStartListFromSource(id, classes),
  );
  handle("startlist:import", async (id: string) => {
    const win = BrowserWindow.getFocusedWindow();
    const pick = await dialog.showOpenDialog(win!, {
      title: "Import start list",
      properties: ["openFile"],
      filters: [
        { name: "IOF XML or CSV", extensions: ["xml", "csv", "txt", "tsv"] },
      ],
    });
    if (pick.canceled || !pick.filePaths[0]) return null;
    const file = pick.filePaths[0];
    return /\.xml$/i.test(file)
      ? events.importStartListIofXml(id, file)
      : events.importStartListCsv(id, file);
  });
  handle("startlist:assignBibs", (id: string, options: any) =>
    events.assignVirtualBibs(id, options),
  );
  handle("startlist:clearBibs", (id: string, classes?: string[]) =>
    events.clearVirtualBibs(id, classes),
  );
  handle("startlist:update", async (id: string, key: string, updates: any) => {
    if (typeof updates.startTimeText === "string") {
      const project = await events.loadEvent(id);
      if (!project.info?.date)
        throw new Error(
          "Set the event date in Settings → Event info before editing start times",
        );
      if (!updates.startTimeText.trim()) updates.startTimeMs = undefined;
      else {
        const m = /^([01]?[0-9]|2[0-3]):([0-5][0-9])(?::([0-5][0-9]))?$/.exec(
          updates.startTimeText.trim(),
        );
        if (!m) throw new Error("Use HH:MM or HH:MM:SS for the start time");
        const [year, month, day] = project.info.date.split("-").map(Number);
        updates.startTimeMs = zonedWallTimeToEpochMs(
          year,
          month,
          day,
          (+m[1] * 3600 + +m[2] * 60 + Number(m[3] || 0)) * 1000,
          project.info.timeZone || "Europe/Stockholm",
        );
      }
    }
    return events.updateStartListEntry(id, key, updates);
  });
  handle("startlist:updatePreferences", (id: string, updates: any) =>
    events.updateStartListPreferences(id, updates),
  );
  /** Clubs in the start list and the names graphics will show for them */
  handle("startlist:clubs", (id: string) => events.startListClubs(id));
  /** The app-wide club name library (app settings) */
  handle("clubNames:list", () => clubNames.libraryRows());
  handle("clubNames:set", (updates: Record<string, string>) => clubNames.setClubNames(updates));
  handle("startlist:exportPdf", async (id: string, classes?: string[]) => {
    const project = await events.loadEvent(id);
    const list = events.loadStartList(id);
    if (!list.entries.length) throw new Error("The start list is empty");
    const win = BrowserWindow.getFocusedWindow();
    const save = await dialog.showSaveDialog(win!, {
      title: "Export start list PDF",
      defaultPath: `${project.name.replace(/[\\/:*?"<>|]+/g, "-")} start list.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (save.canceled || !save.filePath) return null;
    const pdfWin = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, javascript: false },
    });
    try {
      await pdfWin.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(events.startListHtml(project, list, classes)),
      );
      const pdf = await pdfWin.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      });
      fs.writeFileSync(save.filePath, pdf);
    } finally {
      pdfWin.destroy();
    }
    return save.filePath;
  });

  // --- live ---
  handle("live:enter", async (id: string) => {
    const version = ++liveEntryVersion;
    const project = await events.loadEvent(id);
    let outputErrors: string[] = [];
    if (version === liveEntryVersion) {
      events.setLiveEvent(id);
      keepDataTested(id);
      // The outputs chosen in Plan → Output turn on with Live, however the desk was opened
      outputErrors = (await activateLiveOutputs(events.liveOutputsFor(project))).errors;
    }
    return { ...(await live.controlState()), outputErrors };
  });
  handle("live:exit", async () => {
    liveEntryVersion++;
    events.setLiveEvent(null);
    keepDataTested(null);
    await deactivateLiveOutputs();
    return null;
  });
  handle("live:state", () => live.controlState());
  /** The draft in Preview; the desk adopts drafts that a control surface prepared */
  handle("live:prepared", () => live.getPrepared());
  handle("weather:lookup", (input: { address?: string; latitude?: number; longitude?: number }) =>
    lookupWeather(input),
  );
  /** The venue's current weather as the desk's Weather graphic uses it */
  handle("desk:weather", (id: string, force?: boolean) => desk.deskWeather(id, !!force));

  handle("control:openModule", async () => {
    const folder = path.join(__dirname, "../../companion");
    const error = await shell.openPath(folder);
    if (error) throw new Error(error);
    return null;
  });

  // --- live desk (template-driven operation: prepare a draft, then Show) ---
  handle("desk:templates", (id: string) => desk.deskTemplates(id));
  handle("desk:state", (id: string) => desk.deskState(id));
  handle("desk:show", (id: string, draft: DeskDraft) => desk.deskShow(id, draft));
  handle("desk:update", (id: string, draft: DeskDraft) => desk.deskUpdate(id, draft));
  handle("desk:hide", (id: string, key?: string) => desk.deskHide(id, key));
  handle("desk:hideAll", (id: string) => desk.deskHideAll(id));
  handle("desk:page", (id: string, delta: 1 | -1) => desk.deskPageStep(id, delta));
  handle("desk:favorites", (id: string) => desk.loadDeskFavorites(id));
  handle("desk:saveFavorite", (id: string, label: string, draft: DeskDraft) => desk.saveDeskFavorite(id, label, draft));
  handle("desk:deleteFavorite", (id: string, key: string, favId: string) => desk.deleteDeskFavorite(id, key, favId));
  handle("desk:catalog", () => desk.commandDefinitions());
  handle("desk:commands", () => desk.loadDeskCommands());
  handle("desk:saveCommands", (map: Record<string, string>) => desk.saveDeskCommands(map));

  // Settings export / import (Settings → Templates): one JSON file with the chosen parts
  handle("event:exportSettings", async (id: string, parts?: transfer.SettingsPart[]) => {
    const file = await transfer.buildSettingsExport(id, parts);
    const safe = (file.from || "event").replace(/[^\w\- ]+/g, "").trim() || "event";
    const win = BrowserWindow.getFocusedWindow();
    const options = { title: "Export settings", defaultPath: `${safe} settings.json`, filters: [{ name: "Split Control settings", extensions: ["json"] }] };
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return { saved: null };
    fs.writeFileSync(res.filePath, JSON.stringify(file, null, 2));
    return { saved: res.filePath };
  });
  handle("event:pickSettingsFile", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const options = { title: "Import settings", properties: ["openFile" as const], filters: [{ name: "Split Control settings", extensions: ["json"] }] };
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths[0]) return null;
    let raw: unknown;
    try { raw = JSON.parse(fs.readFileSync(res.filePaths[0], "utf8")); } catch { throw new Error("The file is not valid JSON"); }
    const { file, parts } = transfer.readSettingsFile(raw);
    return { file, parts, path: res.filePaths[0] };
  });
  handle("event:importSettings", (id: string, file: unknown, parts?: transfer.SettingsPart[]) =>
    transfer.applySettingsImport(id, file, parts));
  /** Load a draft into the Preview monitor (never touches the output) */
  handle("preview:draft", (projectId: string, draft: DeskDraft) =>
    live.prepare(projectId, draft),
  );
  handle("preview:clear", () => live.clearPreview());
  // Preview has its own renderer and data. It never sends program playback commands.
  handle("preview:get", () => live.getPreview());

  handle("output:pattern", async (projectId: string, show: boolean) => {
    const { getPlaybackEngine } = await import("../playback/PlaybackEngine");
    const cue = await events.testPatternCue(projectId);
    if (show)
      await getPlaybackEngine().playItem(projectId, cue.pageId, cue.itemId);
    else await getPlaybackEngine().stopItem(projectId, cue.pageId, cue.itemId);
    return null;
  });

  handle(
    "preview:template",
    async (
      projectId: string,
      templateId: string,
      className?: string,
      draft?: { templateSet?: string; presentation?: Record<string, unknown> },
    ) => {
      const request = live.beginPreview();
      const project = await events.loadEvent(projectId);
      const previewSet = draft?.templateSet || project.templateSet || DEFAULT_TEMPLATE_SET;
      const template = getTemplateManager()
        .getAllTemplates()
        .find(
          (t) =>
            t.manifest.id === templateId &&
            t.setId === previewSet,
        );
      if (!template) throw new Error("Choose a graphic from this event’s theme");
      const kind = String((template.manifest as any).v_olgrafik_kind || "");
      const entry = template.desk ?? resolveDeskDeclaration(template.manifest).desk;
      const needs = entry ? entry.previewData : previewDataForKind(kind);
      const defaults = Object.fromEntries(
        Object.entries((template.manifest.schema as any)?.properties || {})
          .filter(([, v]: any) => v.default !== undefined)
          .map(([key, v]: any) => [key, v.default]),
      );
      let previewSource: "real" | "start-list" | "mock" = "mock";
      const startList = events.loadStartList(projectId);
      const selectedClass =
        className ||
        startList.favouriteClasses?.find((name) =>
          startList.entries.some((entry) => entry.className === name),
        ) ||
        startList.entries[0]?.className ||
        "H21";
      const classEntries = startList.entries.filter(
        (entry) => entry.className === selectedClass,
      );
      const previewEntries = classEntries.length
        ? classEntries
        : MOCK_PREVIEW_RUNNERS.map((entry) => ({
            ...entry,
            className: selectedClass,
          }));
      const first = previewEntries[0];
      let data: any = {
        ...defaults,
        title: project.name,
        name: first.name,
        targetTime: "12:00:00",
        className: selectedClass,
        runnerName: first.name,
        runnerClub: first.club,
        runnerBib: first.bib,
        results: previewResults(previewEntries),
        splitControls: PREVIEW_SPLIT_CONTROLS,
        controlCode: "45",
        controlName: "Radio 2",
        series: project.info?.series || "International Orienteering",
        place: project.info?.location || "Arena and forest",
        date: project.info?.date || "2026-07-18",
        club: first.club,
        country: first.country || "SWE",
        bib: first.bib,
        label: "Race time",
        mode: "time-of-day",
        time: "12:00:00",
        length: "12.4",
        climb: "420",
        controls: "24",
        winningTime: "68 min",
        startInterval: "2 min",
        legs: "Long distance",
        condition: "Partly cloudy",
        temperature: "18",
        wind: "9",
        humidity: "62",
      };
      if (
        template.dataSourceConfig &&
        project.dataSource?.competitionId &&
        selectedClass
      ) {
        try {
          const mapped = await DataSourceFieldMapper.fetchAndMapData(
            template.dataSourceConfig,
            project.dataSource.competitionId,
            {
              className: selectedClass,
              ...(first
                ? {
                    runnerName: first.name,
                    runnerClub: first.club,
                    runnerId: first.name,
                  }
                : {}),
            },
            {
              competitionNameOverride: project.name,
              raceLocation: project.info?.location,
            },
            project.dataSource.sourceId,
          );
          const hasRealResults = hasUsablePreviewData(needs, mapped);
          data = { ...data, ...mapped };
          if (hasRealResults) previewSource = "real";
        } catch (error) {
          // Theme preview is intentionally resilient. Live playback never uses
          // this fallback path or any of the synthetic rows above.
          logger.warn("Theme preview is using fallback data", {
            projectId,
            templateId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (previewSource !== "real" && !!needs) {
        data.results = previewResults(previewEntries);
        data.className = selectedClass;
        data.splitControls = PREVIEW_SPLIT_CONTROLS;
        data.runnerName = first.name;
        data.runnerClub = first.club;
        data.runnerBib = first.bib;
        previewSource = classEntries.length ? "start-list" : "mock";
      } else if (previewSource !== "real" && classEntries.length) {
        previewSource = "start-list";
      }
      data = {
        ...events.applyStartList(projectId, data),
        presentation:
          draft?.presentation || project.settings?.presentation || {},
        event: {
          ...project.info,
          name: project.name,
          date: project.info?.date || "",
          location: project.info?.location || "",
        },
      };
      return live.finishPreview(request, {
        template,
        data,
        page: 1,
        name: `${
          previewSource === "start-list"
            ? "Start-list preview · "
            : previewSource === "mock"
              ? "Sample data · "
              : ""
        }${template.manifest.name}`,
      });
    },
  );

  // --- pop-out monitors ---
  handle("window:openMonitor", async (kind: "program" | "preview" | "both") => {
    if (kind !== "program" && kind !== "preview" && kind !== "both")
      throw new Error("Unknown monitor");
    // One combined window replaces separate ones (and the other way round)
    if (kind === "both") for (const k of ["program", "preview"]) monitors.get(k)?.close();
    else monitors.get("both")?.close();
    const existing = monitors.get(kind);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return true;
    }
    // Prefer a second display when there is one
    const displays = screen.getAllDisplays();
    const target =
      displays.find((d) => d.id !== screen.getPrimaryDisplay().id) ??
      screen.getPrimaryDisplay();
    const { x, y, width, height } = target.workArea;
    const w = kind === "both" ? Math.min(1320, width) : Math.min(1280, width, Math.max(480, ((height - 100) * 16) / 9)),
      h = kind === "both" ? Math.min(912, height) : Math.round((w * 9) / 16) + 40;
    const win = new BrowserWindow({
      x: x + Math.round((width - w) / 2),
      y: y + Math.round((height - h) / 2),
      width: w,
      height: h,
      title: kind === "program" ? "Split Control – Program" : kind === "preview" ? "Split Control – Preview" : "Split Control – Preview & Program",
      minWidth: 480,
      minHeight: 320,
      backgroundColor: "#000000",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
      },
    });
    win.on("closed", () => {
      if (monitors.get(kind) === win) monitors.delete(kind);
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send("fromMain", { type: "monitorClosed", kind }),
      );
    });
    monitors.set(kind, win);
    try {
      if (!app.isPackaged)
        await win.loadURL(`http://localhost:5174/?monitor=${kind}`);
      else
        await win.loadFile(path.join(__dirname, "../../dist/index.html"), {
          search: `monitor=${kind}`,
        });
    } catch (error) {
      if (monitors.get(kind) === win) monitors.delete(kind);
      if (!win.isDestroyed()) win.close();
      throw new Error(
        `Could not open ${kind} monitor. Try Pop out again. ${error instanceof Error ? error.message : ""}`,
      );
    }
    return true;
  });
  handle("window:closeMonitor", (kind: string) => {
    monitors.get(kind)?.close();
    return true;
  });
  handle("window:monitors", () => [...monitors.keys()]);
}

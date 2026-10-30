/**
 * Events: folders, event settings, readiness, start lists and live control.
 *
 * An event is a project. Its graphics play from hidden rundown pages (the Live desk's
 * "__desk__" page and the output test page); the event's data source and details are written
 * to every page so the playback engine, the data mapper and live polling work as before.
 */

import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { getLogger } from "../utils/logger";
import { getConfig } from "../utils/config";
import { getProjectManager } from "../projects/ProjectManager";
import { getRundownManager } from "../projects/RundownManager";
import { getTemplateManager } from "../templates/OGrafManager";
import { getDataSourceRegistry } from "../data/DataSourceRegistry";
import { competitionClock, startTimeEpochMs } from "../data/liveTime";
import { IofXmlBackend } from "../data/sources/IofXmlBackend";
import { clubNameRows } from "../data/clubNames";
import type {
  SPXProject,
  SPXRundown,
} from "../../shared/types/spx";
import { DEFAULT_TEMPLATE_SET } from "../../shared/types/spx";
import { SYSTEM_TEMPLATE_SET } from "../../shared/types/ograf";
import type {
  EventFolder,
  EventLiveOutputs,
  EventStartList,
  ClubNameRow,
  EventSummary,
  ReadinessItem,
  StartListEntry,
  VirtualBibOptions,
} from "../../shared/types/event";
import { inheritFolder, breakChangedInheritance } from "./folderInheritance";
import {
  templateGraphicKind,
} from "../templates/templateSets";

const logger = getLogger();

/** Hidden page used for one-off runner graphics taken from Live */
export const QUICK_PAGE_NAME = "__quick__";

export const entryKey = (className: string, name: string, club: string) =>
  `${className}|${String(name).trim().toLowerCase()}|${String(club ?? "")
    .trim()
    .toLowerCase()}`;

// --- folders ------------------------------------------------------------------------------

function dataroot(): string {
  return getConfig().general.dataroot;
}

function foldersPath(): string {
  return path.join(dataroot(), "folders.json");
}

export function listFolders(): EventFolder[] {
  try {
    return JSON.parse(fs.readFileSync(foldersPath(), "utf-8"));
  } catch {
    return [];
  }
}

function saveFolders(folders: EventFolder[]): void {
  fs.mkdirSync(path.dirname(foldersPath()), { recursive: true });
  fs.writeFileSync(foldersPath(), JSON.stringify(folders, null, 2));
}

export function createFolder(name: string): EventFolder {
  const folder: EventFolder = {
    id: uuidv4(),
    name: name.trim() || "New folder",
    created: Date.now(),
  };
  saveFolders([...listFolders(), folder]);
  return folder;
}

export async function updateFolder(
  id: string,
  updates: Partial<EventFolder>,
): Promise<EventFolder> {
  if (updates.defaults?.info?.timeZone) {
    try {
      new Intl.DateTimeFormat("en", {
        timeZone: updates.defaults.info.timeZone,
      });
    } catch {
      throw new Error("Enter a valid folder time zone");
    }
  }
  const folders = listFolders();
  const i = folders.findIndex((f) => f.id === id);
  if (i < 0) throw new Error("Folder not found");
  folders[i] = { ...folders[i], ...updates, id };
  saveFolders(folders);
  if (updates.defaults) {
    for (const item of await getProjectManager().listProjects()) {
      const project = await getProjectManager().loadProject(item.id);
      if (project.folderId === id && project.id !== liveEventId)
        await loadEvent(project.id);
    }
  }
  return folders[i];
}

/** Delete a folder; its events stay and move to "No folder" */
export async function deleteFolder(id: string): Promise<void> {
  saveFolders(listFolders().filter((f) => f.id !== id));
  const pm = getProjectManager();
  for (const item of await pm.listProjects()) {
    const project = await pm.loadProject(item.id);
    if (project.folderId === id)
      await pm.updateProject(project.id, { folderId: undefined });
  }
}

// --- events -------------------------------------------------------------------------------

async function pagesOf(
  projectId: string,
  includeQuick = false,
): Promise<SPXRundown[]> {
  const rm = getRundownManager();
  const list = await rm.listRundowns(projectId);
  const pages: SPXRundown[] = [];
  for (const r of list) {
    const rundown = await rm.loadRundown(projectId, r.id);
    // Hidden pages ("__desk__", "__test__"): used internally, never listed
    if (!includeQuick && rundown.name.startsWith("__")) continue;
    pages.push(rundown);
  }
  // Oldest first: the order pages were made
  return pages.sort((a, b) => a.created - b.created);
}

/** Pages of an event (always at least one) */
export async function getPages(projectId: string): Promise<SPXRundown[]> {
  let pages = await pagesOf(projectId);
  if (!pages.length) {
    await getRundownManager().createRundown({ projectId, name: "Graphics" });
    await syncPages(await getProjectManager().loadProject(projectId));
    pages = await pagesOf(projectId);
  }
  return pages;
}

/**
 * Write the event's data source and details to all its pages (rundowns), so playback,
 * the mapper and live polling see the same settings on every page.
 * Projects from before events take their data source from their first page.
 */
export async function syncPages(project: SPXProject): Promise<void> {
  const rm = getRundownManager();
  for (const r of await pagesOf(project.id, true)) {
    const ds = project.dataSource;
    r.dataSource = ds?.sourceId
      ? {
          sourceId: ds.sourceId,
          baseUrl: ds.baseUrl || "",
          competitionId: ds.competitionId,
          competitionName: ds.competitionName,
        }
      : ds === undefined
        ? r.dataSource
        : undefined;
    r.settings = {
      ...(r.settings || {}),
      competitionNameOverride: project.name,
      raceLocation: project.info?.location || r.settings?.raceLocation || "",
    };
    await rm.saveRundown(r);
  }
}

async function mayApplyFolderDefaults(projectId: string): Promise<boolean> {
  if (projectId === liveEventId) return false;
  try {
    const { getPlaybackEngine } = await import("../playback/PlaybackEngine");
    return !getPlaybackEngine()
      .getActiveGraphics()
      .some((g) => g.projectId === projectId && g.isPlaying);
  } catch {
    return true;
  } // Playback is not initialized during project migration/tests.
}

/** Load an event, adopting the data source of its first page for projects made before events */
export async function loadEvent(projectId: string): Promise<SPXProject> {
  const pm = getProjectManager();
  let project = await pm.loadProject(projectId);
  if (project.folderId && (await mayApplyFolderDefaults(project.id))) {
    const inherited = inheritFolder(
      project,
      listFolders().find((f) => f.id === project.folderId),
    );
    if (JSON.stringify(inherited) !== JSON.stringify(project)) {
      project = { ...inherited, modified: Date.now() };
      await pm.saveProject(project);
      await syncPages(project);
    }
  }
  if (!project.dataSource) {
    const first = (await pagesOf(projectId)).find(
      (p) => p.dataSource?.sourceId,
    );
    if (first?.dataSource?.sourceId) {
      project.dataSource = {
        sourceId: first.dataSource.sourceId,
        baseUrl: first.dataSource.baseUrl,
        competitionId:
          first.dataSource.competitionId ?? first.liveResults?.competitionId,
        competitionName:
          first.dataSource.competitionName ??
          first.liveResults?.competitionName,
      };
      await pm.saveProject(project);
    }
  }
  return project;
}

export async function createEvent(options: {
  name: string;
  folderId?: string;
  copyFrom?: string;
  templateSet?: string;
}): Promise<SPXProject> {
  const pm = getProjectManager();
  const folder = options.folderId
    ? listFolders().find((f) => f.id === options.folderId)
    : undefined;
  const source = options.copyFrom ? await loadEvent(options.copyFrom) : null;
  const project = await pm.createProject({
    name: options.name,
    templateSet:
      options.templateSet ||
      source?.templateSet ||
      folder?.defaults?.templateSet ||
      DEFAULT_TEMPLATE_SET,
    settings:
      source?.settings ??
      (folder?.defaults?.presentation
        ? { presentation: folder.defaults.presentation as any }
        : undefined),
  });
  project.folderId = options.folderId ?? source?.folderId;
  // Duplicated events are explicit copies; fresh events can follow folder settings.
  if (folder?.defaults && !source)
    project.folderInheritance = {
      look:
        !options.templateSet ||
        options.templateSet === folder.defaults.templateSet,
      branding: true,
      data: true,
      info: true,
    };
  project.info = {
    ...(folder?.defaults?.info || {}),
    ...(source?.info
      ? {
          timeZone: source.info.timeZone,
          organiser: source.info.organiser,
          series: source.info.series,
          location: source.info.location,
        }
      : {}),
  };
  const ds = source?.dataSource ?? folder?.defaults?.dataSource;
  if (ds?.sourceId)
    project.dataSource = { sourceId: ds.sourceId, baseUrl: ds.baseUrl };
  project.status = "planning";
  await pm.saveProject(project);

  // A duplicated event keeps the source's desk favourites (per-graphic saved fields)
  if (source) {
    const from = path.join(getProjectManager().getRundownsDir(source.id), "..", "desk-favorites.json");
    const to = path.join(getProjectManager().getRundownsDir(project.id), "..", "desk-favorites.json");
    if (fs.existsSync(from)) fs.copyFileSync(from, to);
  }
  await getPages(project.id);
  await syncPages(project);
  return project;
}

export async function updateEvent(
  projectId: string,
  updates: Partial<SPXProject>,
): Promise<SPXProject> {
  const pm = getProjectManager();
  const current = await loadEvent(projectId);
  const next: SPXProject = {
    ...current,
    ...updates,
    folderInheritance: breakChangedInheritance(current, updates),
    id: current.id,
    info: updates.info
      ? { ...(current.info || {}), ...updates.info }
      : current.info,
    settings: updates.settings
      ? { ...(current.settings || {}), ...updates.settings }
      : current.settings,
    modified: Date.now(),
  };
  if (updates.dataSource) {
    const fingerprint = (ds?: SPXProject["dataSource"]) =>
      JSON.stringify([ds?.sourceId, ds?.baseUrl || "", ds?.competitionId]);
    if (
      fingerprint(current.dataSource) !== fingerprint(next.dataSource) &&
      next.dataSource
    )
      delete next.dataSource.lastCheck;
  }
  if (next.info?.timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: next.info.timeZone });
    } catch {
      throw new Error("Enter a valid time zone, for example Europe/Stockholm");
    }
  }
  const effective = (await mayApplyFolderDefaults(next.id))
    ? inheritFolder(
        next,
        listFolders().find((f) => f.id === next.folderId),
      )
    : next;
  await pm.saveProject(effective);
  if (
    JSON.stringify(effective.dataSource) !== JSON.stringify(next.dataSource) ||
    JSON.stringify(effective.info) !== JSON.stringify(next.info)
  )
    await syncPages(effective);
  if ("dataSource" in updates || "info" in updates || "name" in updates)
    await syncPages(effective);
  return effective;
}

/** Check that the event's data source answers and has classes; remembered for readiness */
export async function testEventData(
  projectId: string,
): Promise<{ ok: boolean; message: string; classes?: number }> {
  const project = await loadEvent(projectId);
  const ds = project.dataSource;
  let result: { ok: boolean; message: string; classes?: number };
  try {
    if (!ds?.sourceId) throw new Error("Choose a data source");
    if (!ds.competitionId) throw new Error("Choose a competition");
    const instance: any = getDataSourceRegistry().get(ds.sourceId);
    if (!instance)
      throw new Error(
        `Data source "${ds.sourceId}" is not set up (Settings → Data)`,
      );
    if (!instance.initialized) await instance.initialize();
    const classes = await instance.getClasses(ds.competitionId);
    result = {
      ok: classes.length > 0,
      message: classes.length
        ? `${classes.length} classes`
        : "The competition has no classes yet",
      classes: classes.length,
    };
  } catch (error) {
    result = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (ds)
    await getProjectManager().saveProject({
      ...project,
      dataSource: {
        ...ds,
        lastCheck: {
          ok: result.ok,
          at: Date.now(),
          message: result.message,
          classes: result.classes,
        },
      },
    });
  return result;
}

// --- readiness ------------------------------------------------------------------------------

export async function summarize(projectId: string): Promise<EventSummary> {
  const project = await loadEvent(projectId);
  const sets = (() => {
    try {
      return getTemplateManager()
        .getTemplateSets()
        .map((s) => s.id);
    } catch {
      return [];
    }
  })();
  const setId = project.templateSet || DEFAULT_TEMPLATE_SET;
  const ds = project.dataSource;
  const sl = loadStartList(projectId);
  const outputs = liveOutputsFor(project);
  const stale = !!ds?.lastCheck && Date.now() - ds.lastCheck.at > 15 * 60_000;
  const readiness: ReadinessItem[] = [
    {
      section: "info",
      label: "Event info",
      ok: !!project.name && !!project.info?.date,
      detail: project.info?.date ? undefined : "Add the event date",
    },
    {
      section: "look",
      label: "Theme",
      ok: sets.includes(setId),
      detail: sets.includes(setId)
        ? setId
        : `Template set "${setId}" is not installed`,
    },
    {
      section: "data",
      label: "Data",
      ok: !!ds?.sourceId && !!ds.competitionId && !!ds.lastCheck?.ok && !stale,
      detail: !ds?.sourceId
        ? "Choose a data source"
        : !ds.competitionId
          ? "Choose a competition"
          : !ds.lastCheck
            ? "Test the connection"
            : stale
              ? "Connection test is older than 15 minutes; test again"
              : ds.lastCheck.message,
    },
    {
      section: "startlists",
      label: "Start lists",
      optional: true,
      ok: sl.entries.length > 0,
      detail: sl.entries.length ? `${sl.entries.length} runners` : "Optional",
    },
    {
      section: "output",
      label: "Output",
      ok: outputs.web || outputs.ndi,
      detail:
        [outputs.web && "Web", outputs.ndi && "NDI"].filter(Boolean).join(" + ") ||
        "Choose the outputs to use in Live",
    },
  ];
  const required = readiness.filter((r) => !r.optional);
  let dataSourceLabel: string | undefined;
  if (ds?.sourceId) {
    const inst: any = getDataSourceRegistry().get(ds.sourceId);
    dataSourceLabel = inst?.config?.name || ds.sourceId;
  }
  return {
    id: project.id,
    name: project.name,
    folderId: project.folderId,
    date: project.info?.date,
    location: project.info?.location,
    templateSet: setId,
    dataSourceLabel,
    status: project.status || "planning",
    live: liveEventId === project.id,
    liveOutputs: outputs,
    readiness,
    ready: required.filter((r) => r.ok).length,
    required: required.length,
    modified: project.modified,
  };
}

export async function listEvents(): Promise<EventSummary[]> {
  const out: EventSummary[] = [];
  for (const p of await getProjectManager().listProjects()) {
    try {
      out.push(await summarize(p.id));
    } catch (error) {
      logger.warn("Event summary failed", { id: p.id, error: String(error) });
    }
  }
  return out.sort(
    (a, b) =>
      (b.date || "").localeCompare(a.date || "") || b.modified - a.modified,
  );
}

// --- start lists ----------------------------------------------------------------------------

function startListPath(projectId: string): string {
  return path.join(
    getProjectManager().getRundownsDir(projectId),
    "..",
    "startlist.json",
  );
}

export function loadStartList(projectId: string): EventStartList {
  try {
    return JSON.parse(fs.readFileSync(startListPath(projectId), "utf-8"));
  } catch {
    return { updated: 0, entries: [] };
  }
}

function saveStartList(
  projectId: string,
  list: EventStartList,
): EventStartList {
  list.updated = Date.now();
  fs.writeFileSync(startListPath(projectId), JSON.stringify(list, null, 1));
  indexCache.delete(projectId);
  return list;
}

export function updateStartListPreferences(
  projectId: string,
  updates: Pick<EventStartList, "favouriteClasses" | "favouriteControls">,
): EventStartList {
  return saveStartList(projectId, {
    ...loadStartList(projectId),
    ...updates,
  });
}

/** Every club in the start list with the name graphics will show, for the operator to review */
export function startListClubs(projectId: string): ClubNameRow[] {
  const runners = new Map<string, number>();
  for (const e of loadStartList(projectId).entries) {
    const club = e.club?.trim();
    if (club) runners.set(club, (runners.get(club) ?? 0) + 1);
  }
  return clubNameRows(runners);
}

/** Merge fresh entries into the stored list, keeping favourites, notes and virtual bibs */
function mergeEntries(
  old: StartListEntry[],
  fresh: StartListEntry[],
  replaceClasses: Set<string>,
): StartListEntry[] {
  const byKey = new Map(old.map((e) => [e.key, e]));
  const kept = old.filter((e) => !replaceClasses.has(e.className));
  const merged = fresh.map((e) => {
    const prev = byKey.get(e.key);
    return prev
      ? {
          ...e,
          favourite: prev.favourite,
          note: prev.note,
          virtualBib: prev.virtualBib,
        }
      : e;
  });
  return [...kept, ...merged];
}

/** Pull start lists (all classes, or some) from the event's data source */
export async function refreshStartListFromSource(
  projectId: string,
  classes?: string[],
): Promise<EventStartList> {
  const project = await loadEvent(projectId);
  const ds = project.dataSource;
  if (!ds?.sourceId || !ds.competitionId)
    throw new Error("Choose a data source and competition first (Settings → Data)");
  const instance: any = getDataSourceRegistry().get(ds.sourceId);
  if (!instance) throw new Error(`Data source "${ds.sourceId}" is not set up`);
  if (!instance.initialized) await instance.initialize();
  const client =
    typeof instance.getClient === "function" ? instance.getClient() : null;
  if (!client) throw new Error("This data source has no start lists");
  let info: any;
  try {
    info = await client.getCompetitionInfo(ds.competitionId);
  } catch {
    info = undefined;
  }
  const clock = info
    ? competitionClock({
        ...info,
        timezone: project.info?.timeZone || info.timezone,
      })
    : null;
  const classNames: string[] = classes?.length
    ? classes
    : (await client.getClasses(ds.competitionId)).data.map(
        (c: any) => c.className,
      );
  const fresh: StartListEntry[] = [];
  for (const className of classNames) {
    const res = await client.getClassResults(ds.competitionId, className, {
      maxAgeMs: 30_000,
    });
    for (const r of res.data.results ?? []) {
      fresh.push({
        key: entryKey(className, r.name, r.club),
        className,
        name: r.name,
        club: r.club || "",
        country: r.country || undefined,
        bib: r.bib ? String(r.bib) : undefined,
        startTimeMs:
          clock && r.start
            ? startTimeEpochMs(clock, Number(r.start))
            : undefined,
      });
    }
  }
  const list = loadStartList(projectId);
  return saveStartList(projectId, {
    ...list,
    origin: "source",
    timeZone: clock?.timeZone,
    entries: mergeEntries(list.entries, fresh, new Set(classNames)),
  });
}

/** Import an IOF XML 3.0 StartList (or ResultList) */
export async function importStartListIofXml(
  projectId: string,
  filePath: string,
): Promise<EventStartList> {
  const project = await loadEvent(projectId);
  const tz = project.info?.timeZone || "Europe/Stockholm";
  const backend = new IofXmlBackend(filePath, {
    competitionId: 1,
    timezone: tz,
  });
  const info = await backend.fetchCompetitionInfo(1);
  const clock = competitionClock({
    date:
      info.date || project.info?.date || new Date().toISOString().slice(0, 10),
    timediff: 0,
    timezone: tz,
  });
  const fresh: StartListEntry[] = [];
  const classNames: string[] = [];
  for (const { className } of await backend.fetchClasses(1)) {
    classNames.push(className);
    const res = await backend.fetchClassResults(1, className);
    for (const r of res.results) {
      fresh.push({
        key: entryKey(className, r.name, r.club),
        className,
        name: r.name,
        club: r.club || "",
        country: (r as any).country,
        bib: r.bib ? String(r.bib) : undefined,
        startTimeMs:
          clock && r.start
            ? startTimeEpochMs(clock, Number(r.start))
            : undefined,
      });
    }
  }
  if (!fresh.length) throw new Error("No runners found in the file");
  const list = loadStartList(projectId);
  return saveStartList(projectId, {
    ...list,
    origin: "iofxml",
    timeZone: tz,
    entries: mergeEntries(list.entries, fresh, new Set(classNames)),
  });
}

/** Split one CSV/TSV line, honouring quotes */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "",
    quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Import a CSV start list. Columns are found by their header (English or Swedish):
 * class/klass, name/namn (or first + last name), club/klubb, bib/nummer/nr, start/starttid,
 * country/nation. Separator: comma, semicolon or tab.
 */
export async function importStartListCsv(
  projectId: string,
  filePath: string,
): Promise<EventStartList> {
  const project = await loadEvent(projectId);
  const text = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("The file has no rows");
  const sep = [";", "\t", ","].find((s) => lines[0].includes(s)) || ",";
  const head = splitCsvLine(lines[0], sep).map((h) =>
    h.toLowerCase().replace(/[^a-zåäöé]/g, ""),
  );
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iClass = col("class", "klass", "classname", "category");
  const iName = col("name", "namn", "fullname", "runner");
  const iFirst = col("firstname", "fornamn", "förnamn", "given");
  const iLast = col("lastname", "efternamn", "surname", "family");
  const iClub = col("club", "klubb", "organisation", "organization", "team");
  const iBib = col(
    "bib",
    "nummer",
    "nr",
    "startnumber",
    "startnummer",
    "number",
  );
  const iStart = col("start", "starttime", "starttid", "time");
  const iCountry = col("country", "nation", "nationality", "land");
  if (iClass < 0 || (iName < 0 && iLast < 0))
    throw new Error(
      "The CSV needs a class column and a name column (or first and last name)",
    );
  const date = project.info?.date || new Date().toISOString().slice(0, 10);
  const clock = competitionClock({
    date,
    timediff: 0,
    timezone: project.info?.timeZone || "Europe/Stockholm",
  });
  const fresh: StartListEntry[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, sep);
    const className = c[iClass];
    const name =
      iName >= 0 ? c[iName] : [c[iFirst], c[iLast]].filter(Boolean).join(" ");
    if (!className || !name) continue;
    const club = iClub >= 0 ? c[iClub] || "" : "";
    let startTimeMs: number | undefined;
    const m =
      iStart >= 0
        ? /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(c[iStart] || "")
        : null;
    if (m && clock)
      startTimeMs = startTimeEpochMs(
        clock,
        (+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) * 100,
      );
    fresh.push({
      key: entryKey(className, name, club),
      className,
      name,
      club,
      country: iCountry >= 0 ? c[iCountry] || undefined : undefined,
      bib: iBib >= 0 && c[iBib] ? c[iBib] : undefined,
      startTimeMs,
    });
  }
  if (!fresh.length) throw new Error("No runners found in the file");
  const list = loadStartList(projectId);
  return saveStartList(projectId, {
    ...list,
    origin: "csv",
    entries: mergeEntries(
      list.entries,
      fresh,
      new Set(fresh.map((f) => f.className)),
    ),
  });
}

/**
 * Give runners without a bib a virtual one: "V" + number, numbered per class in start order.
 * Virtual bibs live only in Split Control (graphics and PDFs); they are never sent to timing.
 */
export function assignVirtualBibs(
  projectId: string,
  options: VirtualBibOptions = {},
): EventStartList {
  const list = loadStartList(projectId);
  const allClasses = [...new Set(list.entries.map((e) => e.className))];
  const classes = allClasses.filter(
    (c) => !options.classes?.length || options.classes.includes(c),
  );
  const start = options.start ?? 1;
  const block = options.perClassBlock ?? 100;
  if (
    !Number.isInteger(start) ||
    start < 1 ||
    !Number.isInteger(block) ||
    block < 0
  )
    throw new Error(
      "Use a positive whole start number and a non-negative whole class block",
    );
  const replacing = new Set(
    options.overwrite
      ? list.entries
          .filter((e) => classes.includes(e.className) && !e.bib)
          .map((e) => e.key)
      : [],
  );
  const used = new Set(
    list.entries
      .flatMap((e) => [e.bib, replacing.has(e.key) ? undefined : e.virtualBib])
      .filter((v): v is string => !!v)
      .map((v) => v.toUpperCase()),
  );
  let next = start;
  classes.forEach((className) => {
    if (block > 0) next = start + allClasses.indexOf(className) * block;
    const runners = list.entries
      .filter((e) => e.className === className)
      .sort(
        (a, b) =>
          (a.startTimeMs ?? Infinity) - (b.startTimeMs ?? Infinity) ||
          a.name.localeCompare(b.name),
      );
    for (const e of runners) {
      if (e.bib || (e.virtualBib && !options.overwrite)) continue;
      while (used.has(`V${next}`)) next++;
      e.virtualBib = `V${next++}`;
      used.add(e.virtualBib);
    }
  });
  return saveStartList(projectId, list);
}

export function clearVirtualBibs(
  projectId: string,
  classes?: string[],
): EventStartList {
  const list = loadStartList(projectId);
  for (const e of list.entries)
    if (!classes?.length || classes.includes(e.className)) delete e.virtualBib;
  return saveStartList(projectId, list);
}

export function updateStartListEntry(
  projectId: string,
  key: string,
  updates: Partial<StartListEntry>,
): EventStartList {
  const list = loadStartList(projectId);
  const e = list.entries.find((x) => x.key === key);
  if (!e) throw new Error("Runner not found in the start list");
  const { name, club, bib, note, favourite, startTimeMs } = updates;
  if ("startTimeMs" in updates && startTimeMs === undefined)
    delete e.startTimeMs;
  Object.assign(
    e,
    Object.fromEntries(
      Object.entries({ name, club, bib, note, favourite, startTimeMs }).filter(
        ([, value]) => value !== undefined,
      ),
    ),
    { key },
  );
  return saveStartList(projectId, list);
}

/** Update a runner, adding them when the start list does not have them yet (favourites from Live/director) */
export function updateOrAddStartListEntry(
  projectId: string,
  key: string,
  entry: Omit<StartListEntry, "key">,
): EventStartList {
  const list = loadStartList(projectId);
  const e = list.entries.find((x) => x.key === key);
  if (e) Object.assign(e, entry, { key });
  else list.entries.push({ ...entry, key });
  return saveStartList(projectId, list);
}

/** Fast lookups for graphics: bib/virtual bib and favourite per runner */
const indexCache = new Map<
  string,
  { updated: number; byName: Map<string, StartListEntry> }
>();
export function startListIndex(projectId: string): Map<string, StartListEntry> {
  const list = loadStartList(projectId);
  const cached = indexCache.get(projectId);
  if (cached && cached.updated === list.updated) return cached.byName;
  const byName = new Map<string, StartListEntry>();
  for (const e of list.entries) {
    byName.set(entryKey(e.className, e.name, e.club), e);
    const loose = `*|${e.name.trim().toLowerCase()}|${e.club.trim().toLowerCase()}`;
    if (!byName.has(loose)) byName.set(loose, e);
  }
  indexCache.set(projectId, { updated: list.updated, byName });
  return byName;
}

/** Bibs (real or virtual) and favourites from the start list, added to results for graphics */
export function applyStartList(
  projectId: string,
  data: Record<string, any>,
): Record<string, any> {
  if (!Array.isArray(data?.results) || !data.results.length) return data;
  let index: Map<string, StartListEntry>;
  try {
    index = startListIndex(projectId);
  } catch {
    return data;
  }
  if (!index.size) return data;
  const cls = String(data.className ?? "");
  return {
    ...data,
    results: data.results.map((r: any) => {
      const e =
        index.get(entryKey(cls, r.name, r.club)) ??
        index.get(
          `*|${String(r.name).trim().toLowerCase()}|${String(r.club ?? "")
            .trim()
            .toLowerCase()}`,
        );
      if (!e) return r;
      return {
        ...r,
        // Virtual bibs are for operators only and never reach graphics
        bib: r.bib || e.bib || undefined,
        favourite: !!e.favourite,
        ...(e.note ? { note: e.note } : {}),
      };
    }),
  };
}

/** Printable HTML of the start list (PDF export) */
export function startListHtml(
  project: SPXProject,
  list: EventStartList,
  classes?: string[],
): string {
  const esc = (s: unknown) =>
    String(s ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
    );
  const tz = list.timeZone || project.info?.timeZone || "Europe/Stockholm";
  const fmt = (ms?: number) => {
    if (!ms) return "";
    try {
      return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        timeZone: tz,
      }).format(ms);
    } catch {
      return "";
    }
  };
  const byClass = new Map<string, StartListEntry[]>();
  for (const e of list.entries) {
    if (classes?.length && !classes.includes(e.className)) continue;
    if (!byClass.has(e.className)) byClass.set(e.className, []);
    byClass.get(e.className)!.push(e);
  }
  const sections = [...byClass]
    .sort((a, b) => a[0].localeCompare(b[0], "sv"))
    .map(([cls, rows]) => {
      rows.sort(
        (a, b) =>
          (a.startTimeMs ?? Infinity) - (b.startTimeMs ?? Infinity) ||
          a.name.localeCompare(b.name),
      );
      return (
        `<section><h2>${esc(cls)} <small>${rows.length} runners</small></h2><table><thead><tr><th>Start</th><th>Bib</th><th>Name</th><th>Club</th></tr></thead><tbody>` +
        rows
          .map(
            (r) =>
              `<tr><td>${fmt(r.startTimeMs)}</td><td class="bib">${esc(r.bib || r.virtualBib || "")}</td><td>${esc(r.name)}${r.favourite ? " ★" : ""}</td><td>${esc(r.club)}</td></tr>`,
          )
          .join("") +
        `</tbody></table></section>`
      );
    })
    .join("");
  const sub = [project.info?.date, project.info?.location]
    .filter(Boolean)
    .map(esc)
    .join(" · ");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm 12mm; }
    body { font: 10.5pt/1.35 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #111; }
    h1 { font-size: 16pt; margin: 0; } .sub { color: #555; margin: 2px 0 10px; }
    section { break-inside: auto; margin-top: 12px; } section + section { break-before: page; }
    h2 { font-size: 13pt; margin: 0 0 4px; border-bottom: 2px solid #111; padding-bottom: 2px; } h2 small { font-weight: 400; color: #666; font-size: 9pt; }
    table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 8.5pt; color: #555; border-bottom: 1px solid #999; }
    td { padding: 3px 4px; border-bottom: 1px solid #e3e3e3; font-variant-numeric: tabular-nums; } td.bib { font-weight: 700; }
    tr { break-inside: avoid; } .note { color: #666; font-size: 8pt; margin-top: 10px; }
  </style></head><body><h1>${esc(project.name)}</h1><div class="sub">${sub}</div>${sections || "<p>No runners</p>"}
  <p class="note">Bibs starting with V are virtual bibs assigned in Split Control.</p></body></html>`;
}

// --- live -----------------------------------------------------------------------------------

let liveEventId: string | null = null;

/** Outputs the event uses in Live: its own choice, or the app's output settings */
export function liveOutputsFor(project: Pick<SPXProject, "liveOutputs">): EventLiveOutputs {
  if (project.liveOutputs) return { web: !!project.liveOutputs.web, ndi: !!project.liveOutputs.ndi };
  const cfg = getConfig();
  return { web: !!cfg.output.web.enabled, ndi: !!cfg.output.ndi.enabled };
}

export function setLiveEvent(projectId: string | null): void {
  liveEventId = projectId;
}

export function getLiveEventId(): string | null {
  return liveEventId;
}

/** A hidden page (names starting with "__" are internal and never listed) */
async function hiddenPage(projectId: string, name: string): Promise<SPXRundown> {
  const rm = getRundownManager();
  const found = (await rm.listRundowns(projectId)).find((r) => r.name === name);
  if (found) return rm.loadRundown(projectId, found.id);
  return rm.createRundown({ projectId, name });
}

/**
 * A hidden graphic for testing the real web/NDI output before going live. The test pattern
 * is one system graphic (templates/system/), the same for every look.
 */
export async function testPatternCue(
  projectId: string,
): Promise<{ pageId: string; itemId: string }> {
  await loadEvent(projectId);
  const template = getTemplateManager()
    .getAllTemplates()
    .find(
      (t) =>
        t.setId === SYSTEM_TEMPLATE_SET &&
        (t.manifest as any).v_olgrafik_kind === "test-pattern",
    );
  if (!template)
    throw new Error("Reload graphics to install the output test pattern");
  const page = await hiddenPage(projectId, "__test__");
  // Events from before the move hold a cue for their set's own copy: drop it
  for (const stale of page.items.filter(
    (i) => i.templateId !== template.manifest.id && /-test-pattern$/.test(i.templateId),
  ))
    await getRundownManager().removeItem(projectId, page.id, stale.id);
  const existing = page.items.find(
    (i) => i.templateId === template.manifest.id,
  );
  const cue =
    existing ||
    (await getRundownManager().addItem(projectId, page.id, {
      graphicKind: templateGraphicKind(template),
      templateId: template.manifest.id,
      templatePath: template.directoryName,
      fields: {},
      layer: "1",
      out: "animate",
      playbackMode: "solo",
    }));
  return { pageId: page.id, itemId: cue.id };
}


import { resolveDeskDeclaration } from '../../shared/deskDeclaration';
/**
 * Live desk: show / update / hide prepared drafts, template favourites and the command map.
 *
 * Each desk template has one hidden playback item on the event's hidden "__desk__" page. Show
 * writes the draft to that item and plays it, so live data, auto-update and start-list bibs
 * work through the normal playback engine. Nothing reaches the output without an explicit
 * Show or Update.
 */

import fs from 'fs';
import { presentationForGraphics } from '../../shared/branding';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getConfig } from '../utils/config';
import { getProjectManager } from '../projects/ProjectManager';
import { getRundownManager } from '../projects/RundownManager';
import { getTemplateManager } from '../templates/OGrafManager';
import { getPlaybackEngine } from '../playback/PlaybackEngine';
import { DataSourceFieldMapper } from '../data/DataSourceFieldMapper';
import { getDataSourceRegistry } from '../data/DataSourceRegistry';
import { isMultiStep, type OGrafTemplateInfo } from '../../shared/types/ograf';
import type { SPXProject, SPXRundown } from '../../shared/types/spx';
import { DEFAULT_TEMPLATE_SET } from '../../shared/types/spx';
import {
  DEFAULT_DESK_COMMANDS, DESK_TEMPLATES, allocateDeskCommands, type DeskTemplate, fieldDefaults, hasBehaviour, hasFeed, isFrozenDraft, liveUpdatesDefault, orderDeskTemplates, type DeskCommandMap, type DeskDraft, type DeskFavorite,
  type DeskOnAir, type DeskState
} from '../../shared/desk';
import { applyStartList, loadEvent, loadStartList, syncPages } from './EventService';
import { eventWeather, weatherFields, WEATHER_MAX_AGE_MS, type EventWeather } from '../data/Weather';

export const DESK_PAGE_NAME = '__desk__';

const onAirInfo = new Map<string, { since: number; draft: DeskDraft }>();

function err(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

/** Validated entries and their exact graphics in a look. First entry wins duplicate keys. */
function entriesFor(project: SPXProject) {
  const entries = new Map<string, { def: DeskTemplate; template: OGrafTemplateInfo }>();
  for (const template of getTemplateManager().getAllTemplates().filter(t => t.setId === (project.templateSet || DEFAULT_TEMPLATE_SET))) {
    const def = template.desk ?? resolveDeskDeclaration(template.manifest).desk;
    if (def && !entries.has(def.key)) entries.set(def.key, { def, template });
  }
  return entries;
}
export function deskDefinitions(project: SPXProject): DeskTemplate[] {
  return [...entriesFor(project).values()].map(e => e.def);
}
function definition(project: SPXProject, key: string): DeskTemplate | undefined {
  return entriesFor(project).get(key)?.def;
}
export function deskTemplateInfo(project: SPXProject, key: string): OGrafTemplateInfo | undefined {
  return entriesFor(project).get(key)?.template;
}

/** Why the event's look has no graphic for a desk template */
function missingGraphic(project: SPXProject, label: string): Error {
  const setId = project.templateSet || DEFAULT_TEMPLATE_SET;
  const installed = getTemplateManager().getTemplateSets().some(s => s.id === setId);
  return err(installed
    ? `The "${setId}" look has no ${label} graphic`
    : `The "${setId}" look is not installed. Import it in Graphics library, or choose another look in Plan → Theme.`);
}

/** Which desk templates the event's set provides */
export async function deskTemplates(projectId: string) {
  const project = await loadEvent(projectId);
  const remembered = new Set([...Object.values(loadDeskCommands()), ...Object.keys(loadDeskFavorites(projectId))]);
  const missing = [...remembered].map(key => ({ key, kind: key, label: key, short: key, params: [], required: [], live: false } as DeskTemplate));
  return orderDeskTemplates([...new Map([...missing, ...DESK_TEMPLATES, ...deskDefinitions(project)].map(t => [t.key, t])).values()], project.settings?.templateOrder).map(def => {
    const t = deskTemplateInfo(project, def.key);
    const settings = project.settings?.templates;
    return {
      ...def,
      hidden: !!settings?.[def.key]?.hidden,
      liveUpdatesDefault: liveUpdatesDefault(def, settings),
      fieldDefaults: fieldDefaults(def, settings),
      templateId: t?.manifest.id ?? null,
      available: !!t,
      schema: (t?.manifest.schema as any)?.properties ?? {},
      requiredFields: ((t?.manifest.schema as any)?.required ?? []) as string[],
      multiStep: t ? isMultiStep(t.manifest) : false
    };
  });
}

async function deskPage(projectId: string): Promise<SPXRundown> {
  const rm = getRundownManager();
  const find = async () => {
    for (const r of await rm.listRundowns(projectId)) {
      if (r.name === DESK_PAGE_NAME) return rm.loadRundown(projectId, r.id);
    }
    return null;
  };
  const existing = await find();
  if (existing) return existing;
  await rm.createRundown({ projectId, name: DESK_PAGE_NAME });
  await syncPages(await loadEvent(projectId));
  return (await find())!;
}

function validate(def: (typeof DESK_TEMPLATES)[number], draft: DeskDraft, t: OGrafTemplateInfo): void {
  const missing: string[] = [];
  if (def.required.includes('class') && !draft.values.className) missing.push('a class');
  if (def.required.includes('runner') && !draft.values.runnerName) missing.push('a runner');
  for (const [name, property] of Object.entries(t.manifest.schema?.properties ?? {})) {
    const field = property as any;
    if (field.v_olgrafik_control !== 'radio-control') continue;
    const value = draft.fields?.[name];
    if (value !== undefined && value !== '' && !(field.v_olgrafik_includeFinish && String(value) === 'F') && (!Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) === 1000))
      throw err('Choose a radio control');
    if (field.v_olgrafik_distinctFrom && value && String(value) === String(draft.fields?.[field.v_olgrafik_distinctFrom]))
      throw err('Choose two different radio controls');
  }
  // Fields the timing data fills in (results, class name …) are not the operator's to type
  const fromData = new Set<string>((t.dataSourceConfig?.api?.fieldMappings ?? []).map((m: any) => m.templateField));
  for (const field of ((t.manifest.schema as any)?.required ?? []) as string[]) {
    if (fromData.has(field)) continue;
    const v = draft.fields?.[field] ?? (t.manifest.schema as any)?.properties?.[field]?.default;
    if (v === undefined || v === '') missing.push((t.manifest.schema as any)?.properties?.[field]?.title || field);
  }
  if (missing.length) throw err(`Choose ${missing.join(' and ')} first`);
}

/**
 * Fields as the graphic receives them. Weather fills in current conditions at the venue;
 * anything the operator typed wins.
 */
async function automaticFields(project: SPXProject, key: string, typed: Record<string, any> = {}, className?: string): Promise<Record<string, any>> {
  if (hasFeed(definition(project, key), 'course')) {
    const title = className && hasBehaviour(definition(project, key), 'titleFromClass') ? { title: className } : {};
    return { ...title, ...(await courseFields(project, className)), ...typed };
  }
  if (!hasFeed(definition(project, key), 'weather')) return { ...typed };
  const { reading, error } = await eventWeather(project.info);
  const fields = weatherFields(reading, typed);
  if (!fields.condition && !fields.temperature)
    throw err(`No weather reading (${error || 'unknown error'}). Type the conditions, or add the venue in Settings → Event info.`);
  return fields;
}

/** Length, climb and controls of a class from the timing data, when the source has them (IOF XML) */
async function courseFields(project: SPXProject, className?: string): Promise<Record<string, any>> {
  const ds = project.dataSource;
  if (!className || !ds?.sourceId || !ds.competitionId) return {};
  try {
    const instance: any = getDataSourceRegistry().get(ds.sourceId);
    if (!instance) return {};
    if (!instance.initialized) await instance.initialize();
    const client = typeof instance.getClient === 'function' ? instance.getClient() : null;
    const course = (await client?.getClassResults(ds.competitionId, className, { maxAgeMs: 10_000 }))?.data?.course;
    if (!course) return {};
    const out: Record<string, any> = { title: className };
    if (course.length) out.length = (course.length / 1000).toFixed(1);
    if (course.climb) out.climb = String(Math.round(course.climb));
    if (course.controls) out.controls = String(course.controls);
    return out;
  } catch {
    return {};
  }
}

/** The venue's current weather for the desk (force: ask the service now) */
export async function deskWeather(projectId: string, force = false): Promise<EventWeather> {
  const project = await loadEvent(projectId);
  return eventWeather(project.info, force);
}

// While the weather graphic is on air it follows the conditions on its own
const weatherProjects = new Set<string>();
let weatherTimer: ReturnType<typeof setInterval> | null = null;
function followWeather(projectId: string) {
  weatherProjects.add(projectId);
  if (weatherTimer) return;
  weatherTimer = setInterval(() => void refreshWeatherOnAir(), WEATHER_MAX_AGE_MS + 1000);
  weatherTimer.unref?.();
}
/** Re-read the weather for every event with the weather graphic on air (exported for tests) */
export async function refreshWeatherOnAir(): Promise<void> {
  for (const projectId of [...weatherProjects]) {
    try {
      const project = await loadEvent(projectId);
      const on = (await deskState(projectId)).onAir.filter(o => hasFeed(definition(project, o.key), 'weather'));
      if (!on.length) { weatherProjects.delete(projectId); continue; }
      for (const o of on) await deskUpdate(projectId, o.draft);
    } catch { /* keep the last reading on air */ }
  }
  if (!weatherProjects.size && weatherTimer) { clearInterval(weatherTimer); weatherTimer = null; }
}

/** Write the draft to the template's desk item; returns where it lives */
/**
 * The draft's data values as graphics receive them. A virtual bib (V12) only helps operators
 * find runners, so it never reaches a graphic: templates then find the runner by name.
 */
function graphicValues(projectId: string, draft: DeskDraft): Record<string, any> {
  const values: Record<string, any> = Object.fromEntries(Object.entries(draft.values || {}).filter(([, v]) => v !== undefined && v !== ''));
  if (values.runnerName) values.runnerId = values.runnerName;
  if (values.runnerBib) {
    const bib = String(values.runnerBib).trim().toLowerCase();
    let entries: { bib?: string; virtualBib?: string }[] = [];
    try { entries = loadStartList(projectId).entries; } catch { /* no start list */ }
    const real = entries.some(e => String(e.bib ?? '').trim().toLowerCase() === bib);
    const virtual = entries.some(e => String(e.virtualBib ?? '').trim().toLowerCase() === bib);
    if (virtual && !real) delete values.runnerBib;
  }
  return values;
}

async function writeDraft(projectId: string, draft: DeskDraft) {
  const project = await loadEvent(projectId);
  const def = definition(project, draft.key);
  if (!def) throw err('Unknown graphic');
  const t = deskTemplateInfo(project, draft.key);
  if (!t) throw missingGraphic(project, def.label);
  validate(def, draft, t);
  if (def.live && (!project.dataSource?.sourceId || !project.dataSource.competitionId))
    throw err('Timing data is not set up for this event (Settings → Data)');
  const page = await deskPage(projectId);
  // The event's template settings fill what the draft leaves open (Settings → Templates)
  const settings = project.settings?.templates;
  draft = {
    ...draft,
    fields: { ...fieldDefaults(definition(project, draft.key) ?? draft.key, settings), ...Object.fromEntries(Object.entries(draft.fields || {}).filter(([, v]) => v !== undefined && v !== '')) },
    liveUpdates: draft.liveUpdates ?? liveUpdatesDefault(definition(project, draft.key) ?? draft.key, settings)
  };
  const values = graphicValues(projectId, draft);
  const rm = getRundownManager();
  let item = page.items.find(i => i.templateId === t.manifest.id);
  // holdOnAir keeps polling (so the desk can say new results are waiting) but does not push them
  // A frozen clock always follows the data: the official time replaces it as soon as it arrives
  const liveResultsData = t.dataSourceConfig ? { autoUpdate: true, holdOnAir: draft.liveUpdates === false && !isFrozenDraft(draft), dataSourceValues: values } : undefined;
  const fields = await automaticFields(project, draft.key, draft.fields, draft.values?.className);
  const eventPageDuration = Math.max(0, Number(project.settings?.presentation?.autoPageDurationSeconds) || 0);
  const requestedPageDuration = draft.autoPageDurationSeconds === undefined
    ? eventPageDuration
    : Math.max(0, Number(draft.autoPageDurationSeconds) || 0);
  // Only multi-page graphics page (and leave) on their own; the operator takes the rest off air
  const autoPageDurationSeconds = !hasBehaviour(def, 'manualSteps') && isMultiStep(t.manifest) && requestedPageDuration > 0 ? requestedPageDuration : undefined;
  if (!item) {
    item = await rm.addItem(projectId, page.id, {
      templateId: t.manifest.id, templatePath: t.directoryName, fields, layer: '1', out: 'animate',
      playbackMode: 'stackable', instanceName: def.label, liveResultsData, autoPageDurationSeconds
    });
  } else {
    item = await rm.updateItem(projectId, page.id, item.id, { fields, liveResultsData, autoPageDurationSeconds });
  }
  return { project, def, template: t, pageId: page.id, itemId: item.id };
}

function graphicId(projectId: string, pageId: string, itemId: string) {
  return `${projectId}-${pageId}-${itemId}`;
}

export async function deskShow(projectId: string, draft: DeskDraft): Promise<DeskState> {
  const { pageId, itemId } = await writeDraft(projectId, draft);
  const project = await loadEvent(projectId);
  const engine = getPlaybackEngine();
  const id = graphicId(projectId, pageId, itemId);
  if (engine.getActiveGraphics().some(g => g.id === id && g.isPlaying)) {
    await engine.refreshItem(projectId, pageId, itemId);
  } else {
    await engine.playItem(projectId, pageId, itemId);
    for (let p = 1; p < (draft.page || 1); p++) await engine.nextItem(projectId, pageId, itemId);
  }
  onAirInfo.set(id, { since: onAirInfo.get(id)?.since ?? Date.now(), draft });
  if (hasFeed(definition(project, draft.key), 'weather')) followWeather(projectId);
  return deskState(projectId);
}

/** Apply the draft to the same graphic while it is on air (no re-entry animation) */
export async function deskUpdate(projectId: string, draft: DeskDraft): Promise<DeskState> {
  const state = await deskState(projectId);
  if (!state.onAir.some(o => o.key === draft.key)) throw err('This graphic is not on air; use Show');
  const { pageId, itemId } = await writeDraft(projectId, draft);
  const id = graphicId(projectId, pageId, itemId);
  await getPlaybackEngine().refreshItem(projectId, pageId, itemId);
  onAirInfo.set(id, { since: onAirInfo.get(id)?.since ?? Date.now(), draft });
  return deskState(projectId);
}

/** Hide one desk graphic (by template key), or the most recently shown one */
export async function deskHide(projectId: string, key?: string): Promise<DeskState> {
  const page = await deskPage(projectId);
  const engine = getPlaybackEngine();
  const playing = engine.getActiveGraphics().filter(g => g.isPlaying && g.projectId === projectId && g.rundownId === page.id);
  const project = await loadEvent(projectId);
  const target = key
    ? playing.find(g => g.templateId === deskTemplateInfo(project, key)?.manifest.id)
    : [...playing].sort((a, b) => (onAirInfo.get(b.id)?.since ?? 0) - (onAirInfo.get(a.id)?.since ?? 0))[0];
  if (!target) throw err('Nothing from the desk is on air');
  await engine.stopItem(projectId, page.id, target.itemId);
  onAirInfo.delete(target.id);
  return deskState(projectId);
}

/** Take every graphic off air (desk graphics and the output test pattern) */
export async function deskHideAll(projectId: string): Promise<DeskState> {
  await getPlaybackEngine().clearAll();
  onAirInfo.clear();
  return deskState(projectId);
}

/** Next/previous page of the most recent paged desk graphic on air */
export async function deskPageStep(projectId: string, delta: 1 | -1): Promise<DeskState> {
  const page = await deskPage(projectId);
  const engine = getPlaybackEngine();
  const templates = getTemplateManager().getAllTemplates();
  const paged = engine.getActiveGraphics()
    .filter(g => g.isPlaying && g.rundownId === page.id && isMultiStep(templates.find(t => t.manifest.id === g.templateId)?.manifest))
    .sort((a, b) => (onAirInfo.get(b.id)?.since ?? 0) - (onAirInfo.get(a.id)?.since ?? 0))[0];
  if (!paged) throw err('No paged graphic is on air');
  if (delta > 0) await engine.nextItem(projectId, page.id, paged.itemId);
  else await engine.previousItem(projectId, page.id, paged.itemId);
  return deskState(projectId);
}

export async function deskState(projectId: string | null): Promise<DeskState> {
  if (!projectId) return { eventId: null, onAir: [], otherOnAir: 0 };
  const project = await getProjectManager().loadProject(projectId);
  const page = await deskPage(projectId);
  const playing = getPlaybackEngine().getActiveGraphics().filter(g => g.isPlaying && g.projectId === projectId);
  const onAir: DeskOnAir[] = [];
  for (const g of playing.filter(g => g.rundownId === page.id)) {
    const def = deskDefinitions(project).find(d => deskTemplateInfo(project, d.key)?.manifest.id === g.templateId);
    if (!def) continue;
    const info = onAirInfo.get(g.id);
    onAir.push({
      key: def.key, templateId: g.templateId, name: def.label,
      since: info?.since ?? Date.now(), step: g.currentStep,
      draft: info?.draft ?? { key: def.key, values: {}, fields: {} },
      held: (info?.draft?.liveUpdates ?? liveUpdatesDefault(def, project.settings?.templates)) === false && !isFrozenDraft(info?.draft),
      newData: g.newData || undefined
    });
  }
  // Forget timers of graphics stopped elsewhere (test pattern, Hide all, clash rules)
  for (const id of [...onAirInfo.keys()]) if (!playing.some(g => g.id === id)) onAirInfo.delete(id);
  return { eventId: projectId, onAir: onAir.sort((a, b) => b.since - a.since), otherOnAir: playing.length - onAir.length };
}

/** Data for the Preview monitor: the draft mapped exactly as Show would, without playing */
export async function deskPreviewData(projectId: string, draft: DeskDraft) {
  const { project, template, pageId } = await writeDraftForPreview(projectId, draft);
  const rundown = await getRundownManager().loadRundown(projectId, pageId);
  const defaults = Object.fromEntries(
    Object.entries((template.manifest.schema as any)?.properties || {})
      .filter(([, f]: any) => f.default !== undefined).map(([k, f]: any) => [k, f.default])
  );
  const typed = { ...fieldDefaults(definition(project, draft.key) ?? draft.key, project.settings?.templates), ...Object.fromEntries(Object.entries(draft.fields || {}).filter(([, v]) => v !== undefined && v !== '')) };
  let data: Record<string, any> = { ...defaults, ...(await automaticFields(project, draft.key, typed, draft.values?.className)) };
  if (template.dataSourceConfig) {
    const values = graphicValues(projectId, draft);
    data = {
      ...data,
      ...(await DataSourceFieldMapper.fetchAndMapData(
        template.dataSourceConfig, rundown.dataSource?.competitionId || 0, values, rundown.settings, rundown.dataSource?.sourceId
      ))
    };
  }
  data = {
    ...applyStartList(projectId, data),
    presentation: presentationForGraphics(project.settings?.presentation),
    event: { ...project.info, name: project.name, location: project.info?.location || '', date: project.info?.date || '' }
  };
  return { template, data };
}

/** Like writeDraft's checks, but leaves the desk item untouched (Preview never changes what Show plays) */
async function writeDraftForPreview(projectId: string, draft: DeskDraft) {
  const project = await loadEvent(projectId);
  const def = definition(project, draft.key);
  if (!def) throw err('Unknown graphic');
  const template = deskTemplateInfo(project, draft.key);
  if (!template) throw missingGraphic(project, def.label);
  validate(def, draft, template);
  if (def.live && (!project.dataSource?.sourceId || !project.dataSource.competitionId))
    throw err('Timing data is not set up for this event (Settings → Data)');
  const page = await deskPage(projectId);
  return { project, def, template, pageId: page.id };
}

// --- favourites (per event, per desk template) -------------------------------------------

function favouritesPath(projectId: string) {
  return path.join(getProjectManager().getRundownsDir(projectId), '..', 'desk-favorites.json');
}

export function loadDeskFavorites(projectId: string): Record<string, DeskFavorite[]> {
  let all: Record<string, DeskFavorite[]>;
  try {
    all = JSON.parse(fs.readFileSync(favouritesPath(projectId), 'utf-8'));
  } catch {
    return {};
  }
  // Favourites saved before F-numbers existed get the next free numbers, in their saved order
  for (const list of Object.values(all)) {
    for (const f of list) if (!Number.isInteger(f.n) || f.n < 1) f.n = nextFavoriteNumber(list.filter(x => x !== f && x.n));
  }
  return all;
}

/** Lowest F-number not used by this graphic's favourites */
function nextFavoriteNumber(list: Pick<DeskFavorite, 'n'>[]): number {
  const used = new Set(list.map(f => f.n));
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

export function saveDeskFavorite(projectId: string, label: string, draft: DeskDraft): Record<string, DeskFavorite[]> {
  const all = loadDeskFavorites(projectId);
  const list = all[draft.key] ?? [];
  list.push({ id: uuidv4(), n: nextFavoriteNumber(list), label: label.trim() || 'Favourite', draft, created: Date.now() });
  all[draft.key] = list;
  fs.writeFileSync(favouritesPath(projectId), JSON.stringify(all, null, 1));
  return all;
}

export function deleteDeskFavorite(projectId: string, key: string, id: string): Record<string, DeskFavorite[]> {
  const all = loadDeskFavorites(projectId);
  all[key] = (all[key] ?? []).filter(f => f.id !== id);
  fs.writeFileSync(favouritesPath(projectId), JSON.stringify(all, null, 1));
  return all;
}

// --- command map (installation-wide) ---------------------------------------------------------

function commandsPath() {
  return path.join(getConfig().general.dataroot, 'desk-commands.json');
}

export function commandDefinitions(): DeskTemplate[] {
  return getTemplateManager().getAllTemplates().flatMap(t => {
    const def = t.desk ?? resolveDeskDeclaration(t.manifest).desk;
    return def ? [def] : [];
  });
}
export function loadDeskCommands(): DeskCommandMap {
  try {
    const saved = JSON.parse(fs.readFileSync(commandsPath(), 'utf-8')) as DeskCommandMap;
    const valid = Object.entries(saved).filter(([n, key]) => /^\d{1,2}$/.test(n) && typeof key === 'string' && !!key.trim());
    const map = allocateDeskCommands(Object.fromEntries(valid), commandDefinitions());
    if (JSON.stringify(map) !== JSON.stringify(saved)) fs.writeFileSync(commandsPath(), JSON.stringify(map, null, 2));
    return map;
  } catch {
    const map = allocateDeskCommands(DEFAULT_DESK_COMMANDS, commandDefinitions());
    fs.mkdirSync(path.dirname(commandsPath()), { recursive: true });
    fs.writeFileSync(commandsPath(), JSON.stringify(map, null, 2));
    return map;
  }
}

export function saveDeskCommands(map: DeskCommandMap): DeskCommandMap {
  const numbers = Object.keys(map);
  const keys = Object.values(map);
  if (numbers.some(n => !/^\d{1,2}$/.test(n))) throw err('Command numbers are 0–99');
  if (new Set(keys).size !== keys.length) throw err('Each graphic can have only one number');
  if (keys.some(k => typeof k !== 'string' || !k.trim())) throw err('Unknown graphic in the command map');
  fs.writeFileSync(commandsPath(), JSON.stringify(map, null, 2));
  return loadDeskCommands();
}

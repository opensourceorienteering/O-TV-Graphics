/**
 * Live control shared by the Live desk (IPC), the HTTP control API and Companion / Stream Deck.
 * Everything acts on the event open in Live and on the draft prepared in Preview: control
 * surfaces prepare a draft (a favourite or a runner), then Show / Update / Hide it, exactly
 * like the operator does on the desk.
 */

import { DESK_TEMPLATES, type DeskDraft, type DeskFavorite } from "../../shared/desk";
import type { ControlState } from "../../shared/types/event";
import { getPlaybackEngine } from '../playback/PlaybackEngine';
import { getConfig } from "../utils/config";
import { ndiOutputManager } from "../output/NDIOutputManager";
import * as desk from "./Desk";
import { getLiveEventId, liveOutputsFor, loadEvent, loadStartList } from "./EventService";
import { getWebServer } from "../output/WebServer";
import { findByBib } from "../../shared/bibs";

export interface PreviewSnapshot {
  version: number;
  payload: { template: any; data: any; name: string; page: number } | null;
}

/** The draft in Preview. `origin` tells the desk whether a control surface prepared it. */
export interface Prepared {
  version: number;
  origin: "desk" | "remote";
  draft: DeskDraft | null;
}

let preview: PreviewSnapshot = { version: 0, payload: null };
let previewRequest = 0;
let prepared: Prepared = { version: 0, origin: "desk", draft: null };

const labelOf = (key: string) =>
  DESK_TEMPLATES.find((t) => t.key === key)?.label ?? key;

function fail(message: string, status = 400): Error {
  return Object.assign(new Error(message), { status });
}

function requireEvent(): string {
  const id = getLiveEventId();
  if (!id) throw fail("No event is open in Live mode", 409);
  return id;
}

export const getPreview = (): PreviewSnapshot => preview;
export const getPrepared = (): Prepared => prepared;

/** Load a draft into Preview (never touches the output) */
export async function prepare(
  projectId: string,
  draft: DeskDraft,
  origin: Prepared["origin"] = "desk",
): Promise<PreviewSnapshot> {
  const request = ++previewRequest;
  prepared = { version: prepared.version + 1, origin, draft };
  let built: Awaited<ReturnType<typeof desk.deskPreviewData>>;
  try {
    built = await desk.deskPreviewData(projectId, draft);
  } catch (error) {
    // Never leave an older draft in Preview when the newest one cannot be shown
    if (request === previewRequest) preview = { version: preview.version + 1, payload: null };
    throw error;
  }
  const { template, data } = built;
  if (request === previewRequest)
    preview = {
      version: preview.version + 1,
      payload: {
        template,
        data,
        name: template.desk?.label ?? labelOf(draft.key) ?? template.manifest.name,
        page: draft.page || 1,
      },
    };
  return preview;
}

export function clearPreview(): PreviewSnapshot {
  ++previewRequest;
  prepared = { version: prepared.version + 1, origin: "desk", draft: null };
  preview = { version: preview.version + 1, payload: null };
  return preview;
}

/** Set Preview to arbitrary content (theme preview in Plan); clears any prepared draft */
export function beginPreview(): number {
  prepared = { version: prepared.version + 1, origin: "desk", draft: null };
  preview = { version: preview.version + 1, payload: null };
  return ++previewRequest;
}
export function finishPreview(request: number, payload: PreviewSnapshot["payload"]): PreviewSnapshot {
  if (request === previewRequest) preview = { version: preview.version + 1, payload };
  return preview;
}

function draftName(draft: DeskDraft): string {
  const v = draft.values || {};
  return (
    v.runnerName ||
    draft.fields?.title ||
    draft.fields?.text ||
    draft.fields?.name ||
    v.className ||
    labelOf(draft.key)
  );
}

export async function controlState(): Promise<ControlState> {
  const eventId = getLiveEventId();
  const config = getConfig();
  const ndi = ndiOutputManager.getStatus().active;
  if (!eventId)
    return { eventId: null, onAir: [], otherOnAir: 0, prepared: null, favorites: [], data: null, output: { web: config.output.web.enabled, ndi } };
  const [event, state] = await Promise.all([loadEvent(eventId), desk.deskState(eventId)]);
  // Web output counts as on when the event uses it and the server is up
  const output = { web: liveOutputsFor(event).web && getWebServer().isRunning(), ndi };
  const p = prepared.draft;
  return {
    eventId,
    eventName: event.name,
    graphics: desk.deskDefinitions(event).map(t => ({ key: t.key, label: t.label, params: t.params })),
    onAir: state.onAir.map((o) => ({
      key: o.key,
      label: desk.deskDefinitions(event).find(t => t.key === o.key)?.label ?? labelOf(o.key),
      name: draftName(o.draft),
      step: o.step ?? 1,
      since: o.since,
    })),
    otherOnAir: state.otherOnAir,
    prepared: p ? { key: p.key, label: desk.deskDefinitions(event).find(t => t.key === p.key)?.label ?? labelOf(p.key), name: draftName(p) } : null,
    favorites: (await favorites()).map(({ id, label, key, graphic }) => ({ id, label, key, graphic })),
    data: event.dataSource?.lastCheck || null,
    polling: getPlaybackEngine().getLivePollingStatus(),
    output,
  };
}

function preparedDraft(): DeskDraft {
  if (!prepared.draft) throw fail("Nothing is prepared in Preview");
  return prepared.draft;
}

export async function show(): Promise<ControlState> {
  await desk.deskShow(requireEvent(), preparedDraft());
  return controlState();
}

export async function update(): Promise<ControlState> {
  await desk.deskUpdate(requireEvent(), preparedDraft());
  return controlState();
}

/** Hide one graphic by template key, or the most recent one */
export async function hide(key?: string): Promise<ControlState> {
  await desk.deskHide(requireEvent(), key);
  return controlState();
}

export async function hideAll(): Promise<ControlState> {
  await desk.deskHideAll(requireEvent());
  return controlState();
}

export async function page(delta: 1 | -1): Promise<ControlState> {
  await desk.deskPageStep(requireEvent(), delta);
  return controlState();
}

/** All favourites of the live event, flat, in desk template order */
export async function favorites(): Promise<(DeskFavorite & { key: string; graphic: string })[]> {
  const eventId = getLiveEventId();
  if (!eventId) return [];
  const all = desk.loadDeskFavorites(eventId);
  return desk.deskDefinitions(await loadEvent(eventId)).flatMap((t) =>
    (all[t.key] ?? []).map((f) => ({ ...f, key: t.key, graphic: t.label })),
  );
}

/** Load a favourite into Preview; with `andShow`, also put it on air */
export async function prepareFavorite(id: string, andShow = false): Promise<ControlState> {
  const eventId = requireEvent();
  const fav = (await favorites()).find((f) => f.id === id);
  if (!fav) throw fail("Favourite not found", 404);
  await prepare(eventId, fav.draft, "remote");
  return andShow ? show() : controlState();
}

/** Load a runner graphic (runner-identity, runner-splits, …) for a bib into Preview */
export async function prepareRunner(bib: string, key = "runner-identity"): Promise<ControlState> {
  const eventId = requireEvent();
  const def = desk.deskDefinitions(await loadEvent(eventId)).find((t) => t.key === key);
  if (!def?.params.includes("runner")) throw fail(`"${key}" is not a runner graphic`, 404);
  // Real bibs first; a virtual bib matches with or without its V ("101" finds V101)
  const runner = findByBib(loadStartList(eventId).entries, String(bib))[0];
  if (!runner) throw fail(`No runner with bib ${bib}`, 404);
  await prepare(
    eventId,
    {
      key,
      values: {
        className: runner.className,
        runnerName: runner.name,
        runnerClub: runner.club,
        // Found by virtual bib too, but only a real bib is shown in graphics
        runnerBib: runner.bib ? String(runner.bib) : undefined,
      },
      fields: {},
    },
    "remote",
  );
  return controlState();
}

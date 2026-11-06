/**
 * Live desk: the operator's template list, the command palette grammar and drafts.
 *
 * The desk lists one entry per graphic type (numbered for the command palette, e.g. "2 2 101":
 * runner identity, class 2, bib 101). Each entry maps to a graphic kind in the event's template
 * set. Operators prepare a draft (class, runner, control, text ...), check it in Preview, and
 * send it to air with an explicit Show.
 */

import type { DeskBehaviour, DeskFeed, DeskParam, PreviewData } from './capabilities';
export type { DeskBehaviour, DeskFeed, DeskParam } from './capabilities';

export interface DeskTemplate {
  /** Stable key (also the default kind in the template set) */
  key: string;
  /** Graphic kind in the template set (v_olgrafik_kind) */
  kind: string;
  /** Kinds to fall back to in sets that lack `kind` (e.g. imported looks with hand-made graphics) */
  fallbackIds?: string[];
  label: string;
  /** Short name in the palette interpretation ("Live feed") */
  short: string;
  /** Palette parameters, in order */
  params: DeskParam[];
  /** Which params must be set before the draft can load */
  required: DeskParam[];
  /** Data-driven graphics need a competition */
  live: boolean;
  /** Draft fields the inspector shows (manual inputs), from the graphic's manifest schema */
  fields?: string[];
  /** Options set only in Settings → Templates (not in the Live inspector) */
  settingsFields?: string[];
  /** Data the app fills in (src/shared/capabilities.ts) */
  feeds?: DeskFeed[];
  /** How the desk treats the graphic (src/shared/capabilities.ts) */
  behaviours?: DeskBehaviour[];
  /** Shares its rows-per-page setting with this graphic (Settings → Templates) */
  rowsPartner?: string;
  /** Real timing data needed for the theme preview */
  previewData?: PreviewData;
}

/** In the default command-number order: the first is 0 (Settings → Controls can reorder) */
export const DESK_TEMPLATES: DeskTemplate[] = [
  { key: 'event-title', kind: 'event-title', label: 'Race title', short: 'Race title', params: [], required: [], live: false, fields: ['series', 'title', 'place', 'date'], feeds: ['event'] },
  { key: 'live-feed', kind: 'standings-lower-third', fallbackIds: ['split-time-lower-third'], label: 'Live split', short: 'Live split', params: ['class', 'control', 'runner'], required: ['class'], live: true, fields: ['rows'], settingsFields: ['nameStyle', 'positionChange'], feeds: ['timing'], behaviours: ['freeze'] },
  { key: 'runner-identity', kind: 'runner-identity', label: 'Runner identity', short: 'Runner identity', params: ['class', 'runner'], required: ['runner'], live: true, fields: ['detail', 'bio', 'showBib'], feeds: ['timing'] },
  { key: 'runner-start', kind: 'runner-start', label: 'Runner focus', short: 'Runner focus', params: ['class', 'runner', 'control'], required: ['runner'], live: true, fields: ['detail', 'showBib', 'startTimeOnly'], feeds: ['timing'], behaviours: ['startControl', 'followNextStarter', 'freeze'] },
  { key: 'results', kind: 'results', fallbackIds: ['results-list-paginated'], label: 'Results table', short: 'Results table', params: ['class', 'control', 'page'], required: ['class'], live: true, fields: ['title', 'rowsPerPage', 'positionChange', 'relayTimes'], feeds: ['timing'], behaviours: ['holdOnAir', 'titleFromClass'], rowsPartner: 'start-list' },
  { key: 'runner-splits', kind: 'runner-splits', label: 'Split comparison', short: 'Splits', params: ['class', 'runner'], required: ['class', 'runner'], live: true, fields: ['compare', 'maxControls'], feeds: ['timing'] },
  { key: 'start-list', kind: 'start-list', label: 'Start list', short: 'Start list', params: ['class', 'page'], required: ['class'], live: true, fields: ['rowsPerPage'], feeds: ['timing'], rowsPartner: 'results' },
  { key: 'free-text', kind: 'free-text', label: 'Identity plate', short: 'Identity plate', params: [], required: [], live: false, fields: ['text', 'title'] },
  { key: 'course-info', kind: 'course-info', label: 'Course parameters', short: 'Course', params: ['class'], required: [], live: false, fields: ['title', 'legs', 'length', 'climb', 'controls', 'winningTime', 'startInterval', 'extra'], feeds: ['course'], behaviours: ['titleFromClass'] },
  { key: 'timer', kind: 'clock', fallbackIds: ['countdown-timer'], label: 'Elapsed timer', short: 'Timer', params: [], required: [], live: false, fields: ['label', 'mode', 'time'] },
  { key: 'weather', kind: 'weather', label: 'Weather', short: 'Weather', params: [], required: [], live: false, fields: ['title', 'condition', 'temperature', 'wind', 'humidity'], feeds: ['weather'], behaviours: ['titleFromLocation'] },
  { key: 'podium', kind: 'podium', label: 'Podium / flowers', short: 'Podium', params: ['class'], required: ['class'], live: true, fields: ['title'], settingsFields: ['showTime'], feeds: ['timing'], behaviours: ['holdOnAir', 'titleFromClass'] },
  { key: 'position-history', kind: 'position-history', label: 'Position history', short: 'Position history', params: ['class'], required: ['class'], live: true, fields: ['runners', 'runnerNames'], feeds: ['timing'] },
  { key: 'speaker', kind: 'speaker', label: 'Commentators / speaker', short: 'Commentators', params: [], required: [], live: false, fields: ['commentators', 'title'] },
  { key: 'start-group', kind: 'start-group', label: 'Start group', short: 'Start group', params: ['class'], required: ['class'], live: true, fields: ['rows'], feeds: ['timing'] }
];

/** The desk entry of a key */
export function deskTemplate(key: string | undefined): DeskTemplate | undefined {
  return key ? DESK_TEMPLATES.find(t => t.key === key) : undefined;
}

type DeskRef = string | Pick<DeskTemplate, 'feeds' | 'behaviours'> | undefined | null;
const refOf = (ref: DeskRef) => (typeof ref === 'string' ? deskTemplate(ref) : ref ?? undefined);

/** Does the graphic (a desk key or entry) have this behaviour? */
export function hasBehaviour(ref: DeskRef, behaviour: DeskBehaviour): boolean {
  return !!refOf(ref)?.behaviours?.includes(behaviour);
}

/** Does the app fill in this feed for the graphic (a desk key or entry)? */
export function hasFeed(ref: DeskRef, feed: DeskFeed): boolean {
  return !!refOf(ref)?.feeds?.includes(feed);
}

/**
 * Desk templates in an event's chosen order (Settings → Templates). Graphics missing from the
 * order (e.g. added in a later version) keep their default place after the ordered ones.
 */
export function orderDeskTemplates<T extends { key: string }>(list: T[], order?: string[]): T[] {
  if (!order?.length) return list;
  const rank = new Map(order.map((key, i) => [key, i]));
  const at = (t: T, i: number) => rank.get(t.key) ?? order.length + i;
  return list.map((t, i) => [t, at(t, i)] as const).sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

/** Command number -> desk template key. Configurable per installation (desk-commands.json). */
export type DeskCommandMap = Record<string, string>;

export const DEFAULT_DESK_COMMANDS: DeskCommandMap = Object.fromEntries(
  DESK_TEMPLATES.map((t, i) => [String(i), t.key])
);

/**
 * Per-event template settings (Settings → Templates), keyed by desk template key.
 * Field defaults fill a draft's empty fields; the operator can still change them in Live.
 */
export interface DeskTemplateSettings {
  /** Not listed in Live (still reachable through Companion and the API) */
  hidden?: boolean;
  /** Live updates while on air by default (the desk toggle starts here) */
  liveUpdates?: boolean;
  /** Default values for the graphic's fields */
  fields?: Record<string, any>;
  /** Start list / results: use the other list's rows-per-page default */
  linkRows?: boolean;
}
export type DeskTemplateSettingsMap = Record<string, DeskTemplateSettings>;

/** The live-updates default of a graphic for an event */
export function liveUpdatesDefault(ref: string | DeskTemplate, settings?: DeskTemplateSettingsMap): boolean {
  const key = typeof ref === 'string' ? ref : ref.key;
  const own = settings?.[key]?.liveUpdates;
  if (typeof own === 'boolean') return own;
  return !hasBehaviour(ref, 'holdOnAir');
}

/** Field defaults of a graphic for an event (rows per page may follow the other list) */
export function fieldDefaults(ref: string | DeskTemplate, settings?: DeskTemplateSettingsMap): Record<string, any> {
  const key = typeof ref === 'string' ? ref : ref.key;
  const own = { ...(settings?.[key]?.fields ?? {}) };
  const partner = (typeof ref === 'string' ? deskTemplate(ref) : ref)?.rowsPartner ?? '';
  if (partner && settings?.[key]?.linkRows) {
    const rows = settings?.[partner]?.fields?.rowsPerPage;
    if (rows !== undefined && rows !== '') own.rowsPerPage = rows;
  }
  return Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined && v !== ''));
}

/**
 * Freeze: the operator saw the runner pass the timing point and stopped the running clock
 * (draft.fields.frozenAt, epoch ms). It stays stopped until the timing data has the runner
 * through, then the official time takes over. Only graphics with a runner on the way have one.
 */
export function canFreeze(draft?: DeskDraft | null, template?: DeskTemplate): boolean {
  if (!draft?.values?.runnerName || !hasBehaviour(template ?? draft.key, 'freeze')) return false;
  // at the start (a graphic that takes the start, with no control) there is no time to stop
  return !(hasBehaviour(template ?? draft.key, 'startControl') && draft.values.controlCode === undefined);
}
export const isFrozenDraft = (draft?: DeskDraft | null) => Number(draft?.fields?.frozenAt) > 0;

/** What the operator prepares */
export interface DeskDraft {
  key: string;
  values: {
    className?: string;
    controlCode?: string;
    runnerName?: string;
    runnerClub?: string;
    runnerBib?: string;
  };
  fields: Record<string, any>;
  /** Page of a paged graphic to show first */
  page?: number;
  /** Per-graphic page hold in seconds. Undefined inherits the event default; zero is manual. */
  autoPageDurationSeconds?: number;
  /**
   * Live timing data on air. Undefined/true: the graphic follows new results while it is on air.
   * false: it keeps the results it went on air with until the operator presses Update.
   */
  liveUpdates?: boolean;
}

export interface DeskFavorite {
  id: string;
  /** F-number within its graphic (F1, F2 ...). It stays fixed; a deleted favourite's number goes to the next new one. */
  n: number;
  label: string;
  draft: DeskDraft;
  created: number;
}

export interface DeskOnAir {
  key: string;
  templateId: string;
  name: string;
  since: number;
  step?: number;
  steps?: number;
  /** The draft that is on air (to tell "changes not applied") */
  draft: DeskDraft;
  /** Live updates are held for this graphic (draft.liveUpdates === false) */
  held?: boolean;
  /** Held graphic: newer results have arrived since it was last updated */
  newData?: boolean;
}

export interface DeskState {
  eventId: string | null;
  onAir: DeskOnAir[];
  /** Other graphics on air, e.g. the output test pattern (shown so the desk never hides them silently) */
  otherOnAir: number;
}

/** A class in palette numbering: 1-based position in the competition's class list */
export interface DeskClass { id: number; name: string }

export function sameDraft(a?: DeskDraft | null, b?: DeskDraft | null): boolean {
  if (!a || !b) return false;
  const sig = (d: DeskDraft) => JSON.stringify([d.key, d.values, d.fields, d.page ?? 1, d.autoPageDurationSeconds, d.liveUpdates !== false]);
  return sig(a) === sig(b);
}

/** The Live desk's keys. They are fixed: one key per action, nothing to configure. */
export const DESK_SHORTCUTS: [string, string][] = [
  ['Space', 'Show / hide the selected graphic'],
  ['U', 'Update the graphic on air with the draft'],
  ['H', 'Hide the active graphic'],
  ['T', 'Freeze / resume the running time on air'],
  ['Esc', 'Hide all (in a field: leave the field)'],
  ['← / →', 'Previous / next page on Program'],
  ['0–9', 'Choose a graphic by its number'],
  ['F', 'Save the draft as a favourite'],
  ['Ctrl/Cmd+K', 'Command palette (also from a field)'],
  ['↑ / ↓', 'Choose a graphic in the list'],
  ['Tab', 'Move between fields']
];

/** Reserve saved numbers, including keys absent from the current look. */
export function allocateDeskCommands(saved: DeskCommandMap, templates: Pick<DeskTemplate, 'key'>[]): DeskCommandMap {
  const map = { ...saved };
  const assigned = new Set(Object.values(map));
  for (const { key } of templates) {
    if (assigned.has(key)) continue;
    const free = Array.from({ length: 100 }, (_, i) => String(i)).find(n => !(n in map));
    if (free === undefined) break;
    map[free] = key;
    assigned.add(key);
  }
  return map;
}

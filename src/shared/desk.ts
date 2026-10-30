/**
 * Live desk: the operator's template list, the command palette grammar and drafts.
 *
 * The desk lists one entry per graphic type (numbered for the command palette, e.g. "2 2 101":
 * runner identity, class 2, bib 101). Each entry maps to a graphic kind in the event's template
 * set. Operators prepare a draft (class, runner, control, text ...), check it in Preview, and
 * send it to air with an explicit Show.
 */

/** A command parameter the palette understands, in order after the template number */
export type DeskParam = 'class' | 'runner' | 'control' | 'page';

export interface DeskTemplate {
  /** Stable key (also the default kind in the template set) */
  key: string;
  /** Graphic kind in the template set (v_olgrafik_kind) */
  kind: string;
  /** Kinds to fall back to in sets that lack `kind` (classic has hand-made graphics) */
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
  /** Live updates while on air, unless the event's template settings say otherwise (default true) */
  liveUpdates?: boolean;
}

/** In the default command-number order: the first is 0 (Settings → Controls can reorder) */
export const DESK_TEMPLATES: DeskTemplate[] = [
  { key: 'event-title', kind: 'event-title', label: 'Race title', short: 'Race title', params: [], required: [], live: false, fields: ['series', 'title', 'place', 'date'] },
  { key: 'live-feed', kind: 'standings-lower-third', fallbackIds: ['split-time-lower-third'], label: 'Live split', short: 'Live split', params: ['class', 'control', 'runner'], required: ['class'], live: true, fields: ['rows'], settingsFields: ['nameStyle', 'positionChange'] },
  { key: 'runner-identity', kind: 'runner-identity', label: 'Runner identity', short: 'Runner identity', params: ['class', 'runner'], required: ['runner'], live: true, fields: ['detail', 'bio', 'showBib'] },
  { key: 'runner-start', kind: 'runner-start', label: 'Runner focus', short: 'Runner focus', params: ['class', 'runner', 'control'], required: ['runner'], live: true, fields: ['detail', 'showBib', 'startTimeOnly'] },
  { key: 'results', kind: 'results', fallbackIds: ['results-list-paginated'], label: 'Results table', short: 'Results table', params: ['class', 'control', 'page'], required: ['class'], live: true, liveUpdates: false, fields: ['title', 'rowsPerPage', 'positionChange'] },
  { key: 'runner-splits', kind: 'runner-splits', label: 'Runner split comparison', short: 'Runner splits', params: ['class', 'runner'], required: ['class', 'runner'], live: true, fields: ['maxControls'] },
  { key: 'start-list', kind: 'start-list', label: 'Start list', short: 'Start list', params: ['class', 'page'], required: ['class'], live: true, fields: ['rowsPerPage'] },
  { key: 'free-text', kind: 'free-text', label: 'Identity plate', short: 'Identity plate', params: [], required: [], live: false, fields: ['text', 'title'] },
  { key: 'course-info', kind: 'course-info', label: 'Course parameters', short: 'Course', params: ['class'], required: [], live: false, fields: ['title', 'legs', 'length', 'climb', 'controls', 'winningTime', 'startInterval', 'extra'] },
  { key: 'timer', kind: 'clock', fallbackIds: ['countdown-timer'], label: 'Elapsed timer', short: 'Timer', params: [], required: [], live: false, fields: ['label', 'mode', 'time'] },
  { key: 'weather', kind: 'weather', label: 'Weather', short: 'Weather', params: [], required: [], live: false, fields: ['title', 'condition', 'temperature', 'wind', 'humidity'] },
  { key: 'podium', kind: 'podium', label: 'Podium / flowers', short: 'Podium', params: ['class'], required: ['class'], live: true, liveUpdates: false, fields: ['title'], settingsFields: ['showTime'] },
  { key: 'position-history', kind: 'position-history', label: 'Position history', short: 'Position history', params: ['class'], required: ['class'], live: true, fields: ['runners', 'runnerNames'] },
  { key: 'speaker', kind: 'speaker', label: 'Commentators / speaker', short: 'Commentators', params: [], required: [], live: false, fields: ['commentators', 'title'] },
  { key: 'start-group', kind: 'start-group', label: 'Start group', short: 'Start group', params: ['class'], required: ['class'], live: true, fields: ['rows'] }
];

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
export function liveUpdatesDefault(key: string, settings?: DeskTemplateSettingsMap): boolean {
  const own = settings?.[key]?.liveUpdates;
  if (typeof own === 'boolean') return own;
  return DESK_TEMPLATES.find(t => t.key === key)?.liveUpdates ?? true;
}

/** Field defaults of a graphic for an event (rows per page may follow the other list) */
export function fieldDefaults(key: string, settings?: DeskTemplateSettingsMap): Record<string, any> {
  const own = { ...(settings?.[key]?.fields ?? {}) };
  const partner = key === 'start-list' ? 'results' : key === 'results' ? 'start-list' : '';
  if (partner && settings?.[key]?.linkRows) {
    const rows = settings?.[partner]?.fields?.rowsPerPage;
    if (rows !== undefined && rows !== '') own.rowsPerPage = rows;
  }
  return Object.fromEntries(Object.entries(own).filter(([, v]) => v !== undefined && v !== ''));
}

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
  ['Esc', 'Hide all (in a field: leave the field)'],
  ['← / →', 'Previous / next page on Program'],
  ['0–9', 'Choose a graphic by its number'],
  ['F', 'Save the draft as a favourite'],
  ['Ctrl/Cmd+K', 'Command palette (also from a field)'],
  ['↑ / ↓', 'Choose a graphic in the list'],
  ['Tab', 'Move between fields']
];

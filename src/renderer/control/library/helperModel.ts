/**
 * The import helper's logic: the graphic's fields, what our data could fill them, what Live
 * then asks for, and the checks before it gets a place in a look. No UI here.
 */
import { DESK_FEEDS, DESK_PARAMS } from '../../../shared/capabilities';
import type { DeskFeed, DeskParam } from '../../../shared/capabilities';
import { ROW_KEYS, type FieldMap } from '../../../shared/fieldMap';
import type { OGrafTemplateInfo, TemplateSetInfo } from '../../../shared/types/ograf';
import { graphicTitle } from './libraryModel';
import { slug } from '../../../shared/slug';
export { slug };

export type FieldType = 'string' | 'number' | 'boolean' | 'list' | 'other';

export interface FieldRow {
  key: string;
  title: string;
  type: FieldType;
  example?: unknown;
  /** A list's row fields */
  items?: FieldRow[];
}

export type RowKey = (typeof ROW_KEYS)[number];

export type Choice =
  | { kind: 'unset' }
  | { kind: 'typed' }
  | { kind: 'data'; key: string; auto?: boolean }
  | { kind: 'list'; from: 'results'; items: Record<string, RowKey | 'typed'>; auto?: boolean };

/** Our single values, grouped as the helper offers them, with what Live then needs */
export const OUR_DATA: Array<{ key: string; label: string; group: string; input?: DeskParam; feed?: DeskFeed; text: boolean }> = [
  { key: 'runnerName', label: 'Runner name', group: 'Runner', input: 'runner', text: true },
  { key: 'runnerClub', label: 'Runner club', group: 'Runner', input: 'runner', text: true },
  { key: 'runnerBib', label: 'Runner bib', group: 'Runner', input: 'runner', text: true },
  { key: 'className', label: 'Class', group: 'Class and timing point', input: 'class', text: true },
  { key: 'controlName', label: 'Timing point name', group: 'Class and timing point', input: 'control', text: true },
  { key: 'title', label: 'Event title', group: 'Event', feed: 'event', text: true },
  { key: 'series', label: 'Series', group: 'Event', feed: 'event', text: true },
  { key: 'place', label: 'Place', group: 'Event', feed: 'event', text: true },
  { key: 'date', label: 'Date', group: 'Event', feed: 'event', text: true },
  { key: 'event.name', label: 'Event name', group: 'Event', feed: 'event', text: true },
  { key: 'event.location', label: 'Event location', group: 'Event', feed: 'event', text: true },
  { key: 'event.organiser', label: 'Organiser', group: 'Event', feed: 'event', text: true },
  { key: 'length', label: 'Course length', group: 'Course', feed: 'course', text: true },
  { key: 'climb', label: 'Climb', group: 'Course', feed: 'course', text: true },
  { key: 'controls', label: 'Controls', group: 'Course', feed: 'course', text: true },
  { key: 'winningTime', label: 'Winning time', group: 'Course', feed: 'course', text: true },
  { key: 'condition', label: 'Weather', group: 'Weather', feed: 'weather', text: true },
  { key: 'temperature', label: 'Temperature', group: 'Weather', feed: 'weather', text: true },
  { key: 'wind', label: 'Wind', group: 'Weather', feed: 'weather', text: true },
  { key: 'humidity', label: 'Humidity', group: 'Weather', feed: 'weather', text: true },
];

/** A list row's values: everything is text except these */
export const ROW_DATA: Array<{ key: RowKey; label: string; text: boolean }> = [
  { key: 'name', label: 'Name', text: true },
  { key: 'club', label: 'Club', text: true },
  { key: 'country', label: 'Country', text: true },
  { key: 'bib', label: 'Bib', text: true },
  { key: 'position', label: 'Place', text: false },
  { key: 'time', label: 'Time', text: true },
  { key: 'diff', label: 'Behind', text: true },
  { key: 'status', label: 'Status', text: true },
  { key: 'startTime', label: 'Start time', text: true },
  { key: 'timeSeconds', label: 'Time in seconds', text: false },
  { key: 'diffSeconds', label: 'Behind in seconds', text: false },
];

type JsonField = { type?: string | string[]; title?: string; default?: unknown; examples?: unknown[]; items?: JsonField; properties?: Record<string, JsonField> };

function typeOf(field: JsonField): FieldType {
  const type = Array.isArray(field.type) ? field.type.find((t) => t !== 'null') : field.type;
  if (type === 'array' && field.items && (field.items.type === 'object' || field.items.properties)) return 'list';
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'string' || type === 'boolean') return type;
  return 'other';
}

function rowsOf(properties: Record<string, JsonField> | undefined): FieldRow[] {
  return Object.entries(properties ?? {}).map(([key, field]) => {
    const f = field && typeof field === 'object' ? field : {};
    const type = typeOf(f);
    return {
      key,
      title: typeof f.title === 'string' && f.title.trim() ? f.title : key,
      type,
      example: f.default ?? f.examples?.[0],
      ...(type === 'list' ? { items: rowsOf(f.items?.properties) } : {}),
    };
  });
}

/** One row per top-level field of the graphic's schema */
export function fieldRows(schema: unknown): FieldRow[] {
  return rowsOf((schema as { properties?: Record<string, JsonField> } | undefined)?.properties);
}

/** Words of a field's key and title: "runner_name", "subHeadline" and "Team" → runner, name, sub, headline, team */
const words = (row: FieldRow) =>
  `${row.key} ${row.title}`.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const has = (w: string[], ...any: string[]) => any.some((a) => w.includes(a));

function suggestRow(row: FieldRow): RowKey | null {
  const w = words(row);
  const numeric = row.type === 'number';
  if (has(w, 'rank', 'pos', 'position', 'place', 'placing')) return 'position';
  if (has(w, 'behind', 'gap', 'diff', 'difference')) return numeric ? 'diffSeconds' : 'diff';
  if (has(w, 'time', 'result', 'points', 'score', 'seconds')) return numeric ? 'timeSeconds' : 'time';
  if (has(w, 'club', 'team', 'organisation', 'organization', 'affiliation')) return 'club';
  if (has(w, 'country', 'nation', 'nationality', 'flag')) return 'country';
  if (has(w, 'bib', 'number')) return 'bib';
  if (has(w, 'status')) return 'status';
  if (has(w, 'start')) return 'startTime';
  if (has(w, 'name', 'athlete', 'runner', 'competitor', 'person', 'label', 'title')) return 'name';
  return null;
}

/** What our data would fit this field, from its key and title; null when nothing fits */
export function suggest(row: FieldRow): Choice | null {
  if (row.type === 'list') {
    const items: Record<string, RowKey | 'typed'> = {};
    for (const item of row.items ?? []) items[item.key] = suggestRow(item) ?? 'typed';
    return { kind: 'list', from: 'results', items };
  }
  if (row.type !== 'string' && row.type !== 'number') return null;
  const w = words(row);
  const key =
    has(w, 'name', 'headline', 'athlete', 'runner', 'competitor', 'person') ? 'runnerName'
    : has(w, 'club', 'team', 'organisation', 'organization', 'affiliation') ? 'runnerClub'
    : has(w, 'bib') ? 'runnerBib'
    : has(w, 'class', 'category') ? 'className'
    : has(w, 'control', 'split', 'checkpoint') ? 'controlName'
    : has(w, 'event', 'competition', 'race') ? 'event.name'
    : has(w, 'venue', 'location') ? 'event.location'
    : has(w, 'date') ? 'date'
    : has(w, 'series') ? 'series'
    : has(w, 'temperature', 'temp') ? 'temperature'
    : has(w, 'wind') ? 'wind'
    : has(w, 'humidity') ? 'humidity'
    : has(w, 'weather', 'condition') ? 'condition'
    : has(w, 'climb') ? 'climb'
    : has(w, 'length', 'distance') ? 'length'
    : null;
  return key ? { kind: 'data', key } : null;
}

/**
 * Where the helper starts: suggestions (marked automatic); fields with a default that nothing
 * fits stay typed in Live; the rest need a choice
 */
export function initialChoices(rows: FieldRow[]): Record<string, Choice> {
  const out: Record<string, Choice> = {};
  for (const row of rows) {
    const suggestion = suggest(row);
    out[row.key] = suggestion ? ({ ...suggestion, auto: true } as Choice) : row.example !== undefined || row.type === 'boolean' || row.type === 'other' ? { kind: 'typed' } : { kind: 'unset' };
  }
  return out;
}

/** A warning when the field expects a number (or yes/no) and our value is text */
export function typeWarning(row: FieldRow, ourKey: string): string | null {
  if (row.type !== 'number' && row.type !== 'boolean') return null;
  const ours = OUR_DATA.find((d) => d.key === ourKey) ?? ROW_DATA.find((d) => d.key === ourKey);
  if (!ours || !ours.text) return null;
  const numberVersion = ourKey === 'time' ? 'Time in seconds' : ourKey === 'diff' ? 'Behind in seconds' : null;
  return numberVersion
    ? `The graphic expects a number here, and ${ours.label} is text: use ${numberVersion}`
    : `The graphic expects ${row.type === 'number' ? 'a number' : 'yes or no'} here, and ${ours.label} is text`;
}

/** The inputs Live asks for and the data it fills in, from the matches */
export function deriveInputs(choices: Record<string, Choice>): { inputs: DeskParam[]; required: DeskParam[]; feeds: DeskFeed[] } {
  const inputs = new Set<DeskParam>();
  const required = new Set<DeskParam>();
  const feeds = new Set<DeskFeed>();
  for (const choice of Object.values(choices)) {
    if (choice.kind === 'list') {
      inputs.add('class').add('control');
      required.add('class');
      feeds.add('timing');
    } else if (choice.kind === 'data') {
      const ours = OUR_DATA.find((d) => d.key === choice.key);
      if (ours?.input) {
        inputs.add(ours.input);
        if (ours.input !== 'control') required.add(ours.input);
      }
      if (ours?.feed) feeds.add(ours.feed);
    }
  }
  return {
    inputs: DESK_PARAMS.filter((p) => inputs.has(p)),
    required: DESK_PARAMS.filter((p) => required.has(p)),
    feeds: DESK_FEEDS.filter((f) => feeds.has(f)),
  };
}

/** The graphic's Live entry (v_olgrafik_desk): fields left typed are what the operator fills in */
export function buildDesk({ label, short, choices }: { label: string; short: string; choices: Record<string, Choice> }) {
  return {
    label: label.trim(),
    short: short.trim() || label.trim(),
    ...deriveInputs(choices),
    fields: Object.entries(choices).filter(([, c]) => c.kind === 'typed').map(([k]) => k),
  };
}

/** The graphic's v_olgrafik_fieldMap */
export function buildFieldMap(choices: Record<string, Choice>): FieldMap {
  const map: FieldMap = {};
  for (const [key, choice] of Object.entries(choices)) {
    if (choice.kind === 'data') map[key] = choice.key;
    else if (choice.kind === 'list') {
      const items = Object.fromEntries(Object.entries(choice.items).filter(([, v]) => v !== 'typed')) as Record<string, string>;
      map[key] = { from: choice.from, items };
    }
  }
  return map;
}

/** An outside graphic's own kind, <look>-<label>, unique among the look's kinds */
export function kindFor(lookId: string, label: string, taken: string[]): string {
  const base = `${lookId}-${slug(label)}`;
  let kind = base;
  for (let n = 2; taken.includes(kind); n++) kind = `${base}-${n}`;
  return kind;
}

/** What must change before Finish, in words */
export function conflicts({
  target,
  label,
  looks,
  templates,
  selfId,
}: {
  target: { lookId: string } | { newLookName: string };
  label: string;
  looks: TemplateSetInfo[];
  templates: OGrafTemplateInfo[];
  selfId: string;
}): string[] {
  const out: string[] = [];
  const wanted = label.trim().toLowerCase();
  if (!wanted) out.push('Give the graphic a name for Live');
  if ('newLookName' in target) {
    const name = target.newLookName.trim();
    if (!name) out.push('Give the new look a name');
    else if (looks.some((l) => l.name.toLowerCase() === name.toLowerCase()))
      out.push(`A look called "${name}" already exists: choose another name, or add to that look`);
  } else if (wanted) {
    const look = looks.find((l) => l.id === target.lookId);
    const clash = templates.find((t) => t.setId === target.lookId && t.manifest.id !== selfId && graphicTitle(t).toLowerCase() === wanted);
    if (clash) out.push(`${look?.name ?? target.lookId} already has a graphic called "${graphicTitle(clash)}": choose another name`);
  }
  return out;
}

/** A graphic of the look asking for the same inputs, to offer as "Use instead of" */
export function replacementFor(templates: OGrafTemplateInfo[], lookId: string, inputs: DeskParam[], selfId: string): OGrafTemplateInfo | null {
  if (!inputs.length) return null;
  const same = (params: readonly string[]) => params.length === inputs.length && inputs.every((p) => params.includes(p));
  return templates.find((t) => t.setId === lookId && t.manifest.id !== selfId && t.desk && same(t.desk.params)) ?? null;
}

/**
 * v_olgrafik_fieldMap: a graphic made elsewhere (OGraf Studio, another tool) names its fields its
 * own way. The map says which of our data goes into which of its fields:
 *
 *   { "headline": "runnerName",
 *     "contestants": { "from": "results", "items": { "name": "name", "points": "timeSeconds" } } }
 *
 * Applied to the data the app builds (Show, Update, live updates, previews), never to the OGraf
 * Server API. Fields not in the map pass through, so typed fields keep working.
 */

/** Our single values a graphic field can take (dotted keys read nested objects) */
export const OUR_KEYS = [
  'runnerName', 'runnerClub', 'runnerBib',
  'className', 'controlName',
  'title', 'series', 'place', 'date',
  'event.name', 'event.location', 'event.date', 'event.series', 'event.organiser',
  'length', 'climb', 'controls', 'winningTime', 'startInterval', 'legs',
  'condition', 'temperature', 'wind', 'humidity',
] as const;

/** Our lists, and the keys of their rows (timeSeconds and diffSeconds are numbers worked out from time and diff) */
export const OUR_LISTS = ['results'] as const;
export const ROW_KEYS = ['name', 'club', 'country', 'bib', 'position', 'time', 'diff', 'status', 'startTime', 'timeSeconds', 'diffSeconds'] as const;

export type FieldMap = Record<string, string | { from: string; items: Record<string, string> }>;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function read(data: Record<string, unknown>, key: string): unknown {
  let value: unknown = data;
  for (const part of key.split('.')) {
    if (!isObject(value)) return undefined;
    value = value[part];
  }
  return value;
}

/** "15:52", "1:02:03", "+1:23" or a number of seconds, as seconds; null when it isn't a time */
export function parseClock(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = /^\s*([+-]?)(\d+(?:\.\d+)?)(?::(\d{1,2}(?:\.\d+)?))?(?::(\d{1,2}(?:\.\d+)?))?\s*$/.exec(value);
  if (!m) return null;
  const parts = [m[2], m[3], m[4]].filter((p) => p !== undefined).map(Number);
  const seconds = parts.reduce((total, p) => total * 60 + p, 0);
  return m[1] === '-' ? -seconds : seconds;
}

function rowValue(row: Record<string, unknown>, key: string): unknown {
  if (key === 'timeSeconds') return parseClock(row.time);
  if (key === 'diffSeconds') return row.diff === '' || row.diff === undefined ? null : parseClock(row.diff);
  return row[key];
}

/** Our data with the graphic's mapped fields set; unchanged when there is no usable map */
export function applyFieldMap<T extends Record<string, unknown>>(map: unknown, data: T): T {
  if (!isObject(map)) return data;
  const out: Record<string, unknown> = { ...data };
  for (const [target, source] of Object.entries(map)) {
    if (typeof source === 'string') {
      const value = read(data, source);
      if (value !== undefined && value !== null && value !== '') out[target] = value;
    } else if (isObject(source) && typeof source.from === 'string' && isObject(source.items)) {
      const rows = read(data, source.from);
      if (!Array.isArray(rows)) continue;
      const items = Object.entries(source.items).filter((e): e is [string, string] => typeof e[1] === 'string');
      out[target] = rows.map((row) => {
        const r = isObject(row) ? row : {};
        return Object.fromEntries(items.map(([to, from]) => [to, rowValue(r, from) ?? null]));
      });
    }
  }
  return out as T;
}

/** What is wrong with a map, in words, against the graphic's schema */
export function fieldMapWarnings(map: unknown, schema: unknown): string[] {
  if (map === undefined) return [];
  if (!isObject(map)) return ['expected an object of graphic field → our data'];
  const properties = isObject(schema) && isObject(schema.properties) ? schema.properties : {};
  const warnings: string[] = [];
  const known = new Set<string>(OUR_KEYS);
  for (const [target, source] of Object.entries(map)) {
    const field = properties[target];
    if (!isObject(field)) warnings.push(`"${target}" is not a field of the graphic`);
    if (typeof source === 'string') {
      if (!known.has(source)) warnings.push(`"${target}": "${source}" is not Split Control data`);
    } else if (isObject(source)) {
      if (isObject(field) && field.type !== 'array') warnings.push(`"${target}" is not a list, so it can't take a list`);
      if (!(OUR_LISTS as readonly string[]).includes(String(source.from))) warnings.push(`"${target}": "${String(source.from)}" is not a Split Control list`);
      for (const [to, from] of Object.entries(isObject(source.items) ? source.items : {})) {
        if (!(ROW_KEYS as readonly string[]).includes(String(from))) warnings.push(`"${target}.${to}": "${String(from)}" is not a row value`);
      }
    } else {
      warnings.push(`"${target}": expected our data key or a list mapping`);
    }
  }
  return warnings;
}

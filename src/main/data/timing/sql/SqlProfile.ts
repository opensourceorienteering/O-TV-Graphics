/**
 * SQL profiles: a timing plugin that is only a file of queries and mappings.
 *
 * Split Control owns the database driver, the connection settings and the safety rules; the
 * profile says what to read. Column names choose the SDK field (`AS start`, `` AS `club.name` ``).
 * See docs/TIMING-PLUGINS.md for the format and src/main/data/timing/profiles/meos-mop.yaml for
 * a complete example.
 */

import { parse as parseYaml } from 'yaml';
import type { ConfigSchema, EntryStatus, ExtFieldDecl, PluginManifest } from '../../../../shared/timing-sdk';
import { ENTRY_STATUSES } from '../../../../shared/timing-sdk';
import { assertReadOnlySelect } from './sqlText';

export type TimeUnit = 'ms' | 'hundredths' | 'tenths' | 'seconds';
export type ClockKind = 'sinceMidnight' | 'epochMs' | 'epochSeconds' | 'datetime';

export type StatusTarget = EntryStatus | { status: EntryStatus; ranked?: boolean };
export type StatusDefault = StatusTarget | { ifPassings: EntryStatus; else: EntryStatus };

export const QUERY_NAMES = [
  'competitions', 'classes', 'radioControls', 'entries', 'relayEntries', 'passings', 'latestPassings'
] as const;
export type QueryName = typeof QUERY_NAMES[number];

export interface SqlProfile {
  id: string;
  name: string;
  description?: string;
  version: string;
  sdk: string;
  driver: 'mysql';
  /** Default IANA zone of the event (the source's settings can override it) */
  timezone?: string;
  /** Fastest useful poll interval (ms, default 2000, minimum 1000) */
  pollMs?: number;
  units: { time: TimeUnit; clock: ClockKind };
  /** Source status value -> SDK status. Without a map the column must hold SDK statuses. */
  statusMap?: Record<string, StatusTarget> & { default?: StatusDefault };
  transforms?: {
    /** Control ids encode the visit: id = control + base * (visit - 1) (MeOS uses 100000) */
    controlId?: { visitEncoding?: { base: number } };
  };
  /** Extra settings shown in the source's settings form; queries read them as :name */
  options?: ConfigSchema;
  queries: Partial<Record<QueryName, string>> & { competitions: string; classes: string; entries: string };
  extFields?: ExtFieldDecl[];
}

const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

/** Parse and check a profile (YAML or JSON text). Errors name the file and the problem. */
export function parseSqlProfile(text: string, label = 'SQL profile'): SqlProfile {
  let raw: any;
  try {
    raw = parseYaml(text);
  } catch (error) {
    throw new Error(`${label}: not valid YAML (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!raw || typeof raw !== 'object') throw new Error(`${label}: empty profile`);
  const fail = (msg: string): never => { throw new Error(`${label}: ${msg}`); };

  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) fail('"id" must be lowercase letters, digits and hyphens');
  if (typeof raw.name !== 'string' || !raw.name) fail('"name" is required');
  if ((raw.driver ?? 'mysql') !== 'mysql') fail(`driver "${raw.driver}" is not supported (only mysql)`);
  const units = raw.units ?? {};
  const time: TimeUnit = units.time ?? 'ms';
  const clock: ClockKind = units.clock ?? 'datetime';
  if (!['ms', 'hundredths', 'tenths', 'seconds'].includes(time)) fail(`units.time "${time}" is not one of ms, hundredths, tenths, seconds`);
  if (!['sinceMidnight', 'epochMs', 'epochSeconds', 'datetime'].includes(clock)) fail(`units.clock "${clock}" is not one of sinceMidnight, epochMs, epochSeconds, datetime`);

  const queries = raw.queries ?? {};
  for (const required of ['competitions', 'classes', 'entries'] as const) {
    if (typeof queries[required] !== 'string') fail(`queries.${required} is required`);
  }
  for (const [name, sql] of Object.entries(queries)) {
    if (!(QUERY_NAMES as readonly string[]).includes(name)) fail(`unknown query "${name}" (known: ${QUERY_NAMES.join(', ')})`);
    if (typeof sql !== 'string') fail(`queries.${name} must be SQL text`);
    assertReadOnlySelect(sql as string, `${label} queries.${name}`);
  }

  const checkStatus = (v: unknown, where: string) => {
    const s = typeof v === 'string' ? v : (v as any)?.status;
    if (!ENTRY_STATUSES.includes(s)) fail(`${where}: "${s}" is not a status (${ENTRY_STATUSES.join(', ')})`);
  };
  if (raw.statusMap !== undefined) {
    if (typeof raw.statusMap !== 'object') fail('statusMap must map source values to statuses');
    for (const [k, v] of Object.entries(raw.statusMap)) {
      if (k === 'default' && v && typeof v === 'object' && 'ifPassings' in (v as object)) {
        checkStatus((v as any).ifPassings, 'statusMap.default.ifPassings');
        checkStatus((v as any).else, 'statusMap.default.else');
      } else {
        checkStatus(v, `statusMap.${k}`);
      }
    }
  }
  const base = raw.transforms?.controlId?.visitEncoding?.base;
  if (base !== undefined && !(Number.isInteger(base) && base > 1)) fail('transforms.controlId.visitEncoding.base must be a whole number above 1');

  for (const f of raw.extFields ?? []) {
    if (!f?.key || !/^[A-Za-z_]\w*$/.test(f.key)) fail(`extFields: "${f?.key}" is not a valid key`);
    if (!['entry', 'class', 'competition'].includes(f.on)) fail(`extFields.${f.key}: "on" must be entry, class or competition`);
  }
  const reserved = new Set(['competitionId', 'classId', 'entryIds', 'limit']);
  for (const key of Object.keys(raw.options?.properties ?? {})) {
    if (reserved.has(key)) fail(`options.${key}: the name is reserved`);
    if (!/^[A-Za-z_]\w*$/.test(key)) fail(`options.${key}: use letters, digits and _`);
  }

  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    version: String(raw.version ?? '1.0.0'),
    sdk: String(raw.sdk ?? '^1.0'),
    driver: 'mysql',
    timezone: raw.timezone,
    pollMs: raw.pollMs,
    units: { time, clock },
    statusMap: raw.statusMap,
    transforms: raw.transforms,
    options: raw.options,
    queries,
    extFields: raw.extFields
  };
}

/** The MySQL connection settings every SQL profile source has */
export const MYSQL_CONNECTION_SCHEMA: ConfigSchema = {
  type: 'object',
  required: ['host', 'database', 'user'],
  properties: {
    host: { type: 'string', title: 'Host', default: 'localhost' },
    port: { type: 'integer', title: 'Port', default: 3306, minimum: 1, maximum: 65535 },
    database: { type: 'string', title: 'Database' },
    user: { type: 'string', title: 'User' },
    password: { type: 'string', title: 'Password', format: 'password' },
    timezone: { type: 'string', title: 'Event time zone', description: 'IANA zone, e.g. Europe/Stockholm', default: 'Europe/Stockholm' },
    pollIntervalMs: { type: 'integer', title: 'Poll interval (ms)', default: 2000, minimum: 1000 }
  }
};

/** The plugin manifest of a profile: connection settings first, then the profile's options */
export function profileManifest(profile: SqlProfile): PluginManifest {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    version: profile.version,
    sdk: profile.sdk,
    configSchema: {
      type: 'object',
      required: [...(MYSQL_CONNECTION_SCHEMA.required ?? []), ...(profile.options?.required ?? [])],
      properties: { ...MYSQL_CONNECTION_SCHEMA.properties, ...(profile.options?.properties ?? {}) }
    },
    capabilities: {
      minPollMs: Math.max(1000, profile.pollMs ?? 2000),
      passings: !!profile.queries.latestPassings,
      relays: !!profile.queries.relayEntries,
      courses: true
    },
    extFields: profile.extFields
  };
}

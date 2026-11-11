/**
 * Split Control timing SDK, version 1
 *
 * The contract between Split Control and a timing plugin. A plugin reports facts about
 * the competition in the model below; Split Control works out everything that follows
 * from them (places, ties, time behind, split places, progress, relay team times) and
 * builds the base tags templates bind to. See docs/TIMING-PLUGINS.md.
 *
 * Rules for plugins:
 *  - Instants are epoch milliseconds (UTC). Durations are milliseconds.
 *  - Ids are strings and must be stable between calls (saved events refer to them).
 *  - Report what the source knows; leave out what it does not. Never compute places.
 *  - Anything that is not in the model goes in `ext`, declared in the manifest's extFields.
 */

/** SDK version this build of Split Control implements */
export const TIMING_SDK_VERSION = '1.0.0';

/** Epoch milliseconds (UTC) */
export type Ms = number;
/** Milliseconds */
export type Duration = number;

export type EntryStatus =
  | 'notStarted'   // has not started (yet)
  | 'running'      // started, no result yet
  | 'ok'           // finished, approved
  | 'okNoTime'     // approved without a time (no timing)
  | 'mispunch'
  | 'dnf'
  | 'dsq'
  | 'overtime'
  | 'dns'
  | 'cancelled'
  | 'notCompeting'; // left out of every list

export const ENTRY_STATUSES: readonly EntryStatus[] = [
  'notStarted', 'running', 'ok', 'okNoTime', 'mispunch', 'dnf', 'dsq', 'overtime', 'dns', 'cancelled', 'notCompeting'
];

export type Ext = Record<string, unknown>;

export interface Competition {
  id: string;
  name: string;
  /** YYYY-MM-DD, local date of the event */
  date: string;
  /** IANA time zone of the event (default Europe/Stockholm) */
  timezone?: string;
  organiser?: string;
  location?: string;
  ext?: Ext;
}

export interface Control {
  /** Stable id, unique within the class (and leg). Passings refer to it. */
  id: string;
  /** Control code as printed on the map */
  code?: number;
  /** Which visit to this control (1 = first, 2 = second ...); default 1 */
  visit?: number;
  name?: string;
  /** Relays: the leg this radio control belongs to (default: every leg) */
  leg?: number;
  ext?: Ext;
}

export interface ClassInfo {
  id: string;
  name: string;
  /** Sort order in lists (lower first); the source's order otherwise */
  order?: number;
  kind: 'individual' | 'relay';
  /** Relays: number of legs */
  legs?: number;
  course?: { lengthM?: number; climbM?: number; controls?: number };
  /** Radio controls in course order (per leg for relays, see Control.leg) */
  radioControls: Control[];
  ext?: Ext;
}

export interface Passing {
  controlId: string;
  /** When the runner passed (epoch ms) ... */
  at?: Ms;
  /** ... or the runner's own running time at the control */
  time?: Duration;
}

export interface Entry {
  id: string;
  classId: string;
  name: { given?: string; family?: string; full: string };
  club?: { name: string; short?: string; country?: string };
  bib?: string;
  /** Nation code (IOC or ISO) */
  country?: string;
  status: EntryStatus;
  /** false = out of competition: shown, never ranked (default true) */
  ranked?: boolean;
  start?: Ms;
  finish?: Ms;
  /** Running time (own leg for relays); otherwise finish - start */
  time?: Duration;
  passings: Passing[];
  /** Relays: the team and leg this runner runs */
  team?: {
    id: string;
    name: string;
    bib?: string;
    /** When the team started (the first leg's start) */
    start?: Ms;
    leg: number;
    /** The team's total time at the end of this leg, when the source knows it */
    time?: Duration;
  };
  changedAt?: Ms;
  ext?: Ext;
}

export interface LatestPassing {
  entryId: string;
  classId: string;
  controlId: string;
  at: Ms;
}

/** Data a plugin adds on top of the base tags */
export interface ExtFieldDecl {
  key: string;
  on: 'entry' | 'class' | 'competition';
  type: 'string' | 'number' | 'boolean';
  label: string;
  unit?: string;
  description?: string;
}

/** The subset of JSON Schema the settings form understands */
export interface ConfigSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, ConfigProperty>;
}

export interface ConfigProperty {
  type: 'string' | 'number' | 'integer' | 'boolean';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  /** UI hints: 'password' hides the value, 'file' shows a file picker, 'url' */
  format?: 'password' | 'file' | 'url';
}

export interface PluginManifest {
  /** Lowercase letters, digits and hyphens. Also the source type saved in events. */
  id: string;
  name: string;
  description?: string;
  version: string;
  /** SDK range the plugin was written for, e.g. "^1.0" */
  sdk: string;
  configSchema?: ConfigSchema;
  capabilities?: {
    /** The plugin calls ctx.changed() when data changes; polling still runs as the fallback */
    push?: boolean;
    /** Fastest useful poll interval (ms, default 2000, never below 500) */
    minPollMs?: number;
    /** Implements passings() (latest passings feed) */
    passings?: boolean;
    relays?: boolean;
    courses?: boolean;
  };
  extFields?: ExtFieldDecl[];
}

export interface SqlRunner {
  /** Run a read-only query with named parameters (:name). Arrays expand for IN (:ids). */
  query(sql: string, params?: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

export interface MySqlConnection {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean;
}

export interface PluginLogger {
  debug(message: string, meta?: object): void;
  info(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, meta?: object): void;
}

export interface PluginContext {
  log: PluginLogger;
  /** Push sources: tell Split Control that a class (or the whole competition) changed */
  changed(competitionId: string, classId?: string): void;
  fetch: typeof fetch;
  /** Split Control's own MySQL/MariaDB driver, read-only, with timeouts and row limits */
  mysql(connection: MySqlConnection): Promise<SqlRunner & { close(): Promise<void> }>;
}

export interface TimingSource {
  /** Check the connection. Throw an Error whose message tells the operator what to fix. */
  connect(): Promise<void>;
  close(): void | Promise<void>;
  competitions(): Promise<Competition[]>;
  classes(competitionId: string): Promise<ClassInfo[]>;
  /** Every entry in the class; for relays every runner of every leg */
  entries(competitionId: string, classId: string): Promise<Entry[]>;
  /** Latest passings, newest first (capabilities.passings) */
  passings?(competitionId: string, limit: number): Promise<LatestPassing[]>;
}

export interface TimingPlugin {
  manifest: PluginManifest;
  create(config: Record<string, unknown>, ctx: PluginContext): TimingSource;
}

/**
 * The timing plugins packaged with Split Control. Their ids are the source types saved in
 * existing events ('liveresults', 'meos', 'iofxml', 'mysql'), so saved settings keep working.
 */

import type { TimingPlugin } from '../../../shared/timing-sdk';
import { TIMING_SDK_VERSION } from '../../../shared/timing-sdk';
import { MeosInfoServerSource } from '../sources/MeosInfoServerSource';
import { IofXmlSource } from '../sources/IofXmlSource';
import { parseSqlProfile, profileManifest, SqlProfile } from './sql/SqlProfile';
import { createSqlProfileSource } from './sql/SqlProfileSource';
import { createMySqlRunner } from './mysqlRunner';
import { createLiveresultatSource } from './liveresultat/LiveresultatSource';
import { createTraceTrackSource, DEFAULT_TRACE_TRACK_URL, TRACE_TRACK_FIELDS } from './tracetrack/TraceTrackSource';
import meosMopYaml from './profiles/meos-mop.yaml?raw';

const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));

export const liveresultatPlugin: TimingPlugin = {
  manifest: {
    id: 'liveresults',
    name: 'LiveResults',
    description: 'Fetch live orienteering results from LiveResults API',
    version: TIMING_SDK_VERSION,
    sdk: '^1.0',
    configSchema: {
      type: 'object',
      required: ['baseUrl'],
      properties: {
        baseUrl: { type: 'string', title: 'Base URL', default: 'https://api.orienteering.services', format: 'url' },
        api: { type: 'string', title: 'API', enum: ['auto', 'rest', 'legacy'], default: 'auto' },
        cacheInterval: { type: 'integer', title: 'Poll interval (ms)', minimum: 100 },
        timeout: { type: 'integer', title: 'Request timeout (ms)', default: 10000 }
      }
    },
    // The real floor (10 s REST, 15 s legacy) comes from the source once it knows its API
    capabilities: { push: true, relays: true, minPollMs: 10000 }
  },
  create: (config, ctx) => createLiveresultatSource(config, ctx)
};

export const meosPlugin: TimingPlugin = {
  manifest: {
    id: 'meos',
    name: 'MeOS (information server)',
    description: 'Live results, radio splits and relay legs straight from MeOS (Services > Information server)',
    version: TIMING_SDK_VERSION,
    sdk: '^1.0',
    configSchema: {
      type: 'object',
      required: ['url'],
      properties: {
        url: { type: 'string', title: 'Information server', default: 'http://localhost:2009', format: 'url' },
        competitionId: { type: 'integer', title: 'Competition id in Split Control', default: 1, minimum: 1 },
        timezone: { type: 'string', title: 'Event time zone', default: 'Europe/Stockholm' },
        pollIntervalMs: { type: 'integer', title: 'Poll interval (ms)', default: 1000, minimum: 500 }
      }
    },
    capabilities: { minPollMs: 500, relays: true }
  },
  create: (config) => new MeosInfoServerSource(String(config.url ?? 'http://localhost:2009'), {
    competitionId: num(config.competitionId),
    timezone: config.timezone as string | undefined,
    minPollIntervalMs: num(config.pollIntervalMs)
  })
};

export const iofXmlPlugin: TimingPlugin = {
  manifest: {
    id: 'iofxml',
    name: 'IOF XML 3.0 file',
    description: 'ResultList/StartList exported by timing software; re-read whenever the file changes',
    version: TIMING_SDK_VERSION,
    sdk: '^1.0',
    configSchema: {
      type: 'object',
      required: ['filePath'],
      properties: {
        filePath: { type: 'string', title: 'File', format: 'file' },
        competitionId: { type: 'integer', title: 'Competition id in Split Control', default: 1, minimum: 1 },
        timezone: { type: 'string', title: 'Event time zone', default: 'Europe/Stockholm' },
        pollIntervalMs: { type: 'integer', title: 'Check the file every (ms)', default: 2000, minimum: 1000 }
      }
    },
    capabilities: { minPollMs: 1000, relays: true, courses: true }
  },
  create: (config) => new IofXmlSource(String(config.filePath ?? ''), {
    competitionId: num(config.competitionId),
    timezone: config.timezone as string | undefined,
    radioControls: Array.isArray(config.radioControls) ? config.radioControls.map(Number) : undefined,
    minPollIntervalMs: num(config.pollIntervalMs)
  })
};

/** Connection settings of a SQL source; accepts the saved 'mysql' shape (ssl: { enabled }) */
function mysqlConnection(config: Record<string, unknown>) {
  const ssl = config.ssl as { enabled?: boolean; rejectUnauthorized?: boolean } | boolean | undefined;
  return {
    host: String(config.host ?? 'localhost'),
    port: num(config.port),
    database: String(config.database ?? ''),
    user: String(config.user ?? ''),
    password: String(config.password ?? ''),
    ssl: typeof ssl === 'object' ? !!ssl?.enabled : !!ssl,
    rejectUnauthorized: typeof ssl === 'object' ? ssl?.rejectUnauthorized : undefined,
    connectionLimit: num(config.connectionLimit),
    connectTimeout: num(config.connectTimeout)
  };
}

/** A plugin that reads a database with the given SQL profile */
export function sqlProfilePlugin(profile: SqlProfile, overrides: { id?: string; name?: string; description?: string } = {}): TimingPlugin {
  const base = profileManifest(profile);
  return {
    manifest: { ...base, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) },
    create: (config) => {
      const runner = createMySqlRunner(mysqlConnection(config));
      return createSqlProfileSource(profile, runner, {
        timezone: config.timezone as string | undefined,
        options: config,
        onConnect: () => runner.ping(),
        onClose: () => runner.close()
      });
    }
  };
}

export const meosMopProfile = parseSqlProfile(meosMopYaml, 'meos-mop.yaml');

/** 'mysql' (the saved type of MOP database sources) is the meos-mop profile */
export const mopPlugin = sqlProfilePlugin(meosMopProfile, {
  id: 'mysql',
  name: 'MySQL/MariaDB Database',
  description: 'MeOS Online Protocol (MOP) database: results, radio splits and relay legs'
});

/**
 * Trace / Track GPS tracking: an additional source next to the event's timing (heart rate, pace,
 * speed, position, signal, and optionally experimental virtual standings), never results.
 */
export const traceTrackPlugin: TimingPlugin = {
  manifest: {
    id: 'trace-track',
    name: 'Trace / Track (GPS)',
    description: 'Heart rate, pace, speed and position from Trace / Track, next to the event\'s timing source (Plan → Additional sources)',
    version: TIMING_SDK_VERSION,
    sdk: '^1.0',
    configSchema: {
      type: 'object',
      required: ['url', 'eventId', 'key'],
      properties: {
        url: { type: 'string', title: 'Server', default: DEFAULT_TRACE_TRACK_URL, format: 'url' },
        eventId: { type: 'string', title: 'Event ID', description: 'In Trace / Track Admin: the event\'s address, or Overview › Data for other software' },
        key: { type: 'string', title: 'Read key', format: 'password', description: 'Admin › event › Overview › Data for other software › create a key (ttr_…). Stored in plain text in config.json.' },
        eventName: { type: 'string', title: 'Name in Split Control', description: 'Optional' },
        timeline: { type: 'string', title: 'Timeline', enum: ['program', 'live'], default: 'program', description: 'program: as Trace / Track\'s Program map shows each runner (its delay or replay); live: the live time' },
        push: { type: 'boolean', title: 'Follow the live stream', default: true, description: 'Graphics update as soon as Trace / Track sends new values; polling stays as the fallback' },
        virtualStandings: { type: 'boolean', title: 'Virtual standings (experimental)', default: false, description: 'Estimated rank, gap, course progress, pacing and next-control arrival from GPS. Estimates, never results.' },
        pollIntervalMs: { type: 'integer', title: 'Update every (ms)', default: 2000, minimum: 1000, maximum: 10000 }
      }
    },
    capabilities: { push: true, minPollMs: 1000 },
    extFields: TRACE_TRACK_FIELDS.map(f => ({ key: f.key, on: 'entry' as const, type: f.type, label: f.label, ...(f.unit ? { unit: f.unit } : {}) }))
  },
  create: (config, ctx) => createTraceTrackSource(config, ctx)
};

export const BUILT_IN_TIMING_PLUGINS: TimingPlugin[] = [liveresultatPlugin, meosPlugin, mopPlugin, iofXmlPlugin, traceTrackPlugin];

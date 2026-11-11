/**
 * The timing plugins packaged with Split Control. Their ids are the source types saved in
 * existing events ('meos', 'iofxml', 'mysql'), so saved settings keep working.
 * Liveresultat is not a plugin: it is the core's native API (LiveResultsDataSource).
 */

import type { TimingPlugin } from '../../../shared/timing-sdk';
import { TIMING_SDK_VERSION } from '../../../shared/timing-sdk';
import { MeosInfoServerSource } from '../sources/MeosInfoServerBackend';
import { IofXmlSource } from '../sources/IofXmlBackend';
import { parseSqlProfile, profileManifest, SqlProfile } from './sql/SqlProfile';
import { createSqlProfileSource } from './sql/SqlProfileSource';
import { createMySqlRunner } from './mysqlRunner';
import meosMopYaml from './profiles/meos-mop.yaml?raw';

const num = (v: unknown): number | undefined => (v === undefined || v === null || v === '' ? undefined : Number(v));

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

export const BUILT_IN_TIMING_PLUGINS: TimingPlugin[] = [meosPlugin, mopPlugin, iofXmlPlugin];

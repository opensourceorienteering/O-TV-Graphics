/**
 * One data source class for every timing plugin (built-in, code plugin or SQL profile).
 *
 * The plugin's TimingSource reports facts; CanonicalBackend turns them into the core's
 * results; LiveResultsClient caches, detects changes and polls. The rest of Split Control
 * (field mapper, desk, playback, Director API) talks to getClient() as it always has.
 */

import { getLogger } from '../../utils/logger';
import { LiveResultsClient } from '../LiveResultsClient';
import { CanonicalBackend } from './CanonicalBackend';
import { createMySqlRunner } from './mysqlRunner';
import type { PluginContext, TimingPlugin, TimingSource, ConfigSchema } from '../../../shared/timing-sdk';
import {
  IDataSource,
  DataSourceConfig,
  Competition,
  Class,
  Result,
  convertLiveResultsCompetition,
  convertLiveResultsClass,
  convertLiveResultsResult
} from '../../../shared/types/dataSource';

const logger = getLogger();

/** Fill in defaults and check required settings; the message names the setting to fix */
export function applyConfigSchema(schema: ConfigSchema | undefined, config: Record<string, unknown>): Record<string, unknown> {
  if (!schema) return { ...config };
  const out: Record<string, unknown> = { ...config };
  for (const [key, prop] of Object.entries(schema.properties)) {
    if ((out[key] === undefined || out[key] === '') && prop.default !== undefined) out[key] = prop.default;
    const v = out[key];
    if (v === undefined || v === '') continue;
    if ((prop.type === 'number' || prop.type === 'integer') && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) {
      out[key] = Number(v);
    }
  }
  for (const key of schema.required ?? []) {
    if (out[key] === undefined || out[key] === '') {
      throw new Error(`Setting "${schema.properties[key]?.title ?? key}" is required`);
    }
  }
  return out;
}

export function pluginContext(pluginId: string, onChanged: (competitionId: string, classId?: string) => void): PluginContext {
  const meta = (m?: object) => ({ plugin: pluginId, ...(m ?? {}) });
  return {
    log: {
      debug: (msg, m) => logger.debug(msg, meta(m)),
      info: (msg, m) => logger.info(msg, meta(m)),
      warn: (msg, m) => logger.warn(msg, meta(m)),
      error: (msg, m) => logger.error(msg, meta(m))
    },
    changed: onChanged,
    fetch: (...args) => fetch(...args),
    mysql: async (connection) => {
      const runner = createMySqlRunner(connection);
      await runner.ping();
      return runner;
    }
  };
}

export class PluginDataSource implements IDataSource {
  readonly config: DataSourceConfig;
  readonly source: TimingSource;
  readonly backend: CanonicalBackend;
  private client: LiveResultsClient;
  private _initialized = false;

  constructor(readonly plugin: TimingPlugin, config: DataSourceConfig) {
    this.config = config;
    const id = plugin.manifest.id;
    // Defaults now; required settings are checked in initialize() so a bad source still loads
    let settings: Record<string, unknown>;
    try {
      settings = applyConfigSchema(plugin.manifest.configSchema, config.config ?? {});
    } catch {
      settings = { ...(config.config ?? {}) };
    }
    // The plugin may report changes before the backend exists; they are dropped until then
    const ctx = pluginContext(id, (competitionId, classId) => this.backend?.notifyChanged(competitionId, classId));
    this.source = plugin.create(settings, ctx);
    const minPoll = Math.max(
      500,
      Number(settings.pollIntervalMs) || 0,
      plugin.manifest.capabilities?.minPollMs ?? 2000
    );
    this.backend = new CanonicalBackend(this.source, id, { minPollIntervalMs: minPoll });
    this.client = new LiveResultsClient({
      baseUrl: `plugin://${id}/${encodeURIComponent(config.id)}`,
      backend: this.backend,
      cacheInterval: minPoll,
      retryAttempts: 1
    });
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;
    applyConfigSchema(this.plugin.manifest.configSchema, this.config.config ?? {});
    await this.source.connect();
    await this.client.getCompetitions();
    this._initialized = true;
    logger.info('Timing plugin source initialized', { id: this.config.id, plugin: this.plugin.manifest.id });
  }

  destroy(): void {
    this.client.destroy();
    this._initialized = false;
    try {
      const closing = this.source.close();
      if (closing && typeof (closing as Promise<void>).catch === 'function') {
        (closing as Promise<void>).catch(error => logger.warn('Timing plugin close failed', { plugin: this.plugin.manifest.id, error: String(error) }));
      }
    } catch (error) {
      logger.warn('Timing plugin close failed', { plugin: this.plugin.manifest.id, error: String(error) });
    }
  }

  private ensureReady(): void {
    if (!this._initialized) throw new Error(`${this.plugin.manifest.name} source not initialized`);
  }

  async getCompetitions(): Promise<Competition[]> {
    this.ensureReady();
    return (await this.client.getCompetitions()).data.map(convertLiveResultsCompetition);
  }

  async getClasses(competitionId: number): Promise<Class[]> {
    this.ensureReady();
    return (await this.client.getClasses(competitionId)).data.map(convertLiveResultsClass);
  }

  async getResults(competitionId: number, className: string): Promise<Result[]> {
    this.ensureReady();
    return ((await this.client.getClassResults(competitionId, className)).data.results ?? []).map(convertLiveResultsResult);
  }

  startPolling(competitionId: number, className: string, interval: number): void {
    this.ensureReady();
    this.client.startPolling({ competitionId, className, interval, onUpdate: () => undefined });
  }

  stopPolling(competitionId: number, className: string): void {
    this.client.stopPolling(`${competitionId}_${className}`);
  }

  supportsRealTime(): boolean {
    return true;
  }

  /** The client the field mapper, desk, playback engine and Director API read from */
  getClient(): LiveResultsClient {
    return this.client;
  }
}

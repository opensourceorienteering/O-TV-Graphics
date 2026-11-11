/**
 * One data source class for every timing source (built in, code plugin or SQL profile).
 *
 * The plugin's TimingSource reports facts; its TimingHub works out standings, caches, detects
 * changes and polls. The rest of Split Control (field mapper, desk, playback, Director API)
 * reads ClassResults from getClient().
 */

import { getLogger } from '../../utils/logger';
import { TimingHub } from './TimingHub';
import { createMySqlRunner } from './mysqlRunner';
import type { PluginContext, TimingPlugin, TimingSource, ConfigSchema } from '../../../shared/timing-sdk';
import type { IDataSource, DataSourceConfig, Competition, Class, Result } from '../../../shared/types/dataSource';

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
  readonly hub: TimingHub;
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
    // The plugin may report changes before the hub exists; they are dropped until then
    const ctx = pluginContext(id, (competitionId, classId) => this.hub?.notifyChanged(competitionId, classId));
    this.source = plugin.create(settings, ctx);
    this.hub = new TimingHub(this.source, {
      pluginId: id,
      label: `${id}:${config.id}`,
      // 'cacheInterval' is Liveresultat's name for it
      pollIntervalMs: Number(settings.pollIntervalMs ?? settings.cacheInterval) || undefined,
      minPollMs: Math.max(500, plugin.manifest.capabilities?.minPollMs ?? 2000)
    });
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;
    applyConfigSchema(this.plugin.manifest.configSchema, this.config.config ?? {});
    await this.source.connect();
    await this.hub.getCompetitions();
    this._initialized = true;
    logger.info('Timing plugin source initialized', { id: this.config.id, plugin: this.plugin.manifest.id });
  }

  destroy(): void {
    this.hub.destroy();
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
    return (await this.hub.getCompetitions()).data.map(c => ({ id: c.id, name: c.name, organizer: c.organiser, date: c.date }));
  }

  async getClasses(competitionId: number): Promise<Class[]> {
    this.ensureReady();
    return (await this.hub.getClasses(competitionId)).data.map(c => ({ className: c.className, displayName: c.className, numberOfEntries: 0 }));
  }

  async getResults(competitionId: number, className: string): Promise<Result[]> {
    this.ensureReady();
    return (await this.hub.getClassResults(competitionId, className)).data.rows.map(r => ({
      place: r.tied ? undefined : r.place || undefined,
      name: r.name,
      club: r.club,
      time: r.time !== undefined ? String(Math.round(r.time / 10)) : '',
      status: String(r.statusCode)
    }));
  }

  startPolling(competitionId: number, className: string, interval: number): void {
    this.ensureReady();
    this.hub.startPolling({ competitionId, className, interval, onUpdate: () => undefined });
  }

  stopPolling(competitionId: number, className: string): void {
    this.hub.stopPolling(`${competitionId}_${className}`);
  }

  supportsRealTime(): boolean {
    return true;
  }

  /** The hub the field mapper, desk, playback engine and Director API read from */
  getClient(): TimingHub {
    return this.hub;
  }
}

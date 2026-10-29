/**
 * MeOS information server data source
 *
 * Reads results, radio splits and relay legs live from MeOS's built-in information server
 * (Services > Information server in MeOS, port 2009 by default). Served through a
 * LiveResultsClient with a MeosInfoServerBackend, so it feeds templates and the live update
 * loop exactly like Liveresultat.
 */

import { getLogger } from '../../utils/logger';
import { LiveResultsClient } from '../LiveResultsClient';
import { MeosInfoServerBackend } from './MeosInfoServerBackend';
import {
  IDataSource,
  DataSourceConfig,
  MeosDataSourceConfig,
  Competition,
  Class,
  Result,
  convertLiveResultsCompetition,
  convertLiveResultsClass,
  convertLiveResultsResult
} from '../../../shared/types/dataSource';

const logger = getLogger();

export class MeosDataSource implements IDataSource {
  readonly config: MeosDataSourceConfig;
  private client: LiveResultsClient;
  private backend: MeosInfoServerBackend;
  private _initialized = false;

  constructor(config: DataSourceConfig) {
    if (config.type !== 'meos') {
      throw new Error(`Invalid config type for MeosDataSource: ${config.type}`);
    }
    this.config = config as MeosDataSourceConfig;
    const c = this.config.config;
    this.backend = new MeosInfoServerBackend(c.url || 'http://localhost:2009', {
      competitionId: c.competitionId,
      timezone: c.timezone,
      minPollIntervalMs: c.pollIntervalMs
    });
    this.client = new LiveResultsClient({
      baseUrl: this.backend.endpoint,
      backend: this.backend,
      cacheInterval: c.pollIntervalMs,
      retryAttempts: 1
    });
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;
    try {
      await this.client.getCompetitions(); // first complete download; fails early if MeOS is not reachable
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not reach the MeOS information server at ${this.backend.endpoint}: ${reason}. ` +
        'In MeOS, start Services > Information server and check the port.');
    }
    this._initialized = true;
    logger.info('MeosDataSource initialized', { id: this.config.id, endpoint: this.backend.endpoint });
  }

  destroy(): void {
    this.client.destroy();
    this._initialized = false;
  }

  private ensureReady() {
    if (!this._initialized) throw new Error('MeosDataSource not initialized');
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

  getClient(): LiveResultsClient {
    return this.client;
  }
}

export function createMeosDataSource(config: DataSourceConfig): MeosDataSource {
  return new MeosDataSource(config);
}

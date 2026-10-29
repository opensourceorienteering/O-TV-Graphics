/**
 * IOF XML 3.0 file data source
 *
 * Point it at the ResultList (or StartList) file your timing software exports regularly.
 * Served through a LiveResultsClient with an IofXmlBackend, so it feeds templates and the
 * live update loop exactly like Liveresultat.
 */

import fs from 'fs';
import { getLogger } from '../../utils/logger';
import { LiveResultsClient } from '../LiveResultsClient';
import { IofXmlBackend } from './IofXmlBackend';
import {
  IDataSource,
  DataSourceConfig,
  IofXmlDataSourceConfig,
  Competition,
  Class,
  Result,
  convertLiveResultsCompetition,
  convertLiveResultsClass,
  convertLiveResultsResult
} from '../../../shared/types/dataSource';

const logger = getLogger();

export class IofXmlDataSource implements IDataSource {
  readonly config: IofXmlDataSourceConfig;
  private client: LiveResultsClient;
  private _initialized = false;

  constructor(config: DataSourceConfig) {
    if (config.type !== 'iofxml') {
      throw new Error(`Invalid config type for IofXmlDataSource: ${config.type}`);
    }
    this.config = config as IofXmlDataSourceConfig;
    const c = this.config.config;
    const backend = new IofXmlBackend(c.filePath, {
      competitionId: c.competitionId,
      timezone: c.timezone,
      radioControls: c.radioControls,
      minPollIntervalMs: c.pollIntervalMs
    });
    this.client = new LiveResultsClient({ baseUrl: `file://${c.filePath}`, backend, cacheInterval: c.pollIntervalMs });
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;
    if (!this.config.config.filePath || !fs.existsSync(this.config.config.filePath)) {
      throw new Error(`IOF XML file not found: ${this.config.config.filePath || '(no path set)'}`);
    }
    await this.client.getCompetitions(); // parses the file once; fails early on a bad file
    this._initialized = true;
    logger.info('IofXmlDataSource initialized', { id: this.config.id, filePath: this.config.config.filePath });
  }

  destroy(): void {
    this.client.destroy();
    this._initialized = false;
  }

  private ensureReady() {
    if (!this._initialized) throw new Error('IofXmlDataSource not initialized');
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

export function createIofXmlDataSource(config: DataSourceConfig): IofXmlDataSource {
  return new IofXmlDataSource(config);
}

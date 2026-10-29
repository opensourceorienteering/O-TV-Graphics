/**
 * MySQL/MariaDB Data Source (MeOS Online Protocol schema)
 *
 * Connects to the database a MOP receiver writes (mopCompetition, mopCompetitor, mopRadio,
 * mopTeam, ...) and serves it through a LiveResultsClient with a MopBackend. That gives MeOS
 * data the same caching, change detection, live polling, transformer and templates as
 * Liveresultat - including radio split times and relay legs.
 *
 * Typical offline/arena setup: MeOS -> MOP receiver on the LAN -> MySQL -> Split Control.
 */

import { createPool, Pool, RowDataPacket } from 'mysql2/promise';
import { getLogger } from '../../utils/logger';
import { LiveResultsClient } from '../LiveResultsClient';
import { MopBackend } from './MopBackend';
import {
  IDataSource,
  DataSourceConfig,
  MySQLDataSourceConfig,
  Competition,
  Class,
  Result,
  convertLiveResultsCompetition,
  convertLiveResultsClass,
  convertLiveResultsResult
} from '../../../shared/types/dataSource';

const logger = getLogger();

export class MySQLDataSource implements IDataSource {
  readonly config: MySQLDataSourceConfig;
  private pool: Pool | null = null;
  private client: LiveResultsClient;
  private _initialized = false;

  constructor(config: DataSourceConfig) {
    if (config.type !== 'mysql') {
      throw new Error(`Invalid config type for MySQLDataSource: ${config.type}`);
    }
    this.config = config as MySQLDataSourceConfig;
    const c = this.config.config;

    const backend = new MopBackend(
      async (sql, params) => {
        if (!this.pool) throw new Error('MySQLDataSource not initialized');
        const [rows] = await this.pool.query<RowDataPacket[]>(sql, params as any[]);
        return rows;
      },
      { timezone: c.timezone, minPollIntervalMs: c.pollIntervalMs }
    );
    this.client = new LiveResultsClient({
      baseUrl: `mysql://${c.host}:${c.port || 3306}/${c.database}`,
      backend,
      cacheInterval: c.pollIntervalMs,
      retryAttempts: 1
    });

    logger.info('MySQLDataSource created', { id: this.config.id, host: c.host, database: c.database });
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._initialized) return;
    const c = this.config.config;
    this.pool = createPool({
      host: c.host,
      port: c.port || 3306,
      database: c.database,
      user: c.user,
      password: c.password,
      connectionLimit: c.connectionLimit || 10,
      connectTimeout: c.connectTimeout || 10000,
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      ...(c.ssl?.enabled && { ssl: { rejectUnauthorized: c.ssl.rejectUnauthorized ?? true } })
    });

    try {
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();
      this._initialized = true;
      logger.info('MySQLDataSource initialized', { id: this.config.id });
    } catch (error) {
      await this.pool.end().catch(() => undefined);
      this.pool = null;
      logger.error('Failed to initialize MySQLDataSource', {
        id: this.config.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  destroy(): void {
    this.client.destroy();
    this.pool?.end().catch(error => logger.error('Error closing MySQL pool', { error: String(error) }));
    this.pool = null;
    this._initialized = false;
  }

  private ensureReady(): void {
    if (!this._initialized) throw new Error('MySQLDataSource not initialized');
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
    const response = await this.client.getClassResults(competitionId, className);
    return (response.data.results ?? []).map(convertLiveResultsResult);
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

  /** LiveResults-compatible client used by the field mapper, DataStore and PlaybackEngine */
  getClient(): LiveResultsClient {
    return this.client;
  }
}

export function createMySQLDataSource(config: DataSourceConfig): MySQLDataSource {
  return new MySQLDataSource(config);
}

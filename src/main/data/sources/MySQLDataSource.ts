/**
 * MySQL/MariaDB Data Source
 * Connects to MySQL or MariaDB databases with MOP/SMGraphics schema
 */

import { createPool, Pool, RowDataPacket } from 'mysql2/promise';
import { getLogger } from '../../utils/logger';
import {
  IDataSource,
  DataSourceConfig,
  MySQLDataSourceConfig,
  Competition,
  Class,
  Result
} from '../../../shared/types/dataSource';

const logger = getLogger();

/**
 * MySQL/MariaDB Data Source
 * Implements IDataSource interface for MySQL/MariaDB databases
 */
export class MySQLDataSource implements IDataSource {
  readonly config: MySQLDataSourceConfig;
  private pool: Pool | null = null;
  private _initialized: boolean = false;
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: DataSourceConfig) {
    // Validate config type
    if (config.type !== 'mysql') {
      throw new Error(`Invalid config type for MySQLDataSource: ${config.type}`);
    }

    this.config = config as MySQLDataSourceConfig;

    logger.info('MySQLDataSource created', {
      id: this.config.id,
      name: this.config.name,
      host: this.config.config.host,
      database: this.config.config.database
    });
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._initialized) {
      logger.warn('MySQLDataSource already initialized', { id: this.config.id });
      return;
    }

    try {
      // Create connection pool
      this.pool = createPool({
        host: this.config.config.host,
        port: this.config.config.port || 3306,
        database: this.config.config.database,
        user: this.config.config.user,
        password: this.config.config.password,
        connectionLimit: this.config.config.connectionLimit || 10,
        connectTimeout: this.config.config.connectTimeout || 10000,
        waitForConnections: true,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        ...(this.config.config.ssl?.enabled && {
          ssl: {
            rejectUnauthorized: this.config.config.ssl.rejectUnauthorized ?? true
          }
        })
      });

      // Test connection
      const connection = await this.pool.getConnection();
      await connection.ping();
      connection.release();

      this._initialized = true;

      logger.info('MySQLDataSource initialized', {
        id: this.config.id,
        name: this.config.name,
        host: this.config.config.host,
        database: this.config.config.database
      });
    } catch (error) {
      logger.error('Failed to initialize MySQLDataSource', {
        id: this.config.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  destroy(): void {
    // Stop all polling
    for (const [pollId, interval] of this.pollingIntervals.entries()) {
      clearInterval(interval);
      logger.debug('Stopped polling', { id: this.config.id, pollId });
    }
    this.pollingIntervals.clear();

    // Close connection pool
    if (this.pool) {
      this.pool.end().catch(error => {
        logger.error('Error closing MySQL pool', {
          id: this.config.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
      this.pool = null;
    }

    this._initialized = false;

    logger.info('MySQLDataSource destroyed', { id: this.config.id });
  }

  async getCompetitions(): Promise<Competition[]> {
    if (!this._initialized || !this.pool) {
      throw new Error('MySQLDataSource not initialized');
    }

    try {
      const [rows] = await this.pool.query<RowDataPacket[]>(
        'SELECT cid as id, id as subId, name, date, organizer, homepage FROM mopCompetition ORDER BY date DESC'
      );

      return rows.map(row => ({
        id: row.id,
        name: row.name,
        organizer: row.organizer || undefined,
        date: row.date ? new Date(row.date).toISOString().split('T')[0] : undefined,
        homepage: row.homepage || undefined
      }));
    } catch (error) {
      logger.error('Failed to get competitions', {
        id: this.config.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getClasses(competitionId: number): Promise<Class[]> {
    if (!this._initialized || !this.pool) {
      throw new Error('MySQLDataSource not initialized');
    }

    try {
      // Get classes for this competition
      const [classRows] = await this.pool.query<RowDataPacket[]>(
        'SELECT id, name, ord FROM mopClass WHERE cid = ? ORDER BY ord',
        [competitionId]
      );

      // Get competitor counts for each class
      const [countRows] = await this.pool.query<RowDataPacket[]>(
        'SELECT cls, COUNT(*) as count FROM mopCompetitor WHERE cid = ? GROUP BY cls',
        [competitionId]
      );

      const countMap = new Map(countRows.map(r => [r.cls, r.count]));

      return classRows.map(row => ({
        className: row.name,
        displayName: row.name,
        numberOfEntries: countMap.get(row.id) || 0,
        classId: row.id,
        order: row.ord
      }));
    } catch (error) {
      logger.error('Failed to get classes', {
        id: this.config.id,
        competitionId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getResults(competitionId: number, className: string): Promise<Result[]> {
    if (!this._initialized || !this.pool) {
      throw new Error('MySQLDataSource not initialized');
    }

    try {
      // First, get the class ID from the class name
      const [classRows] = await this.pool.query<RowDataPacket[]>(
        'SELECT id FROM mopClass WHERE cid = ? AND name = ?',
        [competitionId, className]
      );

      if (classRows.length === 0) {
        logger.warn('Class not found', { id: this.config.id, competitionId, className });
        return [];
      }

      const classId = classRows[0].id;

      // Get competitors with organization names
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT 
          c.id,
          c.name,
          c.bib,
          c.stat,
          c.st,
          c.rt,
          c.it,
          o.name as orgName
        FROM mopCompetitor c
        LEFT JOIN mopOrganization o ON c.org = o.id AND c.cid = o.cid
        WHERE c.cid = ? AND c.cls = ?
        ORDER BY 
          CASE 
            WHEN c.stat = 1 THEN c.rt
            ELSE 999999999
          END,
          c.stat,
          c.name`,
        [competitionId, classId]
      );

      // Calculate places
      let place = 1;
      return rows.map((row) => {
        const status = this.mapStatus(row.stat);
        const time = this.formatTime(row.rt);
        
        const result: Result = {
          place: status === 'OK' ? place++ : undefined,
          name: row.name,
          club: row.orgName || undefined,
          time: time,
          status: status,
          bib: row.bib || undefined,
          startTime: this.formatTime(row.st),
          intermediateTime: row.it ? this.formatTime(row.it) : undefined
        };

        return result;
      });
    } catch (error) {
      logger.error('Failed to get results', {
        id: this.config.id,
        competitionId,
        className,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  startPolling(competitionId: number, className: string, interval: number): void {
    if (!this._initialized) {
      throw new Error('MySQLDataSource not initialized');
    }

    const pollId = `${competitionId}_${className}`;

    // Stop existing polling for this ID
    if (this.pollingIntervals.has(pollId)) {
      this.stopPolling(competitionId, className);
    }

    // Start new polling interval
    const intervalId = setInterval(async () => {
      try {
        await this.getResults(competitionId, className);
        logger.debug('Polling update', { id: this.config.id, pollId });
      } catch (error) {
        logger.error('Polling error', {
          id: this.config.id,
          pollId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, interval);

    this.pollingIntervals.set(pollId, intervalId);

    logger.info('Started polling', {
      id: this.config.id,
      competitionId,
      className,
      interval,
      pollId
    });
  }

  stopPolling(competitionId: number, className: string): void {
    const pollId = `${competitionId}_${className}`;
    const intervalId = this.pollingIntervals.get(pollId);

    if (intervalId) {
      clearInterval(intervalId);
      this.pollingIntervals.delete(pollId);

      logger.info('Stopped polling', {
        id: this.config.id,
        competitionId,
        className,
        pollId
      });
    }
  }

  supportsRealTime(): boolean {
    return true; // Supports polling
  }

  /**
   * Map MOP status codes to human-readable status
   */
  private mapStatus(stat: number): string {
    switch (stat) {
      case 0: return 'Not Started';
      case 1: return 'OK';
      case 2: return 'DNS'; // Did Not Start
      case 3: return 'MP'; // Mispunch
      case 4: return 'DNF'; // Did Not Finish
      case 5: return 'OT'; // Over Time
      case 9: return 'NC'; // Not Competing
      default: return 'Unknown';
    }
  }

  /**
   * Format time from hundredths of seconds to HH:MM:SS or MM:SS
   */
  private formatTime(hundredths: number | null): string | undefined {
    if (hundredths === null || hundredths === 0) {
      return undefined;
    }

    const totalSeconds = Math.floor(hundredths / 100);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    } else {
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }
}

/**
 * Factory function for creating MySQLDataSource instances
 */
export function createMySQLDataSource(config: DataSourceConfig): MySQLDataSource {
  return new MySQLDataSource(config);
}


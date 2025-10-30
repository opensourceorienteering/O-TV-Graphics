/**
 * LiveResults Data Source
 * Adapter that wraps LiveResultsClient to implement IDataSource interface
 */

import { getLogger } from '../../utils/logger';
import { LiveResultsClient, LiveResultsClientOptions } from '../LiveResultsClient';
import {
  IDataSource,
  DataSourceConfig,
  LiveResultsDataSourceConfig,
  Competition,
  Class,
  Result,
  convertLiveResultsCompetition,
  convertLiveResultsClass
} from '../../../shared/types/dataSource';

const logger = getLogger();

/**
 * LiveResults Data Source
 * Implements IDataSource interface using LiveResultsClient
 */
export class LiveResultsDataSource implements IDataSource {
  readonly config: LiveResultsDataSourceConfig;
  private client: LiveResultsClient;
  private _initialized: boolean = false;

  constructor(config: DataSourceConfig) {
    // Validate config type
    if (config.type !== 'liveresults') {
      throw new Error(`Invalid config type for LiveResultsDataSource: ${config.type}`);
    }

    this.config = config as LiveResultsDataSourceConfig;

    // Create LiveResultsClient instance
    const clientOptions: LiveResultsClientOptions = {
      baseUrl: this.config.config.baseUrl,
      cacheInterval: this.config.config.cacheInterval,
      timeout: this.config.config.timeout
    };
    this.client = new LiveResultsClient(clientOptions);

    logger.info('LiveResultsDataSource created', {
      id: this.config.id,
      name: this.config.name,
      baseUrl: this.config.config.baseUrl
    });
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._initialized) {
      logger.warn('LiveResultsDataSource already initialized', { id: this.config.id });
      return;
    }

    try {
      // Test connection by fetching competitions
      await this.client.getCompetitions();
      
      this._initialized = true;
      
      logger.info('LiveResultsDataSource initialized', {
        id: this.config.id,
        name: this.config.name
      });
    } catch (error) {
      logger.error('Failed to initialize LiveResultsDataSource', {
        id: this.config.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  destroy(): void {
    // Stop all polling
    this.client.stopAllPolling();
    
    this._initialized = false;
    
    logger.info('LiveResultsDataSource destroyed', {
      id: this.config.id
    });
  }

  async getCompetitions(): Promise<Competition[]> {
    if (!this._initialized) {
      throw new Error('LiveResultsDataSource not initialized');
    }

    try {
      const response = await this.client.getCompetitions();
      return response.data.map(convertLiveResultsCompetition);
    } catch (error) {
      logger.error('Failed to get competitions', {
        id: this.config.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getClasses(competitionId: number): Promise<Class[]> {
    if (!this._initialized) {
      throw new Error('LiveResultsDataSource not initialized');
    }

    try {
      logger.debug('LiveResultsDataSource.getClasses called', {
        id: this.config.id,
        competitionId,
        timestamp: Date.now()
      });

      const response = await this.client.getClasses(competitionId);

      logger.debug('LiveResultsDataSource.getClasses response', {
        id: this.config.id,
        competitionId,
        count: response.data.length,
        changed: response.changed,
        timestamp: Date.now()
      });

      return response.data.map(convertLiveResultsClass);
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
    if (!this._initialized) {
      throw new Error('LiveResultsDataSource not initialized');
    }

    try {
      // LiveResultsClient doesn't have getResults - we need to use getClassResults
      // For now, return empty array - this needs to be implemented properly
      logger.warn('getResults not yet implemented for LiveResultsDataSource', {
        id: this.config.id,
        competitionId,
        className
      });
      return [];
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
      throw new Error('LiveResultsDataSource not initialized');
    }

    // Create poll ID for this competition/class combination
    const pollId = `${competitionId}_${className}`;

    this.client.startPolling({
      competitionId,
      className,
      interval,
      onUpdate: (data) => {
        logger.debug('Polling update received', {
          id: this.config.id,
          competitionId,
          className,
          dataSize: JSON.stringify(data).length
        });
      },
      onError: (error) => {
        logger.error('Polling error', {
          id: this.config.id,
          competitionId,
          className,
          error: error.message
        });
      }
    });

    logger.info('Started polling', {
      id: this.config.id,
      competitionId,
      className,
      interval,
      pollId
    });
  }

  stopPolling(competitionId: number, className: string): void {
    if (!this._initialized) {
      throw new Error('LiveResultsDataSource not initialized');
    }

    // Create poll ID for this competition/class combination
    const pollId = `${competitionId}_${className}`;
    this.client.stopPolling(pollId);

    logger.info('Stopped polling', {
      id: this.config.id,
      competitionId,
      className,
      pollId
    });
  }

  supportsRealTime(): boolean {
    return true; // LiveResults supports polling
  }

  /**
   * Get the underlying LiveResultsClient instance
   * (for backward compatibility)
   */
  getClient(): LiveResultsClient {
    return this.client;
  }
}

/**
 * Factory function for creating LiveResultsDataSource instances
 */
export function createLiveResultsDataSource(config: DataSourceConfig): LiveResultsDataSource {
  return new LiveResultsDataSource(config);
}


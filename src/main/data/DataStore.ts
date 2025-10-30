/**
 * Data Store
 * In-memory cache for LiveResults data with event emission and WebSocket broadcasting
 */

import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';
import { getLiveResultsClient } from './LiveResultsClient';
import { LiveResultsTransformer, OGrafResultsData } from './LiveResultsTransformer';
import {
  LiveResultsCompetition,
  LiveResultsClass,
  LiveResultsClassResult
} from '../../shared/types/liveresults';

const logger = getLogger();

export interface DataStoreEvents {
  'competitions:updated': (competitions: LiveResultsCompetition[]) => void;
  'classes:updated': (competitionId: number, classes: LiveResultsClass[]) => void;
  'results:updated': (competitionId: number, className: string, data: OGrafResultsData) => void;
  'error': (error: Error) => void;
}

export interface PollingStatus {
  active: boolean;
  competitionId?: number;
  className?: string;
  interval?: number;
  lastUpdate?: number;
  errorCount?: number;
}

/**
 * Data Store
 * Manages in-memory cache and subscriptions for LiveResults data
 */
export class DataStore extends EventEmitter {
  private competitions: LiveResultsCompetition[] = [];
  private classes: Map<number, LiveResultsClass[]> = new Map();
  private results: Map<string, OGrafResultsData> = new Map();
  private pollingStatus: Map<string, PollingStatus> = new Map();
  private wsServer: any; // WebSocket server instance
  private updateDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_DELAY = 500; // milliseconds

  // Transformed data cache to avoid redundant transformations
  private transformedResults: Map<string, {
    ografData: OGrafResultsData;
    hash: string;
    timestamp: number;
  }> = new Map();
  private readonly TRANSFORM_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    logger.info('Data store initialized');
  }

  /**
   * Set WebSocket server for broadcasting updates
   */
  setWebSocketServer(wsServer: any): void {
    this.wsServer = wsServer;
    logger.info('WebSocket server attached to data store');
  }

  /**
   * Broadcast data update via WebSocket
   */
  private broadcast(event: string, data: any): void {
    if (this.wsServer) {
      this.wsServer.emit(event, data);
      logger.debug('Broadcasted via WebSocket', { event });
    }
  }

  /**
   * Debounced broadcast to prevent excessive WebSocket updates
   * Groups rapid updates and only sends the latest after a delay
   */
  private debouncedBroadcast(key: string, event: string, data: any): void {
    // Clear existing timer for this key
    const existingTimer = this.updateDebounceTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.broadcast(event, data);
      this.updateDebounceTimers.delete(key);
    }, this.DEBOUNCE_DELAY);

    this.updateDebounceTimers.set(key, timer);
  }

  /**
   * Load competitions
   */
  async loadCompetitions(): Promise<LiveResultsCompetition[]> {
    try {
      logger.debug('DataStore: Loading competitions...');
      const client = getLiveResultsClient();
      const response = await client.getCompetitions();

      logger.debug('DataStore: Competitions response', {
        dataLength: response.data.length,
        changed: response.changed,
        hash: response.hash
      });

      if (response.changed) {
        this.competitions = response.data;
        this.emit('competitions:updated', response.data);
        this.broadcast('competitions:updated', response.data);
        logger.info('Competitions updated', { count: response.data.length });
      } else {
        logger.debug('Competitions not changed, using cached data');
      }

      logger.debug('DataStore: Returning competitions', { count: response.data.length });
      return response.data;
    } catch (error) {
      logger.error('Failed to load competitions', { error: (error as Error).message, stack: (error as Error).stack });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Load classes for a competition
   */
  async loadClasses(competitionId: number): Promise<LiveResultsClass[]> {
    try {
      const client = getLiveResultsClient();
      const response = await client.getClasses(competitionId);

      if (response.changed) {
        this.classes.set(competitionId, response.data);
        this.emit('classes:updated', competitionId, response.data);
        this.broadcast('classes:updated', { competitionId, classes: response.data });
        logger.info('Classes updated', { competitionId, count: response.data.length });
      }

      return response.data;
    } catch (error) {
      logger.error('Failed to load classes', {
        competitionId,
        error: (error as Error).message
      });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Load results for a class
   */
  async loadResults(
    competitionId: number,
    className: string
  ): Promise<OGrafResultsData> {
    try {
      const client = getLiveResultsClient();
      const response = await client.getClassResults(competitionId, className);

      // Get competition name for context
      const competition = this.competitions.find(c => c.id === competitionId);
      const competitionName = competition?.name;

      // Transform to OGRAF format
      const ografData = LiveResultsTransformer.transformClassResults(response.data, {
        competitionName
      });

      const key = `${competitionId}_${className}`;
      
      if (response.changed) {
        this.results.set(key, ografData);
        this.emit('results:updated', competitionId, className, ografData);
        this.broadcast('results:updated', {
          competitionId,
          className,
          data: ografData
        });
        logger.info('Results updated', {
          competitionId,
          className,
          runners: ografData.results.length
        });
      }

      return ografData;
    } catch (error) {
      logger.error('Failed to load results', {
        competitionId,
        className,
        error: (error as Error).message
      });
      this.emit('error', error as Error);
      throw error;
    }
  }

  /**
   * Get transformed class results with caching
   * Only re-transforms if raw data hash changed or cache is stale
   */
  async getTransformedClassResults(
    competitionId: number,
    className: string,
    options?: {
      maxRows?: number;
      competitionName?: string;
      controlCode?: string; // If specified, transform split time results for this control
      client?: any; // Optional LiveResultsClient instance (if not provided, uses singleton)
    }
  ): Promise<OGrafResultsData> {
    // Use provided client or fall back to singleton (for backward compatibility)
    const client = options?.client || getLiveResultsClient();

    // Include controlCode in cache key to differentiate between finish and split results
    const cacheKey = options?.controlCode
      ? `${competitionId}_${className}_${options.controlCode}`
      : `${competitionId}_${className}`;

    // Fetch raw data (uses LiveResultsClient cache)
    const rawData = await client.getClassResults(competitionId, className);

    // Check if we have cached transformed data
    const cached = this.transformedResults.get(cacheKey);
    const now = Date.now();

    // Return cached if:
    // 1. Cache exists
    // 2. Hash matches (data hasn't changed)
    // 3. Cache is not stale (within TTL)
    if (cached &&
        cached.hash === rawData.hash &&
        (now - cached.timestamp) < this.TRANSFORM_CACHE_TTL) {
      logger.debug('Returning cached transformed data', {
        competitionId,
        className,
        controlCode: options?.controlCode,
        cacheAge: now - cached.timestamp
      });
      return cached.ografData;
    }

    // Transform data
    logger.debug('Transforming class results', {
      competitionId,
      className,
      controlCode: options?.controlCode,
      reason: !cached ? 'no cache' :
              cached.hash !== rawData.hash ? 'hash changed' :
              'cache stale'
    });

    const ografData = LiveResultsTransformer.transformClassResults(
      rawData.data,
      options
    );

    // Log transformed data to verify transformation
    logger.info('=== DataStore: Transformation complete ===', {
      competitionId,
      className,
      controlCode: options?.controlCode,
      resultsCount: ografData.results?.length || 0
    });

    // Log first 3 transformed results
    if (ografData.results && ografData.results.length > 0) {
      for (let i = 0; i < Math.min(3, ografData.results.length); i++) {
        logger.info(`[DataStore] Transformed result ${i + 1}`, {
          position: ografData.results[i].position,
          name: ografData.results[i].name,
          time: ografData.results[i].time,
          timeType: typeof ografData.results[i].time,
          diff: ografData.results[i].diff,
          diffType: typeof ografData.results[i].diff,
          statusCode: ografData.results[i].statusCode
        });
      }
    }

    // Cache transformed data
    this.transformedResults.set(cacheKey, {
      ografData,
      hash: rawData.hash,
      timestamp: now
    });

    return ografData;
  }

  /**
   * Start polling for results
   */
  startPolling(
    competitionId: number,
    className: string,
    interval: number = 15000,
    client?: any // Optional LiveResultsClient instance (if not provided, uses singleton)
  ): string {
    // Use provided client or fall back to singleton (for backward compatibility)
    const liveResultsClient = client || getLiveResultsClient();
    const key = `${competitionId}_${className}`;

    logger.info('Starting polling for results', { competitionId, className, interval });

    const pollId = liveResultsClient.startPolling({
      competitionId,
      className,
      interval,
      onUpdate: async (data: LiveResultsClassResult) => {
        try {
          // Get competition name
          const competition = this.competitions.find(c => c.id === competitionId);
          const competitionName = competition?.name;

          // Transform to OGRAF format
          const ografData = LiveResultsTransformer.transformClassResults(data, {
            competitionName
          });

          // Update store
          this.results.set(key, ografData);

          // Update polling status
          const status = this.pollingStatus.get(key);
          if (status) {
            status.lastUpdate = Date.now();
            status.errorCount = 0;
          }

          // Emit events
          this.emit('results:updated', competitionId, className, ografData);

          // Use debounced broadcast to prevent excessive WebSocket updates
          this.debouncedBroadcast(key, 'results:updated', {
            competitionId,
            className,
            data: ografData
          });

          logger.debug('Polling update received', {
            competitionId,
            className,
            runners: ografData.results.length
          });
        } catch (error) {
          logger.error('Error processing polling update', {
            competitionId,
            className,
            error: (error as Error).message
          });

          // Update error count
          const status = this.pollingStatus.get(key);
          if (status) {
            status.errorCount = (status.errorCount || 0) + 1;
          }
        }
      },
      onError: (error: Error) => {
        logger.error('Polling error', { competitionId, className, error: error.message });
        
        // Update error count
        const status = this.pollingStatus.get(key);
        if (status) {
          status.errorCount = (status.errorCount || 0) + 1;
        }

        this.emit('error', error);
      }
    });

    // Track polling status
    this.pollingStatus.set(key, {
      active: true,
      competitionId,
      className,
      interval,
      lastUpdate: Date.now(),
      errorCount: 0
    });

    return pollId;
  }

  /**
   * Stop polling for results
   */
  stopPolling(competitionId: number, className: string, client?: any): void {
    // Use provided client or fall back to singleton (for backward compatibility)
    const liveResultsClient = client || getLiveResultsClient();
    const key = `${competitionId}_${className}`;

    liveResultsClient.stopPolling(key);

    const status = this.pollingStatus.get(key);
    if (status) {
      status.active = false;
    }

    logger.info('Stopped polling for results', { competitionId, className });
  }

  /**
   * Stop all polling
   */
  stopAllPolling(): void {
    const client = getLiveResultsClient();
    client.stopAllPolling();

    this.pollingStatus.forEach(status => {
      status.active = false;
    });

    logger.info('Stopped all polling');
  }

  /**
   * Get cached competitions
   */
  getCompetitions(): LiveResultsCompetition[] {
    return this.competitions;
  }

  /**
   * Get cached classes for a competition
   */
  getClasses(competitionId: number): LiveResultsClass[] | undefined {
    return this.classes.get(competitionId);
  }

  /**
   * Get cached results for a class
   */
  getResults(competitionId: number, className: string): OGrafResultsData | undefined {
    const key = `${competitionId}_${className}`;
    return this.results.get(key);
  }

  /**
   * Get polling status
   */
  getPollingStatus(competitionId?: number, className?: string): PollingStatus[] {
    if (competitionId !== undefined && className) {
      const key = `${competitionId}_${className}`;
      const status = this.pollingStatus.get(key);
      return status ? [status] : [];
    }

    return Array.from(this.pollingStatus.values());
  }

  /**
   * Get store statistics
   */
  getStats() {
    return {
      competitions: this.competitions.length,
      classes: this.classes.size,
      results: this.results.size,
      activePolls: Array.from(this.pollingStatus.values()).filter(s => s.active).length,
      totalPolls: this.pollingStatus.size,
      transformedCache: this.transformedResults.size
    };
  }

  /**
   * Clear transformed data cache
   */
  clearTransformedCache(competitionId?: number, className?: string): void {
    if (competitionId && className) {
      const key = `${competitionId}_${className}`;
      this.transformedResults.delete(key);
      logger.info('Cleared transformed cache', { competitionId, className });
    } else if (competitionId) {
      // Clear all for competition
      const keys = Array.from(this.transformedResults.keys())
        .filter(k => k.startsWith(`${competitionId}_`));
      keys.forEach(k => this.transformedResults.delete(k));
      logger.info('Cleared transformed cache for competition', { competitionId, count: keys.length });
    } else {
      // Clear all
      this.transformedResults.clear();
      logger.info('Cleared all transformed cache');
    }
  }

  /**
   * Get transformed cache statistics
   */
  getTransformedCacheStats(): {
    size: number;
    entries: Array<{ key: string; age: number; hash: string }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.transformedResults.entries()).map(([key, value]) => ({
      key,
      age: now - value.timestamp,
      hash: value.hash
    }));

    return {
      size: this.transformedResults.size,
      entries
    };
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.competitions = [];
    this.classes.clear();
    this.results.clear();
    this.transformedResults.clear();
    logger.info('Data store cleared');
  }

  /**
   * Cleanup resources
   * Prevents memory leaks by clearing all timers, caches, and listeners
   */
  destroy(): void {
    // Stop all polling
    this.stopAllPolling();

    // Clear all debounce timers
    this.updateDebounceTimers.forEach(timer => clearTimeout(timer));
    this.updateDebounceTimers.clear();

    // Clear polling status
    this.pollingStatus.clear();

    // Clear cached data
    this.clear();

    // Remove all event listeners
    this.removeAllListeners();

    // Clear WebSocket server reference
    this.wsServer = null;

    logger.info('Data store destroyed');
  }
}

// Singleton instance
let storeInstance: DataStore | null = null;

/**
 * Initialize data store
 */
export function initDataStore(): DataStore {
  if (storeInstance) {
    storeInstance.destroy();
  }
  storeInstance = new DataStore();
  return storeInstance;
}

/**
 * Get data store instance
 */
export function getDataStore(): DataStore {
  if (!storeInstance) {
    throw new Error('Data store not initialized. Call initDataStore first.');
  }
  return storeInstance;
}


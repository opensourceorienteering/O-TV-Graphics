/**
 * LiveResults API Client
 * Handles HTTP requests to LiveResults API with hash-based caching and automatic polling
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import { getLogger } from '../utils/logger';
import {
  LiveResultsCompetition,
  LiveResultsClass,
  LiveResultsClassResult,
  LiveResultsPassing,
  LiveResultsCache
} from '../../shared/types/liveresults';

const logger = getLogger();

export interface LiveResultsClientOptions {
  baseUrl: string;
  cacheInterval?: number; // milliseconds (minimum 15000)
  timeout?: number; // milliseconds
  retryAttempts?: number;
  retryDelay?: number; // milliseconds
}

export interface CachedResponse<T> {
  data: T;
  hash: string;
  timestamp: number;
  changed: boolean;
}

export interface PollingConfig {
  competitionId: number;
  className?: string;
  interval: number;
  onUpdate: (data: any) => void;
  onError?: (error: Error) => void;
}

/**
 * LiveResults API Client
 * Provides methods for fetching data from LiveResults API with caching and polling
 */
export class LiveResultsClient {
  private client: AxiosInstance;
  private cache: LiveResultsCache;
  private pollingTimers: Map<string, NodeJS.Timeout>;
  private options: Required<LiveResultsClientOptions>;

  constructor(options: LiveResultsClientOptions) {
    this.options = {
      baseUrl: options.baseUrl,
      cacheInterval: Math.max(options.cacheInterval || 15000, 15000), // Minimum 15s
      timeout: options.timeout || 10000,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000
    };

    this.client = axios.create({
      baseURL: this.options.baseUrl,
      timeout: this.options.timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TV-Grafik/1.0.0'
      }
    });

    this.cache = {
      competitions: undefined,
      classes: {},
      classResults: {},
      lastPassings: {}
    };

    this.pollingTimers = new Map();

    logger.info('LiveResults API client initialized', {
      baseUrl: this.options.baseUrl,
      cacheInterval: this.options.cacheInterval
    });
  }

  /**
   * Calculate hash of data for change detection
   */
  private calculateHash(data: any): string {
    const json = JSON.stringify(data);
    return crypto.createHash('md5').update(json).digest('hex');
  }

  /**
   * Sanitize JSON string by removing/escaping invalid control characters
   * This handles control characters that are not properly escaped in JSON strings
   *
   * NOTE: Tab, newline, and carriage return are only valid as whitespace OUTSIDE of strings.
   * Inside JSON string values, they must be escaped (\t, \n, \r) or removed.
   */
  private sanitizeJsonString(jsonString: string): string {
    let sanitized = jsonString;
    let removedCount = 0;
    const removedChars: { char: string; code: number; position: number }[] = [];

    // Log the character at error position for debugging
    if (jsonString.length > 60808) {
      const charAtError = jsonString.charAt(60808);
      const charCode = jsonString.charCodeAt(60808);
      logger.debug('Character at error position 60808', {
        char: charAtError,
        charCode: charCode,
        charHex: '0x' + charCode.toString(16),
        isControlChar: charCode < 32,
        context: jsonString.substring(60800, 60820),
        contextCharCodes: Array.from(jsonString.substring(60800, 60820)).map(c => c.charCodeAt(0))
      });
    }

    // Remove ALL control characters (0-31) including tab, newline, carriage return
    // These are only valid as whitespace OUTSIDE of JSON strings
    // Inside string values, they must be escaped or removed
    sanitized = sanitized.replace(/[\x00-\x1F]/g, (match, offset) => {
      const charCode = match.charCodeAt(0);

      removedCount++;
      if (removedChars.length < 10) { // Only log first 10 for performance
        removedChars.push({ char: match, code: charCode, position: offset });
      }

      // Remove the character (could also escape it, but removal is simpler)
      return '';
    });

    if (removedCount > 0) {
      logger.info('Sanitized JSON string', {
        removedControlChars: removedCount,
        originalLength: jsonString.length,
        sanitizedLength: sanitized.length,
        firstFewRemoved: removedChars
      });
    } else {
      logger.warn('No control characters found to remove during sanitization', {
        stringLength: jsonString.length,
        sampleCharCodes: Array.from(jsonString.substring(60800, 60820)).map(c => c.charCodeAt(0))
      });
    }

    return sanitized;
  }

  /**
   * Make HTTP request with retry logic
   */
  private async request<T>(
    endpoint: string,
    params?: Record<string, any>
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        logger.debug('LiveResults API request', { endpoint, params, attempt });

        const response = await this.client.get<T>(endpoint, { params });

        logger.debug('LiveResults API response', {
          endpoint,
          status: response.status,
          dataType: typeof response.data,
          dataSize: typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data).length
        });

        // Handle case where Axios returns a string instead of parsed JSON
        let data = response.data;
        if (typeof data === 'string') {
          const stringData = data as string;

          try {
            // First attempt: Try parsing without sanitization
            data = JSON.parse(stringData) as T;
            logger.debug('Successfully parsed JSON string response', {
              stringLength: stringData.length
            });
          } catch (parseError) {
            // Second attempt: Sanitize and try again
            // This is expected behavior for LiveResults API, not an error
            logger.debug('LiveResults API response contains invalid control characters, sanitizing...', {
              error: (parseError as Error).message,
              stringLength: stringData.length
            });

            try {
              const sanitized = this.sanitizeJsonString(stringData);
              data = JSON.parse(sanitized) as T;
              logger.info('Successfully parsed JSON response after sanitization');
            } catch (sanitizeError) {
              logger.error('Failed to parse JSON response even after sanitization', {
                error: (sanitizeError as Error).message,
                dataPreview: stringData.substring(0, 200)
              });
              throw new Error(`Invalid JSON response: ${(sanitizeError as Error).message}`);
            }
          }
        }

        return data;
      } catch (error) {
        lastError = error as Error;

        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          logger.warn('LiveResults API request failed', {
            endpoint,
            attempt,
            status: axiosError.response?.status,
            message: axiosError.message
          });

          // Don't retry on 4xx errors (client errors)
          if (axiosError.response?.status && axiosError.response.status < 500) {
            break;
          }
        } else {
          logger.warn('LiveResults API request failed', {
            endpoint,
            attempt,
            error: (error as Error).message
          });
        }

        // Wait before retry (except on last attempt)
        if (attempt < this.options.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
        }
      }
    }

    logger.error('LiveResults API request failed after retries', {
      endpoint,
      attempts: this.options.retryAttempts,
      error: lastError?.message
    });

    throw lastError || new Error('Request failed');
  }

  /**
   * Fetch list of competitions
   */
  async getCompetitions(): Promise<CachedResponse<LiveResultsCompetition[]>> {
    logger.debug('LiveResultsClient: Fetching competitions...');

    const response = await this.request<{ competitions: LiveResultsCompetition[] }>('/api.php', {
      method: 'getcompetitions'
    });

    logger.debug('LiveResultsClient: Raw API response', {
      hasCompetitions: !!response.competitions,
      competitionsType: typeof response.competitions,
      isArray: Array.isArray(response.competitions),
      responseKeys: Object.keys(response)
    });

    // Extract competitions array from response object
    const data = response.competitions || [];

    logger.debug('LiveResultsClient: Extracted data', {
      dataLength: data.length,
      isArray: Array.isArray(data),
      sample: data.length > 0 ? data[0] : null
    });

    const hash = this.calculateHash(data);
    const changed = !this.cache.competitions || this.cache.competitions.hash !== hash;

    this.cache.competitions = {
      data,
      hash,
      timestamp: Date.now()
    };

    logger.info('Fetched competitions', { count: data.length, changed });

    return { data, hash, timestamp: Date.now(), changed };
  }

  /**
   * Fetch classes for a competition
   */
  async getClasses(competitionId: number): Promise<CachedResponse<LiveResultsClass[]>> {
    const response = await this.request<{ status: string; classes: LiveResultsClass[]; hash?: string }>('/api.php', {
      method: 'getclasses',
      comp: competitionId
    });

    // Extract classes array from response object
    const data = response.classes || [];

    const hash = this.calculateHash(data);
    const cached = this.cache.classes?.[competitionId];
    const changed = !cached || cached.hash !== hash;

    if (!this.cache.classes) {
      this.cache.classes = {};
    }

    this.cache.classes[competitionId] = {
      data,
      hash,
      timestamp: Date.now()
    };

    logger.info('Fetched classes', { competitionId, count: data.length, changed });

    return { data, hash, timestamp: Date.now(), changed };
  }

  /**
   * Fetch results for a specific class
   */
  async getClassResults(
    competitionId: number,
    className: string
  ): Promise<CachedResponse<LiveResultsClassResult>> {
    const data = await this.request<LiveResultsClassResult>('/api.php', {
      method: 'getclassresults',
      comp: competitionId,
      class: className,
      unformattedTimes: 'true'
    });

    // Log detailed information about the API response
    logger.debug('API response received', {
      competitionId,
      className,
      runners: data.results?.length || 0,
      splitcontrols: data.splitcontrols?.length || 0
    });

    // Log first runner's splits structure
    if (data.results && data.results.length > 0) {
      const firstRunner = data.results[0];
      logger.info('First runner splits structure', {
        runnerName: firstRunner.name,
        hasSplits: !!firstRunner.splits,
        splitsType: typeof firstRunner.splits,
        splitsKeys: firstRunner.splits ? Object.keys(firstRunner.splits).slice(0, 30) : 'NO SPLITS',
        firstFewSplits: firstRunner.splits ? JSON.stringify(firstRunner.splits).substring(0, 500) : 'NO SPLITS'
      });

      // Log a few runners to see the pattern
      for (let i = 0; i < Math.min(3, data.results.length); i++) {
        const runner = data.results[i];
        logger.info(`Runner ${i + 1} splits sample`, {
          name: runner.name,
          hasSplits: !!runner.splits,
          splitsKeys: runner.splits ? Object.keys(runner.splits).slice(0, 10) : 'NO SPLITS'
        });
      }
    }

    // IMPORTANT: Always calculate our own hash instead of trusting API's hash
    // The API's hash might not be sensitive enough to detect split time changes
    // for specific control points during live events
    const hash = this.calculateHash(data);

    const key = `${competitionId}_${className}`;
    const cached = this.cache.classResults?.[key];
    const changed = !cached || cached.hash !== hash;

    if (!this.cache.classResults) {
      this.cache.classResults = {};
    }

    this.cache.classResults[key] = {
      data,
      hash,
      timestamp: Date.now()
    };

    logger.info('Fetched class results', {
      competitionId,
      className,
      runners: data.results?.length || 0,
      changed
    });

    return { data, hash, timestamp: Date.now(), changed };
  }

  /**
   * Fetch last passings for a competition
   */
  async getLastPassings(
    competitionId: number,
    count: number = 20
  ): Promise<CachedResponse<LiveResultsPassing[]>> {
    const response = await this.request<{ status: string; passings: LiveResultsPassing[]; hash?: string }>('/api.php', {
      method: 'getlastpassings',
      comp: competitionId,
      count
    });

    // Extract passings array from response object
    const data = response.passings || [];

    const hash = this.calculateHash(data);
    const cached = this.cache.lastPassings?.[competitionId];
    const changed = !cached || cached.hash !== hash;

    if (!this.cache.lastPassings) {
      this.cache.lastPassings = {};
    }

    this.cache.lastPassings[competitionId] = {
      data,
      hash,
      timestamp: Date.now()
    };

    logger.info('Fetched last passings', { competitionId, count: data.length, changed });

    return { data, hash, timestamp: Date.now(), changed };
  }

  /**
   * Start polling for class results
   */
  startPolling(config: PollingConfig): string {
    const pollId = config.className
      ? `${config.competitionId}_${config.className}`
      : `${config.competitionId}_passings`;

    // Stop existing polling for this ID
    this.stopPolling(pollId);

    const interval = Math.max(config.interval, this.options.cacheInterval);

    logger.info('Starting polling', { pollId, interval });

    const poll = async () => {
      try {
        let result: CachedResponse<any>;

        if (config.className) {
          result = await this.getClassResults(config.competitionId, config.className);
        } else {
          result = await this.getLastPassings(config.competitionId);
        }

        if (result.changed) {
          logger.debug('Polling detected change', { pollId });
          config.onUpdate(result.data);
        }
      } catch (error) {
        logger.error('Polling error', { pollId, error: (error as Error).message });
        if (config.onError) {
          config.onError(error as Error);
        }
      }
    };

    // Initial poll
    poll();

    // Set up interval
    const timer = setInterval(poll, interval);
    this.pollingTimers.set(pollId, timer);

    return pollId;
  }

  /**
   * Stop polling
   */
  stopPolling(pollId: string): void {
    const timer = this.pollingTimers.get(pollId);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(pollId);
      logger.info('Stopped polling', { pollId });
    }
  }

  /**
   * Stop all polling
   */
  stopAllPolling(): void {
    logger.info('Stopping all polling', { count: this.pollingTimers.size });
    this.pollingTimers.forEach((timer) => {
      clearInterval(timer);
    });
    this.pollingTimers.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      competitions: this.cache.competitions ? {
        count: this.cache.competitions.data.length,
        timestamp: this.cache.competitions.timestamp,
        age: Date.now() - this.cache.competitions.timestamp
      } : null,
      classes: Object.keys(this.cache.classes || {}).length,
      classResults: Object.keys(this.cache.classResults || {}).length,
      lastPassings: Object.keys(this.cache.lastPassings || {}).length,
      activePolls: this.pollingTimers.size
    };
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache = {
      competitions: undefined,
      classes: {},
      classResults: {},
      lastPassings: {}
    };
    logger.info('Cache cleared');
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopAllPolling();
    this.clearCache();
    logger.info('LiveResults client destroyed');
  }
}

// Singleton instance
let clientInstance: LiveResultsClient | null = null;

/**
 * Initialize LiveResults client
 */
export function initLiveResultsClient(options: LiveResultsClientOptions): LiveResultsClient {
  if (clientInstance) {
    clientInstance.destroy();
  }
  clientInstance = new LiveResultsClient(options);
  return clientInstance;
}

/**
 * Get LiveResults client instance
 */
export function getLiveResultsClient(): LiveResultsClient {
  if (!clientInstance) {
    throw new Error('LiveResults client not initialized. Call initLiveResultsClient first.');
  }
  return clientInstance;
}


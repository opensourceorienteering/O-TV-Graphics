/**
 * LiveResults API Client
 * Handles HTTP requests to LiveResults API with hash-based caching and automatic polling
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import crypto from 'crypto';
import { getLogger } from '../utils/logger';
import { LiveResultsPushChannel, DEFAULT_PUSH_URL, WebSocketFactory } from './LiveResultsPush';
import {
  LiveResultsCompetition,
  LiveResultsCompetitionInfo,
  LiveResultsClass,
  LiveResultsClassResult,
  LiveResultsPassing,
  LiveResultsCache
} from '../../shared/types/liveresults';

const logger = getLogger();

/** REST API /classresults response (subset we use) */
interface RestClassResult {
  className: string;
  splitControls?: { code: number; name: string }[];
  results?: (Omit<LiveResultsClassResult['results'][number], 'result' | 'timeplus'> & {
    result?: number | string | null;
    timeplus?: number | string | null;
  })[];
  [extra: string]: unknown;
}

/** REST API /passings row */
interface RestPassing {
  class: string;
  control: number;
  controlName: string | null;
  place: number;
  bib: string;
  name: string;
  club: string;
  time: number;      // running time, hundredths
  timeplus: number;  // hundredths behind at this control
  wallClock: number; // hundredths since local midnight
  changed: number;   // UNIX seconds
}

/**
 * Which LiveResults API to talk to.
 * - 'legacy': liveresultat.orientering.se/api.php?method=... (hash based, 15 s server cache)
 * - 'rest':   api.orienteering.services REST API (ETag/If-None-Match, ~5 s CDN cache, poll >= 10 s)
 *             Docs: https://liveresultat.orientering.se/beta/docs
 * - 'auto':   'rest' when the base URL host is api.orienteering.services, otherwise 'legacy'
 */
export type LiveResultsApiFlavor = 'legacy' | 'rest' | 'auto';

/**
 * A non-HTTP source of LiveResults-shaped data (e.g. a MeOS MOP database).
 * When a backend is given, the client keeps its caching, change detection and polling,
 * and only the fetching is delegated.
 */
export interface LiveResultsBackend {
  readonly name: string;
  /** Minimum poll interval for this backend (ms) */
  readonly minPollIntervalMs: number;
  fetchCompetitions(): Promise<LiveResultsCompetition[]>;
  fetchCompetitionInfo(competitionId: number): Promise<LiveResultsCompetitionInfo>;
  fetchClasses(competitionId: number): Promise<LiveResultsClass[]>;
  fetchClassResults(competitionId: number, className: string): Promise<LiveResultsClassResult>;
  fetchLastPassings?(competitionId: number, count: number): Promise<LiveResultsPassing[]>;
}

export interface LiveResultsClientOptions {
  baseUrl: string;
  cacheInterval?: number; // milliseconds (minimum 15000 legacy, 10000 REST)
  timeout?: number; // milliseconds
  retryAttempts?: number;
  retryDelay?: number; // milliseconds
  api?: LiveResultsApiFlavor;
  /**
   * Lower poll floor in ms. Only honoured for local simulators (localhost / 127.0.0.1);
   * the public APIs always keep their documented minimum (10 s REST, 15 s legacy).
   */
  localPollFloorMs?: number;
  /** Fetch from this backend instead of HTTP (baseUrl is then only a label) */
  backend?: LiveResultsBackend;
  /**
   * REST only: listen on the Liveresultat push channel and refetch a class as soon as it
   * changes (default true). Polling keeps running as the fallback.
   */
  push?: boolean;
  /** Push channel URL (default wss://ws.orienteering.services) */
  pushUrl?: string;
  /** For tests: how push sockets are created */
  webSocketFactory?: WebSocketFactory;
}

/** Minimum poll interval per API, as documented by each API */
const MIN_INTERVAL_MS = { legacy: 15000, rest: 10000 } as const;

/**
 * Resolve 'auto' to a concrete API flavor from the base URL
 */
export function resolveApiFlavor(baseUrl: string, api: LiveResultsApiFlavor = 'auto'): 'legacy' | 'rest' {
  if (api !== 'auto') return api;
  try {
    return new URL(baseUrl).hostname === 'api.orienteering.services' ? 'rest' : 'legacy';
  } catch {
    return 'legacy';
  }
}

function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Format hundredths of a second as m:ss or h:mm:ss (legacy getlastpassings style) */
function formatRunningTime(hundredths: number): string {
  const total = Math.floor(hundredths / 100);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Format hundredths of a second since midnight as HH:MM:SS (wall clock) */
function formatWallClock(hundredths: number): string {
  const total = Math.floor(hundredths / 100) % 86400;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
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
  /** Every successful poll, including unchanged/304 responses. */
  onPoll?: (changed: boolean, interval: number) => void;
}

/**
 * LiveResults API Client
 * Provides methods for fetching data from LiveResults API with caching and polling
 */
export class LiveResultsClient {
  private client: AxiosInstance;
  private cache: LiveResultsCache;
  private pollingTimers: Map<string, NodeJS.Timeout>;
  private options: Required<Omit<LiveResultsClientOptions, 'api' | 'localPollFloorMs' | 'backend' | 'push' | 'pushUrl' | 'webSocketFactory'>>;
  /** Push wanted by the options (the API must also turn out to be REST) */
  private readonly pushWanted: boolean;
  private readonly pushUrl: string;
  private readonly webSocketFactory?: WebSocketFactory;
  /** One push socket per competition with the classes being polled */
  private pushChannels: Map<number, { channel: LiveResultsPushChannel; classes: Map<string, number> }> = new Map();
  /** Immediate refetch hooks of running polls, by pollId */
  private pollTriggers: Map<string, (pushVer?: number) => void> = new Map();
  private api: 'legacy' | 'rest';
  /**
   * 'auto' for an address that is neither Liveresultat API: the first request asks the server
   * which API it speaks (a replay or self-hosted server can be REST)
   */
  private apiUnknown = false;
  private apiProbe?: Promise<void>;
  private readonly requestedInterval?: number;
  private readonly localPollFloorMs?: number;
  private readonly backend?: LiveResultsBackend;
  /** REST only: last ETag and body per request path, for If-None-Match / 304 */
  private etagCache: Map<string, { etag: string; body: unknown }> = new Map();
  /** Per-competition info (date, timezone, timediff), refreshed at most every minute */
  private competitionInfoCache: Map<number, { data: LiveResultsCompetitionInfo; fetchedAt: number }> = new Map();
  /** Measured server clock offset (server - local), REST only */
  private clockOffset: { offsetMs: number; measuredAt: number } | null = null;

  constructor(options: LiveResultsClientOptions) {
    this.api = resolveApiFlavor(options.baseUrl, options.api);
    this.backend = options.backend;
    // Liveresultat's push channel only signals changes on its own API: another REST server (a
    // replay or self-hosted copy) gets push only with its own pushUrl
    const official = (() => {
      try { return new URL(options.baseUrl).hostname === 'api.orienteering.services'; } catch { return false; }
    })();
    this.pushWanted = options.push !== false && (official || !!options.pushUrl);
    const host = (() => { try { return new URL(options.baseUrl).hostname; } catch { return ''; } })();
    this.apiUnknown = !options.backend && (options.api ?? 'auto') === 'auto' && !!host &&
      host !== 'api.orienteering.services' && host !== 'liveresultat.orientering.se';
    this.requestedInterval = options.cacheInterval;
    this.localPollFloorMs = isLocalUrl(options.baseUrl) ? options.localPollFloorMs : undefined;
    this.pushUrl = options.pushUrl || DEFAULT_PUSH_URL;
    this.webSocketFactory = options.webSocketFactory;
    this.options = {
      baseUrl: options.baseUrl.replace(/\/+$/, ''),
      cacheInterval: this.pollInterval(),
      timeout: options.timeout || 10000,
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000
    };

    this.client = axios.create({
      baseURL: this.options.baseUrl,
      timeout: this.options.timeout,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SplitControl/1.1.0'
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
      api: this.api,
      cacheInterval: this.options.cacheInterval
    });
  }

  /** Which API this client talks to */
  getApiFlavor(): 'legacy' | 'rest' | 'backend' {
    return this.backend ? 'backend' : this.api;
  }

  private get pushEnabled(): boolean {
    return !this.backend && this.api === 'rest' && this.pushWanted;
  }

  /** Poll interval for the current API (REST allows 10 s, the legacy api.php 15 s) */
  private pollInterval(): number {
    let floor: number = this.backend ? this.backend.minPollIntervalMs : MIN_INTERVAL_MS[this.api];
    if (this.localPollFloorMs !== undefined) floor = Math.max(100, this.localPollFloorMs);
    return Math.max(this.requestedInterval || floor, floor);
  }

  /**
   * 'auto' on another address: ask once whether the server speaks the REST API
   * (GET /competitions answers { competitions: [...] }); otherwise it is the legacy api.php.
   * An unreachable server is asked again on the next request.
   */
  private async ensureApi(): Promise<void> {
    if (!this.apiUnknown) return;
    this.apiProbe ??= (async () => {
      try {
        const res = await this.client.get('/competitions', { validateStatus: () => true, timeout: Math.min(this.options.timeout, 5000) });
        this.api = res.status === 200 && Array.isArray((res.data as any)?.competitions) ? 'rest' : 'legacy';
        this.apiUnknown = false;
        this.options.cacheInterval = this.pollInterval();
        logger.info('LiveResults API detected', { baseUrl: this.options.baseUrl, api: this.api });
      } catch (error) {
        logger.warn('Could not reach the LiveResults server to detect its API', { error: (error as Error).message });
      } finally {
        this.apiProbe = undefined;
      }
    })();
    await this.apiProbe;
  }

  /**
   * REST API GET with ETag handling.
   * Sends If-None-Match when we have an ETag for the path; on 304 returns the cached body.
   * Retries 5xx and network errors like request().
   */
  private async restGet<T>(
    path: string,
    params?: Record<string, string | number>,
    uncachedParams?: Record<string, string | number>
  ): Promise<T> {
    const query = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : '';
    const key = path + query;
    // Params that must reach the server but not split the ETag cache (e.g. push=<ver>)
    const extra = uncachedParams
      ? (query ? '&' : '?') + new URLSearchParams(Object.entries(uncachedParams).map(([k, v]) => [k, String(v)])).toString()
      : '';
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.options.retryAttempts; attempt++) {
      try {
        const cached = this.etagCache.get(key);
        const response = await this.client.get(key + extra, {
          headers: cached ? { 'If-None-Match': cached.etag } : undefined,
          validateStatus: status => (status >= 200 && status < 300) || status === 304
        });

        if (response.status === 304 && cached) {
          logger.debug('LiveResults REST not modified', { path: key });
          return cached.body as T;
        }

        const etag = response.headers['etag'];
        if (typeof etag === 'string' && etag.length > 0) {
          this.etagCache.set(key, { etag, body: response.data });
        }
        return response.data as T;
      } catch (error) {
        lastError = error as Error;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        logger.warn('LiveResults REST request failed', { path: key, attempt, status, message: lastError.message });
        if (status && status < 500) break; // 4xx: don't retry
        if (attempt < this.options.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
        }
      }
    }
    throw lastError || new Error('Request failed');
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
    // eslint-disable-next-line no-control-regex -- stripping raw control characters is the point
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
    await this.ensureApi();
    logger.debug('LiveResultsClient: Fetching competitions...');

    const response = this.backend
      ? { competitions: await this.backend.fetchCompetitions() }
      : this.api === 'rest'
      ? await this.restGet<{ competitions: LiveResultsCompetition[] }>('/competitions')
      : await this.request<{ competitions: LiveResultsCompetition[] }>('/api.php', {
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
   * Fetch info for one competition: name, date, timediff and (REST) IANA timezone.
   * Much lighter than getCompetitions(), which returns every competition.
   */
  async getCompetitionInfo(competitionId: number, maxAgeMs = 60_000): Promise<LiveResultsCompetitionInfo> {
    await this.ensureApi();
    const cached = this.competitionInfoCache.get(competitionId);
    if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return cached.data;

    const raw: Record<string, any> = this.backend
      ? await this.backend.fetchCompetitionInfo(competitionId)
      : this.api === 'rest'
      ? await this.restGet<Record<string, any>>(`/competitions/${competitionId}`)
      : await this.request<Record<string, any>>('/api.php', { method: 'getcompetitioninfo', comp: competitionId });

    const data: LiveResultsCompetitionInfo = {
      id: Number(raw.id ?? competitionId),
      name: raw.name ?? '',
      organizer: raw.organizer ?? '',
      date: raw.date ?? '',
      timediff: Number(raw.timediff ?? 0) || 0,
      timezone: typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : undefined,
      multiDayStage: raw.multiDayStage ?? raw.multidaystage,
      multiDayFirstDay: raw.multiDayFirstDay ?? raw.multidayfirstday
    };
    this.competitionInfoCache.set(competitionId, { data, fetchedAt: Date.now() });
    return data;
  }

  /**
   * Offset in ms to add to Date.now() to get Liveresultat server time.
   * REST: measured against GET /time (not cached by the CDN), re-measured every 5 minutes.
   * Legacy: no time endpoint, so 0 (local clock is trusted).
   */
  async getServerClockOffsetMs(maxAgeMs = 5 * 60_000): Promise<number> {
    await this.ensureApi();
    if (this.backend || this.api !== 'rest') return 0;
    if (this.clockOffset && Date.now() - this.clockOffset.measuredAt < maxAgeMs) {
      return this.clockOffset.offsetMs;
    }
    try {
      const t0 = Date.now();
      const response = await this.client.get<{ serverTime: number }>('/time', {
        headers: { 'Cache-Control': 'no-cache' }
      });
      const t1 = Date.now();
      const serverTime = Number(response.data?.serverTime);
      if (Number.isFinite(serverTime)) {
        const offsetMs = Math.round(serverTime - (t0 + t1) / 2);
        this.clockOffset = { offsetMs, measuredAt: t1 };
        if (Math.abs(offsetMs) > 2000) {
          logger.warn('Local clock differs from Liveresultat server time', { offsetMs });
        }
        return offsetMs;
      }
    } catch (error) {
      logger.warn('Could not measure server clock offset', { error: (error as Error).message });
    }
    return this.clockOffset?.offsetMs ?? 0;
  }

  /**
   * Fetch classes for a competition
   */
  async getClasses(competitionId: number): Promise<CachedResponse<LiveResultsClass[]>> {
    await this.ensureApi();
    let data: LiveResultsClass[];
    if (this.backend) {
      data = await this.backend.fetchClasses(competitionId);
    } else if (this.api === 'rest') {
      // REST returns plain class names. An unknown competition answers 200 {"classes":[]},
      // so an empty list is not proof that the competition exists.
      const response = await this.restGet<{ classes: string[] }>(`/competitions/${competitionId}/classes`);
      data = (response.classes || []).map(className => ({ className }));
    } else {
      const response = await this.request<{ status: string; classes: LiveResultsClass[]; hash?: string }>('/api.php', {
        method: 'getclasses',
        comp: competitionId
      });
      // Extract classes array from response object
      data = response.classes || [];
    }

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
    className: string,
    opts: { pushVer?: number; maxAgeMs?: number } = {}
  ): Promise<CachedResponse<LiveResultsClassResult>> {
    await this.ensureApi();
    // Reuse a very recent fetch (e.g. the poll that just detected the change) instead of
    // downloading the same class again for every graphic that maps it.
    if (opts.maxAgeMs && !opts.pushVer) {
      const recent = this.cache.classResults?.[`${competitionId}_${className}`];
      if (recent && Date.now() - recent.timestamp <= opts.maxAgeMs) {
        return { data: recent.data, hash: recent.hash, timestamp: recent.timestamp, changed: false };
      }
    }
    const data = this.backend
      ? await this.backend.fetchClassResults(competitionId, className)
      : this.api === 'rest'
      ? this.mapRestClassResult(
          await this.restGet<RestClassResult>(
            `/competitions/${competitionId}/classresults`,
            { class: className },
            opts.pushVer ? { push: opts.pushVer } : undefined
          )
        )
      : await this.request<LiveResultsClassResult>('/api.php', {
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
      logger.debug('First runner splits structure', {
        runnerName: firstRunner.name,
        hasSplits: !!firstRunner.splits,
        splitsType: typeof firstRunner.splits,
        splitsKeys: firstRunner.splits ? Object.keys(firstRunner.splits).slice(0, 30) : 'NO SPLITS',
        firstFewSplits: firstRunner.splits ? JSON.stringify(firstRunner.splits).substring(0, 500) : 'NO SPLITS'
      });

      // Log a few runners to see the pattern
      for (let i = 0; i < Math.min(3, data.results.length); i++) {
        const runner = data.results[i];
        logger.debug(`Runner ${i + 1} splits sample`, {
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
    await this.ensureApi();
    let data: LiveResultsPassing[];
    if (this.backend) {
      data = this.backend.fetchLastPassings ? await this.backend.fetchLastPassings(competitionId, count) : [];
    } else if (this.api === 'rest') {
      // REST always returns the latest 50, newest first
      const response = await this.restGet<{ passings: RestPassing[] }>(`/competitions/${competitionId}/passings`);
      data = (response.passings || []).slice(0, count).map(p => ({
        passtime: formatWallClock(p.wallClock),
        runnerName: p.name,
        club: p.club,
        class: p.class,
        control: String(p.control),
        controlName: p.controlName ?? (p.control === 1000 ? 'Finish' : String(p.control)),
        time: formatRunningTime(p.time),
        place: p.place,
        bib: p.bib,
        timeplus: p.timeplus,
        changed: p.changed
      }));
    } else {
      const response = await this.request<{ status: string; passings: LiveResultsPassing[]; hash?: string }>('/api.php', {
        method: 'getlastpassings',
        comp: competitionId,
        count
      });
      // Extract passings array from response object
      data = response.passings || [];
    }

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
   * Map a REST class result onto the legacy getclassresults shape the transformer expects:
   * camelCase splitControls -> splitcontrols, numeric result/timeplus -> strings.
   * Extra REST fields (bib, changed, isMassStart, relayLeg...) are passed through.
   */
  private mapRestClassResult(rest: RestClassResult): LiveResultsClassResult {
    const { splitControls, results, ...rest_ } = rest;
    return {
      ...rest_,
      className: rest.className,
      splitcontrols: splitControls ?? [],
      hash: '',
      results: (results ?? []).map(r => ({
        ...r,
        result: r.result === undefined || r.result === null ? '' : String(r.result),
        timeplus: r.timeplus === undefined || r.timeplus === null ? '' : String(r.timeplus)
      }))
    } as LiveResultsClassResult;
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

    // Never overlap polls: during an outage a request (with retries) can outlast the interval,
    // and stacking more requests on a struggling API only makes things worse.
    let inFlight = false;
    let queuedPushVer: number | undefined;
    const poll = async (pushVer?: number) => {
      if (inFlight) {
        // A push hint during a running poll is replayed right after it
        if (pushVer) queuedPushVer = pushVer;
        else logger.debug('Previous poll still running, skipping this tick', { pollId });
        return;
      }
      inFlight = true;
      try {
        let result: CachedResponse<any>;

        if (config.className) {
          result = await this.getClassResults(config.competitionId, config.className, { pushVer });
        } else {
          result = await this.getLastPassings(config.competitionId);
        }

        config.onPoll?.(result.changed, interval);
        if (result.changed) {
          logger.debug('Polling detected change', { pollId });
          config.onUpdate(result.data);
        }
      } catch (error) {
        logger.error('Polling error', { pollId, error: (error as Error).message });
        if (config.onError) {
          config.onError(error as Error);
        }
      } finally {
        inFlight = false;
        if (queuedPushVer !== undefined && this.pollingTimers.has(pollId)) {
          const ver = queuedPushVer;
          queuedPushVer = undefined;
          void poll(ver);
        }
      }
    };

    // Set up interval (before the first poll, so a queued push replay sees the poll as running)
    const timer = setInterval(() => void poll(), interval);
    this.pollingTimers.set(pollId, timer);
    this.pollTriggers.set(pollId, (ver?: number) => void poll(ver));

    // Initial poll
    void poll();

    if (this.pushEnabled && config.className) {
      this.subscribePush(config.competitionId, config.className);
    }

    return pollId;
  }

  /** Is the push channel for this competition connected? (diagnostics) */
  isPushConnected(competitionId: number): boolean {
    return this.pushChannels.get(competitionId)?.channel.isConnected() ?? false;
  }

  private subscribePush(competitionId: number, className: string): void {
    let entry = this.pushChannels.get(competitionId);
    if (!entry) {
      const channel = new LiveResultsPushChannel(
        this.pushUrl,
        competitionId,
        (tabs, ver) => {
          for (const tab of tabs) {
            const trigger = this.pollTriggers.get(`${competitionId}_${tab}`);
            if (trigger) {
              logger.debug('Push: class changed, refetching now', { competitionId, className: tab, ver });
              trigger(ver);
            }
          }
        },
        this.webSocketFactory
      );
      entry = { channel, classes: new Map() };
      this.pushChannels.set(competitionId, entry);
    }
    entry.classes.set(className, (entry.classes.get(className) ?? 0) + 1);
    entry.channel.setTabs([...entry.classes.keys()]);
  }

  private unsubscribePush(pollId: string): void {
    const m = /^(\d+)_(.*)$/.exec(pollId);
    if (!m) return;
    const competitionId = Number(m[1]);
    const className = m[2];
    const entry = this.pushChannels.get(competitionId);
    if (!entry || !entry.classes.has(className)) return;
    const n = (entry.classes.get(className) ?? 1) - 1;
    if (n > 0) entry.classes.set(className, n);
    else entry.classes.delete(className);
    if (entry.classes.size === 0) {
      entry.channel.close();
      this.pushChannels.delete(competitionId);
    } else {
      entry.channel.setTabs([...entry.classes.keys()]);
    }
  }

  /**
   * Stop polling
   */
  stopPolling(pollId: string): void {
    const timer = this.pollingTimers.get(pollId);
    if (timer) {
      clearInterval(timer);
      this.pollingTimers.delete(pollId);
      this.pollTriggers.delete(pollId);
      this.unsubscribePush(pollId);
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
    this.pollTriggers.clear();
    for (const { channel } of this.pushChannels.values()) channel.close();
    this.pushChannels.clear();
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
    this.etagCache.clear();
    this.competitionInfoCache.clear();
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


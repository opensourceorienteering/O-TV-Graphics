/**
 * HTTP access to Liveresultat: the REST API (api.orienteering.services) and the legacy
 * api.php. Only the Liveresultat plugin uses it.
 *
 * - 'legacy': liveresultat.orientering.se/api.php (hash-based, poll >= 15 s)
 * - 'rest':   api.orienteering.services (ETag/If-None-Match, ~5 s CDN cache, poll >= 10 s)
 * - 'auto':   'rest' for api.orienteering.services, 'legacy' for liveresultat.orientering.se,
 *             and on any other address one probe of GET /competitions decides
 */

import axios, { AxiosError, AxiosInstance } from 'axios';
import { getLogger } from '../../../utils/logger';
import { DEFAULT_PUSH_URL, LiveResultsPushChannel, WebSocketFactory } from './push';
import type { LrClassResult, LrCompetition, LrRestClassResult } from './wire';

const logger = getLogger();

export type LiveresultatApiFlavor = 'legacy' | 'rest' | 'auto';

export interface LiveresultatApiOptions {
  baseUrl: string;
  timeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
  api?: LiveresultatApiFlavor;
  /** Lower poll floor for a local simulator (localhost / 127.0.0.1 only) */
  localPollFloorMs?: number;
  /** REST only: refetch as soon as the push channel reports a change (default true) */
  push?: boolean;
  pushUrl?: string;
  webSocketFactory?: WebSocketFactory;
}

/** Minimum poll interval per API, as documented by each API */
const MIN_INTERVAL_MS = { legacy: 15000, rest: 10000 } as const;

/** Resolve 'auto' to a concrete API from the base URL */
export function resolveApiFlavor(baseUrl: string, api: LiveresultatApiFlavor = 'auto'): 'legacy' | 'rest' {
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

/** Remove raw control characters that some api.php answers contain inside strings */
function sanitizeJsonString(json: string): string {
  // eslint-disable-next-line no-control-regex -- stripping raw control characters is the point
  return json.replace(/[\x00-\x1F]/g, '');
}

export class LiveresultatApi {
  private readonly http: AxiosInstance;
  private api: 'legacy' | 'rest';
  private apiUnknown: boolean;
  private apiProbe?: Promise<void>;
  private readonly timeout: number;
  private readonly retryAttempts: number;
  private readonly retryDelay: number;
  private readonly localPollFloorMs?: number;
  private readonly pushWanted: boolean;
  private readonly pushUrl: string;
  private readonly webSocketFactory?: WebSocketFactory;
  private etagCache = new Map<string, { etag: string; body: unknown }>();
  private clockOffset: { offsetMs: number; measuredAt: number } | null = null;
  private pushChannels = new Map<number, LiveResultsPushChannel>();
  readonly baseUrl: string;

  constructor(options: LiveresultatApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.api = resolveApiFlavor(options.baseUrl, options.api);
    const host = (() => { try { return new URL(options.baseUrl).hostname; } catch { return ''; } })();
    this.apiUnknown = (options.api ?? 'auto') === 'auto' && !!host &&
      host !== 'api.orienteering.services' && host !== 'liveresultat.orientering.se';
    // The push channel only signals changes on Liveresultat's own API: another REST server
    // (a replay or a self-hosted copy) gets push only with its own pushUrl
    this.pushWanted = options.push !== false && (host === 'api.orienteering.services' || !!options.pushUrl);
    this.pushUrl = options.pushUrl || DEFAULT_PUSH_URL;
    this.webSocketFactory = options.webSocketFactory;
    this.timeout = options.timeout || 10000;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.localPollFloorMs = isLocalUrl(options.baseUrl) ? options.localPollFloorMs : undefined;
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: { Accept: 'application/json', 'User-Agent': 'SplitControl/1.1.0' }
    });
  }

  /** The API in use (known after the first request on an unknown address) */
  get flavor(): 'legacy' | 'rest' {
    return this.api;
  }

  /** Fastest allowed poll interval: 10 s REST, 15 s legacy (lower only for a local simulator) */
  minPollMs(): number {
    return this.localPollFloorMs !== undefined ? Math.max(100, this.localPollFloorMs) : MIN_INTERVAL_MS[this.api];
  }

  get pushEnabled(): boolean {
    return this.api === 'rest' && this.pushWanted;
  }

  // --- requests --------------------------------------------------------------------------

  /** 'auto' on another address: ask once whether the server speaks the REST API */
  private async ensureApi(): Promise<void> {
    if (!this.apiUnknown) return;
    this.apiProbe ??= (async () => {
      try {
        const res = await this.http.get('/competitions', { validateStatus: () => true, timeout: Math.min(this.timeout, 5000) });
        this.api = res.status === 200 && Array.isArray((res.data as any)?.competitions) ? 'rest' : 'legacy';
        this.apiUnknown = false;
        logger.info('LiveResults API detected', { baseUrl: this.baseUrl, api: this.api });
      } catch (error) {
        logger.warn('Could not reach the LiveResults server to detect its API', { error: (error as Error).message });
      } finally {
        this.apiProbe = undefined;
      }
    })();
    await this.apiProbe;
  }

  /** REST GET with ETag: on 304 the cached body. Retries 5xx and network errors. */
  private async restGet<T>(path: string, params?: Record<string, string | number>, uncachedParams?: Record<string, string | number>): Promise<T> {
    const query = params ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : '';
    const key = path + query;
    // Params that must reach the server but not split the ETag cache (push=<ver>)
    const extra = uncachedParams
      ? (query ? '&' : '?') + new URLSearchParams(Object.entries(uncachedParams).map(([k, v]) => [k, String(v)])).toString()
      : '';
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const cached = this.etagCache.get(key);
        const response = await this.http.get(key + extra, {
          headers: cached ? { 'If-None-Match': cached.etag } : undefined,
          validateStatus: status => (status >= 200 && status < 300) || status === 304
        });
        if (response.status === 304 && cached) return cached.body as T;
        const etag = response.headers['etag'];
        if (typeof etag === 'string' && etag.length > 0) this.etagCache.set(key, { etag, body: response.data });
        return response.data as T;
      } catch (error) {
        lastError = error as Error;
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        logger.warn('LiveResults REST request failed', { path: key, attempt, status, message: lastError.message });
        if (status && status < 500) break; // 4xx: don't retry
        if (attempt < this.retryAttempts) await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
    throw lastError || new Error('Request failed');
  }

  /** Legacy api.php GET with retries; tolerates raw control characters in the JSON */
  private async legacyGet<T>(params: Record<string, any>): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const response = await this.http.get<T>('/api.php', { params });
        let data: any = response.data;
        if (typeof data === 'string') {
          try {
            data = JSON.parse(data);
          } catch {
            try {
              data = JSON.parse(sanitizeJsonString(data));
            } catch (error) {
              throw new Error(`Invalid JSON response: ${(error as Error).message}`);
            }
          }
        }
        return data as T;
      } catch (error) {
        lastError = error as Error;
        const status = axios.isAxiosError(error) ? (error as AxiosError).response?.status : undefined;
        logger.warn('LiveResults API request failed', { method: params.method, attempt, status, message: lastError.message });
        if (status && status < 500) break;
        if (attempt < this.retryAttempts) await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
    throw lastError || new Error('Request failed');
  }

  // --- data ------------------------------------------------------------------------------

  async competitions(): Promise<LrCompetition[]> {
    await this.ensureApi();
    const response = this.api === 'rest'
      ? await this.restGet<{ competitions: LrCompetition[] }>('/competitions')
      : await this.legacyGet<{ competitions: LrCompetition[] }>({ method: 'getcompetitions' });
    return response.competitions || [];
  }

  async competitionInfo(competitionId: number): Promise<LrCompetition> {
    await this.ensureApi();
    const raw: Record<string, any> = this.api === 'rest'
      ? await this.restGet<Record<string, any>>(`/competitions/${competitionId}`)
      : await this.legacyGet<Record<string, any>>({ method: 'getcompetitioninfo', comp: competitionId });
    return {
      id: Number(raw.id ?? competitionId),
      name: raw.name ?? '',
      organizer: raw.organizer ?? '',
      date: raw.date ?? '',
      timediff: Number(raw.timediff ?? 0) || 0,
      timezone: typeof raw.timezone === 'string' && raw.timezone ? raw.timezone : undefined,
      multiDayStage: raw.multiDayStage ?? raw.multidaystage,
      multiDayFirstDay: raw.multiDayFirstDay ?? raw.multidayfirstday
    };
  }

  /** Class names. An unknown competition answers an empty list on REST. */
  async classes(competitionId: number): Promise<string[]> {
    await this.ensureApi();
    if (this.api === 'rest') {
      const response = await this.restGet<{ classes: string[] }>(`/competitions/${competitionId}/classes`);
      return response.classes || [];
    }
    const response = await this.legacyGet<{ classes: { className: string }[] }>({ method: 'getclasses', comp: competitionId });
    return (response.classes || []).map(c => c.className);
  }

  /** One class, in the legacy shape (REST is mapped onto it); pushVer bypasses the CDN cache */
  async classResult(competitionId: number, className: string, pushVer?: number): Promise<LrClassResult> {
    await this.ensureApi();
    if (this.api === 'rest') {
      const rest = await this.restGet<LrRestClassResult>(
        `/competitions/${competitionId}/classresults`,
        { class: className },
        pushVer ? { push: pushVer } : undefined
      );
      const { splitControls, results, ...others } = rest;
      return {
        ...others,
        className: rest.className,
        splitcontrols: splitControls ?? [],
        results: (results ?? []).map(r => ({
          ...r,
          result: r.result === undefined || r.result === null ? '' : String(r.result),
          timeplus: r.timeplus === undefined || r.timeplus === null ? '' : String(r.timeplus)
        }))
      } as LrClassResult;
    }
    return this.legacyGet<LrClassResult>({ method: 'getclassresults', comp: competitionId, class: className, unformattedTimes: 'true' });
  }

  /**
   * Liveresultat server time minus this computer's clock (ms). REST: measured against GET /time
   * (not cached by the CDN), again every 5 minutes. Legacy has no time endpoint: 0.
   */
  async clockOffsetMs(maxAgeMs = 5 * 60_000): Promise<number> {
    await this.ensureApi();
    if (this.api !== 'rest') return 0;
    if (this.clockOffset && Date.now() - this.clockOffset.measuredAt < maxAgeMs) return this.clockOffset.offsetMs;
    try {
      const t0 = Date.now();
      const response = await this.http.get<{ serverTime: number }>('/time', { headers: { 'Cache-Control': 'no-cache' } });
      const t1 = Date.now();
      const serverTime = Number(response.data?.serverTime);
      if (Number.isFinite(serverTime)) {
        const offsetMs = Math.round(serverTime - (t0 + t1) / 2);
        this.clockOffset = { offsetMs, measuredAt: t1 };
        if (Math.abs(offsetMs) > 2000) logger.warn('Local clock differs from Liveresultat server time', { offsetMs });
        return offsetMs;
      }
    } catch (error) {
      logger.warn('Could not measure server clock offset', { error: (error as Error).message });
    }
    return this.clockOffset?.offsetMs ?? 0;
  }

  // --- push ------------------------------------------------------------------------------

  /** Listen for changes to these classes (REST + push only); onChanged(tabs, ver) */
  subscribe(competitionId: number, tabs: string[], onChanged: (tabs: string[], ver: number) => void): void {
    if (!this.pushEnabled) return;
    let channel = this.pushChannels.get(competitionId);
    if (!tabs.length) {
      channel?.close();
      this.pushChannels.delete(competitionId);
      return;
    }
    if (!channel) {
      channel = new LiveResultsPushChannel(this.pushUrl, competitionId, onChanged, this.webSocketFactory);
      this.pushChannels.set(competitionId, channel);
    }
    channel.setTabs(tabs);
  }

  isPushConnected(competitionId: number): boolean {
    return this.pushChannels.get(competitionId)?.isConnected() ?? false;
  }

  close(): void {
    for (const channel of this.pushChannels.values()) channel.close();
    this.pushChannels.clear();
    this.etagCache.clear();
  }
}

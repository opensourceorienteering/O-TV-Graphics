/**
 * Liveresultat push channel (REST API only)
 *
 * The public follow pages at liveresultat.orientering.se subscribe to
 *   wss://ws.orienteering.services?tavid={competitionId}
 * send {"action":"sub","tabs":[...class names]} and receive {"type":"changed","tabs":[...],"ver":n}
 * when a class changes, then refetch it with `&push={ver}` to bypass the CDN cache.
 *
 * This channel is not in the published API docs, so Split Control treats it strictly as a hint:
 * a "changed" message triggers an immediate refetch, and normal ETag polling keeps running
 * underneath. If the socket fails or the protocol changes, nothing breaks; updates just
 * arrive at the polling interval again.
 */

import { getLogger } from '../utils/logger';

const logger = getLogger();

export const DEFAULT_PUSH_URL = 'wss://ws.orienteering.services';

/** Same back-off as the public site: 1, 2, 5, 10, 30 s (+ up to 1 s jitter) */
const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: ((ev: any) => void) | null;
  onerror: ((ev: any) => void) | null;
};
export type WebSocketFactory = (url: string) => WebSocketLike;

const defaultFactory: WebSocketFactory = (url) => {
  const WS = (globalThis as any).WebSocket;
  if (!WS) throw new Error('WebSocket is not available in this runtime');
  return new WS(url);
};

export class LiveResultsPushChannel {
  private socket: WebSocketLike | null = null;
  private tabs: string[] = [];
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private connected = false;

  constructor(
    private readonly baseUrl: string,
    readonly competitionId: number,
    private readonly onChanged: (tabs: string[], ver: number) => void,
    private readonly factory: WebSocketFactory = defaultFactory
  ) {
    this.connect();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Replace the subscribed class names */
  setTabs(tabs: string[]): void {
    this.tabs = [...new Set(tabs)];
    this.sendSubscription();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const s = this.socket;
    this.socket = null;
    this.connected = false;
    try { s?.close(); } catch { /* ignore */ }
  }

  private connect(): void {
    if (this.closed) return;
    let socket: WebSocketLike;
    try {
      socket = this.factory(`${this.baseUrl}?tavid=${this.competitionId}`);
    } catch (error) {
      logger.warn('Push channel unavailable, polling only', { error: (error as Error).message });
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.connected = true;
      logger.info('Liveresultat push channel connected', { competitionId: this.competitionId });
      this.sendSubscription();
    };
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg?.type === 'changed' && Array.isArray(msg.tabs)) {
          this.onChanged(msg.tabs.map(String), Number(msg.ver) || Date.now());
        }
      } catch {
        // Unknown message shape: ignore, polling still covers us
      }
    };
    socket.onerror = () => {
      try { socket.close(); } catch { /* ignore */ }
    };
    socket.onclose = () => {
      this.connected = false;
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] + Math.random() * 1000;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private sendSubscription(): void {
    const s = this.socket;
    if (!s || s.readyState !== 1) return;
    try {
      s.send(JSON.stringify({ action: 'sub', tabs: this.tabs }));
    } catch (error) {
      logger.debug('Push subscription send failed', { error: (error as Error).message });
    }
  }
}

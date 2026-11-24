/**
 * The remote access key. Other computers on the network need it to control Split Control or to
 * read its live data (Companion, OGraf controllers, OBS/vMix web output, the director page).
 * This computer never does: the app's own windows, previews and a local OBS just work.
 * The operator can turn the requirement off in Settings → Remote access.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export interface RemoteAccessSettings {
  /** Other computers need the key */
  requireKey: boolean;
  key: string;
}

const KEY = /^[A-Za-z0-9_-]{24,128}$/;

export function generateAccessKey(): string {
  return randomBytes(18).toString('base64url');
}

/** This computer: 127.0.0.0/8 and ::1, also as IPv4-mapped IPv6 */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return v4 === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4);
}

/** The key a request carries: Authorization: Bearer, X-Split-Key, or ?key= in the address */
export function keyFromHttp(req: { headers: Record<string, unknown>; query: Record<string, unknown> }): string {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const header = req.headers['x-split-key'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const query = req.query.key;
  return typeof query === 'string' ? query.trim() : '';
}

/** Exact comparison that takes the same time whatever the guess */
export function keyMatches(given: string, expected: string): boolean {
  if (!given || !expected) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(given), digest(expected)) && given.length === expected.length;
}

/** What "this computer" means right now: its own network addresses and the app's own page origins */
export interface LocalContext {
  own: string[];
  origins: string[];
}

export interface Caller {
  /** The connection's source address */
  address: string | undefined;
  /** The Host header: the name the request was addressed to */
  host: string | undefined;
  /** The Origin header: the page that made the request, if a browser did */
  origin?: string;
  key: string;
}

/** The origins of the app's own pages: file:// (the packaged app) and the web server's addresses */
export function appOrigins({ webPort, dev, own }: { webPort: number; dev: boolean; own: string[] }): string[] {
  const hosts = ['localhost', '127.0.0.1', '[::1]', ...own.map((a) => (a.includes(':') ? `[${a}]` : a))];
  const ports = dev ? [webPort, 5175] : [webPort];
  return ['file://', ...hosts.flatMap((h) => ports.map((p) => `http://${h}:${p}`))];
}

const hostName = (host: string) => {
  const m = /^\[([^\]]+)\](?::\d+)?$/.exec(host) ?? /^([^:]+)(?::\d+)?$/.exec(host);
  return m ? m[1].toLowerCase() : '';
};

/**
 * This computer, and not a web page open in a browser on it: the connection comes from here,
 * it was addressed to this computer by name (a rebound domain name is not), and it carries no
 * Origin or one of the app's own pages
 */
export function fromThisComputer(caller: Omit<Caller, 'key'>, here: LocalContext): boolean {
  const isHere = (address: string | undefined) => isLocalAddress(address) || (!!address && here.own.includes(address.replace(/^::ffff:/, '')));
  if (!isHere(caller.address)) return false;
  const name = caller.host ? hostName(caller.host) : '';
  if (!(name === 'localhost' || isHere(name))) return false;
  return caller.origin === undefined || here.origins.includes(caller.origin);
}

export function remoteAllowed(caller: Caller, settings: RemoteAccessSettings, here: LocalContext): boolean {
  if (!settings.requireKey || fromThisComputer(caller, here)) return true;
  return keyMatches(caller.key, settings.key);
}

/** Stored settings checked again; `created` says a new key was made and needs saving */
export function cleanRemoteAccess(raw: unknown): { value: RemoteAccessSettings; created: boolean } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<RemoteAccessSettings>;
  const validKey = typeof r.key === 'string' && KEY.test(r.key);
  return {
    value: { requireKey: r.requireKey !== false, key: validKey ? r.key! : generateAccessKey() },
    created: !validKey || typeof r.requireKey !== 'boolean',
  };
}

/** A link another computer can open as it is: with ?key= while the key is required */
export function linkWithKey(url: string, settings: RemoteAccessSettings): string {
  if (!settings.requireKey || !settings.key) return url;
  const u = new URL(url);
  u.searchParams.set('key', settings.key);
  return u.toString();
}

/**
 * Content rules (CSP) for the app's pages.
 *
 * The operator UI keeps its own rules. Pages that run graphics (the graphics window, the web
 * output for OBS and vMix, the template preview and the sealed preview frame) get the same
 * rules plus the operator's internet allowlist (Settings → Internet access for graphics).
 * Used by Electron's header hook and by the web server, so every output follows one rule.
 */

export interface CspOptions {
  dev: boolean;
  webPort: number;
  wsPort: number;
}

export interface GraphicsCspOptions extends CspOptions {
  /** Host the page reached the web server on (another computer on the network for OBS) */
  wsHost: string;
  /** Normalised allowlist entries: https://host or https://*.host */
  allowed: string[];
}

export type AllowedOriginResult = { ok: true; value: string } | { ok: false; reason: string };

const HOST = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** An allowlist entry as typed: "https://host" or "https://*.host", nothing else */
export function normalizeAllowedOrigin(input: string): AllowedOriginResult {
  const text = String(input ?? '').trim();
  const m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(text);
  if (!m) return { ok: false, reason: 'Start the address with https://' };
  if (m[1].toLowerCase() !== 'https') return { ok: false, reason: 'Only https:// addresses can be allowed' };
  const rest = m[2].replace(/\/$/, '');
  if (!rest) return { ok: false, reason: 'Add a host name after https://' };
  if (/[/?#]/.test(rest)) return { ok: false, reason: 'Leave out the path: just https:// and the host name' };
  if (rest.includes(':')) return { ok: false, reason: 'Leave out the port' };
  const host = rest.toLowerCase();
  if (!HOST.test(host) || host === '*.' || !host.replace(/^\*\./, '').includes('.')) {
    return { ok: false, reason: 'That is not a host name, e.g. https://www.example.com or https://*.example.com' };
  }
  return { ok: true, value: `https://${host}` };
}

const GRAPHICS_FILES = /\/(graphics|web-output|template-preview|preview-frame)\.html$/;
const GRAPHICS_ROUTES = /^\/(output(\/[^/]+)?|preview|preview-frame)\/?$/;

/** Pages that run graphic code */
export function isGraphicsPage(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return GRAPHICS_FILES.test(pathname) || GRAPHICS_ROUTES.test(pathname);
  } catch {
    return false;
  }
}

type Directives = Array<[string, string[]]>;

function appDirectives({ dev, webPort, wsPort }: CspOptions): Directives {
  const web = `http://localhost:${webPort}`;
  const socket = `ws://localhost:${wsPort}`;
  // The sealed preview frame always lives on 127.0.0.1 (a different origin from the UI)
  const frame = dev ? [`http://127.0.0.1:${webPort}`, 'http://127.0.0.1:5175'] : [`http://127.0.0.1:${webPort}`];
  return [
    ['default-src', ["'self'"]],
    ['script-src', dev ? ["'self'", "'unsafe-inline'", 'http://localhost:5175', web, 'https://cdnjs.cloudflare.com'] : ["'self'", web, 'https://cdnjs.cloudflare.com']],
    ['style-src', ["'self'", "'unsafe-inline'", web, 'https://cdnjs.cloudflare.com']],
    ['img-src', dev ? ["'self'", 'data:', 'http://localhost:5175', web] : ["'self'", 'data:', web]],
    ['font-src', ["'self'", 'data:', web]],
    ['connect-src', dev ? ["'self'", socket, 'ws://localhost:5175', 'http://localhost:5175', web, 'https://cdnjs.cloudflare.com'] : ["'self'", socket, web, 'https://cdnjs.cloudflare.com']],
    ['media-src', ["'self'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', ["'self'", web, ...frame]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
  ];
}

const render = (d: Directives) => d.map(([name, sources]) => [name, ...new Set(sources)].join(' ')).join('; ');

/** The operator UI's rules (unchanged from before the allowlist) */
export function buildAppCsp(o: CspOptions): string {
  return render(appDirectives(o));
}

/** Rules for pages that run graphics: the app's rules plus the allowlist */
export function buildGraphicsCsp(o: GraphicsCspOptions): string {
  const local = [`http://127.0.0.1:${o.webPort}`];
  const extra: Record<string, string[]> = {
    'script-src': [...local, ...o.allowed],
    'style-src': [...local, ...o.allowed],
    'img-src': [...local, ...o.allowed],
    'font-src': [...local, ...o.allowed],
    'media-src': [...o.allowed],
    'frame-src': [...o.allowed],
    'connect-src': [...local, `ws://127.0.0.1:${o.wsPort}`, `ws://${o.wsHost}:${o.wsPort}`, ...o.allowed, ...o.allowed.map((a) => a.replace(/^https:/, 'wss:'))],
  };
  return render(appDirectives(o).map(([name, sources]) => [name, [...sources, ...(extra[name] ?? [])]]));
}

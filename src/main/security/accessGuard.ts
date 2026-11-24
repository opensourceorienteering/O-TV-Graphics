/**
 * The access key at the doors: Express routes that control the app or serve live data, and the
 * Socket.IO connections. See accessKey.ts for the rules.
 */
import type { Request, RequestHandler } from 'express';
import { fromThisComputer, keyFromHttp, keyMatches, remoteAllowed, type LocalContext, type RemoteAccessSettings } from './accessKey';

export const KEY_REQUIRED = 'Access key required: copy it from Split Control → Settings → Remote access';

type Settings = () => RemoteAccessSettings;
type Here = () => LocalContext;

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Access key required</title></head>
<body style="font-family:system-ui,sans-serif;background:#16181d;color:#eee;padding:2em;max-width:40em">
<h1>Access key required</h1>
<p>This computer is not the one running Split Control, so the address needs the access key.</p>
<p>Copy the link from Split Control (Output → Web output, or Settings → Remote access). It ends in <code>?key=…</code>.</p>
</body></html>`;

/**
 * An output page (OBS/vMix browser source) refused: transparent, so an old link without the key
 * never puts a card over the program. The reason is in the tab title and the app's log.
 */
const outputPage = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Split Control: access key required</title></head>
<body style="background: transparent; margin: 0"><!-- This address needs the access key: copy the link again from Split Control (Output → Web output). --></body></html>`;

const isOutput = (req: Request) => /^\/(output|preview)(\/|$|\?)/.test(req.originalUrl);

const wantsPage = (req: Request) => !/^\/(api|ograf)\//.test(req.originalUrl) && !!req.accepts('html') && req.method === 'GET';

/** Express middleware: other computers need the key while it is required */
export function requireAccessKey(
  settings: Settings,
  here: Here,
  addressOf: (req: Request) => string | undefined = (req) => req.socket.remoteAddress,
  /** An output page refused (an OBS/vMix link without the key): for the log */
  onRefusedOutput?: (address: string | undefined) => void,
): RequestHandler {
  return (req, res, next) => {
    // A browser's preflight carries no key and does nothing; the request after it is checked
    if (req.method === 'OPTIONS') return next();
    const caller = { address: addressOf(req), host: req.get('host'), origin: req.get('origin'), key: keyFromHttp(req as never) };
    if (remoteAllowed(caller, settings(), here())) return next();
    res.status(401);
    if (isOutput(req) && req.method === 'GET') {
      onRefusedOutput?.(caller.address);
      res.type('html').send(outputPage);
    } else if (wantsPage(req)) res.type('html').send(page);
    else res.json({ ok: false, success: false, error: KEY_REQUIRED });
  };
}

interface HandshakeSocket {
  handshake: { address: string; auth?: Record<string, unknown>; query?: Record<string, unknown>; headers?: Record<string, unknown> };
  data: Record<string, unknown>;
}

const socketKey = (s: HandshakeSocket) => {
  const fromAuth = s.handshake.auth?.key;
  const fromQuery = s.handshake.query?.key;
  return typeof fromAuth === 'string' ? fromAuth : typeof fromQuery === 'string' ? fromQuery : '';
};

/** Socket.IO middleware: the same rule for live connections; remembers who connected how */
export function socketAccessGuard(settings: Settings, here: Here) {
  return (socket: HandshakeSocket, next: (error?: Error) => void) => {
    const key = socketKey(socket);
    const headers = socket.handshake.headers ?? {};
    const header = (name: string) => (typeof headers[name] === 'string' ? (headers[name] as string) : undefined);
    const caller = { address: socket.handshake.address, host: header('host'), origin: header('origin'), key };
    socket.data.remote = !fromThisComputer(caller, here());
    socket.data.accessKey = key;
    if (remoteAllowed(caller, settings(), here())) next();
    else next(new Error(KEY_REQUIRED));
  };
}

/** Whether a connected socket still qualifies after the operator changed the key or the switch */
export function socketStillAllowed(socket: HandshakeSocket, current: RemoteAccessSettings): boolean {
  if (!current.requireKey || !socket.data.remote) return true;
  return keyMatches(String(socket.data.accessKey ?? ''), current.key);
}

/**
 * The access key at the doors: Express routes that control the app or serve live data, and the
 * Socket.IO connections. See accessKey.ts for the rules.
 */
import type { Request, RequestHandler } from 'express';
import { isLocalAddress, keyFromHttp, keyMatches, remoteAllowed, type RemoteAccessSettings } from './accessKey';

export const KEY_REQUIRED = 'Access key required: copy it from Split Control → Settings → Remote access';

type Settings = () => RemoteAccessSettings;

const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Access key required</title></head>
<body style="font-family:system-ui,sans-serif;background:#16181d;color:#eee;padding:2em;max-width:40em">
<h1>Access key required</h1>
<p>This computer is not the one running Split Control, so the address needs the access key.</p>
<p>Copy the link from Split Control (Output → Web output, or Settings → Remote access). It ends in <code>?key=…</code>.</p>
</body></html>`;

const wantsPage = (req: Request) => !/^\/(api|ograf)\//.test(req.originalUrl) && !!req.accepts('html') && req.method === 'GET';

/** Express middleware: other computers need the key while it is required */
export function requireAccessKey(settings: Settings, addressOf: (req: Request) => string | undefined = (req) => req.socket.remoteAddress): RequestHandler {
  return (req, res, next) => {
    if (remoteAllowed({ address: addressOf(req), key: keyFromHttp(req as never) }, settings())) return next();
    res.status(401);
    if (wantsPage(req)) res.type('html').send(page);
    else res.json({ ok: false, success: false, error: KEY_REQUIRED });
  };
}

interface HandshakeSocket {
  handshake: { address: string; auth?: Record<string, unknown>; query?: Record<string, unknown> };
  data: Record<string, unknown>;
}

const socketKey = (s: HandshakeSocket) => {
  const fromAuth = s.handshake.auth?.key;
  const fromQuery = s.handshake.query?.key;
  return typeof fromAuth === 'string' ? fromAuth : typeof fromQuery === 'string' ? fromQuery : '';
};

/** Socket.IO middleware: the same rule for live connections; remembers who connected how */
export function socketAccessGuard(settings: Settings) {
  return (socket: HandshakeSocket, next: (error?: Error) => void) => {
    const key = socketKey(socket);
    socket.data.remote = !isLocalAddress(socket.handshake.address);
    socket.data.accessKey = key;
    if (remoteAllowed({ address: socket.handshake.address, key }, settings())) next();
    else next(new Error(KEY_REQUIRED));
  };
}

/** Whether a connected socket still qualifies after the operator changed the key or the switch */
export function socketStillAllowed(socket: HandshakeSocket, current: RemoteAccessSettings): boolean {
  if (!current.requireKey || !socket.data.remote) return true;
  return keyMatches(String(socket.data.accessKey ?? ''), current.key);
}

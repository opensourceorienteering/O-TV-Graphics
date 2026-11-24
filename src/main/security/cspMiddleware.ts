/** Sends the graphics content rules with every graphics page the web server serves (OBS, vMix, preview frame) */
import type { RequestHandler } from 'express';
import { buildGraphicsCsp, isGraphicsPage } from './csp';

export interface GraphicsCspSettings {
  dev: boolean;
  webPort: number;
  wsPort: number;
  allowed: string[];
}

/** `settings` is read on every request, so allowlist changes apply without a restart */
export function graphicsCspMiddleware(settings: () => GraphicsCspSettings): RequestHandler {
  return (req, res, next) => {
    if (isGraphicsPage(`http://${req.headers.host ?? 'localhost'}${req.originalUrl}`)) {
      res.setHeader('Content-Security-Policy', buildGraphicsCsp({ ...settings(), wsHost: req.hostname }));
    }
    next();
  };
}

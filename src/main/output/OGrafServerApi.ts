/**
 * EBU OGraf Server API v1 (stable since 2026-08-13)
 * https://github.com/ebu/ograf/blob/main/v1/specification/open-api/server-api.yaml
 *
 * Lets any OGraf controller (automation, another graphics controller) list Split Control's
 * graphics and load / play / update / stop / clear them on the program output.
 *
 * Mounted at /ograf/v1 on the web server (default http://<host>:5657/ograf/v1).
 *
 * Split Control exposes one Renderer, "program", with one RenderTarget { output: "program" }:
 * everything subscribed to the program output (graphics window -> NDI, web outputs) renders it.
 * Graphics loaded by rundown items appear in the listings and can be cleared; their
 * play/stop/update stay with the rundown (409 if a controller tries).
 */

import express, { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import type { OGrafTemplateInfo } from '../../shared/types/ograf';

export interface OGrafServerApiDeps {
  getTemplates(): OGrafTemplateInfo[];
  engine: {
    listGraphicInstances(): { graphicInstanceId: string; templateId: string; source: 'rundown' | 'api'; isPlaying: boolean }[];
    apiLoad(templateId: string, data: unknown): Promise<{ graphicInstanceId: string; statusCode: number; statusMessage?: string }>;
    apiPlay(id: string, params: { delta?: number; goto?: number; skipAnimation?: boolean }): Promise<{ graphicInstanceId: string; statusCode: number; statusMessage?: string; currentStep: number }>;
    apiStop(id: string, params: { skipAnimation?: boolean }): Promise<{ graphicInstanceId: string; statusCode: number }>;
    apiUpdate(id: string, params: { data: unknown; skipAnimation?: boolean }): Promise<{ graphicInstanceId: string; statusCode: number }>;
    apiCustomAction(id: string, actionId: string, params: { payload: unknown; skipAnimation?: boolean }): Promise<{ graphicInstanceId: string; statusCode: number }>;
    apiClear(filters: { graphicId?: string; graphicInstanceId?: string }[]): Promise<string[]>;
  };
  serverName?: string;
  version?: string;
  resolution?: { width: number; height: number };
  frameRate?: number;
}

export const RENDERER_ID = 'program';
const RENDER_TARGET = { output: 'program' };

/** RFC 7807 problem details, as the spec's ErrorResponse */
function problem(res: Response, status: number, title: string, detail?: string) {
  res.status(status).type('application/json').json({ type: 'about:blank', title, status, ...(detail ? { detail } : {}) });
}

function errorStatus(error: unknown, fallback: number): number {
  const s = (error as any)?.httpStatus;
  return typeof s === 'number' ? s : fallback;
}

function isProgramTarget(target: unknown): boolean {
  if (target === undefined || target === null) return false;
  if (typeof target !== 'object' || Array.isArray(target)) return false;
  const output = (target as any).output;
  return output === undefined || output === RENDER_TARGET.output;
}

export function createOGrafServerApiRouter(deps: OGrafServerApiDeps): Router {
  const router = express.Router();

  // Spec-recommended CORS so browser-based controllers can call us
  router.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, HEAD, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '3600');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  router.use(express.json({ limit: '5mb' }));

  const listInfo = (t: OGrafTemplateInfo) => ({
    id: t.manifest.id,
    name: t.manifest.name,
    ...(t.manifest.description ? { description: t.manifest.description } : {}),
    ...(t.manifest.thumbnails ? { thumbnails: t.manifest.thumbnails } : {})
  });
  const findTemplate = (id: string) => deps.getTemplates().find(t => t.manifest.id === id);

  const renderTargetInfo = () => {
    const templates = deps.getTemplates();
    return {
      renderTarget: RENDER_TARGET,
      name: 'Program',
      description: 'Split Control program output (graphics window / NDI and web outputs)',
      graphicInstances: deps.engine.listGraphicInstances().map(i => {
        const t = templates.find(tt => tt.manifest.id === i.templateId);
        return {
          graphicInstanceId: i.graphicInstanceId,
          graphic: t ? listInfo(t) : { id: i.templateId, name: i.templateId }
        };
      })
    };
  };

  // --- server -------------------------------------------------------------------------------
  router.get('/', (_req, res) => {
    res.json({
      name: deps.serverName || 'Split Control',
      description: 'Orienteering broadcast graphics (live results, OGraf v1)',
      author: { name: 'Split Control' },
      version: deps.version || '1.0'
    });
  });

  // --- graphics -----------------------------------------------------------------------------
  router.get('/graphics', (_req, res) => {
    res.json({ graphics: deps.getTemplates().map(listInfo) });
  });

  router.get('/graphics/:graphicId', (req, res) => {
    const t = findTemplate(req.params.graphicId);
    if (!t) return problem(res, 404, 'Graphic not found', req.params.graphicId);
    let createdAt = new Date(0).toISOString();
    try { createdAt = fs.statSync(t.manifestPath).mtime.toISOString(); } catch { /* keep epoch */ }
    res.json({ graphic: t.manifest, manifest: t.manifest, metadata: { createdAt } });
  });

  router.delete('/graphics/:graphicId', (req, res) => {
    if (!findTemplate(req.params.graphicId)) return problem(res, 404, 'Graphic not found', req.params.graphicId);
    problem(res, 405, 'Not supported', 'Split Control manages templates on disk; graphics cannot be deleted through the API');
  });

  router.get('/graphics/:graphicId/thumbnail', (req, res) => {
    const t = findTemplate(req.params.graphicId);
    if (!t) return problem(res, 404, 'Graphic not found', req.params.graphicId);
    const file = typeof req.query.file === 'string' ? req.query.file : undefined;
    const listed = t.manifest.thumbnails?.find(th => th.file === file) ?? (!file ? t.manifest.thumbnails?.[0] : undefined);
    if (!listed) return problem(res, 400, 'Missing or invalid thumbnail file reference');
    const dir = path.dirname(t.manifestPath);
    const full = path.resolve(dir, listed.file);
    if (!full.startsWith(dir + path.sep) || !fs.existsSync(full)) return problem(res, 404, 'Thumbnail not found');
    res.sendFile(full);
  });

  // --- renderers ----------------------------------------------------------------------------
  const rendererInfo = () => ({
    id: RENDERER_ID,
    name: 'Program',
    description: 'Split Control program renderer',
    customActions: [],
    renderCharacteristics: {
      resolution: deps.resolution || { width: 1920, height: 1080 },
      frameRate: deps.frameRate || 50,
      accessToPublicInternet: true
    },
    renderTargetSchema: {
      type: 'object',
      properties: { output: { type: 'string', enum: ['program'], default: 'program' } }
    },
    status: { status: 'OK' },
    renderTargets: [renderTargetInfo()]
  });

  router.get('/renderers', (_req, res) => {
    res.json({ renderers: [{ id: RENDERER_ID, name: 'Program', description: 'Split Control program renderer' }] });
  });

  const requireRenderer = (req: Request, res: Response): boolean => {
    if (req.params.rendererId !== RENDERER_ID) {
      problem(res, 404, 'Renderer not found', req.params.rendererId as string);
      return false;
    }
    return true;
  };

  router.get('/renderers/:rendererId', (req, res) => {
    if (!requireRenderer(req, res)) return;
    res.json({ renderer: rendererInfo() });
  });

  router.get('/renderers/:rendererId/target', (req, res) => {
    if (!requireRenderer(req, res)) return;
    let target: unknown;
    try {
      target = JSON.parse(String(req.query.renderTarget ?? ''));
    } catch {
      return problem(res, 400, 'renderTarget must be a JSON-stringified RenderTargetIdentifier');
    }
    if (!isProgramTarget(target)) return problem(res, 404, 'RenderTarget not found');
    res.json(renderTargetInfo());
  });

  router.post('/renderers/:rendererId/customActions/:customActionId', (req, res) => {
    if (!requireRenderer(req, res)) return;
    problem(res, 404, 'CustomAction not found', `The program renderer has no custom actions (${req.params.customActionId})`);
  });

  // --- graphic instances --------------------------------------------------------------------
  const base = '/renderers/:rendererId/target/graphicInstance';

  router.put(`${base}/clear`, async (req, res) => {
    if (!requireRenderer(req, res)) return;
    const filters = Array.isArray(req.body?.filters) ? req.body.filters : null;
    if (!filters) return problem(res, 400, 'Body must contain a filters array');
    if (filters.some((f: any) => f?.renderTarget !== undefined && !isProgramTarget(f.renderTarget))) {
      return res.json({ graphicInstances: [] });
    }
    try {
      const cleared = await deps.engine.apiClear(filters);
      res.json({ graphicInstances: cleared.map(id => ({ renderTarget: RENDER_TARGET, graphicInstanceId: id })) });
    } catch (error) {
      problem(res, 500, 'Clear failed', (error as Error).message);
    }
  });

  router.post(`${base}/load`, async (req, res) => {
    if (!requireRenderer(req, res)) return;
    const { renderTarget, graphicId, params } = req.body ?? {};
    if (!isProgramTarget(renderTarget)) return problem(res, 400, 'Unknown renderTarget');
    if (typeof graphicId !== 'string' || !params || !('data' in params)) {
      return problem(res, 400, 'Body must contain renderTarget, graphicId and params.data');
    }
    try {
      res.json(await deps.engine.apiLoad(graphicId, params.data));
    } catch (error) {
      const status = errorStatus(error, 550);
      problem(res, status, status === 404 ? 'Graphic not found' : 'load() failed', (error as Error).message);
    }
  });

  const instanceAction = (
    name: 'updateAction' | 'playAction' | 'stopAction',
    run: (id: string, params: any) => Promise<unknown>,
    needsParams = true
  ) => router.post(`${base}/${name}`, async (req, res) => {
    if (!requireRenderer(req, res)) return;
    const { renderTarget, graphicInstanceId, params } = req.body ?? {};
    if (!isProgramTarget(renderTarget)) return problem(res, 400, 'Unknown renderTarget');
    if (typeof graphicInstanceId !== 'string') return problem(res, 400, 'graphicInstanceId is required');
    if (needsParams && (!params || typeof params !== 'object')) return problem(res, 400, 'params is required');
    if (name === 'updateAction' && !('data' in params)) return problem(res, 400, 'params.data is required');
    try {
      res.json(await run(graphicInstanceId, params ?? {}));
    } catch (error) {
      problem(res, errorStatus(error, 550), `${name}() failed`, (error as Error).message);
    }
  });

  instanceAction('updateAction', (id, p) => deps.engine.apiUpdate(id, { data: p.data, skipAnimation: p.skipAnimation }));
  instanceAction('playAction', (id, p) => deps.engine.apiPlay(id, { delta: p.delta, goto: p.goto, skipAnimation: p.skipAnimation }));
  instanceAction('stopAction', (id, p) => deps.engine.apiStop(id, { skipAnimation: p.skipAnimation }), false);

  router.post(`${base}/customActions/:customActionId`, async (req, res) => {
    if (!requireRenderer(req, res)) return;
    const { renderTarget, graphicInstanceId, params } = req.body ?? {};
    if (!isProgramTarget(renderTarget)) return problem(res, 400, 'Unknown renderTarget');
    if (typeof graphicInstanceId !== 'string' || !params || !('payload' in params)) {
      return problem(res, 400, 'Body must contain graphicInstanceId and params.payload');
    }
    try {
      res.json(await deps.engine.apiCustomAction(graphicInstanceId, req.params.customActionId as string, {
        payload: params.payload,
        skipAnimation: params.skipAnimation
      }));
    } catch (error) {
      problem(res, errorStatus(error, 550), 'customAction() failed', (error as Error).message);
    }
  });

  router.use((_req, res) => problem(res, 404, 'Not found'));
  return router;
}

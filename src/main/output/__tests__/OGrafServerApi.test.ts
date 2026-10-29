/**
 * OGraf Server API v1 router (paths and shapes from ebu/ograf v1/specification/open-api/server-api.yaml)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createOGrafServerApiRouter } from '../OGrafServerApi';

const templates: any[] = [{
  type: 'ograf',
  manifestPath: __filename, // any existing file; the router only stats it / uses its directory
  manifest: { id: 'results-list', name: 'Results list', description: 'Paginated results', main: 'graphic.js', supportsRealTime: true, supportsNonRealTime: false },
  directoryName: 'results-list'
}];

const instances: any[] = [];
const engine = {
  listGraphicInstances: vi.fn(() => instances),
  apiLoad: vi.fn(async (id: string) => {
    if (id !== 'results-list') throw Object.assign(new Error('nope'), { httpStatus: 404 });
    instances.push({ graphicInstanceId: 'inst-1', templateId: id, source: 'api', isPlaying: false });
    return { graphicInstanceId: 'inst-1', statusCode: 200 };
  }),
  apiPlay: vi.fn(async (id: string) => ({ graphicInstanceId: id, statusCode: 200, currentStep: 1 })),
  apiStop: vi.fn(async (id: string) => ({ graphicInstanceId: id, statusCode: 200 })),
  apiUpdate: vi.fn(async (id: string) => {
    if (id === 'rundown-item') throw Object.assign(new Error('rundown'), { httpStatus: 409 });
    return { graphicInstanceId: id, statusCode: 200 };
  }),
  apiCustomAction: vi.fn(async (id: string) => ({ graphicInstanceId: id, statusCode: 200 })),
  apiClear: vi.fn(async () => ['inst-1'])
};

let server: Server;
let base: string;
const target = { output: 'program' };

const call = async (method: string, p: string, body?: unknown) => {
  const res = await fetch(base + p, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
};

beforeAll(async () => {
  const app = express();
  app.use('/ograf/v1', createOGrafServerApiRouter({ getTemplates: () => templates, engine, serverName: 'Test', version: '9' }));
  server = await new Promise<Server>(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ograf/v1`;
});
afterAll(() => new Promise<void>(r => server.close(() => r())));

describe('OGraf Server API', () => {
  it('GET / returns server info with a name', async () => {
    const r = await call('GET', '/');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ name: 'Test', version: '9' });
  });

  it('sends the spec CORS headers and answers preflight', async () => {
    const r = await call('OPTIONS', '/graphics');
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('access-control-allow-methods')).toContain('PUT');
  });

  it('lists graphics and returns one manifest', async () => {
    const list = await call('GET', '/graphics');
    expect(list.json).toEqual({ graphics: [{ id: 'results-list', name: 'Results list', description: 'Paginated results' }] });
    const one = await call('GET', '/graphics/results-list');
    expect(one.json.graphic.id).toBe('results-list');
    expect(one.json.metadata.createdAt).toMatch(/^\d{4}-/);
    expect((await call('GET', '/graphics/nope')).status).toBe(404);
  });

  it('refuses DELETE of graphics with an RFC 7807 problem', async () => {
    const r = await call('DELETE', '/graphics/results-list');
    expect(r.status).toBe(405);
    expect(r.json).toMatchObject({ status: 405, title: 'Not supported' });
  });

  it('describes the program renderer and its render target', async () => {
    const list = await call('GET', '/renderers');
    expect(list.json.renderers).toEqual([{ id: 'program', name: 'Program', description: expect.any(String) }]);
    const info = await call('GET', '/renderers/program');
    expect(info.json.renderer).toMatchObject({ id: 'program', status: { status: 'OK' }, renderTargets: [expect.objectContaining({ renderTarget: target })] });
    expect(info.json.renderer.renderTargetSchema.properties.output.enum).toEqual(['program']);
    expect((await call('GET', '/renderers/other')).status).toBe(404);
  });

  it('GET target requires a JSON-stringified RenderTargetIdentifier', async () => {
    expect((await call('GET', '/renderers/program/target?renderTarget=notjson')).status).toBe(400);
    const ok = await call('GET', `/renderers/program/target?renderTarget=${encodeURIComponent(JSON.stringify(target))}`);
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ renderTarget: target, name: 'Program', graphicInstances: [] });
  });

  it('load -> play -> update -> custom -> stop -> clear', async () => {
    const load = await call('POST', '/renderers/program/target/graphicInstance/load', { renderTarget: target, graphicId: 'results-list', params: { data: { results: [] } } });
    expect(load.json).toEqual({ graphicInstanceId: 'inst-1', statusCode: 200 });

    const play = await call('POST', '/renderers/program/target/graphicInstance/playAction', { renderTarget: target, graphicInstanceId: 'inst-1', params: { skipAnimation: true } });
    expect(play.json).toMatchObject({ graphicInstanceId: 'inst-1', statusCode: 200, currentStep: 1 });
    expect(engine.apiPlay).toHaveBeenCalledWith('inst-1', { delta: undefined, goto: undefined, skipAnimation: true });

    const update = await call('POST', '/renderers/program/target/graphicInstance/updateAction', { renderTarget: target, graphicInstanceId: 'inst-1', params: { data: { results: [1] } } });
    expect(update.status).toBe(200);

    const custom = await call('POST', '/renderers/program/target/graphicInstance/customActions/highlight', { renderTarget: target, graphicInstanceId: 'inst-1', params: { payload: { row: 2 } } });
    expect(custom.status).toBe(200);
    expect(engine.apiCustomAction).toHaveBeenCalledWith('inst-1', 'highlight', { payload: { row: 2 }, skipAnimation: undefined });

    const target2 = await call('GET', `/renderers/program/target?renderTarget=${encodeURIComponent(JSON.stringify(target))}`);
    expect(target2.json.graphicInstances).toEqual([{ graphicInstanceId: 'inst-1', graphic: expect.objectContaining({ id: 'results-list' }) }]);

    const stop = await call('POST', '/renderers/program/target/graphicInstance/stopAction', { renderTarget: target, graphicInstanceId: 'inst-1', params: {} });
    expect(stop.status).toBe(200);

    const clear = await call('PUT', '/renderers/program/target/graphicInstance/clear', { filters: [] });
    expect(clear.json).toEqual({ graphicInstances: [{ renderTarget: target, graphicInstanceId: 'inst-1' }] });
  });

  it('validates bodies and maps engine errors to statuses', async () => {
    expect((await call('POST', '/renderers/program/target/graphicInstance/load', { renderTarget: target, graphicId: 'x' })).status).toBe(400);
    expect((await call('POST', '/renderers/program/target/graphicInstance/load', { renderTarget: { output: 'preview' }, graphicId: 'results-list', params: { data: {} } })).status).toBe(400);
    expect((await call('POST', '/renderers/program/target/graphicInstance/load', { renderTarget: target, graphicId: 'nope', params: { data: {} } })).status).toBe(404);
    expect((await call('POST', '/renderers/program/target/graphicInstance/updateAction', { renderTarget: target, graphicInstanceId: 'inst-1', params: {} })).status).toBe(400);
    const busy = await call('POST', '/renderers/program/target/graphicInstance/updateAction', { renderTarget: target, graphicInstanceId: 'rundown-item', params: { data: {} } });
    expect(busy.status).toBe(409);
    expect(busy.json.detail).toBe('rundown');
    expect((await call('PUT', '/renderers/program/target/graphicInstance/clear', {})).status).toBe(400);
  });

  it('has no renderer-level custom actions', async () => {
    const r = await call('POST', '/renderers/program/customActions/x', { payload: {} });
    expect(r.status).toBe(404);
  });
});

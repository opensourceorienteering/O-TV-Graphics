/** Connected backend flow. Disk stores, zip import, discovery, desk, API and playback are real;
 * only output transport and hardware status are replaced. This is not a visual UI test. */
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { strToU8, zipSync } from 'fflate';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphic-capabilities-'));
vi.mock('../../utils/logger', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), verbose: vi.fn() };
  return { logger, getLogger: () => logger };
});
vi.mock('../../utils/config', () => ({ getConfig: () => ({ general: { dataroot: tmp }, output: { web: { enabled: false }, ndi: { enabled: false } } }) }));
vi.mock('../../output/NDIOutputManager', () => ({ ndiOutputManager: { getStatus: () => ({ active: false }) } }));
vi.mock('../../output/WebServer', () => ({ getWebServer: () => ({ isRunning: () => false }) }));

import { initTemplateManager } from '../../templates/OGrafManager';
import { importTemplateZip } from '../../templates/TemplatePackages';
import { initProjectManager } from '../../projects/ProjectManager';
import { initRundownManager } from '../../projects/RundownManager';
import { initDataStore } from '../../data/DataStore';
import { initPlaybackEngine } from '../../playback/PlaybackEngine';
import { setLiveEvent, updateEvent } from '../EventService';
import * as desk from '../Desk';
import * as live from '../LiveControl';
import { createControlApiRouter } from '../../output/ControlApi';
import { parseCommand } from '../../../renderer/control/desk/command';

let server: Server;
let base: string;
let projectId: string;
let transport: ReturnType<typeof vi.spyOn>;
let engine: ReturnType<typeof initPlaybackEngine>;
const graphicKey = 'club-announcement';

beforeAll(async () => {
  const appTemplates = path.join(tmp, 'app');
  fs.mkdirSync(path.join(appTemplates, 'sets'), { recursive: true });
  fs.cpSync(path.resolve('templates/sets/standard'), path.join(appTemplates, 'sets/standard'), { recursive: true });
  const manager = await initTemplateManager(appTemplates, path.join(tmp, 'user'));
  await manager.discoverTemplates();
  const manifest = {
    $schema: 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json',
    id: 'test-club-announcement', name: 'Club announcement', main: 'graphic.js',
    supportsRealTime: true, supportsNonRealTime: false, stepCount: -1,
    v_olgrafik_kind: graphicKey, v_olgrafik_zone: 'lower',
    v_olgrafik_desk: { label: 'Club announcement', inputs: ['page'], fields: ['text'], feeds: [], behaviours: ['holdOnAir'] },
    schema: { type: 'object', properties: { text: { type: 'string', default: 'Welcome' } } },
  };
  await importTemplateZip(manager, zipSync({
    'club/set.json': strToU8(JSON.stringify({ name: 'Test club' })),
    'club/announcement/announcement.ograf.json': strToU8(JSON.stringify(manifest)),
    'club/announcement/graphic.js': strToU8("export default class extends HTMLElement {}"),
  }));
  expect(manager.getAllTemplates().find(t => t.manifest.id === manifest.id)?.deskWarnings).toEqual([]);
  const pm = initProjectManager();
  initRundownManager();
  const project = await pm.createProject({ name: 'Capabilities test', templateSet: 'club' });
  projectId = project.id;
  setLiveEvent(projectId);
  initDataStore();
  engine = initPlaybackEngine();
  let step = 1;
  transport = vi.spyOn(engine as any, 'sendCommand').mockImplementation(async (command: string, payload: any) => {
    if (command === 'play') step = payload.options?.goto ?? Math.min(2, Math.max(1, step + (payload.options?.delta ?? 0)));
    return { success: true, currentStep: step, totalSteps: 2 };
  });
  const app = express();
  app.use('/api/control', createControlApiRouter());
  server = await new Promise<Server>((resolve, reject) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
    started.on('error', reject);
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/control`;
});
afterAll(async () => {
  if (engine) await engine.clearAll();
  transport?.mockRestore();
  setLiveEvent(null);
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

it('imports, prepares, shows, updates, pages, hides and restores a custom look through the real control path', async () => {
  const graphics = await (await fetch(`${base}/graphics`)).json();
  expect(graphics).toEqual([{ key: graphicKey, label: 'Club announcement', params: ['page'] }]);
  const templates = await desk.deskTemplates(projectId);
  const commands = desk.loadDeskCommands();
  const number = Object.entries(commands).find(([, key]) => key === graphicKey)![0];
  const parsed = parseCommand(`${number} 1 `, { templates, commands, available: new Set(graphics.map((g: any) => g.key)), classes: [], runners: [], controls: () => [] });
  expect(parsed.complete).toBe(true);
  const draft = { ...parsed.draft!, fields: { text: 'Welcome to the relay' } };
  await live.prepare(projectId, draft);
  expect((await (await fetch(`${base}/state`)).json()).prepared.label).toBe('Club announcement');
  expect(engine.getActiveGraphics()).toEqual([]); // Preview never activates output.
  const all = desk.saveDeskFavorite(projectId, 'Welcome', draft);
  const favorite = all[graphicKey][0];
  const post = async (route: string) => {
    const response = await fetch(`${base}${route}`, { method: 'POST' });
    expect(response.status).toBe(200);
    return response.json();
  };
  expect(await post(`/favorite/${favorite.id}/show`)).toMatchObject({ ok: true, onAir: 1 });
  expect(transport).toHaveBeenCalledWith('load', expect.objectContaining({ templateId: 'sets/club/announcement', data: expect.objectContaining({ text: 'Welcome to the relay' }) }));
  await live.prepare(projectId, { ...draft, fields: { text: 'Leg two' } });
  expect(await post('/update')).toMatchObject({ ok: true, onAir: 1 });
  expect(transport).toHaveBeenCalledWith('update', expect.objectContaining({ data: expect.objectContaining({ text: 'Leg two' }) }));
  await post('/page/next');
  expect((await (await fetch(`${base}/state`)).json()).onAir[0].step).toBe(2);
  expect(await post(`/hide/${graphicKey}`)).toMatchObject({ ok: true, onAir: 0 });
  await updateEvent(projectId, { templateSet: 'standard' });
  expect((await (await fetch(`${base}/graphics`)).json()).some((g: any) => g.key === graphicKey)).toBe(false);
  expect((await desk.deskTemplates(projectId)).find(t => t.key === graphicKey)?.available).toBe(false);
  expect(desk.loadDeskCommands()[number]).toBe(graphicKey);
  expect(desk.loadDeskFavorites(projectId)[graphicKey][0].id).toBe(favorite.id);
  await updateEvent(projectId, { templateSet: 'club' });
  expect(await post(`/favorite/${favorite.id}/show`)).toMatchObject({ ok: true, onAir: 1 });
  expect(desk.loadDeskCommands()[number]).toBe(graphicKey);
});

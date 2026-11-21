import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireAccessKey, socketAccessGuard } from '../accessGuard';
import { appOrigins } from '../accessKey';

const key = 'K'.repeat(24);
let settings = { requireKey: true, key };
let server: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  // Tests run on 127.0.0.1: the X-Test-From header stands in for another computer's address
  const here = () => ({ own: [], origins: appOrigins({ webPort: 5657, dev: false, own: [] }) });
  const guard = requireAccessKey(() => settings, here, (req) => (req.headers['x-test-from'] as string) ?? req.socket.remoteAddress);
  app.use(['/api/control', '/output'], guard);
  app.get('/api/control/state', (_q, r) => { r.json({ ok: true }); });
  app.use('/director', guard);
  app.get('/output', (_q, r) => { r.send('page'); });
  app.get('/director', (_q, r) => { r.send('page'); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const remote = { 'x-test-from': '192.168.1.20' };

describe('access key on the web server', () => {
  it('lets this computer in without the key', async () => {
    expect((await fetch(base + '/api/control/state')).status).toBe(200);
  });
  it('refuses another computer without the key, in words', async () => {
    const res = await fetch(base + '/api/control/state', { headers: remote });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, success: false, error: expect.stringContaining('Access key') });
    const page = await fetch(base + '/output', { headers: remote });
    expect(page.status).toBe(401);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('key');
  });
  it('refuses an output page with a transparent page, so nothing covers the program in OBS', async () => {
    const page = await fetch(base + '/output', { headers: { ...remote, accept: 'text/html' } });
    expect(page.status).toBe(401);
    const html = await page.text();
    expect(html).toMatch(/background:\s*transparent/);
    expect(html).not.toMatch(/#16181d/);
  });
  it('explains the key on other pages, such as the director page', async () => {
    const page = await fetch(base + '/director', { headers: { ...remote, accept: 'text/html' } });
    expect(page.status).toBe(401);
    expect(await page.text()).toContain('?key=');
  });
  it('lets another computer in with the key in a header or the address', async () => {
    expect((await fetch(base + '/api/control/state', { headers: { ...remote, authorization: `Bearer ${key}` } })).status).toBe(200);
    expect((await fetch(base + '/api/control/state', { headers: { ...remote, 'x-split-key': key } })).status).toBe(200);
    expect((await fetch(`${base}/output?key=${key}`, { headers: remote })).status).toBe(200);
    expect((await fetch(`${base}/output?key=wrong`, { headers: remote })).status).toBe(401);
  });
  it('refuses a website open in a browser on this computer, but lets its preflight through', async () => {
    expect((await fetch(base + '/api/control/state', { headers: { origin: 'https://evil.example' } })).status).toBe(401);
    expect((await fetch(base + '/api/control/state', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } })).status).not.toBe(401);
  });
  it('lets everyone in when the operator turned the key off', async () => {
    settings = { requireKey: false, key };
    expect((await fetch(base + '/api/control/state', { headers: remote })).status).toBe(200);
    settings = { requireKey: true, key };
  });
});

describe('access key on the live connection', () => {
  const here = () => ({ own: [], origins: appOrigins({ webPort: 5657, dev: false, own: [] }) });
  const run = (address: string, auth: Record<string, unknown> = {}, query: Record<string, unknown> = {}, headers: Record<string, string> = { host: '127.0.0.1:5656' }) => {
    let error: Error | undefined | null = null;
    socketAccessGuard(() => settings, here)({ handshake: { address, auth, query, headers }, data: {} } as never, (e?: Error) => { error = e; });
    return error;
  };
  it('refuses another computer without the key and lets the right key in', () => {
    expect(run('192.168.1.20')).toBeInstanceOf(Error);
    expect(run('192.168.1.20', { key })).toBeUndefined();
    expect(run('192.168.1.20', {}, { key })).toBeUndefined();
    expect(run('::ffff:127.0.0.1')).toBeUndefined();
    expect(run('127.0.0.1', {}, {}, { host: '127.0.0.1:5656', origin: 'file://' })).toBeUndefined();
    expect(run('127.0.0.1', {}, {}, { host: '127.0.0.1:5656', origin: 'https://evil.example' })).toBeInstanceOf(Error);
    expect(run('127.0.0.1', {}, {}, { host: 'rebound.example:5656' })).toBeInstanceOf(Error);
  });
});

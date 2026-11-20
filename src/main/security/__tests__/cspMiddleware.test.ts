import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { graphicsCspMiddleware } from '../cspMiddleware';

let server: Server;
let base = '';
let allowed = ['https://www.livelox.com'];
beforeAll(async () => {
  const app = express();
  app.use(graphicsCspMiddleware(() => ({ dev: false, webPort: 5657, wsPort: 5656, allowed })));
  for (const p of ['/output', '/output/abc', '/preview', '/preview-frame', '/api/output/info']) app.get(p, (_q, r) => { r.send('ok'); });
  await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('graphics content rules on the web server', () => {
  it.each(['/output', '/output/abc', '/preview', '/preview-frame'])('sends them for %s, with the allowlist', async (p) => {
    const csp = (await fetch(base + p)).headers.get('content-security-policy') ?? '';
    expect(csp).toContain('https://www.livelox.com');
    expect(csp).toContain('ws://127.0.0.1:5656');
  });
  it('reads the allowlist on every request', async () => {
    allowed = ['https://maps.example.com'];
    expect((await fetch(base + '/output')).headers.get('content-security-policy')).toContain('https://maps.example.com');
  });
  it('leaves other responses alone', async () => {
    expect((await fetch(base + '/api/output/info')).headers.get('content-security-policy')).toBeNull();
  });
});

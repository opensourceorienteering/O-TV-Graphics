/** MeosDataSource over real HTTP against a stand-in for the MeOS information server */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';

vi.mock('../../../utils/logger', () => {
  const l = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };
  return { getLogger: () => l, logger: l };
});

import { MeosDataSource } from '../MeosDataSource';

const COMPLETE = `<?xml version="1.0"?><MOPComplete xmlns="http://www.melin.nu/mop" nextdifference="1">
<competition date="2026-10-26" organizer="OK" homepage="" zerotime="10:00:00">Test</competition>
<ctrl id="31">R1</ctrl><cls id="1" ord="1" radio="31">H21</cls><org id="1">OK</org>
<cmp id="1" card="1"><base org="1" cls="1" stat="0" st="360000" rt="0">Anna</base></cmp>
</MOPComplete>`;
const DIFF = `<?xml version="1.0"?><MOPDiff xmlns="http://www.melin.nu/mop" nextdifference="2">
<cmp id="1"><base org="1" cls="1" stat="0" st="360000" rt="0">Anna</base><radio>31,3000</radio></cmp></MOPDiff>`;

describe('MeosDataSource (HTTP)', () => {
  let server: http.Server;
  let port: number;
  const seen: string[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const diff = new URL(req.url!, 'http://x').searchParams.get('difference');
      seen.push(`${req.url}`);
      res.setHeader('content-type', 'text/xml; charset=utf-8');
      res.end(diff === 'zero' ? COMPLETE : diff === '1' ? DIFF : `<MOPDiff xmlns="http://www.melin.nu/mop" nextdifference="${diff}"/>`);
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>(r => server.close(() => r())));

  it('initialises, lists classes and picks up a radio punch while polling', async () => {
    const ds = new MeosDataSource({ id: 'm', name: 'MeOS', type: 'meos', enabled: true, config: { url: `127.0.0.1:${port}`, pollIntervalMs: 500 } } as any);
    await ds.initialize();
    expect(await ds.getClasses(1)).toEqual([expect.objectContaining({ className: 'H21' })]);

    const updates: any[] = [];
    ds.getClient().startPolling({ competitionId: 1, className: 'H21', interval: 0, onUpdate: (d: any) => updates.push(d) });
    await vi.waitFor(() => expect(updates.some(u => u.results?.[0]?.splits?.['1031'] === 30000)).toBe(true), { timeout: 4000 });
    ds.destroy();
    expect(seen[0]).toBe('/meos?difference=zero');
    expect(seen).toContain('/meos?difference=1');
  });

  it('explains how to fix an unreachable MeOS', async () => {
    const ds = new MeosDataSource({ id: 'm2', name: 'MeOS', type: 'meos', enabled: true, config: { url: 'http://127.0.0.1:1' } } as any);
    await expect(ds.initialize()).rejects.toThrow(/Information server/);
  });
});

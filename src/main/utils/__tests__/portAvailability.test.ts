import { createServer, type Server } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import { findAvailablePort } from '../portAvailability';

describe('findAvailablePort', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server?.listening) return;
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  });

  it('skips ports already in use', async () => {
    server = createServer();
    await new Promise<void>(resolve => server!.listen(0, '0.0.0.0', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected the test server to have a TCP port.');
    const usedPort = address.port;

    const found = await findAvailablePort(usedPort, [usedPort]);

    expect(found).not.toBe(usedPort);
    expect(found).toBeGreaterThanOrEqual(1024);
    expect(found).toBeLessThanOrEqual(65535);
  });

  it('wraps to the start of the valid range when needed', async () => {
    const found = await findAvailablePort(65535, [65535]);

    expect(found).toBeGreaterThanOrEqual(1024);
    expect(found).toBeLessThanOrEqual(65535);
  });
});

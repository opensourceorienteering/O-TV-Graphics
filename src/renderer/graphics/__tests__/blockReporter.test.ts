import { describe, expect, it, vi } from 'vitest';
import { createBlockReporter } from '../blockReporter';

describe('reporting what the browser blocked on a graphics page', () => {
  it('reports each blocked address once per page, with the graphics on it', () => {
    const send = vi.fn();
    const report = createBlockReporter(send, () => ['Map strap']);
    report({ blockedURI: 'https://tile.openstreetmap.org/1.png' } as any);
    report({ blockedURI: 'https://tile.openstreetmap.org/2.png' } as any);
    report({ blockedURI: 'inline' } as any);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ origin: 'https://tile.openstreetmap.org', graphics: ['Map strap'] });
  });
});

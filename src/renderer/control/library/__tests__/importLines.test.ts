import { describe, expect, it, vi } from 'vitest';

// The translations read the chosen language from browser storage
vi.hoisted(() => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
});

import { importLines } from '../ImportConfirm';

describe('import confirmation lines', () => {
  it('describes additions to an installed look and to a missing one', () => {
    const lines = importLines({
      looks: [],
      graphics: [],
      additions: [
        { lookId: 'standard', lookName: 'Standard', graphics: 2 },
        { lookId: 'gps-pack', lookName: null, graphics: 1 },
      ],
    });
    expect(lines[0]).toBe('Standard: adds graphics to this look (2)');
    expect(lines[1]).toMatch(/^gps-pack: .*Needs attention.*\(1\)$/);
  });
});

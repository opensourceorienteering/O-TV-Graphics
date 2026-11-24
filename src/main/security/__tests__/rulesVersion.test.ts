import { describe, expect, it, vi } from 'vitest';
import { RulesReloader } from '../rulesReload';

describe('rules version', () => {
  it('counts every change, so pages that missed a reload can tell', () => {
    const r = new RulesReloader({ onAirCount: () => 0, reloadPages: vi.fn(), notifyPreviews: vi.fn() });
    expect(r.version).toBe(0);
    r.changed();
    r.changed();
    expect(r.version).toBe(2);
  });
});

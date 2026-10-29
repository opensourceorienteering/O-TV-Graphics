import { describe, it, expect, beforeEach, vi } from 'vitest';

// The palette (and the i18n module it imports) read localStorage on import
const store = vi.hoisted(() => {
  const map = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k)
  };
  return map;
});

import { loadRecent, rememberRecent } from '../CommandPalette';

beforeEach(() => store.clear());

describe('recent palette commands', () => {
  it('are kept per event and never carry over', () => {
    rememberRecent('event-a', { input: '4 1 45', label: 'Live split', detail: 'H21' });
    expect(loadRecent('event-a').map(r => r.input)).toEqual(['4 1 45']);
    expect(loadRecent('event-b')).toEqual([]);
  });

  it('drop the old list that every event shared', () => {
    store.set('olg.desk.recent', JSON.stringify([{ input: '0 9 999', label: 'Old', detail: '' }]));
    expect(loadRecent('event-a')).toEqual([]);
    expect(store.has('olg.desk.recent')).toBe(false);
  });
});

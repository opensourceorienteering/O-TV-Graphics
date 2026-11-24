import { describe, expect, it } from 'vitest';
import { BlockedLog, blockedOrigin } from '../blockedAddresses';

describe('what a blocked request asked for', () => {
  it.each([
    ['https://tile.openstreetmap.org/12/2200/1200.png', 'https://tile.openstreetmap.org'],
    ['http://api.Example.com/data?x=1', 'https://api.example.com'],
    ['wss://live.example.com/socket', 'https://live.example.com'],
  ])('%s → %s', (uri, origin) => expect(blockedOrigin(uri)).toBe(origin));
  it.each(['inline', 'eval', 'data', 'blob:https://x', 'https://x.example:8443/a', ''])('ignores %s', (uri) => expect(blockedOrigin(uri)).toBeNull());
});

describe('blocked addresses list', () => {
  it('keeps one row per address: newest first, with the graphics that asked and how often', () => {
    const log = new BlockedLog();
    log.add({ origin: 'https://a.example', graphics: ['Map strap'], at: 1 });
    log.add({ origin: 'https://b.example', graphics: ['GPS'], at: 2 });
    log.add({ origin: 'https://a.example', graphics: ['GPS'], at: 3 });
    expect(log.list([])).toEqual([
      { origin: 'https://a.example', graphics: ['GPS', 'Map strap'], last: 3, count: 2 },
      { origin: 'https://b.example', graphics: ['GPS'], last: 2, count: 1 },
    ]);
  });
  it('leaves out addresses that have been allowed since', () => {
    const log = new BlockedLog();
    log.add({ origin: 'https://a.example', graphics: [], at: 1 });
    log.add({ origin: 'https://tiles.example.com', graphics: [], at: 2 });
    expect(log.list(['https://a.example', 'https://*.example.com']).map((e) => e.origin)).toEqual([]);
  });
  it('keeps the 20 most recent addresses', () => {
    const log = new BlockedLog();
    for (let i = 0; i < 25; i++) log.add({ origin: `https://h${i}.example`, graphics: [], at: i });
    const list = log.list([]);
    expect(list).toHaveLength(20);
    expect(list[0].origin).toBe('https://h24.example');
  });
  it('can be cleared', () => {
    const log = new BlockedLog();
    log.add({ origin: 'https://a.example', graphics: [], at: 1 });
    log.clear();
    expect(log.list([])).toEqual([]);
  });
});

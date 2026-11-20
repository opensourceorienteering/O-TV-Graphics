/** GPS tower: Trace / Track's virtual standings (results[].x['trace-track']) as an F1-style tower */
import { describe, it, expect, beforeAll } from 'vitest';

let views: any;
beforeAll(async () => { views = await import('../../../../templates/sets/_core/views.js'); });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const rowsOf = (html: string) => [...html.matchAll(/<div class="(row(?: [^"]*)?)"[^>]*>(.*?)<\/div>/g)].map(m => [m[1], text(m[2])]);
const ctx = { id: 'standard', kind: 'gps-tower', step: 1, nameStyle: {}, labels: {} };
const runner = (name: string, g?: object) => ({ name, club: 'Club', statusCode: 0, ...(g ? { x: { 'trace-track': g } } : {}) });

describe('GPS tower', () => {
  const results = [
    runner('Hanna Lundberg', { virtualRank: 3, virtualGap: 109_000, progressPercent: 89, progressState: 'tracking', signal: 'live' }),
    runner('Tove Alexandersson', { virtualRank: 1, virtualGap: 0, progressPercent: 100, progressState: 'timing-finished', signal: 'live' }),
    runner('Alva Sonesson', { progressPercent: 40, progressState: 'tracking', signal: 'lost' }),   // estimate withheld
    runner('Simona Aebersold', { virtualRank: 2, virtualGap: 61_400, progressPercent: 79.2, progressState: 'tracking', signal: 'live' }),
    runner('Not Tracked'),                                                                           // no Trace / Track data
  ];

  it('lists the estimated order with the gap to the leader, official finishers marked, lost GPS last', () => {
    const html = views.renderView('gps-tower', { className: 'D21', results }, ctx).html;
    expect(rowsOf(html)).toEqual([
      ['row is-official row--leader', '1 Alexandersson F Leader'],
      ['row', '2 Aebersold +1:01'],
      ['row', '3 Lundberg +1:49'],
      ['row is-lost', 'Sonesson GPS'],
    ]);
    expect(text(html)).toContain('Estimated');
    expect(html).toContain('--p:79.2');
  });

  it('keeps the selected runner on a short tower', () => {
    const html = views.renderView('gps-tower', { className: 'D21', results, rows: 2, runnerName: 'Hanna Lundberg' }, ctx).html;
    expect(rowsOf(html).map(r => r[1])).toEqual(['1 Alexandersson F Leader', '3 Lundberg +1:49']);
    expect(rowsOf(html)[1][0]).toContain('row--hl');
  });

  it('speaks the event language and says when there is nothing to show', () => {
    expect(text(views.renderView('gps-tower', { className: 'D21', results, presentation: { language: 'sv' } }, ctx).html)).toContain('Ledare');
    expect(text(views.renderView('gps-tower', { className: 'D21', results: [runner('Not Tracked')] }, ctx).html)).toContain('No results yet');
  });
});

describe('GPS tower arrows', () => {
  const t0 = Date.UTC(2026, 10, 20, 10);
  const at = (ranks: Record<string, number>, ms: number, extra = {}) => ({
    className: 'D21', frozenAt: t0 + ms, ...extra,
    results: Object.entries(ranks).map(([name, virtualRank]) =>
      ({ name, club: 'Club', statusCode: 0, x: { 'trace-track': { virtualRank, virtualGap: (virtualRank - 1) * 5000, progressState: 'tracking', signal: 'live' } } }))
  });
  const changes = (html: string) => [...html.matchAll(/<span class="c-change([^"]*)">([^<]*)<\/span>/g)].map(m => (m[1].trim() || '-') + m[2]);

  it('shows places gained or lost after a change, then lets them go', () => {
    const memory = {};
    const c = { ...ctx, memory };
    views.renderView('gps-tower', at({ A: 1, B: 2, C: 3 }, 0), c);
    // C passes A and B
    expect(changes(views.renderView('gps-tower', at({ C: 1, A: 2, B: 3 }, 1000), c).html)).toEqual(['up2', 'down1', 'down1']);
    // a second move within 10 s adds up: B passes A
    expect(changes(views.renderView('gps-tower', at({ C: 1, B: 2, A: 3 }, 4000), c).html)).toEqual(['up2', '-', 'down2']);
    // 10 s after its last move an arrow goes
    expect(changes(views.renderView('gps-tower', at({ C: 1, B: 2, A: 3 }, 12000), c).html)).toEqual(['-', '-', 'down2']);
    expect(changes(views.renderView('gps-tower', at({ C: 1, B: 2, A: 3 }, 15000), c).html)).toEqual(['-', '-', '-']);
  });

  it('clears an arrow when the moves cancel out, and starts again for another class', () => {
    const memory = {};
    const c = { ...ctx, memory };
    views.renderView('gps-tower', at({ A: 1, B: 2 }, 0), c);
    views.renderView('gps-tower', at({ B: 1, A: 2 }, 1000), c);
    expect(changes(views.renderView('gps-tower', at({ A: 1, B: 2 }, 2000), c).html)).toEqual(['-', '-']);
    views.renderView('gps-tower', at({ B: 1, A: 2 }, 3000), c);
    expect(changes(views.renderView('gps-tower', at({ A: 1, B: 2 }, 3500, { className: 'H21' }), c).html)).toEqual(['-', '-']);
  });
});

describe('GPS tower arrows count overtakes only', () => {
  const at = (ranks: Record<string, number>, ms: number) => ({
    className: 'D21', frozenAt: Date.UTC(2026, 10, 20, 10) + ms,
    results: Object.entries(ranks).map(([name, virtualRank]) =>
      ({ name, club: 'Club', statusCode: 0, x: { 'trace-track': { virtualRank, virtualGap: 0, progressState: 'tracking', signal: 'live' } } }))
  });
  const changes = (html: string) => [...html.matchAll(/<span class="c-change([^"]*)">([^<]*)<\/span>/g)].map(m => (m[1].trim() || '-') + m[2]);

  it('a runner joining or leaving the tower moves no one\'s arrow', () => {
    const c = { ...ctx, memory: {} };
    views.renderView('gps-tower', at({ A: 1, B: 2, C: 3 }, 0), c);
    // N appears in 2nd: B and C drop a place on the tower, but nobody overtook them
    expect(changes(views.renderView('gps-tower', at({ A: 1, N: 2, B: 3, C: 4 }, 1000), c).html)).toEqual(['-', '-', '-', '-']);
    // A leaves (GPS withheld): no arrows either
    expect(changes(views.renderView('gps-tower', at({ N: 1, B: 2, C: 3 }, 2000), c).html)).toEqual(['-', '-', '-']);
  });
});

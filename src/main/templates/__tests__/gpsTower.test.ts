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

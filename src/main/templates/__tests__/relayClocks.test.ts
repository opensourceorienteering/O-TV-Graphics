/**
 * Relays: a runner on the way on leg 2 runs in the team's time. Results and splits count from
 * the team's start, so running times must too (JWOC 2026 Sprint Relay numbers).
 */
import { describe, it, expect, beforeAll } from 'vitest';

let views: any;
beforeAll(async () => {
  views = await import('../../../../templates/sets/_core/views.js');
});
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const ctx = { id: 'standard', kind: 'standings-lower-third', step: 1, nameStyle: {}, labels: {} };

const teamStart = Date.UTC(2026, 5, 30, 9, 0, 0);
const now = teamStart + 950_000;            // 15:50 into the race
const changeover = teamStart + 797_000;     // France handed over after 13:17
// the leader passed TV1 at 16:26 team time
const leader = { name: 'Simon Calandry', club: 'France 1', position: 1, place: 1, time: '16:26', statusCode: 0, progress: 100,
  startTimeMs: teamStart + 780_000, teamStartTimeMs: teamStart };
const onTheWay = { name: 'Vladimir Srb', club: 'Czechia 1', statusCode: 9, progress: 0, time: '',
  startTimeMs: changeover, teamStartTimeMs: teamStart };
const data = (extra = {}) => ({ className: 'Mixed-2', controlCode: '1035', runnerName: 'Vladimir Srb', frozenAt: now,
  results: [leader, onTheWay], ...extra });

describe('relay running times', () => {
  it('compares a leg 2 runner with the leader in the team\'s time', () => {
    const html = views.renderView('standings-lower-third', data(), ctx).html;
    // 15:50 team time against the leader's 16:26: 36 s ahead (not 13:53 ahead from the changeover)
    expect(text(html)).toContain('-0:36');
    const lower = views.renderView('runner-lower-third', data(), { ...ctx, kind: 'runner-lower-third' }).html;
    expect(text(lower)).toContain('-0:36');
  });

  it('runs Runner focus in the team\'s time after the changeover', () => {
    const html = views.renderView('runner-start', data({ controlCode: '1035' }), { ...ctx, kind: 'runner-start' }).html;
    expect(html).toContain(`data-t="${changeover}"`);
    expect(html).toContain(`data-from="${teamStart}"`);
    expect(text(html)).toContain('15:50');
  });

  it('keeps individual races on the runner\'s own start', () => {
    const solo = { ...onTheWay, teamStartTimeMs: undefined, startTimeMs: teamStart };
    const html = views.renderView('standings-lower-third', data({ className: 'H21', results: [leader, solo] }), ctx).html;
    expect(text(html)).toContain('-0:36');
  });
});

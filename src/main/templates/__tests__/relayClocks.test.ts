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

describe('relay split comparison and leg names', () => {
  const runner = (name: string, place: number, result: number, timeplus: number, splits: any[]) =>
    ({ name, club: 'Czechia 1', status: 0, place, result, timeplus, splits });
  const legs = [
    { leg: 1, className: 'Mixed-1', controls: [{ code: 1035, name: 'TV1' }], runner: runner('Marketa Hanusova', 7, 82500, 2800, [{ code: 1035, time: 40000, place: 31, timeplus: 2500 }]) },
    { leg: 2, className: 'Mixed-2', controls: [{ code: 1035, name: 'TV1' }], runner: runner('Vladimir Srb', 2, 160400, 700, [{ code: 1035, time: 102000, place: 7, timeplus: 3400 }]) },
    { leg: 3, className: 'Mixed-3', controls: [{ code: 1035, name: 'TV1' }, { code: 1040, name: 'TV2' }], runner: runner('Tomas Urbanek', 0, 0, 0, [{ code: 1035, time: 180000, place: 2, timeplus: 100 }]) },
    { leg: 4, className: 'Mixed-4', controls: [{ code: 1035, name: 'TV1' }], runner: null }
  ];
  const rows = (html: string) => [...html.matchAll(/<div class="row[^"]*"[^>]*>(.*?)<\/div>/g)].map(m => text(m[1]));
  const base = { className: 'Mixed-3', runnerName: 'Tomas Urbanek', runnerClub: 'Czechia 1', relayLegs: legs, results: [] };

  it('lists every leg\'s radio controls and changeovers for the team', () => {
    const html = views.renderView('runner-splits', { ...base, compare: 'team', maxControls: 10 }, { ...ctx, kind: 'runner-splits' }).html;
    expect(text(html)).toContain('Czechia 1');
    expect(rows(html)).toEqual([
      '1 TV1 31 +0:25', 'Changeover 1 7 24 +0:28', '2 TV1 7 +0:34', 'Changeover 2 2 5 +0:07', '3 TV1 2 +0:01'
    ]);
  });

  it('keeps every changeover when rows are short, with places gained since the row above', () => {
    const html = views.renderView('runner-splits', { ...base, compare: 'team', maxControls: 3 }, { ...ctx, kind: 'runner-splits' }).html;
    expect(rows(html)).toEqual(['Changeover 1 7 +0:28', 'Changeover 2 2 5 +0:07', '3 TV1 2 +0:01']);
  });

  it('says the leg in Swedish, and keeps the runner view for individual classes', () => {
    const sv = views.renderView('runner-splits', { ...base, compare: 'team', presentation: { language: 'sv' } }, { ...ctx, kind: 'runner-splits' }).html;
    expect(text(sv)).toContain('Växling 1');
    const solo = views.renderView('runner-splits', { ...base, relayLegs: undefined, compare: 'team' }, { ...ctx, kind: 'runner-splits' }).html;
    expect(text(solo)).toContain('Mixed · Leg 3');
    const svSolo = views.renderView('results', { className: 'Mixed-2', results: [], presentation: { language: 'sv' } }, { ...ctx, kind: 'results' }).html;
    expect(text(svSolo)).toContain('Mixed · Sträcka 2');
    expect(text(views.renderView('results', { className: 'H21', results: [] }, { ...ctx, kind: 'results' }).html)).toContain('H21');
  });
});

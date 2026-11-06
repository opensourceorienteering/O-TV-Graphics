import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: l, getLogger: () => l };
});
vi.mock('../DataStore', () => ({ getDataStore: () => ({}) }));
vi.mock('../DataSourceRegistry', () => ({ getDataSourceRegistry: () => ({}) }));
vi.mock('../ClubLogoService', () => ({ getClubLogoService: () => null }));

import { relayTeamStarts } from '../DataSourceFieldMapper';

// JWOC 2026 Sprint Relay (Liveresultat 37049): leg 2 rows give the changeover as start,
// results count from the team's start on leg 1
const leg1 = [{ name: 'Lucie Gaudion', club: 'France 1', start: 420000 }, { name: 'X', club: 'Czechia 1', start: 420000 }];
const leg2 = [{ name: 'Simon Calandry', club: 'France 1', start: 499700 }, { name: 'Vladimir Srb', club: 'Czechia 1', start: 502500 }];
const client = (byClass: Record<string, any[]>) => ({
  getClassResults: vi.fn(async (_c: number, name: string) => {
    if (!byClass[name]) throw new Error('no class');
    return { data: { className: name, splitcontrols: [], results: byClass[name], hash: '' }, hash: '', timestamp: 0, changed: false };
  })
});

describe('relay team starts', () => {
  it('reads a later leg\'s team starts from leg 1 (Liveresultat)', async () => {
    const c = client({ 'Mixed-1': leg1 });
    const starts = await relayTeamStarts(c as any, 37049, 'Mixed-2', leg2);
    expect(starts.get('France 1')).toBe(420000);
    expect(starts.get('Czechia 1')).toBe(420000);
    expect(c.getClassResults).toHaveBeenCalledWith(37049, 'Mixed-1', { maxAgeMs: 60_000 });
  });

  it('uses the source\'s own team start (MeOS, MOP, IOF XML) without fetching leg 1', async () => {
    const c = client({});
    const starts = await relayTeamStarts(c as any, 1, 'Kavle-2', [{ club: 'OK Exempel 1', start: 500000, teamstart: 320000 }]);
    expect(starts.get('OK Exempel 1')).toBe(320000);
    expect(c.getClassResults).not.toHaveBeenCalled();
  });

  it('leaves individual classes and leg 1 alone, and ignores impossible team starts', async () => {
    const c = client({ 'Mixed-1': [{ club: 'France 1', start: 600000 }] });
    expect((await relayTeamStarts(c as any, 1, 'H21', leg2)).size).toBe(0);
    expect((await relayTeamStarts(c as any, 1, 'Mixed-1', leg1)).size).toBe(0);
    // a team start after the runner's own start is dropped
    expect((await relayTeamStarts(c as any, 1, 'Mixed-2', leg2)).has('France 1')).toBe(false);
    // no leg 1 class: nothing, no error
    expect((await relayTeamStarts(client({}) as any, 1, 'Mixed-2', leg2)).size).toBe(0);
  });
});

import { relayLegsOfTeam } from '../DataSourceFieldMapper';

describe('relay legs of a team', () => {
  // JWOC 2026 Sprint Relay, Czechia 1 (shortened: one radio control per leg)
  const leg = (n: number, place: string, result: string, timeplus: string, split: number, splitPlace: number, name: string) => ({
    splitcontrols: [{ code: 1035, name: 'TV1' }],
    results: [
      { name, club: 'Czechia 1', place, result, timeplus, status: 0, start: 420000, splits: { 1035: split, '1035_place': splitPlace, '1035_timeplus': 2500 } },
      { name: 'Other', club: 'France 1', place: '1', result: '1', timeplus: '0', status: 0, start: 420000, splits: {} }
    ]
  });
  const classes = { 'Mixed-1': leg(1, '7', '82500', '2800', 40000, 31, 'Marketa Hanusova'), 'Mixed-2': leg(2, '2', '160400', '700', 102000, 7, 'Vladimir Srb'),
    'Mixed-3': leg(3, '', '', '', 180000, 2, 'Tomas Urbanek') };
  const client = {
    getClasses: vi.fn(async () => ({ data: [{ className: 'Mixed-1' }, { className: 'Mixed-2' }, { className: 'Mixed-3' }, { className: 'Mixed-4' }, { className: 'H21' }] })),
    getClassResults: vi.fn(async (_c: number, name: string) => {
      if (!(name in classes)) throw new Error('no class');
      return { data: (classes as any)[name], hash: '', timestamp: 0, changed: false };
    })
  };

  it('follows the selected runner\'s team through every leg', async () => {
    const legs = await relayLegsOfTeam(client as any, 37049, 'Mixed-3', (classes as any)['Mixed-3'], { runnerName: 'Tomas Urbanek' });
    expect(legs.map(l => l.leg)).toEqual([1, 2, 3]); // leg 4 has no data yet
    expect(legs[0].runner).toMatchObject({ name: 'Marketa Hanusova', club: 'Czechia 1', place: 7, result: 82500, timeplus: 2800 });
    expect(legs[1].runner?.splits).toEqual([{ code: 1035, time: 102000, place: 7, timeplus: 2500 }]);
    expect(legs[2].runner).toMatchObject({ name: 'Tomas Urbanek', result: 0 });
    expect(legs[0].controls).toEqual([{ code: 1035, name: 'TV1' }]);
  });

  it('is empty for individual classes and without a runner', async () => {
    expect(await relayLegsOfTeam(client as any, 1, 'H21', { results: [] }, { runnerName: 'X' })).toEqual([]);
    expect(await relayLegsOfTeam(client as any, 1, 'Mixed-2', { results: [] }, {})).toEqual([]);
  });
});

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: l, getLogger: () => l };
});
vi.mock('../DataStore', () => ({ getDataStore: () => ({}) }));
vi.mock('../DataSourceRegistry', () => ({ getDataSourceRegistry: () => ({}) }));
vi.mock('../ClubLogoService', () => ({ getClubLogoService: () => null }));

import { relayLegsOfTeam, teamStartsByClub } from '../DataSourceFieldMapper';
import { teamStartsOfLeg } from '../timing/liveresultat/LiveresultatSource';
import { instantOfWallClock, type ClassResults, type ResultRow } from '../timing/model';

// JWOC 2026 Sprint Relay (Liveresultat 37049): leg 2 rows give the changeover as start,
// results count from the team's start on leg 1
const leg1 = [{ name: 'Lucie Gaudion', club: 'France 1', start: 420000 }, { name: 'X', club: 'Czechia 1', start: 420000 }];
const leg2 = [{ name: 'Simon Calandry', club: 'France 1', start: 499700 }, { name: 'Vladimir Srb', club: 'Czechia 1', start: 502500 }];
const raw = (results: any[]) => ({ results });

describe('relay team starts (Liveresultat)', () => {
  it("falls back to a team's start on leg 1", () => {
    const starts = teamStartsOfLeg([raw(leg1), raw(leg2)], 1);
    expect(starts.get('France 1')).toBe(420000);
    expect(starts.get('Czechia 1')).toBe(420000);
  });

  it('works the team start out from the previous leg when leg start times disagree', () => {
    // JWOC 2026: legs 1-2 have start times nine hours off legs 3-4 (01:10 against 10:10)
    const starts = teamStartsOfLeg([
      raw([{ club: 'Czechia 1', start: 420000 }]),
      raw([{ club: 'Czechia 1', start: 502500, result: '160400', status: 0 }]),
      raw([{ club: 'Czechia 1', start: 3820400 }])
    ], 2);
    expect(starts.get('Czechia 1')).toBe(3660000); // 10:10:00, not 01:10:00 from leg 1
  });

  it('leaves leg 1 alone, and ignores impossible team starts', () => {
    expect(teamStartsOfLeg([raw(leg1)], 0).size).toBe(0);
    // a team start after the runner's own start is dropped
    expect(teamStartsOfLeg([raw([{ club: 'France 1', start: 600000 }]), raw(leg2)], 1).has('France 1')).toBe(false);
  });
});

describe('relay team starts for graphics', () => {
  const info = { date: '2026-06-30', timezone: 'Europe/Stockholm', timediffHours: 0 } as any;
  const t = (cs: number) => instantOfWallClock(info, cs);
  const r = (club: string, start: number, teamStart?: number) => ({ name: club, club, start: t(start), ...(teamStart ? { teamStart: t(teamStart) } : {}) }) as ResultRow;

  it("uses the source's team starts, by team", () => {
    expect([...teamStartsByClub([r('OK Exempel 1', 500000, 320000)], info)]).toEqual([['OK Exempel 1', 320000]]);
  });

  it('is empty for individual classes, and ignores a team start after the runner\'s own start', () => {
    expect(teamStartsByClub([r('A', 500000)], info).size).toBe(0);
    expect(teamStartsByClub([r('A', 500000, 600000)], info).size).toBe(0);
  });
});

describe('relay legs of a team', () => {
  // JWOC 2026 Sprint Relay, Czechia 1 (shortened: one radio control per leg)
  const leg = (place: number | undefined, time: number | undefined, behind: number | undefined, split: number, splitPlace: number, name: string): ClassResults => ({
    competitionId: 37049, className: '', classId: 'Mixed',
    controls: [{ key: 1035, id: '1035', code: 35, name: 'TV1' }],
    rows: [
      { entryId: name, name, club: 'Czechia 1', status: 'ok', statusCode: 0, ranked: true, tied: false, progress: 0,
        ...(place ? { place } : {}), ...(time !== undefined ? { time } : {}), ...(behind !== undefined ? { behind } : {}),
        splits: { 1035: { time: split, status: 0, place: splitPlace, behind: 25_000 } } },
      { entryId: 'o', name: 'Other', club: 'France 1', status: 'ok', statusCode: 0, ranked: true, tied: false, progress: 0, place: 1, time: 10, behind: 0, splits: {} }
    ]
  });
  const classes: Record<string, ClassResults> = {
    'Mixed-1': leg(7, 825_000, 28_000, 400_000, 31, 'Marketa Hanusova'),
    'Mixed-2': leg(2, 1_604_000, 7_000, 1_020_000, 7, 'Vladimir Srb'),
    'Mixed-3': leg(undefined, undefined, undefined, 1_800_000, 2, 'Tomas Urbanek')
  };
  const client = {
    getClasses: vi.fn(async () => ({ data: ['Mixed-1', 'Mixed-2', 'Mixed-3', 'Mixed-4', 'H21'].map(className => ({ className, classId: className })) })),
    getClassResults: vi.fn(async (_c: number, name: string) => {
      if (!(name in classes)) throw new Error('no class');
      return { data: classes[name], hash: '', timestamp: 0, changed: false };
    })
  };

  it("follows the selected runner's team through every leg", async () => {
    const legs = await relayLegsOfTeam(client as any, 37049, 'Mixed-3', classes['Mixed-3'], { runnerName: 'Tomas Urbanek' });
    expect(legs.map(l => l.leg)).toEqual([1, 2, 3]); // leg 4 has no data yet
    expect(legs[0].runner).toMatchObject({ name: 'Marketa Hanusova', club: 'Czechia 1', place: 7, result: 82500, timeplus: 2800 });
    expect(legs[1].runner?.splits).toEqual([{ code: 1035, time: 102000, place: 7, timeplus: 2500 }]);
    expect(legs[1].runner).toMatchObject({ legTime: 160400 - 82500, legPlace: 1 });
    expect(legs[2].runner).toMatchObject({ name: 'Tomas Urbanek', result: 0 });
    expect(legs[0].controls).toEqual([{ code: 1035, name: 'TV1' }]);
  });

  it('is empty for individual classes and without a runner', async () => {
    const none = { ...classes['Mixed-1'], rows: [] };
    expect(await relayLegsOfTeam(client as any, 1, 'H21', none, { runnerName: 'X' })).toEqual([]);
    expect(await relayLegsOfTeam(client as any, 1, 'Mixed-2', none, {})).toEqual([]);
  });
});

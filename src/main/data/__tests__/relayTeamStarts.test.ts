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

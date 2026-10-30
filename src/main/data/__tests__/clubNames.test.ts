import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: {} as any, saves: 0 }));
vi.mock('../../utils/config', () => ({
  getConfig: () => state.config,
  saveConfig: async (cfg: any) => { state.config = cfg; state.saves++; },
}));
vi.mock('../ClubLogoService', () => ({
  getClubLogoService: () => ({ shortName: (n: string) => (n === 'Orienteringsklubben Linné' ? 'OK Linné' : n) }),
}));
import { clubNameLibrary, clubNameRows, libraryRows, setClubNames } from '../clubNames';

describe('club name library (app settings)', () => {
  beforeEach(() => {
    state.config = { general: {}, clubNames: { 'OK Tyr': 'Tyr' } };
    state.saves = 0;
  });

  it('adds, changes and removes names in the app settings', async () => {
    await setClubNames({ ' IFK Göteborg Orientering ': ' IFK Göteborg ', 'OK Tyr': '' });
    expect(state.config.clubNames).toEqual({ 'IFK Göteborg Orientering': 'IFK Göteborg' });
    expect(state.config.general).toEqual({}); // the rest of the settings stay
    expect(clubNameLibrary()).toEqual({ 'IFK Göteborg Orientering': 'IFK Göteborg' });
  });

  it('shows each club with its automatic name and the library name', () => {
    const rows = clubNameRows(new Map([['Orienteringsklubben Linné', 3], ['OK Tyr', 2]]));
    expect(rows).toEqual([
      { name: 'OK Tyr', runners: 2, automatic: 'OK Tyr', override: 'Tyr' },
      { name: 'Orienteringsklubben Linné', runners: 3, automatic: 'OK Linné' },
    ]);
    expect(libraryRows()).toEqual([{ name: 'OK Tyr', runners: 0, automatic: 'OK Tyr', override: 'Tyr' }]);
  });
});

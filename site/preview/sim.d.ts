/** Types for sim.js (the simulated race shared by the website preview and the app) */
export interface SampleRunner {
  name: string; club: string; country: string; bib: string;
  startTimeMs: number; splitsMs: number[]; finishMs: number; status: 'ok' | 'mp' | 'dnf';
}
export interface SampleControl { code: number; name: string; short: string; at: number }
export interface SampleRace {
  className: string;
  controls: SampleControl[];
  runners: SampleRunner[];
  firstStart: number;
  end: number;
  /** Graphic data at simulated time `at` for a timing point ('S', a control code or 'F') */
  data(at: number, controlCode?: string | number): {
    className: string; controlCode: string; controlName: string;
    splitControls: { code: number; name: string; short: string }[];
    results: Record<string, unknown>[];
    competitionDate: string;
  };
}
export function createRace(options?: { seed?: number; firstStart?: number }): SampleRace;
export function raceEvents(race: SampleRace, from: number, to: number): { at: number; text: string }[];

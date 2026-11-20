import { describe, expect, it } from 'vitest';
import { createRace } from '../../../../../site/preview/sim.js';
import { raceTimeAt, sampleGraphicData } from '../sampleData';
import type { OGrafTemplateInfo } from '../../../../shared/types/ograf';
import type { DeskTemplate } from '../../../../shared/desk';

function tpl(desk: Partial<DeskTemplate>, properties: Record<string, unknown> = {}): OGrafTemplateInfo {
  return {
    type: 'ograf', manifestPath: '', description: '', uicolor: 0, webplayout: '', directoryName: 'x', setId: 'standard',
    desk: { key: 'k', kind: 'k', label: 'K', short: 'K', params: [], required: [], live: false, ...desk } as DeskTemplate,
    manifest: { id: 'x', name: 'X', main: 'm.js', schema: { type: 'object', properties } } as any,
  };
}

const race = createRace({ seed: 7, firstStart: Date.UTC(2026, 6, 18, 12) });

describe('sample race data for previews', () => {
  it('wraps simulated time to the race start after the end', () => {
    const span = race.end - race.firstStart;
    expect(raceTimeAt(race, 0, span / 20 + 1000, 20)).toBe(race.firstStart + 20_000);
  });
  it('gives a timing graphic results at the finish late in the race', () => {
    const data = sampleGraphicData(tpl({ params: ['class', 'control'], feeds: ['timing'] }), race, race.end - 60_000);
    expect((data.results as unknown[]).length).toBe(12);
    expect(data.className).toBe('D21');
  });
  it('fills the runner for graphics that ask for one', () => {
    const data = sampleGraphicData(tpl({ params: ['runner'], feeds: ['timing'] }), race, race.firstStart + 3 * 60_000);
    expect(data.runnerName).toBe('Simona Aebersold');
  });
  it('uses schema defaults for typed fields', () => {
    const data = sampleGraphicData(tpl({ params: [], feeds: [] }, { headline: { type: 'string', default: 'Jane Doe' } }), race, race.firstStart);
    expect(data.headline).toBe('Jane Doe');
  });
});

import { describe, expect, it } from 'vitest';
import { createRace } from '../../../../../site/preview/sim.js';
import { changeClockSpeed, clockTime, raceTimeAt, sampleGraphicData, startClock } from '../sampleData';
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
  it('starts the preview clock late in the race, at the chosen speed', () => {
    const clock = startClock(20, 1_000_000);
    expect(clock.speed).toBe(20);
    expect(clockTime(race, clock, 1_000_000)).toBe(race.firstStart + 50 * 60_000);
  });
  it('keeps the race at the same moment when the speed changes', () => {
    const clock = startClock(20, 1_000_000);
    const before = clockTime(race, clock, 1_005_000);
    const slower = changeClockSpeed(race, clock, 1, 1_005_000);
    expect(slower.speed).toBe(1);
    expect(clockTime(race, slower, 1_005_000)).toBe(before);
    expect(clockTime(race, slower, 1_006_000)).toBe(before + 1000);
  });
  it('fills empty typed text fields with sample values so the graphic is not blank', () => {
    const t = tpl({ params: [], feeds: [] }, {
      name: { type: 'string', title: 'Name' }, club: { type: 'string' }, title: { type: 'string', title: 'Role' },
      count: { type: 'number' }, kept: { type: 'string', default: '' },
    });
    const data = sampleGraphicData(t, race, race.firstStart);
    expect(data).toMatchObject({ name: 'Tove Alexandersson', club: 'Stora Tuna OK', title: 'Role', kept: '' });
    expect(data.count).toBeUndefined();
  });
  it('leaves typed fields of data graphics empty, so they fall back to their data', () => {
    const t = tpl({ params: ['class'], feeds: ['timing'] }, { title: { type: 'string', title: 'Title' } });
    expect(sampleGraphicData(t, race, race.end - 60_000).title).toBeUndefined();
  });
});

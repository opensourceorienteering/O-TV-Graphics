import { describe, it, expect } from 'vitest';
import { DESK_BEHAVIOURS, DESK_FEEDS, DESK_PARAMS, previewDataForKind } from '../capabilities';
import { DESK_TEMPLATES, canFreeze, deskTemplate, fieldDefaults, hasBehaviour, hasFeed, liveUpdatesDefault } from '../desk';

describe('desk building blocks', () => {
  it('every desk graphic is built from the standard blocks', () => {
    for (const t of DESK_TEMPLATES) {
      for (const p of t.params) expect(DESK_PARAMS, t.key).toContain(p);
      for (const p of t.required) expect(t.params, t.key).toContain(p);
      for (const f of t.feeds ?? []) expect(DESK_FEEDS, t.key).toContain(f);
      for (const b of t.behaviours ?? []) expect(DESK_BEHAVIOURS, t.key).toContain(b);
      // a graphic needs timing data exactly when it reads the timing feed
      expect(t.live, t.key).toBe(hasFeed(t, 'timing'));
      // behaviours that need an input
      if (hasBehaviour(t, 'startControl')) expect(t.params, t.key).toContain('control');
      if (hasBehaviour(t, 'followNextStarter') || hasBehaviour(t, 'freeze')) expect(t.params, t.key).toContain('runner');
      // rows partners point at each other
      if (t.rowsPartner) expect(deskTemplate(t.rowsPartner)?.rowsPartner, t.key).toBe(t.key);
    }
  });

  it('keeps today\'s behaviour', () => {
    expect(liveUpdatesDefault('results')).toBe(false);
    expect(liveUpdatesDefault('podium')).toBe(false);
    expect(liveUpdatesDefault('start-list')).toBe(true);
    const runner = { runnerName: 'A' };
    expect(canFreeze({ key: 'live-feed', values: runner, fields: {} })).toBe(true);
    expect(canFreeze({ key: 'runner-start', values: runner, fields: {} })).toBe(false); // at the start
    expect(canFreeze({ key: 'runner-start', values: { ...runner, controlCode: '31' }, fields: {} })).toBe(true);
    expect(canFreeze({ key: 'runner-identity', values: runner, fields: {} })).toBe(false);
    const settings = { 'start-list': { linkRows: true, fields: {} }, results: { fields: { rowsPerPage: 8 } } };
    expect(fieldDefaults('start-list', settings)).toEqual({ rowsPerPage: 8 });
    expect(hasFeed('weather', 'weather') && hasFeed('course-info', 'course') && hasFeed('event-title', 'event')).toBe(true);
    expect(previewDataForKind('runner-splits')).toBe('splits');
    expect(previewDataForKind('start-group')).toBe('starts');
    expect(previewDataForKind('runner-lower-third')).toBe('results');
    expect(previewDataForKind('weather')).toBeUndefined();
  });
});

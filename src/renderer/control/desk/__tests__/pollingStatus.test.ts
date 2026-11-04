import { describe, expect, it } from 'vitest';
import { summarizePollingStatus } from '../pollingStatus';

describe('summarizePollingStatus', () => {
  it('combines class polls into one source status with its latest poll time', () => {
    const now = 100_000;
    expect(summarizePollingStatus([
      { active: true, sourceId: 'lr', sourceName: 'Liveresultat', apiFlavor: 'rest', className: 'D21', lastPoll: 98_000 },
      { active: true, sourceId: 'lr', sourceName: 'Liveresultat', apiFlavor: 'rest', className: 'H21', lastPoll: 99_000 }
    ], now)).toEqual([{
      sourceId: 'lr',
      sourceName: 'Liveresultat',
      apiFlavor: 'rest',
      lastPoll: 99_000,
      waiting: false,
      stale: false,
      ok: true,
      error: undefined
    }]);
  });

  it('keeps distinct sources separate and surfaces source-level errors without class names', () => {
    const summaries = summarizePollingStatus([
      { active: true, sourceId: 'lr', sourceName: 'Replay', sourceType: 'liveresults', apiFlavor: 'rest', className: 'D21', lastPoll: 99_000, lastError: 'Unavailable' },
      { active: true, sourceId: 'meos', sourceName: 'MeOS', apiFlavor: 'backend', className: 'H21', lastPoll: 99_500 }
    ], 100_000);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ sourceName: 'Replay', sourceType: 'liveresults', apiFlavor: 'rest', ok: false, error: 'Unavailable' });
    expect(summaries[1]).toMatchObject({ sourceName: 'MeOS', ok: true });
    expect(JSON.stringify(summaries)).not.toContain('D21');
  });
});

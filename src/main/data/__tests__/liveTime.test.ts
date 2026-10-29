import { describe, it, expect } from 'vitest';
import { competitionClock, startTimeEpochMs, timeZoneOffsetMs } from '../liveTime';

describe('liveTime', () => {
  it('knows the Stockholm offset in summer and winter', () => {
    expect(timeZoneOffsetMs(Date.UTC(2026, 5, 30, 12), 'Europe/Stockholm')).toBe(2 * 3600_000);
    expect(timeZoneOffsetMs(Date.UTC(2026, 0, 15, 12), 'Europe/Stockholm')).toBe(1 * 3600_000);
  });

  it('defaults to Swedish time plus timediff when no IANA zone is given', () => {
    const clock = competitionClock({ date: '2026-06-30', timezone: '', timediff: 0 })!;
    // 07:00:00 local (start = 420000 cs, as in JWOC 2026 Sprint Relay) = 05:00Z in CEST
    expect(new Date(startTimeEpochMs(clock, 2520000)!).toISOString()).toBe('2026-06-30T05:00:00.000Z');
  });

  it('applies a legacy timediff of +1 hour (e.g. Finland) on top of Swedish time', () => {
    const clock = competitionClock({ date: '2026-10-25', timediff: 1 })!;
    // 25 Oct 2026 is after the DST switch: Stockholm is UTC+1, Finland UTC+2
    // 10:00:00 local Finnish time = 3600000 hundredths
    expect(new Date(startTimeEpochMs(clock, 3600000)!).toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  it('uses an explicit IANA zone and ignores timediff', () => {
    const clock = competitionClock({ date: '2026-07-10', timezone: 'Europe/Rome', timediff: 5 })!;
    expect(clock.timediffHours).toBe(0);
    expect(new Date(startTimeEpochMs(clock, 5400000)!).toISOString()).toBe('2026-07-10T13:00:00.000Z');
  });

  it('handles the DST change day', () => {
    const clock = competitionClock({ date: '2026-03-29', timezone: 'Europe/Stockholm' })!;
    // 10:00 local on the spring-forward day is already CEST (UTC+2)
    expect(new Date(startTimeEpochMs(clock, 3600000)!).toISOString()).toBe('2026-03-29T08:00:00.000Z');
  });

  it('returns undefined for missing or zero start', () => {
    const clock = competitionClock({ date: '2026-06-30' })!;
    expect(startTimeEpochMs(clock, 0)).toBeUndefined();
    expect(startTimeEpochMs(clock, undefined)).toBeUndefined();
    expect(startTimeEpochMs(clock, 'abc')).toBeUndefined();
  });

  it('rejects a missing date', () => {
    expect(competitionClock({ date: '' })).toBeNull();
  });
});

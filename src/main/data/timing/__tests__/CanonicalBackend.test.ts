import { describe, it, expect, vi } from 'vitest';
import type { ClassInfo, Competition, Entry, LatestPassing, TimingSource } from '../../../../shared/timing-sdk';
import { CanonicalBackend, numericCompetitionId, splitCode, STATUS_CODES } from '../CanonicalBackend';
import { LiveResultsClient } from '../../LiveResultsClient';
import { zonedWallTimeToEpochMs } from '../../liveTime';

vi.mock('../../../utils/logger', () => {
  const l = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };
  return { getLogger: () => l, logger: l };
});

const TZ = 'Europe/Stockholm';
/** Wall-clock time on the event day (2026-10-25: the day summer time ends) */
const at = (h: number, m = 0, s = 0) => zonedWallTimeToEpochMs(2026, 10, 25, ((h * 60 + m) * 60 + s) * 1000, TZ);

const competition: Competition = { id: 'autumn-cup', name: 'Autumn Cup', date: '2026-10-25', timezone: TZ, organiser: 'OK Test', ext: { sponsor: 'Acme', weather: 'rain' } };

const classes: ClassInfo[] = [
  {
    id: 'c2', name: 'H21', kind: 'individual', order: 2,
    course: { lengthM: 6200, climbM: 180, controls: 18 },
    radioControls: [{ id: '50', code: 50, name: 'Radio 1' }, { id: '50#2', code: 50, visit: 2 }],
    ext: { weather: 'sun' }
  },
  {
    id: 'c1', name: 'Relay', kind: 'relay', legs: 2, order: 1,
    radioControls: [{ id: '31', code: 31, leg: 1, name: 'Leg 1 radio' }, { id: '32', code: 32, leg: 2, name: 'Leg 2 radio' }]
  }
];

const entries: Record<string, Entry[]> = {
  c2: [
    { id: 'a', classId: 'c2', name: { full: 'Anna A' }, club: { name: 'OK Long Name', short: 'OKL' }, status: 'ok', start: at(10), time: 3_600_000, passings: [{ controlId: '50', time: 600_000 }, { controlId: '50#2', at: at(10, 40) }], ext: { speedKmh: 12.5 } },
    { id: 'b', classId: 'c2', name: { given: 'Bo', family: 'B', full: 'Bo B' }, club: { name: 'IK B' }, status: 'ok', start: at(10, 2), finish: at(10, 52), passings: [{ controlId: '50', time: 500_000 }] },
    { id: 'c', classId: 'c2', name: { full: 'Cia C' }, status: 'ok', ranked: false, start: at(10, 4), time: 3_000_000, passings: [] },
    { id: 'd', classId: 'c2', name: { full: 'Dag D' }, status: 'running', start: at(10, 6), passings: [{ controlId: '50', time: 550_000 }] },
    { id: 'e', classId: 'c2', name: { full: 'Eva E' }, status: 'notCompeting', passings: [] },
    { id: 'f', classId: 'c2', name: { full: 'Fia F' }, status: 'mispunch', start: at(10, 8), time: 2_000_000, passings: [] }
  ],
  c1: [
    { id: 'r1', classId: 'c1', name: { full: 'Leg One' }, status: 'ok', start: at(9), time: 1_800_000, passings: [{ controlId: '31', time: 900_000 }], team: { id: 't1', name: 'Team 1', bib: '7', start: at(9), leg: 1 } },
    { id: 'r2', classId: 'c1', name: { full: 'Leg Two' }, status: 'ok', start: at(9, 30), time: 1_200_000, passings: [{ controlId: '32', time: 600_000 }], team: { id: 't1', name: 'Team 1', bib: '7', start: at(9), leg: 2 } },
    { id: 'r3', classId: 'c1', name: { full: 'Other Two' }, status: 'ok', start: at(9, 35), time: 1_000_000, passings: [], team: { id: 't2', name: 'Team 2', start: at(9), leg: 2, time: 3_100_000 } }
  ]
};

function fakeSource(overrides: Partial<TimingSource> = {}): TimingSource {
  return {
    connect: async () => undefined,
    close: () => undefined,
    competitions: async () => [competition],
    classes: async () => classes,
    entries: async (_c, classId) => entries[classId] ?? [],
    ...overrides
  };
}

describe('CanonicalBackend', () => {
  it('maps every SDK status', () => {
    expect(STATUS_CODES).toMatchObject({ ok: 0, dns: 1, dnf: 2, mispunch: 3, dsq: 4, overtime: 5, notStarted: 9, running: 10, cancelled: 11, okNoTime: 20, notCompeting: null });
  });

  it('numbers split codes by visit and keeps string competition ids stable', () => {
    expect(splitCode({ id: '50' })).toBe(1050);
    expect(splitCode({ id: 'x', code: 50, visit: 2 })).toBe(2050);
    expect(splitCode({ id: 'x', code: 1234, visit: 2 })).toBe(101234);
    expect(numericCompetitionId('42')).toBe(42);
    expect(numericCompetitionId('autumn-cup')).toBe(numericCompetitionId('autumn-cup'));
    expect(numericCompetitionId('autumn-cup')).toBeGreaterThanOrEqual(1_000_000_000);
  });

  it('lists competitions and classes (relays per leg, in the source order)', async () => {
    const b = new CanonicalBackend(fakeSource(), 'test');
    const id = numericCompetitionId('autumn-cup');
    expect(await b.fetchCompetitions()).toEqual([{ id, name: 'Autumn Cup', organizer: 'OK Test', date: '2026-10-25', timediff: 0 }]);
    expect(await b.fetchCompetitionInfo(id)).toMatchObject({ id, timezone: TZ });
    expect((await b.fetchClasses(id)).map(c => c.className)).toEqual(['Relay-1', 'Relay-2', 'H21']);
    await expect(b.fetchClasses(5)).rejects.toThrow('Unknown competition');
  });

  it('ranks individual results, converts times and keeps plugin fields under the plugin id', async () => {
    const b = new CanonicalBackend(fakeSource(), 'test');
    const res = await b.fetchClassResults(numericCompetitionId('autumn-cup'), 'H21');
    expect(res.splitcontrols).toEqual([{ code: 1050, name: 'Radio 1' }, { code: 2050, name: 'Control 50' }]);
    expect(res.course).toEqual({ length: 6200, climb: 180, controls: 18 });
    expect(res.ext).toEqual({ test: { sponsor: 'Acme', weather: 'sun' } });

    const byName = Object.fromEntries(res.results.map(r => [r.name, r]));
    expect(Object.keys(byName)).not.toContain('Eva E'); // notCompeting
    // Bo: finish - start = 50:00 -> first; Anna 60:00 -> second
    expect(byName['Bo B']).toMatchObject({ place: '1', result: '300000', club: 'IK B' });
    expect(byName['Anna A']).toMatchObject({ place: '2', result: '360000', timeplus: '60000', club: 'OKL', ext: { test: { speedKmh: 12.5 } } });
    // Wall clock on the summer-time change day: 10:00 is 36000 s after midnight
    expect(byName['Anna A'].start).toBe(3600000);
    // Passing given as an instant counts from the runner's own start
    expect(byName['Anna A'].splits).toMatchObject({ '1050': 60000, '2050': 240000, '1050_place': 3 });
    expect(byName['Cia C']).toMatchObject({ place: '', status: 0, result: '300000' }); // not ranked
    expect(byName['Dag D']).toMatchObject({ status: 10, result: '' });
    expect(byName['Fia F']).toMatchObject({ status: 3, result: '' });
  });

  it('times relay legs from the team start, with team names and bibs', async () => {
    const b = new CanonicalBackend(fakeSource(), 'test');
    const id = numericCompetitionId('autumn-cup');
    const leg1 = await b.fetchClassResults(id, 'Relay-1');
    expect(leg1.splitcontrols.map(c => c.code)).toEqual([1031]);
    expect(leg1.results).toEqual([expect.objectContaining({ name: 'Leg One', club: 'Team 1', bib: '7', result: '180000', place: '1' })]);

    const leg2 = await b.fetchClassResults(id, 'Relay-2');
    expect(leg2.splitcontrols.map(c => c.code)).toEqual([1032]);
    const two = Object.fromEntries(leg2.results.map(r => [r.name, r]));
    // 30:00 into the race + own 20:00 = 50:00, split 30:00 + 10:00
    expect(two['Leg Two']).toMatchObject({ result: '300000', teamstart: 3240000, start: 3420000, place: '1' });
    expect(two['Leg Two'].splits).toMatchObject({ '1032': 240000 });
    // The source's team time (51:40) wins over start offset + own time
    expect(two['Other Two']).toMatchObject({ result: '310000', place: '2', timeplus: '10000' });
  });

  it('fails clearly for an unknown class', async () => {
    const b = new CanonicalBackend(fakeSource(), 'test');
    await expect(b.fetchClassResults(numericCompetitionId('autumn-cup'), 'Nope')).rejects.toThrow('Class not found: Nope');
  });

  it('turns latest passings into the core passing feed (only when the plugin has them)', async () => {
    expect(new CanonicalBackend(fakeSource(), 'test').fetchLastPassings).toBeUndefined();
    const latest: LatestPassing[] = [
      { entryId: 'r2', classId: 'c1', controlId: '32', at: at(9, 40) },
      { entryId: 'a', classId: 'c2', controlId: '50', at: at(10, 10) }
    ];
    const b = new CanonicalBackend(fakeSource({ passings: async () => latest }), 'test');
    const list = await b.fetchLastPassings!(numericCompetitionId('autumn-cup'), 10);
    expect(list[0]).toMatchObject({ passtime: '09:40:00', runnerName: 'Leg Two', club: 'Team 1', class: 'Relay-2', control: '1032', controlName: 'Leg 2 radio', time: '40:00', place: 1 });
    expect(list[1]).toMatchObject({ runnerName: 'Anna A', class: 'H21', control: '1050', time: '10:00', place: 3 });
  });

  it('refetches polled classes as soon as a push plugin reports a change', async () => {
    let calls = 0;
    const source = fakeSource({ entries: async (_c, classId) => { calls++; return entries[classId] ?? []; } });
    const b = new CanonicalBackend(source, 'test', { minPollIntervalMs: 60_000 });
    const client = new LiveResultsClient({ baseUrl: 'plugin://test', backend: b, cacheInterval: 60_000 });
    const id = numericCompetitionId('autumn-cup');
    await b.fetchClasses(id);
    client.startPolling({ competitionId: id, className: 'Relay-2', interval: 60_000, onUpdate: () => undefined });
    await vi.waitFor(() => expect(calls).toBe(1));
    b.notifyChanged('autumn-cup', 'c1');
    await vi.waitFor(() => expect(calls).toBe(2));
    b.notifyChanged('autumn-cup', 'c2'); // another class: not polled
    await new Promise(r => setTimeout(r, 20));
    expect(calls).toBe(2);
    b.notifyChanged('autumn-cup'); // whole competition
    await vi.waitFor(() => expect(calls).toBe(3));
    client.destroy();
  });
});

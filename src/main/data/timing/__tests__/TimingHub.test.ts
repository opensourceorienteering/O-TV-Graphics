import { describe, it, expect, vi } from 'vitest';
import type { ClassInfo, Competition, Entry, LatestPassing, TimingSource } from '../../../../shared/timing-sdk';
import { TimingHub, numericCompetitionId } from '../TimingHub';
import { splitCode } from '../ranking';
import { STATUS_CODES } from '../model';
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

const hubOf = (source: TimingSource, minPollMs?: number) => new TimingHub(source, { pluginId: 'test', minPollMs });
const ID = numericCompetitionId('autumn-cup');
const by = (rows: any[]) => Object.fromEntries(rows.map(r => [r.name, r]));

describe('TimingHub', () => {
  it('maps every SDK status to the number graphics know', () => {
    expect(STATUS_CODES).toMatchObject({ ok: 0, dns: 1, dnf: 2, mispunch: 3, dsq: 4, overtime: 5, notStarted: 9, running: 10, cancelled: 11, movedUp: 12, okNoTime: 20, notCompeting: null });
  });

  it('numbers control keys by visit and keeps string competition ids stable', () => {
    expect(splitCode({ id: '50' })).toBe(1050);
    expect(splitCode({ id: 'x', code: 50, visit: 2 })).toBe(2050);
    expect(splitCode({ id: 'x', code: 1234, visit: 2 })).toBe(101234);
    expect(numericCompetitionId('42')).toBe(42);
    expect(numericCompetitionId('autumn-cup')).toBe(ID);
    expect(ID).toBeGreaterThanOrEqual(1_000_000_000);
  });

  it('lists competitions and classes (relays per leg, in the source order)', async () => {
    const hub = hubOf(fakeSource());
    expect((await hub.getCompetitions()).data).toEqual([{ id: ID, sourceId: 'autumn-cup', name: 'Autumn Cup', organiser: 'OK Test', date: '2026-10-25', timezone: TZ, timediffHours: 0, ext: competition.ext }]);
    expect(await hub.getCompetitionInfo(ID)).toMatchObject({ id: ID, timezone: TZ });
    expect((await hub.getClasses(ID)).data).toEqual([
      { className: 'Relay-1', classId: 'c1', leg: 1, legs: 2 },
      { className: 'Relay-2', classId: 'c1', leg: 2, legs: 2 },
      { className: 'H21', classId: 'c2' }
    ]);
    await expect(hub.getClasses(5)).rejects.toThrow('Unknown competition');
  });

  it('ranks individual results and keeps plugin fields under the plugin id', async () => {
    const res = (await hubOf(fakeSource()).getClassResults(ID, 'H21')).data;
    expect(res.controls).toEqual([{ key: 1050, id: '50', code: 50, name: 'Radio 1' }, { key: 2050, id: '50#2', code: 50, name: 'Control 50' }]);
    expect(res.course).toEqual({ lengthM: 6200, climbM: 180, controls: 18 });
    expect(res.ext).toEqual({ test: { sponsor: 'Acme', weather: 'sun' } });

    expect(res.rows.map(r => r.name)).toEqual(['Bo B', 'Anna A', 'Dag D', 'Fia F', 'Cia C']); // placed, running, then the rest by result
    const rows = by(res.rows);
    expect(Object.keys(rows)).not.toContain('Eva E'); // notCompeting
    expect(rows['Bo B']).toMatchObject({ place: 1, tied: false, time: 3_000_000, behind: 0, club: 'IK B', progress: 100 });
    expect(rows['Anna A']).toMatchObject({ place: 2, time: 3_600_000, behind: 600_000, club: 'OKL', start: at(10), ext: { test: { speedKmh: 12.5 } } });
    // A passing given as an instant counts from the runner's own start
    expect(rows['Anna A'].splits).toEqual({
      1050: { time: 600_000, status: 0, place: 3, behind: 100_000 },
      2050: { time: 2_400_000, status: 0, place: 1, behind: 0 }
    });
    expect(rows['Cia C']).toMatchObject({ status: 'ok', statusCode: 0, ranked: false, time: 3_000_000 });
    expect(rows['Dag D']).toMatchObject({ statusCode: 10, progress: 33 });
    expect(rows['Fia F']).toMatchObject({ statusCode: 3, progress: 100 });
    // Not placed: out of competition, still running, mispunched; no result unless status ok
    expect([rows['Cia C'].place, rows['Dag D'].place, rows['Fia F'].place, rows['Dag D'].time, rows['Fia F'].time]).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it('times relay legs from the team start, with team names and bibs', async () => {
    const hub = hubOf(fakeSource());
    const leg1 = (await hub.getClassResults(ID, 'Relay-1')).data;
    expect(leg1).toMatchObject({ classId: 'c1', leg: 1 });
    expect(leg1.controls.map(c => c.key)).toEqual([1031]);
    expect(leg1.rows).toEqual([expect.objectContaining({ name: 'Leg One', club: 'Team 1', bib: '7', time: 1_800_000, place: 1 })]);

    const leg2 = (await hub.getClassResults(ID, 'Relay-2')).data;
    expect(leg2.controls.map(c => c.key)).toEqual([1032]);
    const two = by(leg2.rows);
    // 30:00 into the race + own 20:00 = 50:00; split 30:00 + 10:00
    expect(two['Leg Two']).toMatchObject({ time: 3_000_000, teamStart: at(9), start: at(9, 30), place: 1, team: { id: 't1', name: 'Team 1', bib: '7', leg: 2 } });
    expect(two['Leg Two'].splits[1032]).toMatchObject({ time: 2_400_000 });
    // The source's team time (51:40) wins over start offset + own time
    expect(two['Other Two']).toMatchObject({ time: 3_100_000, place: 2, behind: 100_000 });
  });

  it('asks a source for one competition, and falls back to its list when that fails', async () => {
    const numeric = { ...competition, id: '42' };
    const one = vi.fn(async () => numeric);
    const list = vi.fn(async () => [numeric]);
    const hub = hubOf(fakeSource({ competition: one, competitions: list }));
    expect(await hub.getCompetitionInfo(42)).toMatchObject({ id: 42, name: 'Autumn Cup' });
    expect(one).toHaveBeenCalledWith('42');
    expect(list).not.toHaveBeenCalled();
    const failing = hubOf(fakeSource({ competition: async () => { throw new Error('404'); }, competitions: list }));
    expect(await failing.getCompetitionInfo(42)).toMatchObject({ name: 'Autumn Cup' });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('fails clearly for an unknown class', async () => {
    await expect(hubOf(fakeSource()).getClassResults(ID, 'Nope')).rejects.toThrow('Class not found: Nope');
  });

  it('keeps a source\'s own standings and order when it publishes them', async () => {
    const standings: Entry[] = [
      { id: 'x', classId: 'c2', name: { full: 'Second' }, status: 'ok', time: 3_700_000, passings: [{ controlId: '50', time: 500_000, standing: { place: 2, behind: 10_000 } }], standing: { place: 2, behind: 100_000, progress: 100 } },
      { id: 'y', classId: 'c2', name: { full: 'First' }, status: 'ok', time: 3_600_000, passings: [], standing: { place: 1, behind: 0, progress: 100 } },
      { id: 'z', classId: 'c2', name: { full: 'Tied' }, status: 'ok', time: 3_700_000, passings: [], standing: { place: 2, tied: true, behind: 100_000, progress: 100 } },
      { id: 'w', classId: 'c2', name: { full: 'Out' }, status: 'dns', time: 0, passings: [{ controlId: '50', time: 100_000, standing: { status: 'dns' } }], standing: { progress: 0 } }
    ];
    const res = (await hubOf(fakeSource({ entries: async () => standings })).getClassResults(ID, 'H21')).data;
    expect(res.rows.map(r => [r.name, r.place, r.tied, r.behind, r.time])).toEqual([
      ['Second', 2, false, 100_000, 3_700_000],
      ['First', 1, false, 0, 3_600_000],
      ['Tied', 2, true, 100_000, 3_700_000],
      ['Out', undefined, false, undefined, 0] // a time the source gives as 0 is kept
    ]);
    expect(res.rows[0].splits[1050]).toEqual({ time: 500_000, status: 0, place: 2, behind: 10_000 });
    expect(res.rows[3].splits[1050]).toEqual({ time: 100_000, status: 1 });
  });

  it('turns latest passings into the passings feed (only when the source has them)', async () => {
    expect((await hubOf(fakeSource()).getLastPassings(ID)).data).toEqual([]);
    const latest: LatestPassing[] = [
      { entryId: 'r2', classId: 'c1', controlId: '32', at: at(9, 40) },
      { entryId: 'a', classId: 'c2', controlId: '50', at: at(10, 10) }
    ];
    const hub = hubOf(fakeSource({ passings: async () => latest }));
    const list = (await hub.getLastPassings(ID, 10)).data;
    expect(list[0]).toMatchObject({ at: at(9, 40), name: 'Leg Two', club: 'Team 1', className: 'Relay-2', controlKey: 1032, controlName: 'Leg 2 radio', time: 2_400_000, place: 1 });
    expect(list[1]).toMatchObject({ name: 'Anna A', className: 'H21', controlKey: 1050, time: 600_000, place: 3 });
  });

  it('shares one source request between graphics asking for the same class', async () => {
    let calls = 0;
    const hub = hubOf(fakeSource({ entries: async (_c, classId) => { calls++; return entries[classId] ?? []; } }));
    await Promise.all([hub.getClassResults(ID, 'Relay-1'), hub.getClassResults(ID, 'Relay-2'), hub.getClassResults(ID, 'Relay-2')]);
    expect(calls).toBe(1);
    await hub.getClassResults(ID, 'Relay-2', { maxAgeMs: 5000 }); // reuses the last result
    expect(calls).toBe(1);
  });

  it('refetches polled classes as soon as a push source reports a change', async () => {
    let calls = 0;
    const watched: string[][] = [];
    const source = fakeSource({
      entries: async (_c, classId) => { calls++; return entries[classId] ?? []; },
      watch: (_c, ids) => { watched.push(ids); }
    });
    const hub = hubOf(source, 60_000);
    await hub.getClasses(ID);
    hub.startPolling({ competitionId: ID, className: 'Relay-2', interval: 60_000, onUpdate: () => undefined });
    await vi.waitFor(() => expect(calls).toBe(1));
    await vi.waitFor(() => expect(watched.at(-1)).toEqual(['c1']));
    hub.notifyChanged('autumn-cup', 'c1');
    await vi.waitFor(() => expect(calls).toBe(2));
    hub.notifyChanged('autumn-cup', 'c2'); // another class: not polled
    await new Promise(r => setTimeout(r, 20));
    expect(calls).toBe(2);
    hub.notifyChanged('autumn-cup'); // whole competition
    await vi.waitFor(() => expect(calls).toBe(3));
    hub.destroy();
    expect(watched.at(-1)).toEqual([]);
  });
});

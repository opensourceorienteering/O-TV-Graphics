/**
 * The Trace / Track plugin against a stand-in for its data API (fakeTraceTrack.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../../utils/logger', () => {
  const l = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };
  return { getLogger: () => l, logger: l };
});

import fs from 'fs';
import path from 'path';
import { TraceTrackSource, TRACE_TRACK_FIELDS, runnerFields, type TraceTrackOptions } from '../TraceTrackSource';
import { TimingHub, numericCompetitionId } from '../../TimingHub';
import { traceTrackPlugin } from '../../builtInPlugins';
import { PluginDataSource } from '../../PluginDataSource';
import { fakeTraceTrack, sampleRunners, type FakeTraceTrack } from './fakeTraceTrack';

const EVENT = 'ev-1';
const KEY = 'ttr_test-key';
const ID = numericCompetitionId(EVENT);
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('Trace / Track plugin', () => {
  let tt: FakeTraceTrack;
  const sources: TraceTrackSource[] = [];
  const make = (opts: Partial<TraceTrackOptions> = {}, changed = vi.fn()) => {
    const source = new TraceTrackSource({ url: tt.url, eventId: EVENT, key: KEY, push: false, ...opts }, { log, changed, fetch, mysql: async () => { throw new Error('no'); } } as any);
    sources.push(source);
    return { source, hub: new TimingHub(source, { pluginId: 'trace-track', minPollMs: 1000 }), changed };
  };

  beforeEach(async () => {
    tt = await fakeTraceTrack({ eventId: EVENT, key: KEY, runners: sampleRunners(), otherEvents: { ttr_other: 'ev-2' } });
  });
  afterEach(async () => {
    for (const s of sources.splice(0)) s.close();
    await tt.close();
  });

  it('turns runners into fields under the plugin, leaving out what Trace / Track does not have', async () => {
    const { hub } = make();
    expect((await hub.getCompetitions()).data[0]).toMatchObject({ id: ID, sourceId: EVENT, name: `Trace / Track ${EVENT}` });
    expect((await hub.getClasses(ID)).data.map(c => c.className)).toEqual(['W21', 'Relay']);

    const w21 = (await hub.getClassResults(ID, 'W21')).data.rows;
    const anna = w21.find(r => r.name === 'Anna Lind')!;
    expect(anna).toMatchObject({ club: 'OK Linné', bib: '101' });
    expect(anna.ext!['trace-track']).toEqual({
      heartRate: 172, maxHeartRate: 188, averageHeartRate: 165, speed: 3.92, speedKmh: 14.1, pace: 255, paceText: '4:15',
      heading: 41, lat: 59.3011, lon: 18.0402, positionTime: 1793529989000, signal: 'live', signalAge: 1, battery: 71, accuracy: 4,
      onProgram: true, lowerThird: true, color: '#e5484d', time: 1793529990000
    });
    // No position and no metrics yet: only what is known
    expect(w21.find(r => r.name === 'Bo Ek')!.ext!['trace-track']).toEqual({ signal: 'none', onProgram: false, lowerThird: false, color: '#3e63dd', time: 1793529990000 });

    // Relays: the team is the club and its bib the runner's, as in the timing source's relay rows
    const cia = (await hub.getClassResults(ID, 'Relay')).data.rows[0];
    expect(cia).toMatchObject({ name: 'Cia Berg', club: 'OK Ravinen 1', bib: '7' });
    expect(cia.ext!['trace-track']).toMatchObject({ speed: 0, speedKmh: 0, signal: 'lost', battery: 15 });
    expect(cia.ext!['trace-track']).not.toHaveProperty('paceText');

    // The key goes in the Authorization header, never in the address
    expect(tt.requests.every(r => r.auth === `Bearer ${KEY}` && !r.query.has('key'))).toBe(true);
    expect(tt.requests[0].query.get('timeline')).toBe('program');
  });

  it('asks once for every class while the data is fresh', async () => {
    const { hub } = make();
    await hub.getClassResults(ID, 'W21');
    await hub.getClassResults(ID, 'Relay');
    expect(tt.requests.filter(r => r.path.endsWith('/runners'))).toHaveLength(1);
  });

  it('explains a wrong key, another event\'s key and an unknown event', async () => {
    await expect(make({ key: 'ttr_nope' }).source.connect()).rejects.toThrow('refused the read key');
    await expect(make({ key: 'ttr_other' }).source.connect()).rejects.toThrow('for another event');
    await expect(make({ eventId: 'ev-9', key: 'ttr_other' }).source.connect()).rejects.toThrow('for another event');
    await expect(make({ key: '' }).source.connect()).rejects.toThrow('read key');
  });

  it('adds the experimental virtual standings only when switched on', async () => {
    tt.standings = {
      w21: [{
        id: 'r-12', rank: 2, gap: 12000, comparisonFieldSize: 8,
        progress: { state: 'tracking', lastControl: 3, nextControl: 4, percent: 41.5 },
        pacing: { current: 250, recent: 262, previous: 270, change: -8, leg: 258 },
        arrival: { controlIndex: 4, time: 1793530040000, remaining: 50000 },
        mistakes: [{ leg: 1, lost: 25000 }, { leg: 2, lost: 31000 }]
      }]
    };
    const off = make();
    await off.hub.getClassResults(ID, 'W21');
    expect(tt.requests.some(r => r.path.includes('virtual-standings'))).toBe(false);

    const on = make({ virtualStandings: true, timeline: 'live' });
    const anna = (await on.hub.getClassResults(ID, 'W21')).data.rows.find(r => r.name === 'Anna Lind')!;
    expect(anna.ext!['trace-track']).toMatchObject({
      virtualRank: 2, virtualGap: 12000, virtualFieldSize: 8, progressPercent: 41.5, progressState: 'tracking',
      lastControl: 3, nextControl: 4, arrivalTime: 1793530040000, arrivalIn: 50000, paceRecent: 262, paceChange: -8, legPace: 258, timeLost: 56000,
      heartRate: 172
    });
    expect(tt.requests.find(r => r.path.endsWith('/classes/w21/virtual-standings'))!.query.get('timeline')).toBe('live');
    // ranked where each runner is now (the GPS tower's who-is-fastest-now), not at one common point
    expect(tt.requests.find(r => r.path.endsWith('/classes/w21/virtual-standings'))!.query.get('comparison')).toBe('own-point');

    // Standings failing: the runner metrics still go out
    tt.failStandings = true;
    const again = make({ virtualStandings: true });
    const row = (await again.hub.getClassResults(ID, 'W21')).data.rows.find(r => r.name === 'Anna Lind')!;
    expect(row.ext!['trace-track']).toMatchObject({ heartRate: 172 });
    expect(row.ext!['trace-track']).not.toHaveProperty('virtualRank');
  });

  it('follows the stream: new values refresh the data and wake the graphics, without asking again', async () => {
    const { source, hub, changed } = make({ push: true, pollIntervalMs: 60_000 });
    await hub.getClassResults(ID, 'W21');
    source.watch(EVENT, ['w21']);
    await vi.waitFor(() => expect(tt.openStreams()).toBe(1));
    const stream = tt.requests.find(r => r.path.endsWith('/stream'))!;
    expect(stream.query.get('interval')).toBe('10');
    expect(stream.auth).toBe(`Bearer ${KEY}`);
    expect(hub.isPushConnected(ID)).toBe(true);

    const before = tt.requests.filter(r => r.path.endsWith('/runners')).length;
    tt.runners[0].heartRate = 180;
    tt.push();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(EVENT));
    const anna = (await hub.getClassResults(ID, 'W21')).data.rows.find(r => r.name === 'Anna Lind')!;
    expect(anna.ext!['trace-track'].heartRate).toBe(180);
    expect(tt.requests.filter(r => r.path.endsWith('/runners')).length).toBe(before); // the stream carried it

    // Dropped: it comes back by itself
    tt.dropStreams();
    await vi.waitFor(() => expect(tt.openStreams()).toBe(1), { timeout: 4000 });

    // Nothing polled any more: the stream closes
    source.watch(EVENT, []);
    await vi.waitFor(() => expect(tt.openStreams()).toBe(0));
  });

  it('stops for good when the key is revoked', async () => {
    const { source } = make({ push: true });
    source.watch(EVENT, ['w21']);
    await vi.waitFor(() => expect(tt.openStreams()).toBe(1));
    const streams = () => tt.requests.filter(r => r.path.endsWith('/stream')).length;
    tt.revoke();
    await new Promise(r => setTimeout(r, 1500));
    expect(streams()).toBe(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('read key was revoked'));
  });

  it('is a built-in data source type with a settings form', async () => {
    const schema = traceTrackPlugin.manifest.configSchema!;
    expect(schema.required).toEqual(['url', 'eventId', 'key']);
    expect(schema.properties.key.format).toBe('password');
    expect(traceTrackPlugin.manifest.extFields!.map(f => f.key)).toEqual(expect.arrayContaining(['heartRate', 'paceText', 'virtualRank']));
    const ds = new PluginDataSource(traceTrackPlugin, { id: 'tt', name: 'GPS', type: 'trace-track', enabled: true, config: { url: tt.url, eventId: EVENT, key: KEY, push: false } });
    await ds.initialize();
    expect((await ds.getClasses(ID)).map(c => c.className)).toEqual(['W21', 'Relay']);
    ds.destroy();
    await expect(new PluginDataSource(traceTrackPlugin, { id: 'x', name: 'x', type: 'trace-track', enabled: true, config: { eventId: EVENT } }).initialize())
      .rejects.toThrow('Setting "Read key" is required');
  });

  it('leaves out values that are not numbers', () => {
    expect(runnerFields({ id: 'a', name: 'A', classId: 'c', speed: NaN, pace: null, heartRate: undefined as any })).toEqual({});
  });

  it('documents every field in docs/TRACE-TRACK.md', () => {
    const doc = fs.readFileSync(path.resolve(__dirname, '../../../../../../docs/TRACE-TRACK.md'), 'utf8');
    expect(TRACE_TRACK_FIELDS.filter(f => !doc.includes(`| \`${f.key}\` |`)).map(f => f.key)).toEqual([]);
  });
});

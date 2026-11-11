/**
 * The data source every timing plugin is wrapped in: the data source API the settings screens
 * use (competitions, classes, results), polling and clean-up.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../utils/logger', () => {
  const l = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };
  return { getLogger: () => l, logger: l };
});

import { PluginDataSource } from '../PluginDataSource';
import type { Entry, TimingPlugin, TimingSource } from '../../../../shared/timing-sdk';

const entries: Entry[] = [
  { id: '1', classId: 'H21', name: { full: 'Anna' }, club: { name: 'OK A' }, status: 'ok', time: 3_600_000, passings: [], standing: { place: 1, progress: 100 } },
  { id: '2', classId: 'H21', name: { full: 'Bo' }, club: { name: 'OK B' }, status: 'ok', time: 3_600_000, passings: [], standing: { place: 1, tied: true, progress: 100 } },
  { id: '3', classId: 'H21', name: { full: 'Cia' }, club: { name: 'OK C' }, status: 'dns', time: 0, passings: [], standing: { progress: 0 } },
  { id: '4', classId: 'H21', name: { full: 'Dag' }, club: { name: 'OK D' }, status: 'running', passings: [], standing: { progress: 50 } }
];

function plugin(overrides: Partial<TimingSource> = {}) {
  const source: TimingSource & { closed: number } = {
    closed: 0,
    connect: vi.fn(async () => undefined),
    close() { source.closed++; },
    competitions: vi.fn(async () => [{ id: '1', name: 'Test Competition', date: '2026-06-01', organiser: 'OK' }]),
    classes: vi.fn(async () => [{ id: 'H21', name: 'H21', kind: 'individual' as const, radioControls: [] }]),
    entries: vi.fn(async () => entries),
    ...overrides
  };
  const p: TimingPlugin = {
    manifest: {
      id: 'fake', name: 'Fake', version: '1.0.0', sdk: '^1.0',
      configSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string', title: 'Address' }, pollIntervalMs: { type: 'integer', default: 3000 } } },
      capabilities: { minPollMs: 1000 }
    },
    create: vi.fn(() => source)
  };
  return { p, source };
}

const config = (c: Record<string, unknown> = { url: 'x' }) => ({ id: 'src', name: 'Source', type: 'fake', enabled: true, config: c });

describe('PluginDataSource', () => {
  it('creates the source with defaults filled in, without connecting', () => {
    const { p } = plugin();
    const ds = new PluginDataSource(p, config());
    expect(ds.initialized).toBe(false);
    expect(p.create).toHaveBeenCalledWith({ url: 'x', pollIntervalMs: 3000 }, expect.anything());
    expect(ds.getClient().pollInterval()).toBe(3000);
  });

  it('connects on initialize, and reports a connection failure', async () => {
    const { p, source } = plugin();
    const ds = new PluginDataSource(p, config());
    await ds.initialize();
    expect(ds.initialized).toBe(true);
    expect(source.connect).toHaveBeenCalledTimes(1);

    const failing = plugin({ connect: async () => { throw new Error('Could not reach it: check the address'); } });
    await expect(new PluginDataSource(failing.p, config()).initialize()).rejects.toThrow('check the address');
    await expect(new PluginDataSource(p, config({})).initialize()).rejects.toThrow('Setting "Address" is required');
  });

  it('refuses queries before initialization', async () => {
    const ds = new PluginDataSource(plugin().p, config());
    await expect(ds.getCompetitions()).rejects.toThrow('not initialized');
  });

  it('lists competitions, classes and results in the data source API shape', async () => {
    const ds = new PluginDataSource(plugin().p, config());
    await ds.initialize();
    expect(await ds.getCompetitions()).toEqual([{ id: 1, name: 'Test Competition', organizer: 'OK', date: '2026-06-01' }]);
    expect(await ds.getClasses(1)).toEqual([{ className: 'H21', displayName: 'H21', numberOfEntries: 0 }]);
    expect(await ds.getResults(1, 'H21')).toEqual([
      { place: 1, name: 'Anna', club: 'OK A', time: '360000', status: '0' },
      { place: undefined, name: 'Bo', club: 'OK B', time: '360000', status: '0' }, // a tie has no place of its own
      { place: undefined, name: 'Cia', club: 'OK C', time: '0', status: '1' },
      { place: undefined, name: 'Dag', club: 'OK D', time: '', status: '10' }
    ]);
  });

  it('passes source errors on', async () => {
    const ds = new PluginDataSource(plugin({ entries: async () => { throw new Error('API down'); } }).p, config());
    await ds.initialize();
    await expect(ds.getResults(1, 'H21')).rejects.toThrow('API down');
    await expect(ds.getResults(1, 'Nope')).rejects.toThrow('Class not found');
  });

  it('polls through its hub', async () => {
    const ds = new PluginDataSource(plugin().p, config());
    await ds.initialize();
    expect(ds.supportsRealTime()).toBe(true);
    const start = vi.spyOn(ds.getClient(), 'startPolling');
    const stop = vi.spyOn(ds.getClient(), 'stopPolling');
    ds.startPolling(1, 'H21', 5000);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ competitionId: 1, className: 'H21', interval: 5000 }));
    ds.stopPolling(1, 'H21');
    expect(stop).toHaveBeenCalledWith('1_H21');
    ds.destroy();
  });

  it('closes the source on destroy, safely more than once and before initialization', async () => {
    const { p, source } = plugin();
    const ds = new PluginDataSource(p, config());
    ds.destroy();
    await ds.initialize();
    ds.destroy();
    ds.destroy();
    expect(source.closed).toBe(3);
    expect(ds.initialized).toBe(false);
  });
});

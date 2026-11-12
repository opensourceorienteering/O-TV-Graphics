/**
 * Loading the plugins folder: the documented examples (docs/timing-plugins/examples), plus
 * plugins that must be refused with a clear reason.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../../utils/logger', () => {
  const l = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };
  return { getLogger: () => l, logger: l };
});

import { getDataSourceRegistry } from '../../DataSourceRegistry';
import { registerBuiltInDataSources } from '../../sources';
import { listTimingPlugins, loadTimingPlugins, resetTimingPlugins, sdkCompatible } from '../TimingPlugins';
import { numericCompetitionId } from '../TimingHub';
import { PluginDataSource, applyConfigSchema } from '../PluginDataSource';

const EXAMPLES = path.resolve(__dirname, '../../../../../docs/timing-plugins/examples');

function write(dir: string, rel: string, content: string) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const plugin = (manifest: object) => `module.exports = { manifest: ${JSON.stringify(manifest)}, create() { return {}; } };`;

describe('timing plugins folder', () => {
  let dir: string;

  beforeEach(() => {
    getDataSourceRegistry().clear();
    resetTimingPlugins();
    registerBuiltInDataSources();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-plugins-'));
    fs.cpSync(path.join(EXAMPLES, 'json-file'), path.join(dir, 'json-file'), { recursive: true });
    fs.copyFileSync(path.join(EXAMPLES, 'simple-club-db.yaml'), path.join(dir, 'simple-club-db.yaml'));
    write(dir, 'notes.txt', 'not a plugin');
    write(dir, 'empty-folder/README.md', 'not a plugin either');
    write(dir, 'throws/index.js', "throw new Error('boom at load');");
    write(dir, 'future/index.js', plugin({ id: 'future', name: 'Future', version: '1.0.0', sdk: '^2.0' }));
    write(dir, 'takes-builtin/index.js', plugin({ id: 'meos', name: 'Fake MeOS', version: '1.0.0', sdk: '^1.0' }));
    write(dir, 'takes-liveresults.yaml', 'id: liveresults\nname: x\nqueries: { competitions: SELECT 1, classes: SELECT 1, entries: SELECT 1 }');
    write(dir, 'writes.yaml', 'id: writer\nname: x\nqueries: { competitions: SELECT 1, classes: SELECT 1, entries: UPDATE t SET a = 1 }');
    write(dir, 'pkg/package.json', JSON.stringify({ main: 'lib/main.js' }));
    write(dir, 'pkg/lib/main.js', `module.exports.default = ${plugin({ id: 'pkg-main', name: 'From package.json', version: '0.1.0', sdk: '1.x' }).replace('module.exports = ', '').replace(/;$/, '')};`);
  });

  afterEach(() => {
    for (const ds of getDataSourceRegistry().getAll()) ds.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('checks the SDK major version', () => {
    expect(sdkCompatible('^1.0')).toBe(true);
    expect(sdkCompatible('1.x')).toBe(true);
    expect(sdkCompatible('>=1.2')).toBe(true);
    expect(sdkCompatible('^2.0')).toBe(false);
    expect(sdkCompatible('')).toBe(false);
  });

  it('loads code plugins and SQL profiles, and reports the ones it refuses', () => {
    const list = loadTimingPlugins(dir);
    expect(list.folder).toBe(dir);
    const external = list.plugins.filter(p => p.kind !== 'builtin');
    expect(external.map(p => [p.id, p.kind]).sort()).toEqual([['club-db', 'sql-profile'], ['json-file', 'code'], ['pkg-main', 'code']]);
    expect(list.plugins.filter(p => p.kind === 'builtin').map(p => p.id)).toEqual(['liveresults', 'meos', 'mysql', 'iofxml', 'trace-track']);

    const reasons = Object.fromEntries(list.failures.map(f => [path.basename(path.dirname(f.path)) === path.basename(dir) ? path.basename(f.path) : path.basename(path.dirname(f.path)) || f.path, f.error]));
    expect(Object.keys(reasons).sort()).toEqual(['future', 'takes-builtin', 'takes-liveresults.yaml', 'throws', 'writes.yaml'].sort());
    expect(reasons.throws).toContain('boom at load');
    expect(reasons.future).toContain('needs timing SDK ^2.0');
    expect(reasons['takes-builtin']).toContain('taken by a source built into Split Control');
    expect(reasons['takes-liveresults.yaml']).toContain('taken by a source built into Split Control');
    expect(reasons['writes.yaml']).toContain('only SELECT');

    // Every plugin is a data source type with its settings form and extra fields
    const types = getDataSourceRegistry().getRegisteredTypeInfo();
    const json = types.find(t => t.type === 'json-file')!;
    expect(json).toMatchObject({ kind: 'code', displayName: 'JSON file (example)', extFields: [expect.objectContaining({ key: 'heartRate' })] });
    expect(json.configSchema!.required).toEqual(['filePath']);
    const club = types.find(t => t.type === 'club-db')!;
    expect(club.kind).toBe('sql-profile');
    expect(Object.keys(club.configSchema!.properties)).toEqual(expect.arrayContaining(['host', 'database', 'season']));
    expect(types.find(t => t.type === 'liveresults')!.kind).toBe('builtin');
  });

  it('reloading forgets plugins that were removed', () => {
    loadTimingPlugins(dir);
    fs.rmSync(path.join(dir, 'simple-club-db.yaml'));
    const list = loadTimingPlugins(dir);
    expect(list.plugins.map(p => p.id)).not.toContain('club-db');
    expect(getDataSourceRegistry().isRegistered('club-db')).toBe(false);
    expect(getDataSourceRegistry().isRegistered('json-file')).toBe(true);
    expect(listTimingPlugins().plugins.map(p => p.id)).toContain('json-file');
  });

  it('runs the example JSON plugin end to end, including its extra field and push', async () => {
    loadTimingPlugins(dir);
    const sample = path.join(dir, 'data.json');
    fs.copyFileSync(path.join(EXAMPLES, 'json-file/sample.json'), sample);
    const ds = await getDataSourceRegistry().create({ id: 'demo', name: 'Demo', type: 'json-file', enabled: true, config: { filePath: sample } });
    expect(ds).toBeInstanceOf(PluginDataSource);
    const client = (ds as PluginDataSource).getClient();
    const id = numericCompetitionId('demo-2026');

    expect((await client.getCompetitions()).data[0]).toMatchObject({ id, name: 'Demo Sprint' });
    const res = (await client.getClassResults(id, 'W21')).data;
    expect(res.course).toEqual({ lengthM: 3100, climbM: 45, controls: 22 });
    expect(res.rows[0]).toMatchObject({ name: 'Ada Ek', place: 1, time: 912_000, start: Date.UTC(2026, 5, 1, 8, 0, 0), bib: '101', ext: { 'json-file': { heartRate: 182 } } });
    expect(res.rows[0].splits[1100]).toMatchObject({ time: 401_000, place: 2 });
    expect(res.rows[1]).toMatchObject({ name: 'Bea Ny', statusCode: 10 });

    // Push: rewriting the file refetches the polled class before the next poll
    const updates: any[] = [];
    let polls = 0;
    client.startPolling({ competitionId: id, className: 'W21', interval: 60_000, onUpdate: d => updates.push(d), onPoll: () => { polls++; } });
    await vi.waitFor(() => expect(polls).toBe(1));
    const data = JSON.parse(fs.readFileSync(sample, 'utf8'));
    data.entries[1].status = 'ok';
    data.entries[1].time = 900000;
    fs.writeFileSync(sample, JSON.stringify(data));
    await vi.waitFor(() => expect(updates.at(-1).rows[0]).toMatchObject({ name: 'Bea Ny', place: 1 }), { timeout: 3000 });
  });

  it('names the missing setting when a source is not configured', async () => {
    loadTimingPlugins(dir);
    const ds = await getDataSourceRegistry().create({ id: 'x', name: 'X', type: 'json-file', enabled: true, config: {} }, false);
    await expect(ds.initialize()).rejects.toThrow('Setting "JSON file" is required');
    expect(applyConfigSchema({ type: 'object', properties: { n: { type: 'integer', default: 5 } } }, { n: '7' })).toEqual({ n: 7 });
    expect(applyConfigSchema({ type: 'object', properties: { n: { type: 'integer', default: 5 } } }, {})).toEqual({ n: 5 });
  });
});

/**
 * Golden snapshots of what every built-in timing source gives the rest of Split Control:
 * template data (base tags) per class, per radio control, start and finish, relay legs and
 * the all-classes scope; the data source API the settings screens use; start lists, radio
 * controls, Director start alerts and course facts.
 *
 * The goldens were recorded before the core stopped using the Liveresultat format inside
 * (test-data/timing-snapshots). They must not change unless a change is intended:
 *
 *   UPDATE_TIMING_SNAPSHOTS=1 npx vitest run src/main/data/timing/__tests__/timingSnapshots.test.ts
 *
 * On a mismatch the expected and actual output are written to test-data/timing-snapshots/.diff/.
 *
 * Fixtures: two recorded Liveresultat races (test-data/liveresultat, served by a local REST
 * server), the real MeOS MOP database dump (SQLite), an IOF XML result list and MeOS
 * information server XML.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import http from 'http';
import zlib from 'zlib';
import type { AddressInfo } from 'net';
import { DatabaseSync } from 'node:sqlite';

vi.mock('../../../utils/logger', () => {
  const l = { info: () => undefined, debug: () => undefined, warn: () => undefined, error: () => undefined };
  return { getLogger: () => l, logger: l };
});

import { getDataSourceRegistry } from '../../DataSourceRegistry';
import { registerBuiltInDataSources } from '../../sources';
import { registerTimingPlugin, resetTimingPlugins } from '../TimingPlugins';
import { DataSourceFieldMapper } from '../../DataSourceFieldMapper';
import { getDataStore, initDataStore } from '../../DataStore';
import { parseSqlProfile } from '../sql/SqlProfile';
import { createSqlProfileSource } from '../sql/SqlProfileSource';
import { bindNamed } from '../sql/sqlText';
import { startListFromSource, startListFromIofXml } from '../../../events/EventService';
import { courseFields } from '../../../events/Desk';
import { timingControls } from '../../timingScope';
import { directorStarts } from '../../../output/DirectorApi';
import type { IDataSource } from '../../../../shared/types/dataSource';
import type { TimingPlugin } from '../../../../shared/timing-sdk';

const ROOT = path.resolve(__dirname, '../../../../..');
const GOLDEN = path.join(ROOT, 'test-data/timing-snapshots');
const UPDATE = process.env.UPDATE_TIMING_SNAPSHOTS === '1';
const IOF_FILE = path.join(ROOT, 'test-data/iofxml/resultlist-course.xml'); // the result list with course facts on H21

const RESULTS = { version: '1.0', mode: 'api', api: { provider: 'liveresults', fieldMappings: [{ templateField: 'results', apiPath: 'results' }] } } as any;
const RELAY = { version: '1.0', mode: 'api', api: { provider: 'liveresults', fieldMappings: [{ templateField: 'results', apiPath: 'results' }, { templateField: 'relayLegs', apiPath: 'relayLegs' }] } } as any;
const ALL_CLASSES = { version: '1.0', mode: 'api', api: { provider: 'liveresults', classScope: 'optional', fieldMappings: [{ templateField: 'results', apiPath: 'results' }] } } as any;

/** Values that depend on when the test runs */
const VOLATILE = new Set(['dataTimestamp', 'timestamp', 'clockOffsetMs']);
function normalize(v: any): any {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const k of Object.keys(v)) if (!VOLATILE.has(k) && v[k] !== undefined) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try { return await fn(); } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

const project = (sourceId: string, competitionId: number, timeZone?: string) =>
  ({ id: 'snapshot', name: 'Snapshot', dataSource: { sourceId, competitionId }, info: timeZone ? { timeZone } : {} }) as any;

async function capture(sourceId: string, competitionIds: number[], opts: { timeZone?: string } = {}) {
  const ds = getDataSourceRegistry().get(sourceId) as IDataSource & { getClient(): any };
  if (!ds.initialized) await ds.initialize();
  const client = ds.getClient();
  const out: Record<string, any> = { competitions: await ds.getCompetitions() };
  for (const comp of competitionIds) {
    const c: Record<string, any> = { classes: await ds.getClasses(comp), byClass: {} };
    for (const { className } of c.classes) {
      const values = { className };
      const base = await DataSourceFieldMapper.fetchAndMapData(RESULTS, comp, values, {}, sourceId);
      const k: Record<string, any> = {
        dataSourceResults: await ds.getResults(comp, className),
        mapped: base,
        atControl: {},
        start: await DataSourceFieldMapper.fetchAndMapData(RESULTS, comp, { className, controlCode: 'Start' }, {}, sourceId),
        finish: await DataSourceFieldMapper.fetchAndMapData(RESULTS, comp, { className, controlCode: 'F' }, {}, sourceId),
        director: await directorStarts(client, comp, className, new Set()),
        course: await courseFields(project(sourceId, comp), className)
      };
      for (const control of base.splitControls ?? []) {
        k.atControl[control.code] = await DataSourceFieldMapper.fetchAndMapData(RESULTS, comp, { className, controlCode: String(control.code) }, {}, sourceId);
      }
      if (/-\d+$/.test(className)) {
        // the relay line-up of the first and the last team on this leg
        const rows = base.results ?? [];
        k.relay = [];
        for (const r of [rows[0], rows[rows.length - 1]].filter(Boolean)) {
          k.relay.push(await DataSourceFieldMapper.fetchAndMapData(RELAY, comp, { className, runnerName: r.name, runnerClub: r.club }, {}, sourceId));
        }
      }
      c.byClass[className] = k;
    }
    c.allClasses = await attempt(() => DataSourceFieldMapper.fetchAndMapData(ALL_CLASSES, comp, {}, {}, sourceId));
    c.startList = await attempt(() => startListFromSource(project(sourceId, comp, opts.timeZone)));
    c.controls = await attempt(() => timingControls(client, comp));
    out[`competition ${comp}`] = c;
  }
  return normalize(out);
}

/** Paths where two values differ (first few) */
function differences(a: any, b: any, at = '', out: string[] = []): string[] {
  if (out.length >= 15) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) differences(a[key], b[key], `${at}.${key}`, out);
  } else {
    out.push(`${at}: expected ${JSON.stringify(a)?.slice(0, 120)} got ${JSON.stringify(b)?.slice(0, 120)}`);
  }
  return out;
}

function check(name: string, actual: any) {
  const file = path.join(GOLDEN, `${name}.json.gz`);
  if (UPDATE || !fs.existsSync(file)) {
    if (!UPDATE) throw new Error(`No golden snapshot ${file}: run with UPDATE_TIMING_SNAPSHOTS=1`);
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(actual)));
    return;
  }
  const expected = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  const diff = differences(expected, actual);
  if (diff.length) {
    const dir = path.join(GOLDEN, '.diff');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.expected.json`), JSON.stringify(expected, null, 1));
    fs.writeFileSync(path.join(dir, `${name}.actual.json`), JSON.stringify(actual, null, 1));
  }
  expect(diff, `${name} differs from its golden snapshot`).toEqual([]);
}

// --- fixtures ----------------------------------------------------------------------------

function liveresultatServer(ids: number[]): Promise<http.Server> {
  const races = new Map(ids.map(id => [id, JSON.parse(fs.readFileSync(path.join(ROOT, `test-data/liveresultat/${id}.json`), 'utf8'))]));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    const m = /^\/competitions(?:\/(\d+)(?:\/(\w+))?)?$/.exec(url.pathname);
    const send = (status: number, body: unknown) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (!m) return send(404, { error: 'not found' });
    if (!m[1]) return send(200, { competitions: [...races.values()].map(r => r.info) });
    const race = races.get(Number(m[1]));
    if (!race) return send(404, { error: 'no such competition' });
    if (!m[2]) return send(200, race.info);
    if (m[2] === 'classes') return send(200, { classes: race.classes });
    if (m[2] === 'classresults') return send(200, race.results[url.searchParams.get('class') ?? ''] ?? { className: '', results: [] });
    if (m[2] === 'passings') return send(200, race.lastpassings ?? { passings: [] });
    return send(404, { error: 'not found' });
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function meosServer(): Promise<http.Server> {
  const complete = fs.readFileSync(path.join(ROOT, 'test-data/meos/complete.xml'), 'utf8');
  const server = http.createServer((req, res) => {
    const diff = new URL(req.url!, 'http://x').searchParams.get('difference');
    res.setHeader('content-type', 'text/xml; charset=utf-8');
    res.end(diff === 'zero' ? complete : '<MOPDiff xmlns="http://www.melin.nu/mop" nextdifference="2"/>');
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function mopSqlitePlugin(): TimingPlugin {
  const sql = fs.readFileSync(path.join(ROOT, 'templates/SMGraphics-example/backup.sql'), 'utf8').replace(/\r\n/g, '\n');
  const db = new DatabaseSync(':memory:');
  for (const m of sql.matchAll(/CREATE TABLE `(\w+)` \(([\s\S]*?)\n\) ENGINE/g)) {
    db.exec(`CREATE TABLE ${m[1]} (${[...m[2].matchAll(/^\s+`(\w+)`/gm)].map(c => c[1]).join(', ')})`);
  }
  for (const m of sql.matchAll(/INSERT INTO `(\w+)` VALUES\n?([\s\S]*?);\n/g)) {
    db.exec(`INSERT INTO ${m[1]} VALUES ${m[2].replace(/\\'/g, "''").replace(/\\"/g, '"')}`);
  }
  const profile = parseSqlProfile(fs.readFileSync(path.join(ROOT, 'src/main/data/timing/profiles/meos-mop.yaml'), 'utf8'));
  return {
    manifest: { id: 'mop-sqlite', name: 'MOP (SQLite)', version: '1.0.0', sdk: '^1.0', capabilities: { minPollMs: 1000 } },
    create: (config) => createSqlProfileSource(profile, {
      query: async (q, params = {}) => {
        const bound = bindNamed(q, params);
        return db.prepare(bound.sql).all(...(bound.values as any[])) as Record<string, unknown>[];
      }
    }, { timezone: String(config.timezone ?? 'Europe/Stockholm') })
  };
}

// --- tests -------------------------------------------------------------------------------

describe('timing snapshots', () => {
  const servers: http.Server[] = [];

  beforeAll(async () => {
    initDataStore();
    getDataSourceRegistry().clear();
    resetTimingPlugins();
    registerBuiltInDataSources();
    registerTimingPlugin(mopSqlitePlugin(), { kind: 'code', path: 'test' });
    const lr = await liveresultatServer([33124, 37049]);
    const meos = await meosServer();
    servers.push(lr, meos);
    const registry = getDataSourceRegistry();
    const port = (s: http.Server) => (s.address() as AddressInfo).port;
    await registry.create({ id: 'lr', name: 'Liveresultat', type: 'liveresults', enabled: true, config: { baseUrl: `http://127.0.0.1:${port(lr)}`, api: 'rest', push: false } });
    await registry.create({ id: 'mop', name: 'MOP', type: 'mop-sqlite', enabled: true, config: { timezone: 'Europe/Stockholm' } });
    await registry.create({ id: 'iof', name: 'IOF', type: 'iofxml', enabled: true, config: { filePath: IOF_FILE, competitionId: 7, timezone: 'Europe/Stockholm' } });
    await registry.create({ id: 'meos', name: 'MeOS', type: 'meos', enabled: true, config: { url: `127.0.0.1:${port(meos)}`, competitionId: 5, timezone: 'Europe/Stockholm' } });
  });

  afterAll(async () => {
    getDataStore().clear();
    getDataSourceRegistry().destroyAll();
    await Promise.all(servers.map(s => new Promise(r => s.close(r))));
  });

  it('Liveresultat: individual race (33124)', async () => {
    check('liveresultat-33124', await capture('lr', [33124]));
  }, 120_000);

  it('Liveresultat: sprint relay (37049)', async () => {
    check('liveresultat-37049', await capture('lr', [37049]));
  }, 60_000);

  it('MeOS MOP database: individual and relay', async () => {
    check('mop', await capture('mop', [3, 2]));
  }, 60_000);

  it('IOF XML result list', async () => {
    const out = await capture('iof', [7]);
    out.iofStartList = normalize(await startListFromIofXml({ id: 'x', name: 'x', info: { timeZone: 'Europe/Stockholm' } } as any, IOF_FILE));
    check('iofxml', out);
  });

  it('MeOS information server', async () => {
    check('meos', await capture('meos', [5]));
  });
});

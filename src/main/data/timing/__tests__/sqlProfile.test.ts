import { describe, it, expect } from 'vitest';
import { assertReadOnlySelect, bindNamed, namedParameters } from '../sql/sqlText';
import { parseSqlProfile, profileManifest } from '../sql/SqlProfile';
import { createSqlProfileSource, SqlProfileSource } from '../sql/SqlProfileSource';
import { TimingHub, numericCompetitionId } from '../TimingHub';

describe('SQL safety', () => {
  it('accepts single read-only SELECT / WITH queries', () => {
    expect(() => assertReadOnlySelect('SELECT 1')).not.toThrow();
    expect(() => assertReadOnlySelect('  with x as (select 1) select * from x;')).not.toThrow();
    expect(() => assertReadOnlySelect("SELECT REPLACE(name, 'a', 'b') AS `update` FROM t WHERE note = 'drop table; delete'")).not.toThrow();
  });

  it('rejects writes, several statements, file access and locks', () => {
    expect(() => assertReadOnlySelect('DELETE FROM t')).toThrow('only SELECT');
    expect(() => assertReadOnlySelect('SELECT 1; DROP TABLE t')).toThrow('one statement');
    expect(() => assertReadOnlySelect("SELECT * FROM t INTO OUTFILE '/tmp/x'")).toThrow('"INTO"');
    expect(() => assertReadOnlySelect('SELECT * FROM t FOR UPDATE')).toThrow('not allowed');
    expect(() => assertReadOnlySelect('SELECT SLEEP(100)')).toThrow('"SLEEP"');
    expect(() => assertReadOnlySelect('SELECT 1 /* ; drop')).toThrow('unclosed');
    expect(() => assertReadOnlySelect('SELECT 1 -- ; DROP TABLE t\n')).not.toThrow();
  });

  it('binds named parameters positionally, expanding lists, never inside literals', () => {
    const sql = "SELECT * FROM t WHERE a = :competitionId AND b IN (:ids) AND c = ':notAParam' AND d = '10:30'";
    expect(namedParameters(sql)).toEqual(['competitionId', 'ids']);
    expect(bindNamed(sql, { competitionId: 3, ids: [1, 2] })).toEqual({
      sql: "SELECT * FROM t WHERE a = ? AND b IN (?, ?) AND c = ':notAParam' AND d = '10:30'",
      values: [3, 1, 2]
    });
    expect(bindNamed('SELECT 1 WHERE x IN (:ids)', { ids: [] }).sql).toBe('SELECT 1 WHERE x IN (NULL)');
    expect(() => bindNamed('SELECT :missing', {})).toThrow('unknown parameter :missing');
  });
});

const PROFILE = `
id: club-db
name: Club timing database
version: 2.1.0
sdk: ^1.0
units: { time: seconds, clock: epochSeconds }
statusMap:
  OK: ok
  DNF: dnf
  GUEST: { status: ok, ranked: false }
  default: running
options:
  type: object
  properties:
    season: { type: integer, title: Season, default: 2026 }
extFields:
  - { key: speedKmh, on: entry, type: number, label: Speed, unit: km/h }
queries:
  competitions: SELECT id, title AS name, day AS date FROM races WHERE season = :season
  classes: SELECT id, name, legs, len AS \`course.lengthM\` FROM classes WHERE race = :competitionId
  radioControls: SELECT code AS id, code, label AS name FROM radios WHERE race = :competitionId AND cls = :classId
  entries: SELECT id, first AS \`name.given\`, last AS \`name.family\`, club AS \`club.name\`, st AS status, start_s AS start, run_s AS time, speed AS \`ext.speedKmh\` FROM runners WHERE cls = :classId
  passings: SELECT runner AS entryId, code AS controlId, t AS time FROM punches WHERE runner IN (:entryIds)
  latestPassings: SELECT runner AS entryId, cls AS classId, code AS controlId, at_s AS at FROM punches ORDER BY at_s DESC LIMIT :limit
`;

function fakeDb() {
  const calls: { sql: string; params: Record<string, unknown> }[] = [];
  const t0 = Date.UTC(2026, 5, 1, 8, 0, 0) / 1000; // 10:00 in Stockholm
  return {
    calls,
    query: async (sql: string, params: Record<string, unknown> = {}) => {
      calls.push({ sql, params });
      if (sql.includes('FROM races')) return [{ id: 'spring', name: 'Spring race', date: '2026-06-01' }];
      if (sql.includes('FROM classes')) return [{ id: 10, name: 'H21', legs: null, 'course.lengthM': 5400 }];
      if (sql.includes('FROM radios')) return [{ id: 100, code: 100, name: 'Radio' }];
      if (sql.includes('FROM runners')) {
        return [
          { id: 1, 'name.given': 'Ada', 'name.family': 'Ek', 'club.name': 'OK A', status: 'OK', start: t0, time: 1800, 'ext.speedKmh': 11 },
          { id: 2, 'name.given': 'Bea', 'name.family': 'Ny', 'club.name': 'OK B', status: 'GUEST', start: t0 + 60, time: 1700 },
          { id: 3, 'name.given': 'Cid', 'name.family': 'Ra', 'club.name': 'OK C', status: null, start: t0 + 120, time: null }
        ];
      }
      if (sql.includes('LIMIT')) return [{ entryId: 1, classId: 10, controlId: 100, at: t0 + 600 }];
      if (sql.includes('FROM punches')) return [{ entryId: 1, controlId: 100, time: 600 }, { entryId: 3, controlId: 100, time: 700 }];
      return [];
    }
  };
}

describe('SQL profiles', () => {
  it('parses a profile and builds its manifest (connection settings + options)', () => {
    const p = parseSqlProfile(PROFILE, 'club.yaml');
    const m = profileManifest(p);
    expect(m).toMatchObject({ id: 'club-db', version: '2.1.0', capabilities: { passings: true, relays: false } });
    expect(Object.keys(m.configSchema!.properties)).toEqual(expect.arrayContaining(['host', 'database', 'user', 'password', 'season']));
    expect(m.extFields).toEqual([expect.objectContaining({ key: 'speedKmh', on: 'entry' })]);
  });

  it('explains what is wrong with a bad profile', () => {
    expect(() => parseSqlProfile('id: Bad Id\nname: x', 'a.yaml')).toThrow('a.yaml: "id" must be');
    expect(() => parseSqlProfile('id: ok-id\nname: x\nqueries: { competitions: SELECT 1, classes: SELECT 1 }', 'b.yaml')).toThrow('queries.entries is required');
    expect(() => parseSqlProfile('id: ok-id\nname: x\nqueries: { competitions: SELECT 1, classes: SELECT 1, entries: DELETE FROM t }', 'c.yaml')).toThrow('only SELECT');
    expect(() => parseSqlProfile('id: ok-id\nname: x\nstatusMap: { 1: fine }\nqueries: { competitions: SELECT 1, classes: SELECT 1, entries: SELECT 1 }', 'd.yaml')).toThrow('"fine" is not a status');
    expect(() => parseSqlProfile('id: ok-id\nname: x\nqueries: { competitions: SELECT 1, classes: SELECT 1, entries: SELECT 1, results: SELECT 1 }', 'e.yaml')).toThrow('unknown query "results"');
    expect(() => parseSqlProfile('id: ok-id\nname: x\nunits: { time: minutes }\nqueries: {}', 'f.yaml')).toThrow('units.time');
  });

  it('maps rows to SDK facts: units, clock, status map, names, ext, options, passings', async () => {
    const db = fakeDb();
    const source = new SqlProfileSource(parseSqlProfile(PROFILE), db, { timezone: 'Europe/Stockholm', options: { season: 2026, host: 'secret-host' } });
    expect(await source.competitions()).toEqual([{ id: 'spring', name: 'Spring race', date: '2026-06-01', timezone: 'Europe/Stockholm' }]);
    // Options reach the query; other settings (connection details) do not
    expect(db.calls[0].params).toEqual({ season: 2026 });

    const [cls] = await source.classes('spring');
    expect(cls).toMatchObject({ id: '10', kind: 'individual', course: { lengthM: 5400 }, radioControls: [{ id: '100', code: 100, name: 'Radio' }] });
    expect(db.calls.find(c => c.sql.includes('FROM radios'))!.params).toEqual({ competitionId: 'spring', classId: 10 });

    const entries = await source.entries('spring', '10');
    expect(db.calls.find(c => c.sql.includes('IN (:entryIds)'))!.params).toEqual({ entryIds: [1, 2, 3] });
    const [ada, bea, cid] = entries;
    expect(ada).toMatchObject({
      id: '1', name: { full: 'Ada Ek', given: 'Ada', family: 'Ek' }, club: { name: 'OK A' }, status: 'ok', ranked: true,
      start: Date.UTC(2026, 5, 1, 8, 0, 0), time: 1_800_000, passings: [{ controlId: '100', time: 600_000 }], ext: { speedKmh: 11 }
    });
    expect(bea).toMatchObject({ status: 'ok', ranked: false });
    expect(cid).toMatchObject({ status: 'running', time: undefined });

    // End to end through the core
    const hub = new TimingHub(source, { pluginId: 'club-db' });
    const res = (await hub.getClassResults(numericCompetitionId('spring'), 'H21')).data;
    expect(res.rows.map(r => [r.name, r.place, r.time])).toEqual([['Ada Ek', 1, 1_800_000], ['Cid Ra', undefined, undefined], ['Bea Ny', undefined, 1_700_000]]); // ranked, running, then the rest
    expect(res.rows[0]).toMatchObject({ start: Date.UTC(2026, 5, 1, 8, 0, 0), splits: { 1100: { time: 600_000, place: 1 } }, ext: { 'club-db': { speedKmh: 11 } } });

    const passings = await source.passings('spring', 5);
    expect(passings).toEqual([{ entryId: '1', classId: '10', controlId: '100', at: Date.UTC(2026, 5, 1, 8, 10, 0) }]);
  });

  it('offers passings() only when the profile has latestPassings', () => {
    const withFeed = createSqlProfileSource(parseSqlProfile(PROFILE), fakeDb());
    expect(typeof withFeed.passings).toBe('function');
    const without = createSqlProfileSource(parseSqlProfile(PROFILE.replace(/\n {2}latestPassings:.*\n/, '\n')), fakeDb());
    expect(without.passings).toBeUndefined();
  });
});

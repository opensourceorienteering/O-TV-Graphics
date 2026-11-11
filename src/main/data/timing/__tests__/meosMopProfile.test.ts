/**
 * The built-in meos-mop SQL profile against the real MeOS MOP dump in
 * templates/SMGraphics-example/backup.sql (competition 3 = "Exempel (Individuell)",
 * 2 = "Exempel (Stafett)"), loaded into Node's built-in SQLite. The profile's SQL is plain
 * enough to run unchanged. These are the assertions the hand-written MopBackend passed.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { mopStatusToLiveResults, mopSplitCode } from '../../sources/meosCodes';
import { TimingHub } from '../TimingHub';
import { wallClockCs } from '../model';
import { parseSqlProfile } from '../sql/SqlProfile';
import { SqlProfileSource } from '../sql/SqlProfileSource';
import { bindNamed } from '../sql/sqlText';

const DUMP = path.resolve(__dirname, '../../../../../templates/SMGraphics-example/backup.sql');
const PROFILE = path.resolve(__dirname, '../profiles/meos-mop.yaml');

function loadDump(): DatabaseSync {
  // Git on Windows may check the dump out with CRLF line endings; the patterns below expect \n
  const sql = fs.readFileSync(DUMP, 'utf8').replace(/\r\n/g, '\n');
  const db = new DatabaseSync(':memory:');
  for (const m of sql.matchAll(/CREATE TABLE `(\w+)` \(([\s\S]*?)\n\) ENGINE/g)) {
    const cols = [...m[2].matchAll(/^\s+`(\w+)`/gm)].map(c => c[1]);
    db.exec(`CREATE TABLE ${m[1]} (${cols.join(', ')})`);
  }
  for (const m of sql.matchAll(/INSERT INTO `(\w+)` VALUES\n?([\s\S]*?);\n/g)) {
    // MySQL escapes quotes as \' ; SQLite wants ''
    const values = m[2].replace(/\\'/g, "''").replace(/\\"/g, '"');
    db.exec(`INSERT INTO ${m[1]} VALUES ${values}`);
  }
  return db;
}

describe('meos-mop SQL profile (real MeOS MOP dump)', () => {
  let hub: TimingHub;

  beforeAll(() => {
    const db = loadDump();
    const profile = parseSqlProfile(fs.readFileSync(PROFILE, 'utf8'), 'meos-mop.yaml');
    const runner = {
      query: async (sql: string, params: Record<string, unknown> = {}) => {
        const bound = bindNamed(sql, params);
        return db.prepare(bound.sql).all(...(bound.values as any[])) as Record<string, unknown>[];
      }
    };
    hub = new TimingHub(new SqlProfileSource(profile, runner, { timezone: 'Europe/Stockholm' }), { pluginId: 'meos-mop' });
  });

  it('maps MeOS statuses to the status numbers graphics know', () => {
    expect(mopStatusToLiveResults(1, false)).toBe(0);
    expect(mopStatusToLiveResults(3, false)).toBe(3);   // MP
    expect(mopStatusToLiveResults(4, false)).toBe(2);   // DNF
    expect(mopStatusToLiveResults(5, false)).toBe(4);   // DQ
    expect(mopStatusToLiveResults(6, false)).toBe(5);   // overtime
    expect(mopStatusToLiveResults(20, false)).toBe(1);  // DNS
    expect(mopStatusToLiveResults(21, false)).toBe(11); // cancelled
    expect(mopStatusToLiveResults(99, false)).toBeNull();
    expect(mopStatusToLiveResults(0, true)).toBe(10);   // running
    expect(mopStatusToLiveResults(0, false)).toBe(9);   // not started
    expect(mopSplitCode(50)).toBe(1050);
  });

  it('lists competitions and info', async () => {
    const comps = (await hub.getCompetitions()).data;
    expect(comps.map(c => c.name)).toEqual(expect.arrayContaining(['Exempel (Individuell)', 'Exempel (Stafett)']));
    expect(await hub.getCompetitionInfo(3)).toMatchObject({ id: 3, date: '2015-04-15', timezone: 'Europe/Stockholm' });
  });

  it('lists individual classes and expands relay classes into legs', async () => {
    expect((await hub.getClasses(3)).data.map(c => c.className)).toEqual(['Öppen 1', 'Öppen 2', 'Öppen 3']);
    const relay = (await hub.getClasses(2)).data;
    expect(relay.some(c => c.leg && /-\d+$/.test(c.className))).toBe(true);
  });

  it('returns individual results with radio splits and places', async () => {
    const res = (await hub.getClassResults(3, 'Öppen 1')).data;
    expect(res.controls.map(c => c.name)).toEqual(['Radio 1', 'Radio 2', 'Förvarning']);
    expect(res.controls.map(c => c.key)).toEqual([1050, 1150, 1100]);

    const linda = res.rows.find(r => r.name === 'Linda Klick')!;
    expect(linda.time).toBe(4_909_000);     // MOP rt 49090 tenths = 81:49.0
    expect(wallClockCs(await hub.getCompetitionInfo(3), linda.start)).toBe(7467000); // MOP st 746700 tenths since midnight
    expect(linda.status).toBe('ok');

    const ranked = res.rows.filter(r => r.place !== undefined);
    expect(ranked[0]).toMatchObject({ place: 1, behind: 0 });
    const times = ranked.map(r => r.time!);
    expect([...times].sort((a, b) => a - b)).toEqual(times); // sorted by time

    // Every split has a place and a time behind
    const withSplits = res.rows.find(r => Object.keys(r.splits).length)!;
    for (const split of Object.values(withSplits.splits)) {
      expect(split.time).toBeGreaterThan(0);
      expect(split.behind).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns relay legs with team-perspective times and the team as club', async () => {
    const leg2 = (await hub.getClasses(2)).data.find(c => c.className.endsWith('-2'))!;
    const res = (await hub.getClassResults(2, leg2.className)).data;
    expect(res.rows.length).toBeGreaterThan(0);
    const finished = res.rows.filter(r => r.statusCode === 0 && r.time);
    for (const r of finished) {
      expect(r.club).toMatch(/^Lag /);           // team name
      expect(r.time).toBeGreaterThan(0);
      // results count from the team's start, at or before this runner's changeover
      expect(r.teamStart).toBeGreaterThan(0);
      expect(r.teamStart!).toBeLessThanOrEqual(r.start!);
    }
  });

  it('fails clearly for an unknown class', async () => {
    await expect(hub.getClassResults(3, 'Nope')).rejects.toThrow('Class not found');
  });
});

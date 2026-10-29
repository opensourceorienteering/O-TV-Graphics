/**
 * MopBackend against the real MeOS MOP dump in templates/SMGraphics-example/backup.sql
 * (competition 3 = "Exempel (Individuell)", 2 = "Exempel (Stafett)"), loaded into
 * Node's built-in SQLite. The backend's SQL is plain enough to run unchanged.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { MopBackend, mopStatusToLiveResults, mopSplitCode } from '../MopBackend';

const DUMP = path.resolve(__dirname, '../../../../../templates/SMGraphics-example/backup.sql');

function loadDump(): DatabaseSync {
  const sql = fs.readFileSync(DUMP, 'utf8');
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

describe('MopBackend (real MeOS MOP dump)', () => {
  let backend: MopBackend;

  beforeAll(() => {
    const db = loadDump();
    backend = new MopBackend(async (q, params = []) => db.prepare(q).all(...(params as any[])) as any[], {
      timezone: 'Europe/Stockholm'
    });
  });

  it('maps MeOS statuses to LiveResults codes', () => {
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
    const comps = await backend.fetchCompetitions();
    expect(comps.map(c => c.name)).toEqual(expect.arrayContaining(['Exempel (Individuell)', 'Exempel (Stafett)']));
    const info = await backend.fetchCompetitionInfo(3);
    expect(info).toMatchObject({ id: 3, date: '2015-04-15', timezone: 'Europe/Stockholm' });
  });

  it('lists individual classes and expands relay classes into legs', async () => {
    const individual = (await backend.fetchClasses(3)).map(c => c.className);
    expect(individual).toEqual(['Öppen 1', 'Öppen 2', 'Öppen 3']);
    const relay = (await backend.fetchClasses(2)).map(c => c.className);
    expect(relay.some(c => /-\d+$/.test(c))).toBe(true);
  });

  it('returns individual results in hundredths with radio splits and places', async () => {
    const res = await backend.fetchClassResults(3, 'Öppen 1');
    expect(res.splitcontrols.map(c => c.name)).toEqual(['Radio 1', 'Radio 2', 'Förvarning']);
    expect(res.splitcontrols.map(c => c.code)).toEqual([1050, 1150, 1100]);

    const linda = res.results.find(r => r.name === 'Linda Klick')!;
    expect(linda.result).toBe('490900');       // MOP rt 49090 tenths = 81:49.0
    expect(linda.start).toBe(7467000);         // MOP st 746700 tenths since midnight
    expect(linda.status).toBe(0);

    const ranked = res.results.filter(r => r.place && r.place !== '');
    expect(ranked[0].place).toBe('1');
    expect(ranked[0].timeplus).toBe('0');
    const times = ranked.map(r => Number(r.result));
    expect([...times].sort((a, b) => a - b)).toEqual(times); // sorted by time

    // Every split has the LiveResults key family
    const withSplits = res.results.find(r => r.splits && Object.keys(r.splits).length)!;
    const code = Object.keys(withSplits.splits!).find(k => /^\d+$/.test(k))!;
    expect(withSplits.splits).toHaveProperty(`${code}_place`);
    expect(withSplits.splits).toHaveProperty(`${code}_timeplus`);
  });

  it('returns relay legs with team-perspective times and the team as club', async () => {
    const leg2 = (await backend.fetchClasses(2)).find(c => c.className.endsWith('-2'))!;
    const res = await backend.fetchClassResults(2, leg2.className);
    expect(res.results.length).toBeGreaterThan(0);
    const finished = res.results.filter(r => r.status === 0 && r.result);
    for (const r of finished) {
      expect(r.club).toMatch(/^Lag /);           // team name
      expect(Number(r.result)).toBeGreaterThan(0);
    }
  });

  it('fails clearly for an unknown class', async () => {
    await expect(backend.fetchClassResults(3, 'Nope')).rejects.toThrow('MOP class not found');
  });
});

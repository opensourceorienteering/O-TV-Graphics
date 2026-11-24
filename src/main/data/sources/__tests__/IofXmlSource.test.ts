import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IofXmlSource, iofStatusToLiveResults } from '../IofXmlSource';
import { TimingHub } from '../../timing/TimingHub';
import { wallClockCs } from '../../timing/model';

const hubOf = (file: string, competitionId = 7) =>
  new TimingHub(new IofXmlSource(file, { competitionId, timezone: 'Europe/Stockholm' }), { pluginId: 'iofxml' });
const row = (rows: any[], name: string) => rows.find(r => r.name === name)!;

const FIXTURE = path.resolve(__dirname, '../../../../../test-data/iofxml/resultlist.xml');

describe('IofXmlSource', () => {
  let hub: TimingHub;
  beforeEach(() => { hub = hubOf(FIXTURE); });

  it('maps IOF statuses', () => {
    expect(iofStatusToLiveResults('OK', true)).toBe(0);
    expect(iofStatusToLiveResults('MissingPunch', true)).toBe(3);
    expect(iofStatusToLiveResults('DidNotFinish', false)).toBe(2);
    expect(iofStatusToLiveResults('DidNotStart', false)).toBe(1);
    expect(iofStatusToLiveResults('Disqualified', false)).toBe(4);
    expect(iofStatusToLiveResults('OverTime', true)).toBe(5);
    expect(iofStatusToLiveResults('Active', false)).toBe(10);
    expect(iofStatusToLiveResults('Inactive', false)).toBe(9);
    expect(iofStatusToLiveResults('DidNotEnter', false)).toBeNull();
  });

  it('reads the event and classes, expanding relays into legs', async () => {
    expect((await hub.getCompetitions()).data).toEqual([{ id: 7, sourceId: '7', name: 'Höstkavlen 2026', organiser: 'OK Exempel', date: '2026-10-25', timezone: 'Europe/Stockholm', timediffHours: 0 }]);
    expect((await hub.getCompetitionInfo(7)).timezone).toBe('Europe/Stockholm');
    expect((await hub.getClasses(7)).data.map(c => c.className)).toEqual(['H21', 'Kavle-1', 'Kavle-2']);
    await expect(hub.getClasses(8)).rejects.toThrow('Unknown competition');
  });

  it('builds individual results: times, local start times, repeated controls, places', async () => {
    const res = (await hub.getClassResults(7, 'H21')).data;
    // control 31 is visited twice: 1031 then 2031
    expect(res.controls.map(c => c.key)).toEqual([1031, 1045, 2031, 1100]);
    expect(res.rows.map(r => r.name)).not.toContain('Fia Fors'); // DidNotEnter is left out

    const bertil = row(res.rows, 'Bertil Bok');
    expect(bertil).toMatchObject({ place: 1, time: 2_350_000, behind: 0, statusCode: 0, club: 'IK Granen' });
    // 10:02:00 local on the day the clocks go back
    expect(wallClockCs(await hub.getCompetitionInfo(7), bertil.start)).toBe(3612000);
    expect(bertil.splits).not.toHaveProperty('1045'); // missing punch at 45
    expect(bertil.splits[2031].time).toBe(1_450_000);

    const anna = row(res.rows, 'Anna Andersson');
    expect(anna).toMatchObject({ place: 2, behind: 50_000, club: 'OKE', bib: '101' });
    expect(anna.splits[1045].time).toBe(900_500); // 900.5 s
    expect(anna.splits[1031].place).toBe(2); // first visit to 31: Doris 295 s, Anna 300 s, Bertil 310 s
    expect(row(res.rows, 'Cesar Cykel')).toMatchObject({ statusCode: 3 });
    expect(row(res.rows, 'Cesar Cykel').place).toBeUndefined();
    expect(row(res.rows, 'Cesar Cykel').time).toBeUndefined();
    expect(row(res.rows, 'Doris Dahl')).toMatchObject({ statusCode: 10 });
    expect(row(res.rows, 'Erik Ek')).toMatchObject({ statusCode: 1 });
  });

  it('builds relay legs with team-perspective times', async () => {
    const leg2 = (await hub.getClassResults(7, 'Kavle-2')).data;
    const hanna = row(leg2.rows, 'Hanna Holm');
    expect(hanna).toMatchObject({ club: 'OK Exempel 1', time: 3_700_000, place: 1 }); // OverallResult
    // leg split 650 s + 30:00 since the team started = 2450 s
    expect(hanna.splits[1050].time).toBe(2_450_000);
    const julia = row(leg2.rows, 'Julia Jul');
    expect(julia.statusCode).toBe(10);
    expect(julia.splits[1050].time).toBe(700_000 + 1_750_000); // 700 s + 29:10 offset
    expect(julia.splits[1050].place).toBe(1); // ahead of Hanna at the radio, from the team's view
    // the team's start, 29:10 before Julia's changeover
    expect(julia.start - julia.teamStart).toBe(1_750_000);
  });

  it('re-parses only when the file changes and survives a half-written export', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iofxml-'));
    const file = path.join(dir, 'results.xml');
    fs.copyFileSync(FIXTURE, file);
    const client = hubOf(file);

    const first = await client.getClassResults(7, 'H21');
    expect(first.changed).toBe(true);
    expect((await client.getClassResults(7, 'H21')).changed).toBe(false);

    const xml = fs.readFileSync(file, 'utf8').replace('<Status>Active</Status>', '<Time>2390</Time><Status>OK</Status>');
    fs.writeFileSync(file, xml);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    const changed = await client.getClassResults(7, 'H21');
    expect(changed.changed).toBe(true);
    expect(row(changed.data.rows, 'Doris Dahl')).toMatchObject({ statusCode: 0, place: 2 }); // 2390 s: behind Bertil 2350, ahead of Anna 2400

    fs.writeFileSync(file, xml.slice(0, 500)); // export caught mid-write
    const evenLater = new Date(Date.now() + 10000);
    fs.utimesSync(file, evenLater, evenLater);
    const kept = await client.getClassResults(7, 'H21');
    expect(row(kept.data.rows, 'Doris Dahl')).toMatchObject({ statusCode: 0 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

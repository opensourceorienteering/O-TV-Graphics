import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { IofXmlBackend, iofStatusToLiveResults } from '../IofXmlBackend';
import { LiveResultsClient } from '../../LiveResultsClient';

const FIXTURE = path.resolve(__dirname, '../../../../../test-data/iofxml/resultlist.xml');

describe('IofXmlBackend', () => {
  let backend: IofXmlBackend;
  beforeEach(() => { backend = new IofXmlBackend(FIXTURE, { competitionId: 7, timezone: 'Europe/Stockholm' }); });

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
    expect(await backend.fetchCompetitions()).toEqual([{ id: 7, name: 'Höstkavlen 2026', organizer: 'OK Exempel', date: '2026-10-25', timediff: 0 }]);
    expect((await backend.fetchCompetitionInfo(7)).timezone).toBe('Europe/Stockholm');
    expect((await backend.fetchClasses(7)).map(c => c.className)).toEqual(['H21', 'Kavle-1', 'Kavle-2']);
    await expect(backend.fetchClasses(8)).rejects.toThrow('Unknown competition');
  });

  it('builds individual results: hundredths, local start times, repeated controls, places', async () => {
    const res = await backend.fetchClassResults(7, 'H21');
    // control 31 is visited twice: 1031 then 2031
    expect(res.splitcontrols.map(c => c.code)).toEqual([1031, 1045, 2031, 1100]);
    const names = res.results.map(r => r.name);
    expect(names).not.toContain('Fia Fors'); // DidNotEnter is left out

    const bertil = res.results.find(r => r.name === 'Bertil Bok')!;
    expect(bertil).toMatchObject({ place: '1', result: '235000', timeplus: '0', status: 0, club: 'IK Granen' });
    expect(bertil.start).toBe(3612000); // 10:02:00 local = 36120 s = 3612000 hundredths since midnight
    expect(bertil.splits).not.toHaveProperty('1045'); // missing punch at 45
    expect(bertil.splits!['2031']).toBe(145000);

    const anna = res.results.find(r => r.name === 'Anna Andersson')!;
    expect(anna).toMatchObject({ place: '2', timeplus: '5000', club: 'OKE', bib: '101' });
    expect(anna.splits!['1045']).toBe(90050); // 900.5 s
    expect(anna.splits!['1031_place']).toBe(2); // first visit to 31: Doris 295 s, Anna 300 s, Bertil 310 s
    expect(res.results.find(r => r.name === 'Cesar Cykel')).toMatchObject({ status: 3, place: '', result: '' });
    expect(res.results.find(r => r.name === 'Doris Dahl')).toMatchObject({ status: 10 });
    expect(res.results.find(r => r.name === 'Erik Ek')).toMatchObject({ status: 1 });
  });

  it('builds relay legs with team-perspective times', async () => {
    const leg2 = await backend.fetchClassResults(7, 'Kavle-2');
    const hanna = leg2.results.find(r => r.name === 'Hanna Holm')!;
    expect(hanna).toMatchObject({ club: 'OK Exempel 1', result: '370000', place: '1' }); // OverallResult
    // leg split 650 s + 30:00 since the team started = 2450 s
    expect(hanna.splits!['1050']).toBe(245000);
    const julia = leg2.results.find(r => r.name === 'Julia Jul')!;
    expect(julia.status).toBe(10);
    expect(julia.splits!['1050']).toBe(70000 + 175000); // 700 s + 29:10 offset
    expect(julia.splits!['1050_place']).toBe(1);        // ahead of Hanna at the radio, from the team's view
  });

  it('re-parses only when the file changes and survives a half-written export', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iofxml-'));
    const file = path.join(dir, 'results.xml');
    fs.copyFileSync(FIXTURE, file);
    const live = new IofXmlBackend(file, { competitionId: 7 });
    const client = new LiveResultsClient({ baseUrl: 'file://' + file, backend: live });

    const first = await client.getClassResults(7, 'H21');
    expect(first.changed).toBe(true);
    expect((await client.getClassResults(7, 'H21')).changed).toBe(false);

    const xml = fs.readFileSync(file, 'utf8').replace('<Status>Active</Status>', '<Time>2390</Time><Status>OK</Status>');
    fs.writeFileSync(file, xml);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    const changed = await client.getClassResults(7, 'H21');
    expect(changed.changed).toBe(true);
    expect(changed.data.results.find(r => r.name === 'Doris Dahl')).toMatchObject({ status: 0, place: '2' }); // 2390 s: behind Bertil 2350, ahead of Anna 2400

    fs.writeFileSync(file, xml.slice(0, 500)); // export caught mid-write
    const evenLater = new Date(Date.now() + 10000);
    fs.utimesSync(file, evenLater, evenLater);
    const kept = await client.getClassResults(7, 'H21');
    expect(kept.data.results.find(r => r.name === 'Doris Dahl')).toMatchObject({ status: 0 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

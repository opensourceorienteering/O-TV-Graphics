/**
 * MeosInfoServerBackend against MOP XML in the exact shape MeOS's information server writes
 * (code/infoserver.cpp serializers, code/restserver.cpp difference()).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MeosInfoServerBackend } from '../MeosInfoServerBackend';
import { mopSplitCode } from '../MopBackend';
import { LiveResultsClient } from '../../LiveResultsClient';

// Zero time 10:00; times in tenths. Control 31 is visited twice on H21 (31, then 100031).
const COMPLETE = `<?xml version="1.0" encoding="UTF-8"?>
<MOPComplete xmlns="http://www.melin.nu/mop" nextdifference="2">
<competition date="2026-10-25" organizer="OK Exempel" homepage="" zerotime="10:00:00">Höstkavlen &amp; Sprint</competition>
<ctrl id="31">Radio 1</ctrl>
<ctrl id="45">Radio 2</ctrl>
<ctrl id="100031">Radio 1 (2)</ctrl>
<ctrl id="50">Växel</ctrl>
<cls id="1" ord="10" radio="31,45,100031">H21</cls>
<cls id="2" ord="20" radio="50;50">Kavle</cls>
<org id="1" nat="SWE">OK Exempel</org>
<org id="2">IK "Granen"</org>
<tm id="7"><base org="1" cls="2" stat="0" st="396000" rt="0" bib="1">OK Exempel 1</base><r>21;22</r></tm>
<tm id="8"><base org="2" cls="2" stat="0" st="396000" rt="0" bib="2">IK Granen 1</base><r>23;24</r></tm>
<cmp id="11" card="501"><base org="1" cls="1" stat="1" st="361200" rt="24000" bib="101">Anna Andersson</base><radio>31,3000;45,9005;100031,15000</radio><input it="0" tstat="1"/></cmp>
<cmp id="12" card="502"><base org="2" cls="1" stat="1" st="360600" rt="23500" bib="102">Bertil Bok</base><radio>31,3100;45,8800;100031,14500</radio><input it="0" tstat="1"/></cmp>
<cmp id="13" card="503"><base org="1" cls="1" stat="3" st="362400" rt="22000">Cesar Cykel</base><input it="0" tstat="3"/></cmp>
<cmp id="14" card="504" competing="true"><base org="2" cls="1" stat="0" st="363000" rt="0">Doris Dahl</base><radio>31,2950</radio><input it="0" tstat="0"/></cmp>
<cmp id="15" card="0"><base org="1" cls="1" stat="20" st="-1" rt="0">Erik Ek</base><input it="0" tstat="20"/></cmp>
<cmp id="16" card="0"><base org="1" cls="1" stat="99" st="-1" rt="0">Fia Fors</base><input it="0" tstat="99"/></cmp>
<cmp id="21" card="601"><base org="1" cls="2" stat="1" st="396000" rt="18000">Gustav Gran</base><radio>50,6000</radio></cmp>
<cmp id="22" card="602"><base org="1" cls="2" stat="0" st="414000" rt="0">Hanna Holm</base><radio>50,6500</radio></cmp>
<cmp id="23" card="603"><base org="2" cls="2" stat="1" st="396000" rt="17500">Ivar Is</base><radio>50,5800</radio></cmp>
<cmp id="24" card="604"><base org="2" cls="2" stat="0" st="413500" rt="0">Julia Jul</base><radio>50,7000</radio></cmp>
</MOPComplete>`;

// Doris finishes; Fia is deleted; Bertil's card attribute is omitted (unchanged)
const DIFF_2 = `<?xml version="1.0" encoding="UTF-8"?>
<MOPDiff xmlns="http://www.melin.nu/mop" nextdifference="3">
<cmp id="16" delete="true"></cmp>
<cmp id="14" card="504"><base org="2" cls="1" stat="1" st="363000" rt="23900">Doris Dahl</base><radio>31,2950;45,8900;100031,14400</radio><input it="0" tstat="1"/></cmp>
<cmp id="12"><base org="2" cls="1" stat="1" st="360600" rt="23500" bib="102">Bertil Bok</base><radio>31,3100;45,8800;100031,14500</radio></cmp>
</MOPDiff>`;

const EMPTY_3 = `<?xml version="1.0" encoding="UTF-8"?>
<MOPDiff xmlns="http://www.melin.nu/mop" nextdifference="3"></MOPDiff>`;

function fakeMeos(responses: Record<string, string>) {
  const requests: string[] = [];
  const fetchImpl = (async (url: string) => {
    requests.push(url);
    const diff = new URL(url).searchParams.get('difference')!;
    const body = responses[diff] ?? 'Error (MeOS): Unknown difference state. Use litteral \'zero\' (?difference=zero) to get complete competition';
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

describe('MeosInfoServerBackend', () => {
  let meos: ReturnType<typeof fakeMeos>;
  let backend: MeosInfoServerBackend;

  beforeEach(() => {
    meos = fakeMeos({ zero: COMPLETE, 2: DIFF_2, 3: EMPTY_3 });
    backend = new MeosInfoServerBackend('192.168.1.10:2009', {
      competitionId: 5, timezone: 'Europe/Stockholm', minPollIntervalMs: 500, fetchImpl: meos.fetchImpl
    });
  });

  it('normalises the server address', () => {
    expect(backend.endpoint).toBe('http://192.168.1.10:2009/meos');
    expect(new MeosInfoServerBackend('http://meos.local:2009/meos/').endpoint).toBe('http://meos.local:2009/meos');
  });

  it('decodes MeOS repeated-control ids into LiveResults split codes', () => {
    expect(mopSplitCode(31)).toBe(1031);
    expect(mopSplitCode(100031)).toBe(2031);
    expect(mopSplitCode(200031)).toBe(3031);
  });

  it('reads the competition and lists classes with relay legs', async () => {
    expect(await backend.fetchCompetitions()).toEqual([
      { id: 5, name: 'Höstkavlen & Sprint', organizer: 'OK Exempel', date: '2026-10-25', timediff: 0 }
    ]);
    expect((await backend.fetchCompetitionInfo(5)).timezone).toBe('Europe/Stockholm');
    expect((await backend.fetchClasses(5)).map(c => c.className)).toEqual(['H21', 'Kavle-1', 'Kavle-2']);
    await expect(backend.fetchClasses(6)).rejects.toThrow('Unknown competition');
    expect(meos.requests).toEqual(['http://192.168.1.10:2009/meos?difference=zero']); // one download serves all three calls
  });

  it('builds individual results: hundredths, places, repeated controls, statuses', async () => {
    const res = await backend.fetchClassResults(5, 'H21');
    expect(res.splitcontrols).toEqual([
      { code: 1031, name: 'Radio 1' },
      { code: 1045, name: 'Radio 2' },
      { code: 2031, name: 'Radio 1 (2)' }
    ]);
    const by = (n: string) => res.results.find(r => r.name === n)!;
    expect(res.results.map(r => r.name)).not.toContain('Fia Fors'); // not competing
    expect(by('Bertil Bok')).toMatchObject({ place: '1', result: '235000', timeplus: '0', status: 0, club: 'IK "Granen"' });
    expect(by('Bertil Bok').start).toBe(3606000); // 10:01:00 in hundredths since midnight
    expect(by('Anna Andersson')).toMatchObject({ place: '2', timeplus: '5000', bib: '101' });
    expect(by('Anna Andersson').splits!['2031']).toBe(150000);
    expect(by('Anna Andersson').splits!['1031_place']).toBe(2); // Doris 295 s, Anna 300 s, Bertil 310 s
    expect(by('Cesar Cykel')).toMatchObject({ status: 3, place: '' });
    expect(by('Doris Dahl')).toMatchObject({ status: 10 });  // unknown status with a radio punch = running
    expect(by('Erik Ek')).toMatchObject({ status: 1, start: 0 }); // DNS, st=-1
  });

  it('builds relay legs with team-perspective times', async () => {
    const leg2 = await backend.fetchClassResults(5, 'Kavle-2');
    const hanna = leg2.results.find(r => r.name === 'Hanna Holm')!;
    const julia = leg2.results.find(r => r.name === 'Julia Jul')!;
    expect(hanna).toMatchObject({ club: 'OK Exempel 1', status: 10 });
    expect(hanna.splits!['1050']).toBe(65000 + 180000);  // 650 s on leg + 30:00 the team used before
    expect(julia.splits!['1050']).toBe(70000 + 175000);
    expect(julia.splits!['1050_place']).toBe(1);
    const leg1 = await backend.fetchClassResults(5, 'Kavle-1');
    expect(leg1.results.find(r => r.name === 'Ivar Is')).toMatchObject({ place: '1', result: '175000' });
  });

  it('applies diffs: updates, deletions, omitted card', async () => {
    await backend.fetchClassResults(5, 'H21');
    await new Promise(r => setTimeout(r, 300)); // past the reuse window (half the poll interval)
    const res = await backend.fetchClassResults(5, 'H21');
    expect(meos.requests.at(-1)).toContain('difference=2');
    const doris = res.results.find(r => r.name === 'Doris Dahl')!;
    expect(doris).toMatchObject({ status: 0, place: '2', result: '239000' });
    expect((backend as any).competitors.get(12).card).toBe(502);
    expect((backend as any).competitors.has(16)).toBe(false);
  });

  it('starts over from zero when MeOS forgets the difference state', async () => {
    await backend.fetchCompetitions();
    (backend as any).difference = '999';
    (backend as any).lastSync = 0;
    await backend.fetchCompetitions();
    expect(meos.requests.slice(-2)).toEqual([
      'http://192.168.1.10:2009/meos?difference=999',
      'http://192.168.1.10:2009/meos?difference=zero'
    ]);
  });

  it('reports unreachable servers and non-MOP answers clearly', async () => {
    const down = new MeosInfoServerBackend('localhost:2009', {
      fetchImpl: (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch
    });
    await expect(down.fetchCompetitions()).rejects.toThrow('ECONNREFUSED');
    expect(() => backend.apply('<html>hello</html>')).toThrow('Not a MeOS MOP document');
  });

  it('drives LiveResultsClient change detection', async () => {
    const client = new LiveResultsClient({ baseUrl: backend.endpoint, backend, cacheInterval: 500 });
    expect((await client.getClassResults(5, 'H21')).changed).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    const second = await client.getClassResults(5, 'H21'); // diff 2: Doris finished
    expect(second.changed).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect((await client.getClassResults(5, 'H21')).changed).toBe(false); // empty diff
    client.destroy();
  });
});

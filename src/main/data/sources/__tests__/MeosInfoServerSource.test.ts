/**
 * MeosInfoServerSource against MOP XML in the exact shape MeOS's information server writes
 * (code/infoserver.cpp serializers, code/restserver.cpp difference()).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MeosInfoServerSource } from '../MeosInfoServerSource';
import { mopSplitCode } from '../meosCodes';
import { TimingHub } from '../../timing/TimingHub';
import { wallClockCs } from '../../timing/model';

const row = (rows: any[], name: string) => rows.find(r => r.name === name)!;

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

describe('MeosInfoServerSource', () => {
  let meos: ReturnType<typeof fakeMeos>;
  let source: MeosInfoServerSource;
  let hub: TimingHub;

  beforeEach(() => {
    meos = fakeMeos({ zero: COMPLETE, 2: DIFF_2, 3: EMPTY_3 });
    source = new MeosInfoServerSource('192.168.1.10:2009', {
      competitionId: 5, timezone: 'Europe/Stockholm', minPollIntervalMs: 500, fetchImpl: meos.fetchImpl
    });
    hub = new TimingHub(source, { pluginId: 'meos', minPollMs: 500 });
  });

  it('normalises the server address', () => {
    expect(source.endpoint).toBe('http://192.168.1.10:2009/meos');
    expect(new MeosInfoServerSource('http://meos.local:2009/meos/').endpoint).toBe('http://meos.local:2009/meos');
  });

  it('decodes MeOS repeated-control ids into control keys', () => {
    expect(mopSplitCode(31)).toBe(1031);
    expect(mopSplitCode(100031)).toBe(2031);
    expect(mopSplitCode(200031)).toBe(3031);
  });

  it('reads the competition and lists classes with relay legs', async () => {
    expect((await hub.getCompetitions()).data).toEqual([
      { id: 5, sourceId: '5', name: 'Höstkavlen & Sprint', organiser: 'OK Exempel', date: '2026-10-25', timezone: 'Europe/Stockholm', timediffHours: 0 }
    ]);
    expect((await hub.getCompetitionInfo(5)).timezone).toBe('Europe/Stockholm');
    expect((await hub.getClasses(5)).data.map(c => c.className)).toEqual(['H21', 'Kavle-1', 'Kavle-2']);
    await expect(hub.getClasses(6)).rejects.toThrow('Unknown competition');
    expect(meos.requests).toEqual(['http://192.168.1.10:2009/meos?difference=zero']); // one download serves all calls
  });

  it('builds individual results: times, places, repeated controls, statuses', async () => {
    const res = (await hub.getClassResults(5, 'H21')).data;
    expect(res.controls).toEqual([
      { key: 1031, id: '31', code: 31, name: 'Radio 1' },
      { key: 1045, id: '45', code: 45, name: 'Radio 2' },
      { key: 2031, id: '100031', code: 31, name: 'Radio 1 (2)' }
    ]);
    expect(res.rows.map(r => r.name)).not.toContain('Fia Fors'); // not competing
    expect(row(res.rows, 'Bertil Bok')).toMatchObject({ place: 1, time: 2_350_000, behind: 0, statusCode: 0, club: 'IK "Granen"' });
    expect(wallClockCs(await hub.getCompetitionInfo(5), row(res.rows, 'Bertil Bok').start)).toBe(3606000); // 10:01:00
    expect(row(res.rows, 'Anna Andersson')).toMatchObject({ place: 2, behind: 50_000, bib: '101' });
    expect(row(res.rows, 'Anna Andersson').splits[2031].time).toBe(1_500_000);
    expect(row(res.rows, 'Anna Andersson').splits[1031].place).toBe(2); // Doris 295 s, Anna 300 s, Bertil 310 s
    expect(row(res.rows, 'Cesar Cykel')).toMatchObject({ statusCode: 3 });
    expect(row(res.rows, 'Cesar Cykel').place).toBeUndefined();
    expect(row(res.rows, 'Doris Dahl')).toMatchObject({ statusCode: 10 }); // unknown status with a radio punch = running
    expect(row(res.rows, 'Erik Ek')).toMatchObject({ statusCode: 1 }); // DNS, st=-1
    expect(row(res.rows, 'Erik Ek').start).toBeUndefined();
  });

  it('builds relay legs with team-perspective times', async () => {
    const leg2 = (await hub.getClassResults(5, 'Kavle-2')).data;
    const hanna = row(leg2.rows, 'Hanna Holm');
    const julia = row(leg2.rows, 'Julia Jul');
    expect(hanna).toMatchObject({ club: 'OK Exempel 1', statusCode: 10 });
    expect(hanna.splits[1050].time).toBe(650_000 + 1_800_000); // 650 s on leg + 30:00 the team used before
    expect(julia.splits[1050].time).toBe(700_000 + 1_750_000);
    expect(julia.splits[1050].place).toBe(1);
    // the team's start: the runner's own start is the changeover, 30:00 later
    expect(hanna.start - hanna.teamStart).toBe(1_800_000);
    expect(julia.start - julia.teamStart).toBe(1_750_000);
    const leg1 = (await hub.getClassResults(5, 'Kavle-1')).data;
    expect(row(leg1.rows, 'Ivar Is')).toMatchObject({ place: 1, time: 1_750_000 });
  });

  it('applies diffs: updates, deletions, omitted card', async () => {
    await hub.getClassResults(5, 'H21');
    await new Promise(r => setTimeout(r, 300)); // past the reuse window (half the poll interval)
    const res = (await hub.getClassResults(5, 'H21')).data;
    expect(meos.requests.at(-1)).toContain('difference=2');
    expect(row(res.rows, 'Doris Dahl')).toMatchObject({ statusCode: 0, place: 2, time: 2_390_000 });
    expect((source as any).competitors.get(12).card).toBe(502);
    expect((source as any).competitors.has(16)).toBe(false);
  });

  it('starts over from zero when MeOS forgets the difference state', async () => {
    await source.competitions();
    (source as any).difference = '999';
    (source as any).lastSync = 0;
    await source.competitions();
    expect(meos.requests.slice(-2)).toEqual([
      'http://192.168.1.10:2009/meos?difference=999',
      'http://192.168.1.10:2009/meos?difference=zero'
    ]);
  });

  it('reports unreachable servers and non-MOP answers clearly', async () => {
    const down = new MeosInfoServerSource('localhost:2009', {
      fetchImpl: (async () => { throw new Error('connect ECONNREFUSED'); }) as unknown as typeof fetch
    });
    await expect(down.competitions()).rejects.toThrow('ECONNREFUSED');
    await expect(down.connect()).rejects.toThrow(/Information server/);
    expect(() => source.apply('<html>hello</html>')).toThrow('Not a MeOS MOP document');
  });

  it('drives the hub\'s change detection', async () => {
    expect((await hub.getClassResults(5, 'H21')).changed).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    const second = await hub.getClassResults(5, 'H21'); // diff 2: Doris finished
    expect(second.changed).toBe(true);
    await new Promise(r => setTimeout(r, 300));
    expect((await hub.getClassResults(5, 'H21')).changed).toBe(false); // empty diff
    hub.destroy();
  });
});

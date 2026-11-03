/**
 * Template sets: discovery of templates/sets/<set>/, the one-set-per-project rule,
 * screen-zone clashes, and the shared view code every set renders with.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import path from 'path';

vi.mock('../../utils/logger', () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: l, getLogger: () => l };
});

import { OGrafManager } from '../OGrafManager';
import { assertTemplateInProjectSet, templateGraphicKind } from '../templateSets';
import { zonesClash } from '../../../shared/types/ograf';

const TEMPLATES = path.resolve(__dirname, '../../../../templates');

describe('template set discovery', () => {
  let manager: OGrafManager;
  beforeAll(async () => {
    manager = new OGrafManager(TEMPLATES);
    await manager.initialize();
    const result = await manager.discoverTemplates();
    expect(result.errors).toEqual([]);
  });

  it('finds the nine sets in the repository', () => {
    const sets = manager.getTemplateSets();
    expect(sets.map(s => s.id).sort()).toEqual(['bold', 'brutal', 'contours', 'cz', 'iof', 'iof2', 'signal', 'sof', 'standard']);
    for (const id of ['signal', 'brutal', 'bold', 'contours', 'iof2']) expect(sets.find(s => s.id === id)?.templateCount).toBe(17);
    expect(sets.find(s => s.id === 'sof')?.templateCount).toBe(19);
    expect(sets.find(s => s.id === 'standard')).toMatchObject({ name: 'Standard', templateCount: 17 });
    expect(sets.find(s => s.id === 'iof')).toMatchObject({ name: 'IOF', templateCount: 17 });
    expect(sets.find(s => s.id === 'cz')?.templateCount).toBe(17);
  });

  it('keeps the output test pattern outside every set', () => {
    const pattern = manager.getTemplateById('output-test-pattern')!;
    expect(pattern).toMatchObject({ setId: 'system', zone: 'full', directoryName: 'system/output-test-pattern' });
    expect(manager.getTemplateSets().map(s => s.id)).not.toContain('system');
    expect(manager.getAllTemplates().filter(t => templateGraphicKind(t) === 'test-pattern')).toHaveLength(1);
    // usable with any look
    expect(() => assertTemplateInProjectSet({ name: 'Any', templateSet: 'iof' }, pattern)).not.toThrow();
  });

  it('records set, zone and URL path per graphic', () => {
    const iofResults = manager.getTemplateById('iof-results')!;
    expect(iofResults).toMatchObject({ setId: 'iof', zone: 'main', directoryName: 'sets/iof/iof-results' });
    expect(manager.getTemplateById('iof-results')!.dataSourceConfig.mode).toBe('api');
    expect(manager.getTemplateById('cz-name-strap')).toMatchObject({ setId: 'cz', zone: 'lower', dataSourceConfig: null });
  });

  it('gives every bundled look the same complete set of style-independent graphic roles', () => {
    const templates = manager.getAllTemplates();
    const roles = (setId: string) =>
      templates
        .filter(template => template.setId === setId)
        .map(templateGraphicKind)
        .sort();
    const standard = roles('standard');
    expect(standard).toHaveLength(17);
    expect(standard.every(Boolean)).toBe(true);
    expect(new Set(standard).size).toBe(17);
    expect(standard).not.toContain('test-pattern');
    for (const id of ['iof', 'iof2', 'cz', 'contours', 'bold', 'brutal', 'signal']) expect(roles(id), id).toEqual(standard);
    expect(roles('sof')).toEqual([...standard, 'runner-presentations', 'finish-watch'].sort());
    expect(manager.getTemplateById('sof-runner-presentations')).toMatchObject({ desk: { key: 'runner-presentations', previewData: 'starts', behaviours: ['holdOnAir', 'manualSteps'] }, deskWarnings: [] });
  });

  it('resolves every declared desk entry and keeps keys unique within each look', () => {
    const keys = new Map<string, Set<string>>();
    for (const template of manager.getAllTemplates()) {
      expect(template.deskWarnings, template.manifest.id).toEqual([]);
      if (!template.desk) continue;
      const seen = keys.get(template.setId) ?? new Set<string>();
      expect(seen.has(template.desk.key), `${template.setId}/${template.desk.key}`).toBe(false);
      seen.add(template.desk.key);
      keys.set(template.setId, seen);
      expect(template.desk.required.every(p => template.desk!.params.includes(p)), template.manifest.id).toBe(true);
    }
    expect([...keys.keys()].sort()).toEqual(['bold', 'brutal', 'contours', 'cz', 'iof', 'iof2', 'signal', 'sof', 'standard']);
  });

  it('assigns clash zones to every bundled graphic', () => {
    for (const template of manager.getAllTemplates()) {
      expect(template.zone, template.manifest.id).toBeTruthy();
    }
    expect(zonesClash(manager.getTemplateById('standard-results')!.zone,
      manager.getTemplateById('standard-runner-identity')!.zone)).toBe(true);
    expect(zonesClash(manager.getTemplateById('standard-results')!.zone,
      manager.getTemplateById('standard-clock')!.zone)).toBe(false);
  });

  it('refuses graphics from another set', () => {
    const cz = manager.getTemplateById('cz-podium')!;
    expect(() => assertTemplateInProjectSet({ name: 'WOC', templateSet: 'iof' }, cz)).toThrow(/belongs to the "cz" template set/);
    expect(() => assertTemplateInProjectSet({ name: 'WOC', templateSet: 'cz' }, cz)).not.toThrow();
    // projects from before sets existed use the default look
    expect(() => assertTemplateInProjectSet({ name: 'Old' }, manager.getTemplateById('standard-clock')!)).not.toThrow();
  });
});

describe('screen zones', () => {
  it('clears what overlaps, keeps what does not', () => {
    expect(zonesClash('main', 'lower')).toBe(true);   // a results table covers the lower third area
    expect(zonesClash('lower', 'lower')).toBe(true);
    expect(zonesClash('lower', 'side')).toBe(false);  // bottom-left and bottom-right live together
    expect(zonesClash('corner', 'main')).toBe(false); // the clock stays up
    expect(zonesClash('full', 'side')).toBe(true);
    expect(zonesClash(undefined, 'main')).toBe(false); // graphics without a zone never clear others
  });
});

describe('shared views (templates/sets/_core)', () => {
  let views: any, util: any;
  beforeAll(async () => {
    views = await import('../../../../templates/sets/_core/views.js');
    util = await import('../../../../templates/sets/_core/util.js');
  });

  // Names are split into given/family spans: compare visible text
  const text = (html: string) => html.replace(/<[^>]+>/g, '');
  const ctx = (extra = {}) => ({ id: 'iof', step: 1, rowsPerPage: 2, nameStyle: {}, labels: {}, ...extra });
  const results = [
    { position: '1', name: 'Kasper Fosser', club: 'NOR', time: '1:31:48.4', diff: '', statusCode: 0 },
    { position: '2', name: 'Albin Ridefelt', club: 'SWE', time: '1:36:11', diff: '+4:23', statusCode: 0 },
    { position: '=', name: 'Tie Runner', club: 'SWE', time: '1:36:11', diff: '+4:23', statusCode: 0 },
    { position: '', name: 'Miss Punch', club: 'FIN', time: '', diff: '', statusCode: 3 },
    { position: '', name: 'Still Running', club: 'EST', time: '', diff: '', statusCode: 9 }
  ];

  it('words the timing point as "Mellantid 2 <name>" with a short "M2", start and finish by name', async () => {
    const { timingPoint } = await import('../../../../templates/sets/_core/labels.js');
    const sv = { split: 'Mellantid', splitShort: 'M{n}', control: 'Kontroll', finish: 'Mål' };
    const data = { controlCode: '1136', splitControls: [{ code: 1110, name: 'Åsen' }, { code: 1136, name: 'Önnestad' }] };
    expect(timingPoint(data, sv)).toEqual({ full: 'Mellantid 2 Önnestad', short: 'M2', split: true });
    expect(timingPoint({ ...data, controlCode: '' }, sv)).toMatchObject({ full: 'Mål', split: false });
    expect(timingPoint({ ...data, splitControls: [{ code: 1136, name: '36' }] }, sv).full).toBe('Mellantid 1 Kontroll 36');
    expect(timingPoint(data, {})).toMatchObject({ full: 'Split 2 Önnestad', short: 'Split 2' });
    // automatic names (Plan → Radio controls) are only a split number: shown once
    expect(timingPoint({ ...data, splitControls: [{ code: 1110, name: 'x' }, { code: 1136, name: 'Mellantid 2' }] }, sv).full).toBe('Mellantid 2');
  });

  it('uses Swedish and Norwegian broadcast wording independently of the look', () => {
    for (const language of ['sv', 'nb']) {
      const data = { className: 'H21', controlName: 'Finish', presentation: { language }, results: [] };
      expect(util.controlLabel(data)).toBe('Mål');
      expect(util.controlLabel({ ...data, controlName: 'Radio 31' })).toBe('Radio 31');
      const weather = views.renderView('weather', data, ctx()).html;
      expect(weather).toContain(language === 'sv' ? 'Väder' : 'Vær');
      const list = views.renderView('start-list', data, ctx()).html;
      expect(list).toContain(language === 'sv' ? 'Startlista' : 'Startliste');
    }
  });

  it('translates the weather service condition, but keeps text the operator typed', () => {
    const render = (language: string, condition: string) =>
      text(views.renderView('weather', { condition, presentation: { language } }, ctx()).html);
    expect(render('sv', 'Partly cloudy')).toContain('Växlande molnighet');
    expect(render('nb', 'Light rain')).toContain('Lett regn');
    expect(render('cs', 'Thunderstorm')).toContain('Bouřka');
    expect(render('en', 'Partly cloudy')).toContain('Partly cloudy');
    expect(render('sv', 'Sol och vindstilla')).toContain('Sol och vindstilla');
  });

  it('escapes and replaces event logos, including a no-logo selection', () => {
    const box = { innerHTML: '' };
    const root = { querySelector: () => box };
    util.updateEventLogo(root, { presentation: { logoUrl: 'data:image/png;base64,TYR' } });
    expect(box.innerHTML).toContain('base64,TYR');
    util.updateEventLogo(root, { presentation: { logoUrl: '/built-in-assets/tyr-logo.png' } });
    expect(box.innerHTML).toContain('tyr-logo.png');
    // logos show with their own transparency by default; the white plate is opt-in
    expect(box.innerHTML).toContain('data-clear');
    util.updateEventLogo(root, { presentation: { logoUrl: '/assets/upload.png' } });
    expect(box.innerHTML).toContain('data-clear');
    util.updateEventLogo(root, { presentation: { logoUrl: '/assets/upload.png', logoPlate: true } });
    expect(box.innerHTML).not.toContain('data-clear');
    expect(box.innerHTML).not.toContain('TYR');
    util.updateEventLogo(root, { presentation: {} });
    expect(box.innerHTML).toBe('');
    expect(util.eventLogoHtml({ presentation: { logoUrl: 'data:a" onerror="oops' } })).not.toContain(' onerror="');
  });

  it('formats broadcast times without fractions', () => {
    expect(util.time('1:31:48.4')).toBe('1:31:48');
    expect(util.diff('+4:23')).toBe('+4:23');
    expect(util.diff('0:00')).toBe('');
    expect(util.clock(-45)).toBe('-0:45');
    expect(util.clock(3725)).toBe('1:02:05');
  });

  it('applies the club / flag rule', () => {
    const r = { name: 'A', club: 'OK Linné', country: 'SWE' };
    expect(util.identity(r, { presentation: { international: false } })).toMatchObject({ club: 'OK Linné', flag: '' });
    expect(util.identity(r, { presentation: { international: true } })).toMatchObject({ club: '', nation: 'SWE' });
    expect(util.identity(r, { presentation: { international: true }, className: 'Men-2' })).toMatchObject({ club: 'OK Linné', nation: 'SWE' });
    // WOC-style data where the club is the nation
    expect(util.identity({ name: 'B', club: 'Sweden' }, { presentation: { international: true } })).toMatchObject({ club: '', nation: 'SWE' });
    expect(util.identity({ name: 'B', club: 'DEU' }, { presentation: { identity: 'flag' } }).nation).toBe('GER');
    expect(util.identity(r, { presentation: { identity: 'both' } })).toMatchObject({ club: 'OK Linné', nation: 'SWE' });
  });

  it('pages results: ranked first, final statuses after, running runners left out', () => {
    const page1 = views.renderView('results', { results, className: 'Men' }, ctx());
    expect(page1.steps).toBe(2);
    expect(page1.html).toContain('1:31:48');
    expect(page1.html).not.toContain('Still Running');
    const page2 = views.renderView('results', { results, className: 'Men' }, ctx({ step: 2 }));
    expect(text(page2.html)).toContain('Tie Runner');
    expect(text(page2.html)).toContain('MP');
  });

  it('escapes names', () => {
    const out = views.renderView('name-strap', { name: '<img src=x onerror=alert(1)>', title: 'Commentator' }, ctx());
    expect(out.html).not.toContain('<img src=x');
  });

  it('builds the podium in 2-1-3 order with ties sharing a column', () => {
    const html = views.renderView('podium', { results }, ctx()).html;
    const t = text(html.replace(/class="pod pod--(\d)/g, 'POD$1 '));
    expect(html.indexOf('pod--2')).toBeLessThan(html.indexOf('pod--1'));
    expect(html.indexOf('pod--1')).toBeLessThan(html.indexOf('pod--3'));
    expect(html).toMatch(/pod--2/);
    expect(text(html.replace(/<div class="pod pod--(\d)[^>]*>/g, '[POD$1]'))).toMatch(/\[POD2\][^[]*Ridefelt[^[]*Tie Runner[^[]*\[POD1\]/);
  });

  it('runner splits: places gained/lost and time behind the best', () => {
    const data = {
      runnerName: 'Albin Ridefelt',
      splitControls: [{ code: 1031, name: 'Radio 1' }, { code: 1045, name: 'Control 45' }],
      results: [{ ...results[1], splitTimes: [
        { code: 1031, time: 30000, place: 4, timeplus: 2000 },
        { code: 1045, time: 60000, place: 2, timeplus: 0 }
      ] }]
    };
    const html = views.renderView('runner-splits', data, ctx()).html;
    expect(html).toContain('Radio 1');
    expect(html).toContain('C45');           // generic "Control 45" is shortened
    expect(html).toContain('+0:20');         // 2000 hundredths behind
    expect(html).toMatch(/c-change up">2</); // gained two places
  });

  it('start group picks the next start minute', () => {
    const now = Date.now();
    const data = { clockOffsetMs: 0, results: [
      { name: 'Gone', startTimeMs: now - 60_000 },
      { name: 'Next A', startTimeMs: now + 30_000 },
      { name: 'Next B', startTimeMs: now + 30_000 },
      { name: 'Later', startTimeMs: now + 90_000 }
    ] };
    const html = text(views.renderView('start-group', data, ctx()).html);
    expect(html).toContain('Next A');
    expect(html).toContain('Next B');
    expect(html).not.toContain('Later');
    expect(html).not.toContain('Gone');
  });

  it('course info adds units only to bare numbers', () => {
    const html = text(views.renderView('course-info', { length: '3.4', climb: '45 m', controls: '18' }, ctx()).html);
    expect(html).toContain('3.4 km');
    expect(html).toContain('45 m');
    expect(html).not.toContain('m m');
  });

  it('runner focus counts down to the start, then runs; start time only on request', () => {
    const now = Date.now();
    const before = views.renderView('runner-start', { runnerName: 'A Runner', results: [{ name: 'A Runner', startTimeMs: now + 42_000 }] }, ctx()).html;
    expect(before).toContain('data-tick="run"');
    expect(text(before)).toMatch(/-0:4[12]/);
    const after = views.renderView('runner-start', { runnerName: 'A Runner', results: [{ name: 'A Runner', startTimeMs: now - 65_000 }] }, ctx()).html;
    expect(text(after)).toMatch(/1:0[45]/);
    const fixed = views.renderView('runner-start', { runnerName: 'A Runner', startTimeOnly: true, competitionTimeZone: 'UTC', results: [{ name: 'A Runner', startTimeMs: now - 5000 }] }, ctx()).html;
    expect(text(fixed)).toContain(util.timeOfDay(now - 5000, 'UTC'));
    // followed at a control: "To split 1" until through, then place and time there
    const splitControls = [{ code: 1031, name: '31' }];
    const onWay = views.renderView('runner-start', { controlCode: '1031', splitControls, runnerName: 'A Runner', results: [{ name: 'A Runner', startTimeMs: now - 5000, statusCode: 10, position: '' }] }, ctx()).html;
    expect(text(onWay)).toContain('To split 1');
    const through = views.renderView('runner-start', { controlCode: '1031', splitControls, runnerName: 'A Runner', results: [{ name: 'A Runner', startTimeMs: now - 300_000, statusCode: 0, position: '1', time: '4:10' }] }, ctx()).html;
    expect(text(through)).toContain('Split 1 - Control 31');
    expect(text(through)).toContain('4:10');
  });

  it('live split without a runner shows the leader and the latest passings', () => {
    const now = Date.now();
    // R2 passed last (latest start), R3 before it
    const results = [
      { position: '1', name: 'R1', club: 'A', time: '5:00', statusCode: 0, startTimeMs: now - 900_000 },
      { position: '2', name: 'R2', club: 'A', time: '5:10', diff: '+0:10', statusCode: 0, startTimeMs: now - 320_000 },
      { position: '3', name: 'R3', club: 'A', time: '5:20', diff: '+0:20', statusCode: 0, startTimeMs: now - 600_000 },
      { position: '4', name: 'R4', club: 'A', time: '5:30', diff: '+0:30', statusCode: 0, startTimeMs: now - 1_200_000 }
    ];
    const names = [...views.renderView('standings-lower-third', { results }, ctx()).html.matchAll(/data-key="([^|"]+)\|/g)].map(m => m[1]);
    expect(names).toEqual(['R1', 'R2', 'R3']);
  });

  it('names: last name gets an initial only when shared; position change on request', () => {
    const results = [
      { position: '1', name: 'Daniel Hubmann', club: 'SUI', time: '30:00', statusCode: 0, splitTimes: [{ code: 1031, place: 3 }] },
      { position: '2', name: 'Martin Hubmann', club: 'SUI', time: '30:10', diff: '+0:10', statusCode: 0, splitTimes: [{ code: 1031, place: 1 }] },
      { position: '3', name: 'Kasper Fosser', club: 'NOR', time: '30:20', diff: '+0:20', statusCode: 0, splitTimes: [{ code: 1031, place: 2 }] }
    ];
    const html = views.renderView('standings-lower-third', { results, nameStyle: 'family', positionChange: true, splitControls: [{ code: 1031, name: '31' }] }, ctx()).html;
    expect(text(html)).toContain('Hubmann D.');
    expect(text(html)).toContain('Fosser');
    expect(text(html)).not.toContain('Fosser K.');
    expect(html).toContain('c-change up">2<');   // Hubmann D.: 3rd -> 1st
    expect(html).toContain('c-change down">1<'); // Hubmann M.: 1st -> 2nd
  });

  it('split tables list only runners through with an OK status', () => {
    const rows = [
      { position: '1', name: 'Ok', club: 'A', time: '5:00', statusCode: 0 },
      { position: '', name: 'Mispunched', club: 'B', time: '', statusCode: 3 }
    ];
    expect(text(views.renderView('results', { controlCode: '1031', results: rows }, ctx({ rowsPerPage: 10 })).html)).not.toContain('Mispunched');
    expect(text(views.renderView('results', { results: rows }, ctx({ rowsPerPage: 10 })).html)).toContain('Mispunched');
  });

  it('course info adds min to bare times and shows extra rows', () => {
    const html = text(views.renderView('course-info', { winningTime: '75', startInterval: '1:30', extra: 'Spectator control: 14\nMap: 1:4000' }, ctx()).html);
    expect(html).toContain('75 min');
    expect(html).toContain('1:30');
    expect(html).not.toContain('1:30 min');
    expect(html).toContain('Spectator control');
    expect(html).toContain('1:4000');
  });

  it('position history plots time behind the leader', () => {
    const results = [
      { position: '1', name: 'A', club: 'X', time: '10:00', statusCode: 0, splitTimes: [{ code: 1031, time: 30000, place: 2, status: 0 }] },
      { position: '2', name: 'B', club: 'X', time: '10:30', statusCode: 0, splitTimes: [{ code: 1031, time: 29000, place: 1, status: 0 }] }
    ];
    const html = views.renderView('position-history', { results, splitControls: [{ code: 1031, name: '31' }] }, ctx()).html;
    expect(html).toContain('chart--gap');
    expect(text(html)).toContain('+0:30'); // B, 30 s behind at the finish
    expect(text(html)).toContain('+0:10'); // A, 10 s behind at control 31
  });

  it('live feed runs the selected runner against the leader until their time is in', () => {
    const now = Date.now();
    // leader passed control 62 after 5:00; the runner started 4:50 ago -> 10 s ahead
    const leader = { position: '1', name: 'Leader', club: 'A', time: '5:00', statusCode: 0, splitTimes: [{ code: 1062, time: 30000 }] };
    const runner = { position: '', name: 'On Way', club: 'B', time: '--:--', statusCode: 10, startTimeMs: now - 290_000 };
    const data = { controlCode: '1062', runnerName: 'On Way', clockOffsetMs: 0, results: [leader, runner] };
    const html = views.renderView('standings-lower-third', data, ctx()).html;
    expect(html).toContain('is-virtual');
    expect(html).toMatch(/data-tick="vs" data-t="(\d+)"/);
    const ref = Number(html.match(/data-tick="vs" data-t="(\d+)"/)[1]);
    expect(ref).toBe(runner.startTimeMs + 300_000);
    // once the runner has a time there, the row shows the place and gap instead
    const arrived = { ...runner, position: '2', time: '5:12', diff: '+0:12', statusCode: 0 };
    const done = views.renderView('standings-lower-third', { ...data, results: [leader, arrived] }, ctx()).html;
    expect(done).not.toContain('is-virtual');
    expect(text(done)).toContain('+0:12');
  });

  it('a frozen live feed stops the running time, then shows the official time when it arrives', () => {
    const now = Date.now();
    const leader = { position: '1', name: 'Leader', club: 'A', time: '5:00', statusCode: 0, splitTimes: [{ code: 1062, time: 30000 }] };
    const runner = { position: '', name: 'On Way', club: 'B', time: '--:--', statusCode: 10, startTimeMs: now - 400_000 };
    // the operator froze it 100 s ago, when the runner had run 5:00 -> level with the leader
    const data = { controlCode: '1062', runnerName: 'On Way', clockOffsetMs: 0, frozenAt: now - 100_000, results: [leader, runner] };
    const html = views.renderView('standings-lower-third', data, ctx()).html;
    expect(html).toContain('is-frozen');
    expect(text(html)).toContain('+0:00');
    const arrived = { ...runner, position: '2', time: '5:01', diff: '+0:01', statusCode: 0 };
    const done = views.renderView('standings-lower-third', { ...data, results: [leader, arrived] }, ctx()).html;
    expect(done).not.toContain('is-frozen');
    expect(text(done)).toContain('+0:01');
  });

  it('a frozen runner focus stops the running time at the freeze moment', () => {
    const now = Date.now();
    const runner = { position: '', name: 'On Way', club: 'B', time: '--:--', statusCode: 10, startTimeMs: now - 400_000 };
    const html = views.renderView('runner-start', { controlCode: 'F', runnerName: 'On Way', clockOffsetMs: 0, frozenAt: now - 100_000, results: [runner] }, ctx()).html;
    expect(html).toContain('is-frozen');
    expect(text(html)).toContain('5:00');
  });

  it('live feed shows the selected runner with the leader and the runners around them', () => {
    const now = Date.now();
    const field = Array.from({ length: 10 }, (_, i) => ({ position: String(i + 1), name: `R${i + 1}`, club: 'X', time: `5:${String(i * 5).padStart(2, '0')}`, statusCode: 0, splitTimes: [{ code: 1062, time: 30000 + i * 500 }] }));
    const names = (html: string) => [...html.matchAll(/data-key="([^|"]+)\|/g)].map(m => m[1]);
    // arrived in 8th: leader, 7th, 8th, 9th
    expect(names(views.renderView('standings-lower-third', { controlCode: '1062', runnerName: 'R8', results: field }, ctx()).html)).toEqual(['R1', 'R7', 'R8', 'R9']);
    // on the way, 5:12 running: would be 4th right now (behind R3 at 5:10)
    const runner = { position: '', name: 'Me', club: 'Y', time: '--:--', statusCode: 10, startTimeMs: now - 312_000 };
    const view = views.renderView('standings-lower-third', { controlCode: '1062', runnerName: 'Me', clockOffsetMs: 0, results: [...field, runner] }, ctx());
    expect(names(view.html)).toEqual(['R1', 'R3', 'Me', 'R4']);
    expect(view.rekey).toBe(true);
    // IOF split wording: "To split 2" on the way, "Split 2 - Control 62" once through, "Finish"
    const splitControls = [{ code: 1031, name: '31' }, { code: 1062, name: '62' }];
    expect(text(views.renderView('standings-lower-third', { controlCode: '1062', splitControls, runnerName: 'Me', clockOffsetMs: 0, results: [...field, runner] }, ctx()).html)).toContain('To split 2');
    expect(text(views.renderView('standings-lower-third', { controlCode: '1062', splitControls, results: field }, ctx()).html)).toContain('Split 2 - Control 62');
    expect(text(views.renderView('standings-lower-third', { splitControls, results: field }, ctx()).html)).toContain('Finish');
  });

  it('rows carry a stable key so live updates can move them', () => {
    const html = views.renderView('results', { results }, ctx({ rowsPerPage: 10 })).html;
    expect(html).toContain('data-key="Kasper Fosser|NOR"');
  });

  it('every generated kind renders without data', () => {
    for (const kind of views.kinds) {
      expect(() => views.renderView(kind, {}, ctx())).not.toThrow();
    }
  });
  it('uses selected event label language without changing graphic structure', () => {
    const swedish = views.renderView('start-list', { presentation: { language: 'sv' } }, ctx()).html;
    expect(text(swedish)).toContain('Startlista');
    const english = views.renderView('start-list', { presentation: { language: 'en' } }, ctx({ labels: { startList: 'Custom wording' } })).html;
    expect(text(english)).toContain('Start list');
    const defaults = views.renderView('start-list', {}, ctx({ labels: { startList: 'Custom wording' } })).html;
    expect(text(defaults)).toContain('Custom wording');
  });
  it('adds escaped sponsor logos and event series only to the title card', () => {
    const data = { event: { name: 'Race', series: 'League <2026>' }, presentation: { sponsorLogos: ['/assets/brand.png', '/assets/evil" onerror="alert(1).png'] } };
    const title = views.renderView('event-title', data, ctx()).html;
    expect(title).toContain('League &lt;2026&gt;');
    expect(title).toContain('title-sponsors');
    expect(title).toContain('brand.png');
    expect(title).not.toContain('" onerror="');
    expect(views.renderView('results', data, ctx()).html).not.toContain('title-sponsors');
  });

});

// Looks are downloaded as zips of their own folder, so a look must carry every font it uses
// and load nothing from other looks; on a new computer only _core and Standard are there.
describe('look zips are self-contained', () => {
  const fs = require('fs') as typeof import('fs');
  const setsDir = path.resolve(__dirname, '../../../../templates/sets');
  const looks = fs.readdirSync(setsDir).filter((d: string) => !d.startsWith('_') && fs.existsSync(path.join(setsDir, d, 'set.json')));
  const cssFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => e.isDirectory() ? cssFiles(path.join(dir, e.name)) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []);

  it.each(looks)('%s bundles its fonts and loads nothing from other looks', (look) => {
    const root = path.join(setsDir, look);
    const css = cssFiles(root);
    const faces = new Set<string>();
    for (const file of css) {
      const text = fs.readFileSync(file, 'utf-8');
      for (const m of text.matchAll(/url\(\s*['"]?([^)'"]+)/g)) {
        const url = m[1];
        if (/^(data:|https?:|#|%23)/.test(url)) continue; // %23: a fragment inside an inline SVG
        const target = path.resolve(path.dirname(file), url);
        const inLook = target.startsWith(root + path.sep);
        const inCore = target.startsWith(path.join(setsDir, '_core') + path.sep);
        expect(inLook || inCore, `${path.relative(setsDir, file)} loads ${url}`).toBe(true);
        expect(fs.existsSync(target), `${path.relative(setsDir, file)}: ${url} is missing`).toBe(true);
      }
      for (const m of text.matchAll(/@font-face\s*{[^}]*font-family:\s*['"]?([^;'"]+)/g)) faces.add(m[1].trim());
    }
    // the look's own logo (set.json "logo") is in its folder
    const meta = JSON.parse(fs.readFileSync(path.join(root, 'set.json'), 'utf-8'));
    if (meta.logo) expect(fs.existsSync(path.join(root, meta.logo)), `${look}: logo ${meta.logo} is missing`).toBe(true);
    // the first family of every font stack in the theme is bundled, so all computers look the same
    const theme = fs.readFileSync(path.join(root, 'theme.css'), 'utf-8');
    for (const m of theme.matchAll(/(?:--[a-z-]+|font-family)\s*:\s*['"]?([A-Z][^,;'"]*)['"]?\s*,[^;]*;/g)) {
      expect(faces, `${look}: "${m[1]}" is not bundled`).toContain(m[1].trim());
    }
  });
});

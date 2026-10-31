import { describe, it, expect } from 'vitest';
import { applySuggestion, commandForDraft, commandSyntax, nextStarter, parseCommand, type PaletteData } from '../command';
import { DEFAULT_DESK_COMMANDS, DESK_TEMPLATES } from '../../../../shared/desk';

// The grammar tests use their own fixed numbering, independent of the default order
const GRAMMAR_ORDER = ['runner-identity', 'runner-start', 'start-group', 'start-list', 'live-feed', 'results', 'runner-splits',
  'position-history', 'podium', 'event-title', 'course-info', 'weather', 'free-text', 'speaker', 'timer'];
const GRAMMAR_COMMANDS = Object.fromEntries(GRAMMAR_ORDER.map((key, i) => [String(i), key]));

const data: PaletteData = {
  commands: GRAMMAR_COMMANDS,
  available: new Set(DESK_TEMPLATES.map(t => t.key)),
  classes: ['Women Elite', 'Men Elite', 'H21'],
  runners: [
    { name: 'Jan Novák', club: 'OK Lokomotiva', className: 'Men Elite', bib: '101' },
    { name: 'Petr Svoboda', club: 'SK Praga', className: 'Men Elite', bib: '102' },
    { name: 'Eva Dvořáková', club: 'TJ Turnov', className: 'Women Elite', bib: '201' },
    { name: 'Jens Berg', club: 'OK Linné', className: 'H21', virtualBib: 'V7' }
  ],
  controls: (cls) => (cls === 'Men Elite' ? [{ code: 213, name: 'Radio control' }, { code: 214, name: 'Finish-approach control' }] : [])
};

describe('next starter', () => {
  it('selects the earliest future start and ignores past or missing start times', () => {
    const now = 1_000;
    const runners = [
      { name: 'Already started', club: '', className: 'A', startTimeMs: 900 },
      { name: 'Later', club: '', className: 'A', startTimeMs: 1_200 },
      { name: 'Next', club: '', className: 'B', startTimeMs: 1_100 },
      { name: 'No start time', club: '', className: 'A' }
    ];

    expect(nextStarter(runners, now)?.name).toBe('Next');
  });

  it('returns no starter when there are no future start times', () => {
    expect(nextStarter([{ ...data.runners[0], startTimeMs: 999 }], 1_000)).toBeUndefined();
  });
});

describe('command palette grammar', () => {
  it('lists graphics before anything is typed', () => {
    const p = parseCommand('', data);
    expect(p.next).toBe('graphic');
    expect(p.suggestions[0]).toMatchObject({ token: '0', label: 'Runner identity' });
    expect(p.suggestions.some(s => s.label === 'PS team standings')).toBe(false); // not in this look
  });

  it('"0 2 101" = runner identity, class 2, bib 101 (complete, loads a draft)', () => {
    const p = parseCommand('0 2 101', data);
    expect(p.interpretation).toEqual(['Runner identity', 'Men Elite', 'Jan Novák']);
    expect(p.complete).toBe(true);
    expect(p.draft).toEqual({ key: 'runner-identity', values: { className: 'Men Elite', runnerName: 'Jan Novák', runnerClub: 'OK Lokomotiva', runnerBib: '101' }, fields: {} });
  });

  it('suggests runners while the bib is incomplete, filtered by class', () => {
    const p = parseCommand('0 2 10', data);
    expect(p.complete).toBe(false);
    expect(p.next).toBe('runner');
    expect(p.interpretation).toEqual(['Runner identity', 'Men Elite', 'Runner: 10…']);
    expect(p.suggestions.map(s => s.label)).toEqual(['Jan Novák', 'Petr Svoboda']);
    expect(applySuggestion('0 2 10', p.suggestions[1], p)).toBe('0 2 102 ');
  });

  it('a blank class searches the whole competition; runners can be found by name', () => {
    const p = parseCommand('6 1 eva', data);
    expect(p.error).toBeUndefined();
    const names = parseCommand('0 1 Jens', { ...data, classes: data.classes });
    expect(names.error).toContain('No runner'); // Jens is not in class 1 (Women Elite)
    expect(names.suggestions.map(s => s.label)).toEqual(['Eva Dvořáková']); // recovery: that class's runners
    expect(parseCommand('0 3 V7', data).draft?.values.runnerName).toBe('Jens Berg'); // virtual bib
  });

  it('"4 2 213" = live feed at control 213 of class 2; the runner is optional', () => {
    const p = parseCommand('4 2 213', data);
    expect(p.interpretation).toEqual(['Live split', 'Men Elite', 'Control 213']);
    expect(p.complete).toBe(true);
    expect(p.draft?.values).toEqual({ className: 'Men Elite', controlCode: '213' });
    expect(parseCommand('4 2 F', data).interpretation).toContain('Finish');
  });

  it('explains an unavailable control and offers the valid ones (no output)', () => {
    const p = parseCommand('4 2 999 ', data);
    expect(p.complete).toBe(false);
    expect(p.error).toBe('Control 999 is unavailable for Men Elite');
    expect(p.errorToken).toBe('Control 999');
    expect(p.suggestions.map(s => s.token)).toEqual(['F', '213', '214']);
    expect(applySuggestion('4 2 999 ', p.suggestions[1], p)).toBe('4 2 213 ');
  });

  it('asks for what is required next', () => {
    const p = parseCommand('3 ', data);
    expect(p.next).toBe('class');
    expect(p.message).toBe('Choose a class to complete the command');
    expect(p.complete).toBe(false);
    expect(parseCommand('3 2 2', data)).toMatchObject({ complete: true, draft: { page: 2 } });
  });

  it('rejects unknown numbers and extra parameters', () => {
    expect(parseCommand('42 1', data).error).toBe('No graphic has number 42');
    expect(parseCommand('9 1', data).error).toContain('takes no more than 0 parameters');
    // a graphic the event's look does not have
    const noPodium = { ...data, available: new Set([...data.available].filter(k => k !== 'podium')) };
    expect(parseCommand('8 1', noPodium).error).toContain('not in this event');
  });

  it('runner focus: start by default, or a control or the finish after the runner', () => {
    // 1 = Runner focus: class, runner, timing point
    expect(parseCommand('1 2 101', data)).toMatchObject({ complete: true, draft: { key: 'runner-start', values: { runnerName: 'Jan Novák' } } });
    expect(parseCommand('1 2 101', data).draft?.values.controlCode).toBeUndefined();
    const atControl = parseCommand('1 2 101 213', data);
    expect(atControl.interpretation).toEqual(['Runner focus', 'Men Elite', 'Jan Novák', 'Control 213']);
    expect(atControl.draft?.values.controlCode).toBe('213');
    expect(parseCommand('1 2 101 F', data).draft?.values.controlCode).toBe('F');
    expect(parseCommand('1 2 101 S', data).interpretation).toContain('Start');
    // a typed name followed by a timing point
    const byName = parseCommand('1 2 Jan Novák 213', data);
    expect(byName.draft?.values).toMatchObject({ runnerName: 'Jan Novák', controlCode: '213' });
    expect(byName.complete).toBe(true);
    // elsewhere F still means the finish (no control code)
    expect(parseCommand('4 2 F', data).draft?.values.controlCode).toBe('');
  });

  it('a bib no longer swallows what follows it', () => {
    expect(parseCommand('0 2 101 9', data).error).toContain('takes no more than 2 parameters');
  });

  it('graphics hidden in Settings are left out', () => {
    const hidden = { ...data, hidden: new Set(['podium']) };
    expect(parseCommand('', hidden).suggestions.some(x => x.label.startsWith('Podium'))).toBe(false);
    expect(parseCommand('8 1', hidden).error).toBe('Podium / flowers is hidden in Settings → Templates');
  });

  it('graphics without parameters are complete at once', () => {
    expect(parseCommand('12', data)).toMatchObject({ complete: true, draft: { key: 'free-text' } });
  });

  it('follows a custom command map', () => {
    const custom = { ...data, commands: { '7': 'results' } };
    expect(parseCommand('7 2', custom).interpretation).toEqual(['Results table', 'Men Elite']);
    expect(parseCommand('5 2', custom).error).toBe('No graphic has number 5');
  });
});

describe('default command numbers', () => {
  it('follow the built-in order', () => {
    expect(Object.entries(DEFAULT_DESK_COMMANDS).map(([n, key]) => `${n} ${key}`)).toEqual([
      '0 event-title', '1 live-feed', '2 runner-identity', '3 runner-start', '4 results', '5 runner-splits', '6 start-list',
      '7 free-text', '8 course-info', '9 timer', '10 weather', '11 podium', '12 position-history', '13 speaker', '14 start-group'
    ]);
  });
});

describe('favourites in the palette', () => {
  const fav = (n: number, label: string, runnerName: string) =>
    ({ id: `f${n}`, n, label, created: 0, draft: { key: 'runner-identity', values: { className: 'Men Elite', runnerName }, fields: {} } });
  const withFavs: PaletteData = { ...data, favorites: { 'runner-identity': [fav(2, 'Petr', 'Petr Svoboda'), fav(1, 'Jan', 'Jan Novák')] } };

  it('"0 F1" loads favourite F1 of the graphic as a complete draft', () => {
    const p = parseCommand('0 F1', withFavs);
    expect(p.complete).toBe(true);
    expect(p.draft).toMatchObject({ key: 'runner-identity', values: { runnerName: 'Jan Novák' } });
    expect(parseCommand('0 f2', withFavs).draft?.values.runnerName).toBe('Petr Svoboda');
  });

  it('offers the favourites right after the graphic, F1 first', () => {
    const p = parseCommand('0 ', withFavs);
    expect(p.suggestions.slice(0, 2).map(s => s.token)).toEqual(['F1', 'F2']);
    expect(parseCommand('0 F', withFavs).suggestions.map(s => s.token)).toEqual(['F1', 'F2']);
  });

  it('rejects a missing favourite and parameters after a favourite', () => {
    expect(parseCommand('0 F9 ', withFavs).error).toContain('no favourite F9');
    expect(parseCommand('0 F1 2', withFavs).error).toContain('takes no parameters');
  });

  it('leaves "F" alone for graphics without favourites', () => {
    expect(parseCommand('0 F', data).next).not.toBe('favourite');
  });
});

describe('syntax line', () => {
  const syntax = (input: string, d: PaletteData = data) => commandSyntax(input, parseCommand(input, d), d);

  it('shows nothing until the graphic number is recognised', () => {
    expect(syntax('')).toBeNull();
    expect(syntax('99')).toBeNull();
  });

  it('marks done parts with their values, the part being typed, and what comes next', () => {
    const s = syntax('0 2 ')!;
    expect(s.number).toBe('0');
    expect(s.parts.map(p => `${p.param}:${p.state}`)).toEqual(['class:done', 'runner:current']);
    expect(s.label).toBe('Runner identity');
    expect(s.parts[0]).toMatchObject({ token: '2', value: 'Men Elite', label: 'Class', range: '1–3' });
    expect(s.parts[1].hint).toBe('bib or name');
  });

  it('shows optional parts and the timing point choices of runner focus', () => {
    const s = syntax('1 ')!; // runner-start in the grammar numbering: class, runner, control
    expect(s.parts.map(p => `${p.param}${p.optional ? '?' : ''}`)).toEqual(['class?', 'runner', 'control?']);
    expect(s.parts.find(p => p.param === 'control')?.hint).toContain('S start');
  });

  it("lists the graphic's favourites, and shows the favourite once one is chosen", () => {
    const fav = (n: number) => ({ id: `f${n}`, n, label: `Fav ${n}`, created: 0, draft: { key: 'runner-identity', values: { runnerName: 'Jan Novák' }, fields: {} } });
    const withFavs = { ...data, favorites: { 'runner-identity': [fav(2), fav(1)] } };
    expect(syntax('0 ', withFavs)!.favorites).toEqual(['F1', 'F2']);
    const chosen = syntax('0 F2', withFavs)!;
    expect(chosen.favorite).toBe(2);
    expect(chosen.parts).toEqual([]);
  });
});

describe('virtual bibs', () => {
  it('are found by their number alone, and a real bib with the same number wins', () => {
    expect(parseCommand('0 3 7', data).draft?.values.runnerName).toBe('Jens Berg'); // V7
    const clash: PaletteData = { ...data, runners: [...data.runners, { name: 'Real Seven', club: 'X', className: 'H21', bib: '7' }] };
    // A finished entry (followed by a space): the real bib 7 wins over V7
    expect(parseCommand('0 3 7 ', clash).draft?.values.runnerName).toBe('Real Seven');
    expect(parseCommand('0 3 V7 ', clash).draft?.values.runnerName).toBe('Jens Berg');
  });

  it('shows the typed numbers and what they matched on the syntax line', () => {
    const p = parseCommand('0 3 7', data);
    const s = commandSyntax('0 3 7', p, data)!;
    expect(s.parts.map(x => `${x.token} ${x.value}`)).toEqual(['3 H21', 'V7 Jens Berg']);
  });
});


describe('command for a draft shown on air', () => {
  const draft = (key: string, values: Record<string, string> = {}, extra: object = {}) => ({ key, values, fields: {}, ...extra });

  it('writes the parameters the palette reads back as the same draft', () => {
    expect(commandForDraft(draft('runner-identity', { className: 'Men Elite', runnerName: 'Jan Novák', runnerBib: '101' }), data)).toBe('0 2 101');
    expect(commandForDraft(draft('live-feed', { className: 'Men Elite', controlCode: '213' }), data)).toBe('4 2 213');
    expect(commandForDraft(draft('live-feed', { className: 'Men Elite', controlCode: '' }), data)).toBe('4 2 F');
    expect(commandForDraft(draft('runner-start', { className: 'Men Elite', runnerName: 'Jan Novák', runnerBib: '101', controlCode: 'F' }), data)).toBe('1 2 101 F');
    expect(commandForDraft(draft('runner-start', { className: 'Men Elite', runnerName: 'Jan Novák', runnerBib: '101' }), data)).toBe('1 2 101');
    expect(commandForDraft(draft('results', { className: 'H21' }, { page: 2 }), data)).toBe('5 3 F 2');
    expect(commandForDraft(draft('free-text'), data)).toBe('12');
  });

  it('uses the runner name when there is no bib', () => {
    expect(commandForDraft(draft('runner-identity', { className: 'Men Elite', runnerName: 'Petr Svoboda' }), { ...data, runners: data.runners.map(r => ({ ...r, bib: undefined })) }))
      .toBe('0 2 Petr Svoboda');
  });

  it('names the favourite when the draft is one', () => {
    const fav = { id: 'f1', n: 3, label: 'Jan', created: 0, draft: draft('runner-identity', { className: 'Men Elite', runnerName: 'Jan Novák' }) };
    expect(commandForDraft(fav.draft, { ...data, favorites: { 'runner-identity': [fav] } })).toBe('0 F3');
  });

  it('gives up when no command can express the draft', () => {
    expect(commandForDraft(draft('runner-identity', { runnerName: 'Nobody Known' }), data)).toBeNull();
    expect(commandForDraft(draft('live-feed', { className: 'Men Elite' }), { ...data, commands: {} })).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { applySuggestion, nextStarter, parseCommand, type PaletteData } from '../command';
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


import { describe, expect, it } from 'vitest';
import {
  buildDesk, buildFieldMap, conflicts, deriveInputs, fieldRows, initialChoices, kindFor, replacementFor, suggest, typeWarning,
  type Choice,
} from '../helperModel';
import type { OGrafTemplateInfo, TemplateSetInfo } from '../../../../shared/types/ograf';

const schema = {
  type: 'object',
  properties: {
    headline: { type: 'string', title: 'Headline', default: 'Jane Doe' },
    subheadline: { type: 'string', title: 'Team' },
    style: { type: 'string', enum: ['news', 'sport'] },
    live_tag: { type: 'boolean', default: true },
    contestants: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, points: { type: 'number' }, rank: { type: 'integer' } } } },
  },
};

describe('import helper: rows and suggestions', () => {
  it('lists every top-level field, with examples and list rows', () => {
    const rows = fieldRows(schema);
    expect(rows.map((r) => [r.key, r.type])).toEqual([['headline', 'string'], ['subheadline', 'string'], ['style', 'string'], ['live_tag', 'boolean'], ['contestants', 'list']]);
    expect(rows[0].example).toBe('Jane Doe');
    expect(rows[4].items!.map((r) => r.key)).toEqual(['name', 'points', 'rank']);
  });
  it('suggests our data from the field name and title', () => {
    const rows = fieldRows(schema);
    expect(suggest(rows[0])).toEqual({ kind: 'data', key: 'runnerName' });
    expect(suggest(rows[1])).toEqual({ kind: 'data', key: 'runnerClub' });
    expect(suggest(rows[2])).toBeNull();
    expect(suggest(rows[4])).toEqual({ kind: 'list', from: 'results', items: { name: 'name', points: 'timeSeconds', rank: 'position' } });
  });
  it('starts with suggestions marked automatic, and the rest needing a choice', () => {
    const start = initialChoices(fieldRows(schema));
    expect(start.headline).toMatchObject({ kind: 'data', key: 'runnerName', auto: true });
    expect(start.style).toEqual({ kind: 'unset' });
    expect(start.live_tag).toEqual({ kind: 'typed' }); // a boolean with a default stays typed
  });
  it('warns when a number field gets text, and offers the seconds version', () => {
    const points = fieldRows(schema)[4].items![1];
    expect(typeWarning(points, 'time')).toMatch(/number/);
    expect(typeWarning(points, 'timeSeconds')).toBeNull();
    expect(typeWarning(fieldRows(schema)[0], 'runnerName')).toBeNull();
  });
});

describe('import helper: what Live asks for', () => {
  const c = (o: Record<string, Choice>) => o;
  it('follows from the matches', () => {
    expect(deriveInputs(c({ a: { kind: 'data', key: 'runnerName' } }))).toEqual({ inputs: ['runner'], required: ['runner'], feeds: [] });
    expect(deriveInputs(c({ a: { kind: 'list', from: 'results', items: {} } }))).toEqual({ inputs: ['class', 'control'], required: ['class'], feeds: ['timing'] });
    expect(deriveInputs(c({ a: { kind: 'data', key: 'className' }, b: { kind: 'data', key: 'event.name' }, d: { kind: 'data', key: 'temperature' } })))
      .toEqual({ inputs: ['class'], required: ['class'], feeds: ['weather', 'event'] });
    expect(deriveInputs(c({ a: { kind: 'typed' } }))).toEqual({ inputs: [], required: [], feeds: [] });
  });
  it('builds the desk entry and the field map', () => {
    const choices = c({ headline: { kind: 'data', key: 'runnerName' }, style: { kind: 'typed' }, contestants: { kind: 'list', from: 'results', items: { name: 'name', rank: 'typed' } } });
    expect(buildDesk({ label: 'Guest strap', short: '', choices })).toEqual({
      label: 'Guest strap', short: 'Guest strap', inputs: ['class', 'runner', 'control'], required: ['class', 'runner'], feeds: ['timing'], fields: ['style'],
    });
    expect(buildFieldMap(choices)).toEqual({ headline: 'runnerName', contestants: { from: 'results', items: { name: 'name' } } });
  });
});

describe('import helper: where and name', () => {
  const set = (id: string, name: string, source: 'built-in' | 'imported' = 'built-in') => ({ id, name, source, templateCount: 1 }) as TemplateSetInfo;
  const looks = [set('standard', 'Standard'), set('club', 'Club look', 'imported')];
  const g = (id: string, setId: string, label: string, params: string[] = []) =>
    ({ manifest: { id, name: label }, setId, desk: { key: id, kind: id, label, short: label, params, required: [], live: false } }) as unknown as OGrafTemplateInfo;
  const templates = [g('standard-free-text', 'standard', 'Identity plate'), g('standard-runner-identity', 'standard', 'Runner identity', ['runner'])];

  it('makes a kind of its own, unique in the look', () => {
    expect(kindFor('standard', 'Guest Strap – Ö!', [])).toBe('standard-guest-strap-o');
    expect(kindFor('standard', 'Guest strap', ['standard-guest-strap'])).toBe('standard-guest-strap-2');
    expect(kindFor('standard', '!!!', [])).toBe('standard-graphic');
  });
  it('refuses a label the look already uses and a new look name already taken', () => {
    expect(conflicts({ target: { lookId: 'standard' }, label: 'identity plate', looks, templates, selfId: 'x' })).toEqual([expect.stringMatching(/already has/)]);
    expect(conflicts({ target: { lookId: 'standard' }, label: 'Guest strap', looks, templates, selfId: 'x' })).toEqual([]);
    expect(conflicts({ target: { newLookName: 'club look' }, label: 'A', looks, templates, selfId: 'x' })).toEqual([expect.stringMatching(/already/)]);
    expect(conflicts({ target: { newLookName: '' }, label: '', looks, templates, selfId: 'x' })).toHaveLength(2);
    expect(conflicts({ target: { lookId: 'standard' }, label: 'Identity plate', looks, templates, selfId: 'standard-free-text' })).toEqual([]);
  });
  it('suggests replacing a graphic of the look that asks for the same inputs', () => {
    expect(replacementFor(templates, 'standard', ['runner'], 'x')?.manifest.id).toBe('standard-runner-identity');
    expect(replacementFor(templates, 'standard', [], 'x')).toBeNull();
  });
});

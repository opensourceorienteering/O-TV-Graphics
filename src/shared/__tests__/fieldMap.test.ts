import { describe, expect, it } from 'vitest';
import { applyFieldMap, fieldMapWarnings, parseClock } from '../fieldMap';

const data = {
  runnerName: 'Tove Alexandersson', runnerClub: 'Stora Tuna OK', headline: 'typed',
  event: { name: 'SM Medel', location: 'Falun' },
  results: [
    { name: 'A', club: 'X', position: 1, time: '15:52', diff: '', status: 'OK' },
    { name: 'B', club: 'Y', position: 2, time: '1:02:03', diff: '+1:23', status: 'OK' },
  ],
};

describe('field map: our data under the graphic\'s own names', () => {
  it('sets single values, dotted ones included, and passes everything else through', () => {
    const out = applyFieldMap({ headline: 'runnerName', subheadline: 'runnerClub', where: 'event.location' }, data);
    expect(out).toMatchObject({ headline: 'Tove Alexandersson', subheadline: 'Stora Tuna OK', where: 'Falun', runnerName: 'Tove Alexandersson' });
  });
  it('maps a list row by row, with times as numbers when asked', () => {
    const out = applyFieldMap({ contestants: { from: 'results', items: { label: 'name', points: 'timeSeconds', rank: 'position', gap: 'diffSeconds' } } }, data);
    expect(out.contestants).toEqual([
      { label: 'A', points: 952, rank: 1, gap: null },
      { label: 'B', points: 3723, rank: 2, gap: 83 },
    ]);
  });
  it('keeps a typed or default value when our data has nothing for it', () => {
    expect(applyFieldMap({ headline: 'runnerBib' }, data).headline).toBe('typed');
    expect(applyFieldMap({ rows: { from: 'results', items: { n: 'name' } } }, { rows: [{ n: 'default' }] }).rows).toEqual([{ n: 'default' }]);
  });
  it('does nothing without a map', () => {
    expect(applyFieldMap(undefined, data)).toBe(data);
    expect(applyFieldMap('nonsense', data)).toBe(data);
  });
});

describe('field map checks', () => {
  const schema = { properties: { headline: { type: 'string' }, contestants: { type: 'array', items: { type: 'object' } }, tag: { type: 'boolean' } } };
  it('accepts a correct map', () => {
    expect(fieldMapWarnings({ headline: 'runnerName', contestants: { from: 'results', items: { name: 'name', pts: 'timeSeconds' } } }, schema)).toEqual([]);
  });
  it('explains each mistake', () => {
    expect(fieldMapWarnings([], schema)).toHaveLength(1);
    const w = fieldMapWarnings({
      nothere: 'runnerName', headline: 'shoeSize', tag: { from: 'results', items: {} },
      contestants: { from: 'splits', items: { n: 'nickname' } },
    }, schema);
    expect(w.join('\n')).toMatch(/nothere/);
    expect(w.join('\n')).toMatch(/shoeSize/);
    expect(w.join('\n')).toMatch(/tag.*not a list/);
    expect(w.join('\n')).toMatch(/splits/);
    expect(w.join('\n')).toMatch(/nickname/);
  });
});

describe('clock times as seconds', () => {
  it.each([['15:52', 952], ['1:02:03', 3723], ['+1:23', 83], ['-0:05', -5], ['-', null], ['', null], [61, 61], ['12.5', 12.5], [undefined, null]])('%s → %s', (input, out) => {
    expect(parseClock(input)).toBe(out);
  });
});

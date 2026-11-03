import { beforeAll, describe, expect, it } from 'vitest';
let view: any, sequence: any, key: any;
beforeAll(async () => {
  const modulePath = '../../../templates/sets/sof/sof-runner-presentations/view.js';
  ({ default: view, presentationSteps: sequence, presentationRunnerKey: key } = await import(modulePath));
});
const runners = [
  { name: 'Anna Runner', club: 'OK One', startTime: '10:00', bib: '1' },
  { name: 'Bea Runner', club: 'OK Two', startTime: '10:02', bib: '2' },
  { name: 'Chris Runner', club: 'OK Three', startTime: '10:04', bib: '3' },
  { name: 'Dana Runner', club: 'OK Four', startTime: '10:06', bib: '4' },
];
const context = { id: 'sof', rowsPerPage: 10, step: 1 };

describe('SOFT runner presentations', () => {
  it('starts normal and focuses picked runners in start order across pages', () => {
    const data = { results: [...runners].reverse(), rowsPerPage: 2, highlightRunners: [key(runners[3]), key(runners[1]), key(runners[0])] };
    const { steps } = sequence(data);
    expect(steps.map((s: any) => [s.page, s.focus])).toEqual([
      [0, null], [0, key(runners[0])], [0, key(runners[1])],
      [1, null], [1, key(runners[3])], [1, null],
    ]);
    const states = steps.map((_: any, i: number) => view(data, { ...context, step: i + 1 }));
    expect(states.every((s: any) => s.steps === 6)).toBe(true);
    expect(states[0].html).not.toContain('is-presented');
    expect(states[1].html.match(/is-presented/g)).toHaveLength(1);
    expect(states[1].pageKey).toBe(states[2].pageKey);
    expect(states[2].pageKey).not.toBe(states[3].pageKey);
    expect(states[3].html).toContain('2/2');
    expect(states[3].html).not.toContain('Anna');
    expect(states[5].html).not.toContain('is-presented');
    expect(view(data, { ...context, step: 999 }).html).toBe(states[5].html);
    // Previous uses the same deterministic state sequence.
    expect(view(data, { ...context, step: 2 }).html).toBe(states[1].html);
  });
  it('behaves as a normal start list with no picks and handles an empty class', () => {
    expect(sequence({ results: runners, rowsPerPage: 2 }).steps).toHaveLength(2);
    expect(view({ results: [] }, context)).toMatchObject({ steps: 1, pageKey: 'page-0' });
    expect(view({ results: [] }, context).html).toContain('No start list');
  });
  it('ignores stale and duplicate picks, distinguishes clubs, and supports bib-less runners', () => {
    const sameName = [{ ...runners[0], bib: '' }, { ...runners[0], club: 'Other club', bib: '' }];
    const data = { results: sameName, highlightRunners: [key(sameName[1]), key(sameName[1]), 'gone'] };
    const { steps } = sequence(data);
    expect(steps.map((s: any) => s.focus)).toEqual([null, key(sameName[1]), null]);
    const html = view(data, { ...context, step: 2 }).html;
    expect(html).toContain('no-bibs');
    expect(html.match(/is-presented/g)).toHaveLength(1);
  });
  it('escapes timing data and clamps invalid row counts', () => {
    const html = view({ results: [{ name: '<script>alert(1)</script>', club: 'OK' }], rowsPerPage: -1 }, context).html;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(sequence({ results: runners, rowsPerPage: -1 }).pages).toBe(4);
  });
});

it('automatically presents favourite runners while respecting an explicit selection or clear', () => {
  const results = runners.map((r, i) => ({ ...r, favourite: i === 1 || i === 3 }));
  expect(sequence({ results }).steps.map((s: any) => s.focus)).toEqual([null, key(results[1]), key(results[3]), null]);
  expect(sequence({ results, highlightRunners: [] }).steps.map((s: any) => s.focus)).toEqual([null]);
  expect(sequence({ results, highlightRunners: [key(results[0])] }).steps.map((s: any) => s.focus)).toEqual([null, key(results[0]), null]);
});

import { beforeAll, describe, expect, it } from 'vitest';
let createView: any, measured: any;
beforeAll(async () => {
  const modulePath = '../../../templates/sets/sof/sof-finish-watch/view.js';
  ({ createFinishWatchView: createView, measuredResult: measured } = await import(modulePath));
});
const runner = { name: 'Approaching Runner', club: 'OK', className: 'D21', startTimeMs: 40000, statusCode: 10, time: '--:--', splitTimes: [{ code: 45, time: 5000, place: 1 }] };
const data = (results: any[], at = 100000, extra: object = {}) => ({ triggerControl: '45', measureControl: 'F', results, frozenAt: at, holdSeconds: 4, ...extra });
const context = { nameStyle: { table: 'full' } };
const text = (html: string) => html.replace(/<[^>]*>/g, '');

describe('SOFT finish watch', () => {
  it('uses the prewarning as a trigger and runs total race time, not the interval', () => {
    const view = createView();
    expect(view(data([{ ...runner, splitTimes: [] }]), context).html).not.toContain('Approaching Runner');
    const shown = view(data([runner]), context);
    expect(text(shown.html)).toContain('Approaching Runner');
    expect(shown.html).toContain('data-t="40000"');
    expect(text(shown.html)).toContain('1:00'); // Total race time; interval since prewarning is 0:10.
    expect(text(view(data([runner], 105000), context).html)).toContain('1:05');
  });
  it('freezes at the finish, holds from receipt, and expires without another data update', () => {
    const view = createView();
    view(data([runner]), context);
    const finish = { ...runner, statusCode: 0, time: '1:20', finishTimeMs: 80000, position: 2 };
    const registered = view(data([finish], 150000), context);
    expect(registered.html).toContain('is-registered');
    expect(registered.html).not.toContain('data-tick');
    expect(text(registered.html)).toContain('1:20');
    expect(view(data([finish], 153999), context).html).toContain('is-registered');
    expect(view(data([finish], 154000), context).html).toContain('is-leaving');
    expect(text(view(data([finish], 154500), context).html)).not.toContain('Approaching Runner');
    expect(view(data([finish], 180000), context).html).not.toContain('is-registered');
  });
  it('measures a second radio as cumulative race time and shows that point’s official place', () => {
    const atRadio = { ...runner, splitTimes: [...runner.splitTimes, { code: 62, time: 7000, place: 3 }] };
    const view = createView();
    view(data([runner], 100000, { measureControl: '62' }), context);
    const shown = view(data([atRadio], 110000, { measureControl: '62' }), context);
    expect(measured(atRadio, '62')).toEqual({ ms: 70000, place: 3 });
    expect(text(shown.html)).toContain('1:10'); // Not the 0:20 interval.
    expect(shown.html).toContain('Registered placing');
  });
  it('does not replay historical completions and keeps graphic instances independent', () => {
    const finish = { ...runner, statusCode: 0, time: '1:20', position: 2 };
    const first = createView(), second = createView();
    first(data([runner]), context);
    expect(first(data([finish]), context).html).toContain('is-registered');
    expect(second(data([finish]), context).html).not.toContain('is-registered');
  });
  it('calculates provisional placing within each runner’s class and supports a class filter', () => {
    const completed = { ...runner, name: 'Winner', statusCode: 0, time: '0:55', position: 1 };
    const other = { ...runner, className: 'H21', name: 'Other class', statusCode: 0, time: '0:50', position: 1 };
    const view = createView();
    const shown = view(data([completed, runner, other]), context);
    expect(shown.html).toContain('>2<small');
    expect(text(shown.html)).toContain('D21');
    const filtered = createView()(data([runner, { ...runner, name: 'Other class', className: 'H21' }], 100000, { className: 'D21' }), context);
    expect(text(filtered.html)).not.toContain('Other class');
  });
});


it('stops terminal statuses and clears rows absent from a successful snapshot', () => {
  const view = createView();
  view(data([runner]), context);
  expect(text(view(data([{ ...runner, statusCode: 2 }], 101000), context).html)).toContain('DNF');
  expect(view(data([{ ...runner, statusCode: 2 }], 106000), context).html).not.toContain('is-registered');
  const another = createView();
  another(data([runner]), context);
  expect(text(another(data([]), context).html)).not.toContain('Approaching Runner');
});

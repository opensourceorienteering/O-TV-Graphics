import { expect, it } from 'vitest';

it('provides every declared feed and schema defaults for an unknown graphic kind', async () => {
  const modulePath = '../../../site/preview/feeds.js';
  const { graphicFeedData } = await import(modulePath);
  const data = graphicFeedData({ desk: { feeds: ['timing', 'course', 'weather', 'event', 'unknown'] }, schema: { properties: { title: { default: 'Relay overview' } } } }, { competitionDate: '2026-11-02', className: 'D21', results: [{ name: 'Runner' }] });
  expect(data).toMatchObject({ title: 'Relay overview', length: '12.4', condition: 'Partly cloudy', event: { date: '2026-11-02' }, results: [{ name: 'Runner' }] });
  expect(graphicFeedData({ desk: { feeds: [] } }, {})).toEqual({});
  expect(graphicFeedData({}, {})).toHaveProperty('temperature');
});

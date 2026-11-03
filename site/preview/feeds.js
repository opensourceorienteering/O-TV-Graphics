/** Preview samples for the standard non-timing feeds. Timing comes from sim.js. */
export function sampleFeeds({ date, className } = {}) {
  return {
    event: {
      title: 'SM Långdistans', series: 'Svenska mästerskapen',
      place: 'Önnestad, Kristianstad', date,
      event: { name: 'SM Långdistans', series: 'Svenska mästerskapen', location: 'Önnestad, Kristianstad', date },
    },
    course: { title: className, length: '12.4', climb: '420', controls: '24', winningTime: '68 min', startInterval: '2 min', legs: 'Long distance' },
    weather: { title: 'Önnestad, Kristianstad', condition: 'Partly cloudy', temperature: '18', wind: '9', humidity: '62' },
  };
}

/** Unknown feeds are ignored; legacy graphics retain all the existing samples. */
export function graphicFeedData(graphic, timing) {
  const declared = graphic?.desk?.feeds;
  const feeds = Array.isArray(declared) ? declared : ['timing', 'course', 'weather', 'event'];
  const samples = { ...sampleFeeds({ date: timing.competitionDate, className: timing.className }), timing };
  const data = {};
  for (const feed of feeds) if (Object.hasOwn(samples, feed)) Object.assign(data, samples[feed]);
  // A schema default is the author's choice until the operator overrides it.
  for (const [key, schema] of Object.entries(graphic?.schema?.properties ?? {})) {
    if (schema && schema.default !== undefined) data[key] = schema.default;
  }
  return data;
}

/** ČO set configuration, shared by every graphic in this set */
export default {
  id: 'cz',
  // class left, timing point right ("Mellantid 2 Önnestad") in results and live split
  timingHeader: true,
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  durations: { in: 520, out: 520, stepOut: 220, step: 320 },
  rowsPerPage: 10,
  colorVars: ['--primary', '--secondary', '--split-neg'],
  nameStyle: { table: 'family-given', lower: 'family-initial', strap: 'family-given' },
  labels: {}
};

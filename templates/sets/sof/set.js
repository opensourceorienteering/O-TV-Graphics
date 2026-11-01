/** Svensk Orientering set configuration, shared by every graphic in this set */
export default {
  id: 'sof',
  // class left, timing point right ("Mellantid 2 Önnestad") in results and live split
  timingHeader: true,
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  durations: { in: 900, out: 320, stepOut: 200, step: 560 },
  rowsPerPage: 10,
  colorVars: ['--blue', '--yellow', '--deep'],
  nameStyle: { table: 'full', lower: 'full', strap: 'full' },
  labels: {}
};

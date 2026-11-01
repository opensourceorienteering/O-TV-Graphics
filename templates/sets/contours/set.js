/** Contours set configuration, shared by every graphic in this set */
export default {
  id: 'contours',
  // class left, timing point right ("Mellantid 2 Önnestad") in results and live split
  timingHeader: true,
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  durations: { in: 950, out: 380, stepOut: 220, step: 600 },
  rowsPerPage: 10,
  colorVars: ['--red', '--blue', '--green'],
  nameStyle: { table: 'full', lower: 'full', strap: 'full' },
  labels: { standingsAt: 'Standings at', startList: 'Start list', positionHistory: 'Position history', podium: 'Flower ceremony' }
};

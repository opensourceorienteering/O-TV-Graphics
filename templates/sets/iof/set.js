/** IOF set configuration, shared by every graphic in this set */
export default {
  id: 'iof',
  // class left, timing point right ("Mellantid 2 Önnestad") in results and live split
  timingHeader: true,
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  durations: { in: 1000, out: 460, stepOut: 200, step: 500 },
  rowsPerPage: 10,
  colorVars: ['--red', '--blue', '--green'],
  nameStyle: { table: 'full', lower: 'family', strap: 'full' },
  labels: { standingsAt: 'Standings at', startList: 'Start list', positionHistory: 'Position history', podium: 'Flower ceremony' }
};

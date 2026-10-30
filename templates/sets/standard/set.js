/** Standard set configuration, shared by every graphic in this set. */
export default {
  id: 'standard',
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  durations: { in: 1120, out: 280, stepOut: 180, step: 700 },
  rowsPerPage: 10,
  colorVars: ['--accent', '--surface', '--success'],
  nameStyle: { table: 'full', lower: 'full', strap: 'full' },
  labels: {
    standingsAt: 'Standings at',
    startList: 'Start list',
    positionHistory: 'Position history',
    podium: 'Podium'
  }
};

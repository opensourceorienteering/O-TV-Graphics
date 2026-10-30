/** Bold (Typography) set configuration, shared by every graphic in this set */
export default {
  id: 'bold',
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  durations: { in: 1150, out: 340, stepOut: 220, step: 650 },
  rowsPerPage: 10,
  colorVars: ['--hot', '--ink', '--paper'],
  nameStyle: { table: 'family-given', lower: 'family-given', strap: 'full' },
  labels: {}
};

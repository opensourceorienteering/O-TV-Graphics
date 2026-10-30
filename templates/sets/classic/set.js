/** Classic set configuration, shared by every core-based graphic in this set */
export default {
  id: 'classic',
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  durations: { in: 1260, out: 260, stepOut: 200, step: 700 },
  rowsPerPage: 10,
  colorVars: ['--red', '--teal', '--mint'],
  nameStyle: { table: 'full', lower: 'full', strap: 'full' },
  labels: {}
};

/** Classic set configuration, shared by every core-based graphic in this set */
export default {
  id: 'classic',
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  durations: { in: 900, out: 300, stepOut: 200, step: 500 },
  rowsPerPage: 10,
  colorVars: ['--red', '--teal', '--mint'],
  nameStyle: { table: 'full', lower: 'full', strap: 'full' },
  labels: {}
};

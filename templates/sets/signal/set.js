/** Signal (RGB split) set configuration, shared by every graphic in this set */
export default {
  id: 'signal',
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  // the look's own logo, in the logo boxes with "Use template logo" (Split Control)
  logo: new URL('./split-control-logo.svg', import.meta.url).href,
  durations: { in: 1100, out: 360, stepOut: 200, step: 620 },
  rowsPerPage: 10,
  colorVars: ['--chan-r', '--chan-c', '--ink'],
  nameStyle: { table: 'full', lower: 'full', strap: 'full' },
  labels: {}
};

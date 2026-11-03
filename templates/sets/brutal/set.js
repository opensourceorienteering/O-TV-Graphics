/** Brutal (Neubrutalism) set configuration, shared by every graphic in this set */
export default {
  id: 'brutal',
  theme: new URL('./theme.css', import.meta.url).href,
  fonts: new URL('./fonts/fonts.css', import.meta.url).href,
  // the look's own logo, in the logo boxes with "Use template logo" (Split Control)
  logo: new URL('./split-control-logo.svg', import.meta.url).href,
  durations: { in: 1050, out: 300, stepOut: 180, step: 600 },
  rowsPerPage: 10,
  colorVars: ['--pop-a', '--pop-b', '--pop-c'],
  nameStyle: { table: 'full', lower: 'full', strap: 'full' },
  labels: {}
};

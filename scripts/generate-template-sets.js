#!/usr/bin/env node
/**
 * Generate the OGraf graphic packages of every template set from one catalogue.
 *
 *   node scripts/generate-template-sets.js
 *
 * For each set in templates/sets/<set>/ (set.js + theme.css) and each kind below it writes
 *   templates/sets/<set>/<set>-<kind>/<set>-<kind>.ograf.json
 *   templates/sets/<set>/<set>-<kind>/graphic.js
 *   templates/sets/<set>/<set>-<kind>/<set>-<kind>.datasource.json   (live-data kinds)
 * Hand-made graphics in a set are left alone.
 * Re-run after changing the catalogue; the generated files are committed.
 */

const fs = require('fs');
const path = require('path');

const SETS_DIR = path.join(__dirname, '..', 'templates', 'sets');
const SCHEMA_URL = 'https://ograf.ebu.io/v1/specification/json-schemas/graphics/schema.json';

const SETS = {
  standard: { label: 'Standard', skip: [] },
  iof: { label: 'IOF', skip: [] },
  iof2: { label: 'IOF 2.0', skip: [] },
  contours: { label: 'Contours', skip: [] },
  cz: { label: 'ČO', skip: [] },
  signal: { label: 'Signal', skip: [] },
  brutal: { label: 'Brutal', skip: [] },
  bold: { label: 'Bold', skip: [] },
  sof: { label: 'Svensk Orientering', skip: [] }
};

// --- data source building blocks -------------------------------------------------------
const classSelector = { type: 'class-selector', label: 'Class', helpText: 'Class to show', required: true, storeAs: 'className', compact: true };
const controlSelector = (required = false) => ({
  type: 'control-point-selector', label: 'Timing point', helpText: 'Finish or a radio control',
  required, storeAs: 'controlCode', multiple: false, includeFinish: true
});
const runnerSearch = (required) => ({
  type: 'runner-search', label: 'Runner', helpText: 'Search by name or bib', required,
  storeAs: 'runnerId', searchBy: 'both', placeholder: 'Name or bib...',
  populateFields: { runnerName: 'name', runnerClub: 'club', runnerBib: 'bib' }
});
const mapping = (templateField, apiPath, extra = {}) => ({
  templateField, apiPath, required: false, autoPopulated: true, allowOverride: false, showInUI: false, ...extra
});
const common = [
  mapping('className', 'className', { required: true, allowOverride: true, showInUI: true, uiLabel: 'Class name', uiHelpText: 'Override the class name shown' }),
  mapping('results', 'results', { required: true })
];

function datasource(controls, extraMappings = [], fixedValues) {
  return {
    version: '1.0',
    mode: 'api',
    api: {
      provider: 'liveresults',
      fieldMappings: [...common, ...extraMappings],
      uiControls: controls,
      ...(fixedValues ? { fixedValues } : {}),
      autoUpdate: { defaultEnabled: true }
    }
  };
}

// --- manual fields ----------------------------------------------------------------------
const str = (title, description, extra = {}) => ({ type: 'string', title, description, ...extra });
const num = (title, description, def) => ({ type: 'number', title, description, default: def });
const bool = (title, description, def) => ({ type: 'boolean', title, description, default: def });
const nameStyle = { type: 'string', title: 'Names', description: 'Last name only adds the first initial when two runners share it ("HUBMANN D.")',
  enum: ['', 'family', 'full', 'given-initial'], enumNames: ['Look default', 'Last name only', 'Full name', 'First name + last initial'], default: '' };
const positionChange = bool('Position change', 'Show places gained ▲ or lost ▼ since the previous split', false);

const pagesActions = [
  { id: 'next-page', name: 'Next page', description: 'Show the next page', schema: null },
  { id: 'previous-page', name: 'Previous page', description: 'Show the previous page', schema: null },
  { id: 'first-page', name: 'First page', description: 'Back to page 1', schema: null }
];

/**
 * zone: where it sits on screen; graphics in clashing zones replace each other
 *   main (upper-centre tables), lower (bottom-left), side (bottom-right), corner (clock), full (title card)
 */
const KINDS = {
  results: {
    name: 'Results', zone: 'main', stepCount: -1, customActions: pagesActions,
    description: 'Results or standings at the finish or a radio control, paged (each play shows the next page).',
    schema: { title: str('Title', 'Header text (default: class name)'), rowsPerPage: num('Rows per page', 'Runners per page', 10), positionChange },
    datasource: datasource([classSelector, controlSelector()], [
      mapping('controlName', 'controlName', { allowOverride: true, showInUI: true, uiLabel: 'Control name', uiHelpText: 'Override the timing point name' })
    ])
  },
  'start-list': {
    name: 'Start list', zone: 'main', stepCount: -1, customActions: pagesActions,
    description: 'Start list of a class with start times, paged.',
    schema: { rowsPerPage: num('Rows per page', 'Runners per page', 12) },
    datasource: datasource([classSelector], [], { controlCode: 'Start' })
  },
  'standings-lower-third': {
    name: 'Standings lower third', zone: 'lower', stepCount: 1,
    description: 'Top runners at the finish or a radio control. With a runner selected: that runner and the runners around them, highlighted.',
    schema: { rows: num('Rows', 'Runners to show', 3), nameStyle, positionChange },
    datasource: datasource([classSelector, controlSelector(), runnerSearch(false)], [
      mapping('controlName', 'controlName', { allowOverride: true, showInUI: true, uiLabel: 'Control name' })
    ])
  },
  'runner-lower-third': {
    name: 'Runner lower third', zone: 'lower', stepCount: 1,
    description: 'One runner: place and time at the timing point, or a running clock until they get there; the leader for comparison.',
    schema: { showLeader: bool('Show leader', 'Show the leader below the runner', true) },
    datasource: datasource([classSelector, controlSelector(), runnerSearch(true)], [
      mapping('controlName', 'controlName', { allowOverride: true, showInUI: true, uiLabel: 'Control name' })
    ])
  },
  'runner-splits': {
    name: 'Runner split comparison', zone: 'side', stepCount: 1,
    description: 'One runner at every radio control: place, places gained or lost, and time behind the best.',
    schema: { maxControls: num('Controls shown', 'Latest radio controls to show', 6) },
    datasource: datasource([classSelector, runnerSearch(true)])
  },
  'position-history': {
    name: 'Position history', zone: 'main', stepCount: 1,
    description: 'Chart of the top runners\' places at each radio control and the finish.',
    schema: {
      runners: num('Runners', 'How many runners to draw (top at the finish)', 8),
      runnerNames: str('Runners to draw', 'Optional: names separated by commas, instead of the top runners')
    },
    datasource: datasource([classSelector])
  },
  podium: {
    name: 'Podium', zone: 'main', stepCount: 1,
    description: 'Flower ceremony / podium: places 1-3 in 2-1-3 order.',
    schema: { title: str('Title', 'Header text (default: class name)'), showTime: bool('Show time', 'Finishing time under each name', false) },
    datasource: datasource([classSelector])
  },
  'start-group': {
    name: 'Next starters', zone: 'lower', stepCount: 1,
    description: 'The next start minute of a class and who starts in it, with a countdown. Moves on to the next group by itself.',
    schema: { rows: num('Rows', 'Most runners to show', 6) },
    datasource: datasource([classSelector], [], { controlCode: 'Start' })
  },
  clock: {
    name: 'Race clock', zone: 'corner', stepCount: 1,
    description: 'Countdown to a time (then counts up), time since a start, or time of day.',
    schema: {
      label: str('Label', 'Text next to the clock, e.g. "Mass start"'),
      mode: { type: 'string', title: 'Mode', enum: ['countdown', 'elapsed', 'time-of-day'], default: 'countdown' },
      time: str('Time', 'HH:MM:SS (countdown target or start time)', { pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$' })
    }
  },
  'course-info': {
    name: 'Course facts', zone: 'side', stepCount: 1,
    description: 'Course parameters: length, climb, controls, estimated winning time, start interval.',
    schema: {
      title: str('Title', 'Class or course, e.g. "Women Long"'),
      legs: str('Legs', 'Relay legs, e.g. "Leg 1 & 3"'),
      length: str('Length (km)', 'e.g. 10.8'), climb: str('Climb (m)', 'e.g. 420'),
      controls: str('Controls', 'e.g. 24'), winningTime: str('Est. winning time', 'e.g. 75 (min is added)'),
      startInterval: str('Start interval', 'e.g. 2 (min is added)'),
      extra: str('Extra rows', 'One "Label: value" per line', { multiline: true })
    }
  },
  weather: {
    name: 'Weather', zone: 'side', stepCount: 1,
    description: 'Weather at the arena: conditions, temperature, wind, humidity (text only).',
    schema: {
      title: str('Title', 'Place (default: race location)'), condition: str('Conditions', 'e.g. Sunny'),
      temperature: str('Temperature (°C)', 'e.g. 18'), wind: str('Wind (km/h)', 'e.g. 12'), humidity: str('Humidity (%)', 'e.g. 60')
    }
  },
  'event-title': {
    name: 'Event title', zone: 'full', stepCount: 1,
    description: 'Event ID card: series, event name, place and date. Defaults come from the rundown and competition.',
    schema: {
      series: str('Series', 'e.g. World Orienteering Championships 2026'), title: str('Title', 'Event or race name'),
      place: str('Place', 'Host city or region'), date: str('Date', 'e.g. 12 July 2026')
    }
  },
  'runner-identity': {
    name: 'Runner identity', zone: 'lower', stepCount: 1,
    description: 'One runner from the competition: bib, name, club or flag, class and a detail line.',
    schema: {
      detail: str('Detail text', 'Optional line under the name, e.g. "Defending champion"'),
      bio: str('Bio', 'Optional: one fact per line; shows the extended athlete presentation', { multiline: true }),
      showBib: bool('Show bib', 'Show the bib number', true)
    },
    datasource: datasource([{ ...classSelector, required: false, helpText: 'Optional: narrows the runner search' }, runnerSearch(true)])
  },
  'runner-start': {
    name: 'Runner focus', zone: 'lower', stepCount: 1,
    description: 'One runner followed at the start, a radio control or the finish: countdown to the start, then the running time; place and time once through the chosen point.',
    schema: {
      detail: str('Detail text', 'Optional line, e.g. "Last to start"'),
      showBib: bool('Show bib', 'Show the bib number', true),
      startTimeOnly: bool('Start time only', 'Show the start time instead of a countdown and running time', false),
      showStartTime: bool('Show time', 'Show the time box', true)
    },
    datasource: datasource([{ ...classSelector, required: false, helpText: 'Optional: narrows the runner search' }, controlSelector(), runnerSearch(true)], [
      mapping('controlName', 'controlName', { allowOverride: true, showInUI: true, uiLabel: 'Control name' })
    ])
  },
  'free-text': {
    name: 'Free text', zone: 'lower', stepCount: 1,
    description: 'A general text lower third.',
    schema: { text: str('Text', 'The text to show'), title: str('Title', 'Optional line under the text') },
    required: ['text']
  },
  speaker: {
    name: 'Commentators', zone: 'lower', stepCount: 1,
    description: 'Commentator / speaker identification.',
    schema: { commentators: str('Commentators', 'e.g. "Anna Svensson & Erik Berg"'), title: str('Title', 'Default: Commentators') },
    required: ['commentators']
  },
  'name-strap': {
    name: 'Name strap', zone: 'lower', stepCount: 1,
    description: 'Name and role: commentators, interviews, athletes.',
    schema: {
      name: str('Name', 'Full name'), title: str('Role', 'e.g. Commentator, World Champion 2025'),
      club: str('Club', 'Club or team'), country: str('Country', 'IOC code, e.g. SWE'), bib: str('Bib', 'Bib number')
    }
  }
};

function manifest(setId, setLabel, kind, def) {
  return {
    $schema: SCHEMA_URL,
    id: `${setId}-${kind}`,
    version: '1.0.0',
    name: `${setLabel} – ${def.name}`,
    description: def.description,
    author: { name: 'Split Control' },
    main: 'graphic.js',
    supportsRealTime: true,
    supportsNonRealTime: false,
    stepCount: def.stepCount,
    schema: { type: 'object', properties: def.schema, ...(def.required ? { required: def.required } : {}) },
    ...(def.customActions ? { customActions: def.customActions } : {}),
    renderRequirements: [{ resolution: { width: { ideal: 1920 }, height: { ideal: 1080 } } }],
    v_olgrafik_set: setId,
    v_olgrafik_kind: kind,
    v_olgrafik_zone: def.zone
  };
}

const graphicJs = (kind) => `// Generated by scripts/generate-template-sets.js - edit the set's theme.css or _core/ instead
import { createGraphic } from '../../_core/graphic.js';
import set from '../set.js';

export default createGraphic('${kind}', set);
`;

let written = 0;
for (const [setId, setDef] of Object.entries(SETS)) {
  const setDir = path.join(SETS_DIR, setId);
  if (!fs.existsSync(path.join(setDir, 'set.js'))) throw new Error(`Missing ${setId}/set.js`);
  for (const [kind, def] of Object.entries(KINDS)) {
    if (setDef.skip.includes(kind)) continue;
    const id = `${setId}-${kind}`;
    const dir = path.join(setDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.ograf.json`), JSON.stringify(manifest(setId, setDef.label, kind, def), null, 2) + '\n');
    fs.writeFileSync(path.join(dir, 'graphic.js'), graphicJs(kind));
    const dsPath = path.join(dir, `${id}.datasource.json`);
    if (def.datasource) fs.writeFileSync(dsPath, JSON.stringify(def.datasource, null, 2) + '\n');
    else if (fs.existsSync(dsPath)) fs.unlinkSync(dsPath);
    written++;
  }
}
console.log(`Generated ${written} graphics in ${Object.keys(SETS).length} sets`);

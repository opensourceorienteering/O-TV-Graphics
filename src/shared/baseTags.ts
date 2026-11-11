/**
 * The base tags: every field Split Control gives graphics, whatever the timing source.
 *
 * This list is the contract between the app and the looks. Tests check that what every
 * built-in source produces matches it (key by key, type by type), and docs/BASE-TAGS.md and the
 * developer site are generated from it. Fields a timing plugin adds are under `x.<plugin>` and
 * `results[].x.<plugin>` (see docs/TIMING-PLUGINS.md); they are not base tags.
 *
 * Paths: `results[]` is every item of the results array; `relayLegs[].runner.splits[]` likewise.
 */

export type BaseTagType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export type BaseTagGroup = 'timing' | 'runner' | 'split' | 'relay' | 'operator' | 'course' | 'weather' | 'event';

export interface BaseTag {
  path: string;
  /** Allowed JSON types (a field that may be null lists 'object') */
  type: BaseTagType[];
  group: BaseTagGroup;
  description: string;
  unit?: string;
  /** When the field is there; unset = always, for graphics in its group */
  when?: string;
  example?: string;
}

export const BASE_TAG_GROUPS: Record<BaseTagGroup, { title: string; intro: string }> = {
  timing: {
    title: 'Timing',
    intro: 'Every graphic with the timing feed (a `.datasource.json` with `provider: "timing"`) gets these for the chosen class and timing point.'
  },
  runner: {
    title: 'Runners: `results[]`',
    intro: 'The runners of the class at the chosen timing point, in display order. Placed runners first; at a radio control, by place there; for start times, in start order.'
  },
  split: {
    title: 'Split times: `results[].splitTimes[]`',
    intro: 'A runner\'s times at the class\'s radio controls they have passed, in course order. Relays: from the team\'s start.'
  },
  relay: {
    title: 'Relay line-up: `relayLegs[]`',
    intro: 'Only for graphics whose `.datasource.json` maps `relayLegs`: the selected runner\'s team on every leg of the relay. Times are hundredths of a second from the team\'s start.'
  },
  operator: {
    title: 'Runner in focus',
    intro: 'Values the operator chose in Live (runner search, palette), passed on to the graphic.'
  },
  course: {
    title: 'Course (`course` feed)',
    intro: 'Course facts for the chosen class, when the timing source has them (IOF XML), or typed by the operator.'
  },
  weather: {
    title: 'Weather (`weather` feed)',
    intro: 'Conditions at the venue, read again while the graphic is on air; the operator can type over them.'
  },
  event: {
    title: 'Event and theme (every graphic)',
    intro: 'Added to every graphic\'s data.'
  }
};

const S: BaseTagType[] = ['string'];
const N: BaseTagType[] = ['number'];

export const BASE_TAGS: readonly BaseTag[] = [
  // --- timing context ------------------------------------------------------------------------
  { path: 'className', type: S, group: 'timing', description: 'The class shown. Relay legs are classes of their own ("Mixed-2"; show them with `classLabel()`). Empty when the graphic combines every class.', example: 'H21' },
  { path: 'competitionName', type: S, group: 'timing', description: 'The competition\'s name (the event\'s override when set).', when: 'when the source names the competition' },
  { path: 'competitionDate', type: S, group: 'timing', description: 'The competition day, YYYY-MM-DD.', when: 'when the source knows it', example: '2026-06-30' },
  { path: 'competitionTimeZone', type: S, group: 'timing', description: 'IANA time zone start times are read in.', when: 'when the date is known', example: 'Europe/Stockholm' },
  { path: 'competitionTimediff', type: N, group: 'timing', unit: 'hours', description: 'Extra hours on top of the zone (Liveresultat\'s legacy offset); almost always 0.', when: 'when the date is known' },
  { path: 'raceLocation', type: S, group: 'timing', description: 'The event\'s place, from the event settings.', when: 'when set' },
  { path: 'controlCode', type: S, group: 'timing', description: 'The timing point: "" or "F" for the finish, "Start" for start times, or a radio control\'s code (see `splitControls`).', example: '1062' },
  { path: 'controlName', type: S, group: 'timing', description: '"Finish", "Start" or the radio control\'s name.', example: 'Radio 2' },
  { path: 'splitControls', type: ['array'], group: 'timing', description: 'The class\'s radio controls in course order.' },
  { path: 'splitControls[].code', type: N, group: 'timing', description: 'Control code as Split Control numbers it: 1000 × visit + the code on the map (1062 = first visit to 62, 2062 = second).', example: '1062' },
  { path: 'splitControls[].name', type: S, group: 'timing', description: 'The control\'s name (Plan → Radio controls can rename it).' },
  { path: 'clockOffsetMs', type: N, group: 'timing', unit: 'ms', description: 'Timing source clock minus this computer\'s clock. Running time now = `Date.now() + clockOffsetMs - startTimeMs`.' },
  { path: 'dataTimestamp', type: N, group: 'timing', unit: 'epoch ms', description: 'When this data was put together.' },
  { path: 'x', type: ['object'], group: 'timing', description: 'Fields timing plugins add for the class and competition: `x.<plugin>.<key>` (docs/TIMING-PLUGINS.md).', when: 'when the source\'s plugin declares class or competition fields' },

  // --- runners -------------------------------------------------------------------------------
  { path: 'results', type: ['array'], group: 'runner', description: 'The runners (see the list below).', when: 'when the class has runners' },
  { path: 'results[].position', type: ['string', 'number'], group: 'runner', description: 'Place at the timing point: "1", "2" …, "=" for the same place as the runner before, "" when not placed (running, not started, MP, DNF …). In start lists the start order.', example: '1' },
  { path: 'results[].name', type: S, group: 'runner', description: 'The runner.' },
  { path: 'results[].club', type: S, group: 'runner', description: 'Club (short name when the source has one). Relays: the team.' },
  { path: 'results[].country', type: S, group: 'runner', description: 'Nation code (IOC or ISO).', when: 'when the source has it (IOF XML, MeOS)', example: 'SWE' },
  { path: 'results[].bib', type: S, group: 'runner', description: 'Bib number, from the event\'s start list (Plan → Start lists). Virtual bibs never reach graphics.', when: 'when the start list has one' },
  { path: 'results[].favourite', type: ['boolean'], group: 'runner', description: 'Marked as a favourite in the event\'s start list.', when: 'when the runner is in the start list' },
  { path: 'results[].note', type: S, group: 'runner', description: 'The operator\'s note from the start list.', when: 'when there is one' },
  { path: 'results[].time', type: S, group: 'runner', description: 'Time at the timing point (h:mm:ss or m:ss); "--:--" for none; the start time in start lists.', example: '31:47' },
  { path: 'results[].diff', type: S, group: 'runner', description: 'Behind the leader at the timing point ("+1:23"); "" for the leader and runners without a time.', example: '+1:23' },
  { path: 'results[].status', type: S, group: 'runner', description: 'Status text for `statusCode`: "OK", "DNS", "DNF", "MP", "DSQ", "OT", "WO", "Moved up", or "" while not started or running.' },
  { path: 'results[].statusCode', type: N, group: 'runner', description: 'Status: 0 OK, 1 DNS, 2 DNF, 3 MP, 4 DSQ, 5 overtime, 9 not started, 10 running, 11 walkover / cancelled, 12 moved up, 20 OK without time. At a radio control, 0 for runners who have passed it.' },
  { path: 'results[].progress', type: N, group: 'runner', unit: '%', description: 'Share of the course done: radio controls passed, 100 once finished or out.' },
  { path: 'results[].className', type: S, group: 'runner', description: 'The runner\'s class (useful when the graphic combines every class).' },
  { path: 'results[].startTime', type: S, group: 'runner', description: 'Start time of day (h:mm:ss); "0:00" when unknown.', when: 'except in start lists, where `time` is the start time', example: '10:02:00' },
  { path: 'results[].startTimeMs', type: N, group: 'runner', unit: 'epoch ms', description: 'The runner\'s own start (relays: the changeover). Use for running clocks.', when: 'when the start time and competition date are known' },
  { path: 'results[].teamStartTimeMs', type: N, group: 'runner', unit: 'epoch ms', description: 'Relays: when the team started; times and splits count from it. `clockStartMs(r)` from `_core/util.js` picks the right start.', when: 'relay legs after the first, when the source knows the team\'s start' },
  { path: 'results[].finishTimeMs', type: N, group: 'runner', unit: 'ms', description: 'The result as a duration (relays: from the team\'s start).', when: 'finished with status OK' },
  { path: 'results[].clubLogo', type: S, group: 'runner', description: 'Address of the club\'s logo (bundled or Plan → Theme).', when: 'when there is a logo for the club' },
  { path: 'results[].splitTimes', type: ['array'], group: 'runner', description: 'Times at the radio controls (see below).', when: 'when the class has radio controls' },
  { path: 'results[].x', type: ['object'], group: 'runner', description: 'Fields timing plugins add for the runner: `results[].x.<plugin>.<key>`.', when: 'when the source\'s plugin declares runner fields' },

  // --- split times ---------------------------------------------------------------------------
  { path: 'results[].splitTimes[].code', type: N, group: 'split', description: 'The control (as in `splitControls`).' },
  { path: 'results[].splitTimes[].time', type: N, group: 'split', unit: 'hundredths', description: 'Time at the control.' },
  { path: 'results[].splitTimes[].place', type: N, group: 'split', description: 'Place at the control; 0 when not ranked there.' },
  { path: 'results[].splitTimes[].timeplus', type: N, group: 'split', unit: 'hundredths', description: 'Behind the best time at the control.' },
  { path: 'results[].splitTimes[].status', type: N, group: 'split', description: 'Status at the control (0 = passed normally).' },

  // --- relay line-up -------------------------------------------------------------------------
  { path: 'relayLegs', type: ['array'], group: 'relay', description: 'One item per leg, in leg order.', when: 'mapped, relay class, runner chosen' },
  { path: 'relayLegs[].leg', type: N, group: 'relay', description: 'Leg number.' },
  { path: 'relayLegs[].className', type: S, group: 'relay', description: 'The leg\'s class ("Mixed-2").' },
  { path: 'relayLegs[].controls', type: ['array'], group: 'relay', description: 'The leg\'s radio controls in course order.' },
  { path: 'relayLegs[].controls[].code', type: N, group: 'relay', description: 'Control code (as in `splitControls`).' },
  { path: 'relayLegs[].controls[].name', type: S, group: 'relay', description: 'Control name.' },
  { path: 'relayLegs[].runner', type: ['object'], group: 'relay', description: 'The team\'s runner on the leg; null when not known yet.' },
  { path: 'relayLegs[].runner.name', type: S, group: 'relay', description: 'The runner.' },
  { path: 'relayLegs[].runner.club', type: S, group: 'relay', description: 'The team.' },
  { path: 'relayLegs[].runner.status', type: N, group: 'relay', description: 'Status code (as `statusCode`).' },
  { path: 'relayLegs[].runner.result', type: N, group: 'relay', unit: 'hundredths', description: 'The team\'s time at the end of the leg; 0 until then.' },
  { path: 'relayLegs[].runner.place', type: N, group: 'relay', description: 'The team\'s place at the end of the leg; 0 when not placed (or tied).' },
  { path: 'relayLegs[].runner.timeplus', type: N, group: 'relay', unit: 'hundredths', description: 'Behind the best team at the end of the leg.' },
  { path: 'relayLegs[].runner.legTime', type: N, group: 'relay', unit: 'hundredths', description: 'The runner\'s own time on the leg; 0 until known.' },
  { path: 'relayLegs[].runner.legPlace', type: N, group: 'relay', description: 'Rank of the leg time among all teams; 0 until known.' },
  { path: 'relayLegs[].runner.legTimeplus', type: N, group: 'relay', unit: 'hundredths', description: 'Behind the fastest leg time.' },
  { path: 'relayLegs[].runner.splits', type: ['array'], group: 'relay', description: 'The team\'s times at the leg\'s radio controls.' },
  { path: 'relayLegs[].runner.splits[].code', type: N, group: 'relay', description: 'Control code.' },
  { path: 'relayLegs[].runner.splits[].time', type: N, group: 'relay', unit: 'hundredths', description: 'Time at the control.' },
  { path: 'relayLegs[].runner.splits[].place', type: N, group: 'relay', description: 'Place at the control.' },
  { path: 'relayLegs[].runner.splits[].timeplus', type: N, group: 'relay', unit: 'hundredths', description: 'Behind the best team at the control.' },

  // --- operator --------------------------------------------------------------------------------
  { path: 'runnerName', type: S, group: 'operator', description: 'The runner in focus (lower thirds, runner identity, focus steps).', when: 'when chosen' },
  { path: 'runnerClub', type: S, group: 'operator', description: 'Their club or team.', when: 'when chosen' },
  { path: 'runnerBib', type: S, group: 'operator', description: 'Their bib.', when: 'when chosen' },

  // --- course ----------------------------------------------------------------------------------
  { path: 'title', type: S, group: 'course', description: 'The class name, as the title.', when: 'with the course feed' },
  { path: 'length', type: S, group: 'course', unit: 'km', description: 'Course length, one decimal.', when: 'when known', example: '5.4' },
  { path: 'climb', type: S, group: 'course', unit: 'm', description: 'Climb.', when: 'when known', example: '120' },
  { path: 'controls', type: S, group: 'course', description: 'Number of controls.', when: 'when known', example: '18' },

  // --- weather ---------------------------------------------------------------------------------
  { path: 'condition', type: S, group: 'weather', description: 'Conditions in words.', when: 'with the weather feed' },
  { path: 'temperature', type: S, group: 'weather', unit: '°C', description: 'Temperature.', when: 'with the weather feed' },
  { path: 'wind', type: S, group: 'weather', unit: 'm/s', description: 'Wind speed.', when: 'with the weather feed' },
  { path: 'humidity', type: S, group: 'weather', unit: '%', description: 'Relative humidity.', when: 'with the weather feed' },

  // --- event -----------------------------------------------------------------------------------
  { path: 'event', type: ['object'], group: 'event', description: 'The event (Plan → Event info).' },
  { path: 'event.name', type: S, group: 'event', description: 'Event name (the override, the competition, or "").' },
  { path: 'event.location', type: S, group: 'event', description: 'Place.' },
  { path: 'event.date', type: S, group: 'event', description: 'Date, YYYY-MM-DD.' },
  { path: 'event.series', type: S, group: 'event', description: 'Series or championship.' },
  { path: 'event.organiser', type: S, group: 'event', description: 'Organiser.' },
  { path: 'event.timeZone', type: S, group: 'event', description: 'IANA time zone set for the event ("" when not set).' },
  { path: 'presentation', type: ['object'], group: 'event', description: 'The theme (Plan → Theme): `language`, `identity` (club, flag, both), `themeColors`, `logoMode`, `logoUrl`, `clubLogos`, `relayNames` …' }
];

const BY_PATH = new Map(BASE_TAGS.map(t => [t.path, t]));

export function baseTag(path: string): BaseTag | undefined {
  return BY_PATH.get(path);
}

/** Paths whose contents are free-form: plugin fields and the theme */
const OPEN = [/^x(\.|$)/, /^results\[\]\.x(\.|$)/, /^presentation(\.|$)/];

function typeOf(v: unknown): BaseTagType | 'null' {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as BaseTagType;
}

/**
 * What in a graphic's data is not described by the base tags: unknown keys and wrong types.
 * `extra` names fields the graphic itself defines (its schema, operator-typed fields).
 */
export function baseTagProblems(data: Record<string, unknown>, extra: Iterable<string> = []): string[] {
  const own = new Set(extra);
  const problems: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (OPEN.some(re => re.test(path))) return;
    const tag = BY_PATH.get(path);
    if (!tag) {
      if (!own.has(path)) problems.push(`${path}: not a base tag`);
      return;
    }
    const t = typeOf(value);
    const ok = t === 'null' ? tag.type.includes('object') : tag.type.includes(t);
    if (!ok) problems.push(`${path}: ${t}, expected ${tag.type.join(' or ')}`);
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === 'object') for (const [k, v] of Object.entries(item)) if (v !== undefined) walk(v, `${path}[].${k}`);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) if (v !== undefined) walk(v, `${path}.${k}`);
    }
  };
  for (const [k, v] of Object.entries(data)) if (v !== undefined) walk(v, k);
  return [...new Set(problems)];
}

const cell = (s: string) => s.replace(/\|/g, '\\|');

/** docs/BASE-TAGS.md (generated: edit src/shared/baseTags.ts instead) */
export function renderBaseTagsMarkdown(): string {
  const out: string[] = [
    '# Base tags',
    '',
    '<!-- Generated from src/shared/baseTags.ts by the base tag tests (UPDATE_BASE_TAGS=1). Do not edit by hand. -->',
    '',
    'Every field Split Control gives graphics, whatever the timing source: Liveresultat, MeOS,',
    'a MOP database, IOF XML or a timing plugin. Tests check that every built-in source gives',
    'exactly these fields with these types. Fields a timing plugin adds are under `x.<plugin>`',
    'and `results[].x.<plugin>` ([TIMING-PLUGINS.md](TIMING-PLUGINS.md#extra-fields)).',
    '',
    'Map them in a graphic\'s `.datasource.json` ([TEMPLATE-DEVELOPMENT.md](TEMPLATE-DEVELOPMENT.md));',
    'the preview tool\'s **More data (JSON)** box shows and edits them.',
    ''
  ];
  for (const [group, meta] of Object.entries(BASE_TAG_GROUPS) as [BaseTagGroup, { title: string; intro: string }][]) {
    out.push(`## ${meta.title}`, '', meta.intro, '', '| Tag | Type | Description | When |', '|---|---|---|---|');
    for (const t of BASE_TAGS.filter(x => x.group === group)) {
      const type = t.type.join(' / ') + (t.unit ? ` (${t.unit})` : '');
      const desc = cell(t.description) + (t.example ? ` Example: \`${t.example}\`.` : '');
      out.push(`| \`${t.path}\` | ${type} | ${desc} | ${cell(t.when ?? 'always')} |`);
    }
    out.push('');
  }
  return out.join('\n');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const code = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

/** The developer site's table (between the base-tags markers in site/developers.html) */
export function renderBaseTagsHtml(): string {
  const out: string[] = [];
  for (const [group, meta] of Object.entries(BASE_TAG_GROUPS) as [BaseTagGroup, { title: string; intro: string }][]) {
    out.push(`      <h3 id="tags-${group}">${code(meta.title)}</h3>`, `      <p>${code(meta.intro)}</p>`, '      <div class="table-wrap">', '      <table>', '        <thead><tr><th>Tag</th><th>Type</th><th>Description</th><th>When</th></tr></thead>', '        <tbody>');
    for (const t of BASE_TAGS.filter(x => x.group === group)) {
      const type = t.type.join(' / ') + (t.unit ? ` (${t.unit})` : '');
      const desc = code(t.description) + (t.example ? ` Example: <code>${esc(t.example)}</code>.` : '');
      out.push(`          <tr><td><code>${esc(t.path)}</code></td><td>${esc(type)}</td><td>${desc}</td><td>${code(t.when ?? 'always')}</td></tr>`);
    }
    out.push('        </tbody>', '      </table>', '      </div>');
  }
  return out.join('\n');
}

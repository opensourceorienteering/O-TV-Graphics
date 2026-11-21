/**
 * Sample data for library previews: the website's simulated race and sample feeds, shaped for
 * one template the way the app shapes live data (feeds the graphic declares, then its defaults).
 */
import { applyFieldMap } from '../../../shared/fieldMap';
import { graphicFeedData } from '../../../../site/preview/feeds.js';
import type { SampleRace } from '../../../../site/preview/sim.js';
import type { OGrafTemplateInfo } from '../../../shared/types/ograf';

export type { SampleRace };

/** Simulated race time for a preview started at `startedAt`, running `speed` times real time; wraps at the end */
export function raceTimeAt(race: SampleRace, startedAt: number, now: number, speed: number): number {
  const span = race.end - race.firstStart;
  return race.firstStart + (((now - startedAt) * speed) % span);
}

/** A preview's race clock: real time it (virtually) started, and how many times real time it runs */
export interface PreviewClock {
  startedAt: number;
  speed: number;
}

/** How far into the race a preview opens: most runners are out, the first have finished */
const OPEN_AT_MS = 50 * 60_000;

export function startClock(speed: number, now = Date.now()): PreviewClock {
  return { startedAt: now - OPEN_AT_MS / speed, speed };
}

export function clockTime(race: SampleRace, clock: PreviewClock, now = Date.now()): number {
  return raceTimeAt(race, clock.startedAt, now, clock.speed);
}

/** The same race moment, running at a new speed from now on */
export function changeClockSpeed(race: SampleRace, clock: PreviewClock, speed: number, now = Date.now()): PreviewClock {
  const at = clockTime(race, clock, now);
  return { startedAt: now - (at - race.firstStart) / speed, speed };
}

/** The runner who started most recently at `simNow` (the first runner before the start) */
function lastStarted(race: SampleRace, simNow: number) {
  const started = race.runners.filter((r) => r.startTimeMs <= simNow);
  return started[started.length - 1] ?? race.runners[0];
}

export function sampleGraphicData(template: OGrafTemplateInfo, race: SampleRace, simNow: number): Record<string, unknown> {
  const timing = race.data(simNow, 'F');
  const data: Record<string, unknown> = graphicFeedData(
    { desk: template.desk, schema: template.manifest.schema as { properties?: Record<string, { default?: unknown }> } },
    timing,
  );
  if (template.desk?.params.includes('runner')) {
    const runner = lastStarted(race, simNow);
    Object.assign(data, { runnerName: runner.name, runnerClub: runner.club, runnerBib: runner.bib });
  }
  // A graphic of typed fields only, with no defaults, would preview blank: fill a sample person,
  // or the field's own title (what the operator would be asked for). Data graphics keep their
  // empty fields, which fall back to the data (a results title shows the class).
  const person = race.runners[0];
  const people: Record<string, string> = { name: person.name, club: person.club, country: person.country, bib: person.bib };
  const properties = (template.manifest.schema as { properties?: Record<string, { type?: string; title?: string; default?: unknown }> } | undefined)?.properties ?? {};
  const typedOnly = !template.desk?.feeds?.length;
  for (const [key, field] of Object.entries(typedOnly ? properties : {})) {
    if (field?.type !== 'string' || field.default !== undefined || data[key] !== undefined) continue;
    data[key] = people[key] ?? field.title ?? key;
  }
  data.clockOffsetMs = simNow - Date.now();
  data.presentation = { language: 'en', identity: 'club', international: false, logoMode: 'template' };
  // A graphic made elsewhere gets our data under its own field names, as on air
  return applyFieldMap((template.manifest as { v_olgrafik_fieldMap?: unknown }).v_olgrafik_fieldMap, data);
}

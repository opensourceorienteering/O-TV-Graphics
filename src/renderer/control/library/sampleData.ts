/**
 * Sample data for library previews: the website's simulated race and sample feeds, shaped for
 * one template the way the app shapes live data (feeds the graphic declares, then its defaults).
 */
import { graphicFeedData } from '../../../../site/preview/feeds.js';
import type { SampleRace } from '../../../../site/preview/sim.js';
import type { OGrafTemplateInfo } from '../../../shared/types/ograf';

export type { SampleRace };

/** Simulated race time for a preview started at `startedAt`, running `speed` times real time; wraps at the end */
export function raceTimeAt(race: SampleRace, startedAt: number, now: number, speed: number): number {
  const span = race.end - race.firstStart;
  return race.firstStart + (((now - startedAt) * speed) % span);
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
  data.clockOffsetMs = simNow - Date.now();
  data.presentation = { language: 'en', identity: 'club', international: false, logoMode: 'template' };
  return data;
}

/**
 * The standard building blocks a graphic can use in the Live desk (docs/GRAPHIC-CAPABILITIES.md).
 * The app knows how to provide each one; a graphic says which it uses. Nothing in the app
 * outside the desk's list of graphics should check for a graphic by name: it checks the block.
 */

/** A command parameter the palette understands, in order after the template number */
export type DeskParam = 'class' | 'runner' | 'control' | 'page';
export const DESK_PARAMS: readonly DeskParam[] = ['class', 'runner', 'control', 'page'];

/** Data the app fills in for the graphic */
export type DeskFeed =
  /** results, split times and start list for the chosen class (through .datasource.json) */
  | 'timing'
  /** course facts for the class: length, climb, controls, winning time … */
  | 'course'
  /** the weather at the event; re-read while the graphic is on air */
  | 'weather'
  /** the event setup: name, series, place, date */
  | 'event';
export const DESK_FEEDS: readonly DeskFeed[] = ['timing', 'course', 'weather', 'event'];

/** How the desk treats the graphic */
export type DeskBehaviour =
  /** the control input also takes the start ("S"; no control = the start) */
  | 'startControl'
  /** the runner follows the next starter until the operator picks one */
  | 'followNextStarter'
  /** the running clock of a runner on the way can be stopped by hand (T) */
  | 'freeze'
  /** an empty title shows the class name */
  | 'titleFromClass'
  /** an empty title shows the event's location */
  | 'titleFromLocation'
  /** keeps the data it went on air with until Update (live updates default off) */
  | 'holdOnAir'
  /** steps are operator-controlled, even when the event automatically pages other graphics */
  | 'manualSteps';
export const DESK_BEHAVIOURS: readonly DeskBehaviour[] = [
  'startControl', 'followNextStarter', 'freeze', 'titleFromClass', 'titleFromLocation', 'holdOnAir', 'manualSteps'
];

/**
 * What the Plan theme preview needs from real timing data to show a graphic; without it the
 * preview uses sample data. results: finished times; splits: split times; starts: start times.
 */
export type PreviewData = 'results' | 'splits' | 'starts';

/** Preview data by graphic kind (also kinds without a desk entry, such as the runner lower third) */
const KIND_PREVIEW_DATA: Record<string, PreviewData> = {
  'results': 'results',
  'podium': 'results',
  'standings-lower-third': 'results',
  'runner-lower-third': 'results',
  'runner-splits': 'splits',
  'position-history': 'splits',
  'start-list': 'starts',
  'start-group': 'starts'
};

/** What a graphic kind needs from timing data in the theme preview, if anything */
export function previewDataForKind(kind: string): PreviewData | undefined {
  return KIND_PREVIEW_DATA[kind];
}

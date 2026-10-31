/**
 * Events: the user-facing model on top of projects.
 *
 *  - An event is a project (DATAROOT/projects/<id>/project.json).
 *  - Graphics are triggered by hand on the Live desk; favourites are saved per graphic.
 *  - Events can be grouped in folders (multi-day events, a season, a club).
 *  - An event is worked on in two modes: Plan (prepare everything) and Live (show graphics).
 */

/** A folder of events. New events can follow shared folder defaults, with event overrides. */
export interface EventFolder {
  id: string;
  name: string;
  created: number;
  /** Defaults followed by linked events, or copied when an event is duplicated */
  defaults?: {
    templateSet?: string;
    presentation?: Record<string, any>;
    dataSource?: { sourceId: string; baseUrl?: string };
    info?: Partial<EventInfo>;
  };
}

/** What the event is: shown in graphics (title card, logo boxes) and in the overview */
export interface EventInfo {
  /** e.g. "2026-07-22" */
  date?: string;
  location?: string;
  organiser?: string;
  /** Series or championship, e.g. "O-Ringen 2026" */
  series?: string;
  /** IANA time zone, e.g. "Europe/Stockholm" */
  timeZone?: string;
  latitude?: number;
  longitude?: number;
  weather?: {
    condition?: string;
    temperature?: number;
    windSpeed?: number;
    humidity?: number;
    fetchedAt?: number;
  };
}

/** Event-level data source; written to every page (rundown) of the event */
export interface EventDataSource {
  sourceId: string;
  baseUrl?: string;
  competitionId?: number;
  competitionName?: string;
  /** Result of the last connection test from Settings → Data */
  lastCheck?: { ok: boolean; at: number; message?: string; classes?: number };
}

export type EventStatus = 'planning' | 'done';

/**
 * Outputs this event sends while it is in Live (Plan → Output). They turn on when the desk
 * opens and NDI turns off again when Live ends. Unset: follow the app's output settings.
 */
export interface EventLiveOutputs {
  /** Web output page (browser source) */
  web: boolean;
  /** NDI sender */
  ndi: boolean;
}

// --- start lists ------------------------------------------------------------------------

export interface StartListEntry {
  /** Stable key: class|name|club */
  key: string;
  className: string;
  name: string;
  club: string;
  country?: string;
  /** Bib from the timing system */
  bib?: string;
  /** Bib assigned in Split Control when the event has none ("V" + number); never sent to timing */
  virtualBib?: string;
  /** Epoch ms of the start (absolute, server time) */
  startTimeMs?: number;
  favourite?: boolean;
  note?: string;
}

/** Renamed radio controls: competition-wide and per class, by control code */
export interface EventControlNames {
  all?: Record<string, string>;
  classes?: Record<string, Record<string, string>>;
}

export interface EventStartList {
  updated: number;
  /** Where the entries came from: 'source' (data source), 'iofxml', 'csv' */
  origin?: string;
  timeZone?: string;
  entries: StartListEntry[];
  /**
   * Plan → Radio controls: names graphics show for radio controls, replacing the names from the
   * data source. By control code; a class name wins over the competition-wide name.
   */
  controlNames?: EventControlNames;
  /** Classes and radio controls pinned for quick access in Live. */
  favouriteClasses?: string[];
  favouriteControls?: Array<{
    className: string;
    code: string | number;
    name: string;
  }>;
}

/** One club in the start list, for reviewing the names graphics will show */
export interface ClubNameRow {
  /** As the data source sends it */
  name: string;
  runners: number;
  /** The short name from the bundled club lists (the name itself when none is known) */
  automatic: string;
  /** The name from the app's club name library */
  override?: string;
}

/** How virtual bibs are numbered */
export interface VirtualBibOptions {
  /** Classes to number (default: all) */
  classes?: string[];
  /** First number of the first class (default 1) */
  start?: number;
  /** Each class starts at a multiple of this (e.g. 100 -> 101, 201, ...); 0 = continue counting */
  perClassBlock?: number;
  /** Replace virtual bibs that already exist */
  overwrite?: boolean;
}

// --- readiness --------------------------------------------------------------------------

export type PlanSectionId = 'info' | 'look' | 'data' | 'startlists' | 'output' | 'control';

export interface ReadinessItem {
  section: PlanSectionId;
  ok: boolean;
  /** Optional sections never block "ready" */
  optional?: boolean;
  label: string;
  detail?: string;
}

export interface EventSummary {
  id: string;
  name: string;
  folderId?: string;
  date?: string;
  location?: string;
  templateSet?: string;
  dataSourceLabel?: string;
  status: EventStatus;
  live: boolean;
  /** Outputs that turn on in Live (the event's choice, or the app's output settings) */
  liveOutputs?: EventLiveOutputs;
  readiness: ReadinessItem[];
  ready: number;
  required: number;
  modified: number;
}

// --- live / control ---------------------------------------------------------------------

/** What control surfaces (web API, Companion) see of the live event */
export interface ControlState {
  eventId: string | null;
  eventName?: string;
  /** Desk graphics on air, newest first */
  onAir: { key: string; label: string; name: string; step: number; since: number }[];
  /** Graphics on air that the desk did not start (test pattern, other tools) */
  otherOnAir: number;
  /** The draft prepared in Preview, if any */
  prepared: { key: string; label: string; name: string } | null;
  /** Saved favourites of the live event (Stream Deck buttons) */
  favorites: { id: string; label: string; key: string; graphic: string }[];
  data?: { ok: boolean; at: number; message?: string } | null;
  output?: { web: boolean; ndi: boolean };
  /** Outputs that did not start when the event entered Live */
  outputErrors?: string[];
  polling?: Array<{ active: boolean; competitionId?: number; className?: string; interval?: number; lastPoll?: number; lastUpdate?: number; errorCount?: number; lastError?: string }>;

}

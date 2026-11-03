import type { DeskTemplate } from '../desk';
import type { DeskDeclaration } from '../deskDeclaration';

/**
 * OGRAF (Open Graphics Format) Type Definitions
 * Based on EBU OGRAF v1 Specification
 * https://ograf.ebu.io/v1/specification/
 */

export interface OGrafManifest {
  /** JSON Schema reference */
  $schema: string;
  
  /** Unique identifier for the graphic */
  id: string;
  
  /** Version of the graphic (optional in the spec) */
  version?: string;
  
  /** Human-readable name */
  name: string;
  
  /** Description of the graphic */
  description?: string;
  
  /** Author information */
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  
  /** Main JavaScript file (Web Component) */
  main: string;
  
  /** GDD / JSON Schema for the update() data (optional in the spec) */
  schema?: JSONSchema;
  
  /** Supports real-time rendering (live broadcast) */
  supportsRealTime: boolean;
  
  /** Supports non-real-time rendering (post-production) */
  supportsNonRealTime: boolean;
  
  /** Number of steps (default 1; -1 = dynamic/unknown) */
  stepCount?: number;

  /** Thumbnail images, paths relative to the manifest (OGraf 2026-04) */
  thumbnails?: { file: string; resolution?: { width?: number; height?: number } }[];

  /** Static animation durations in ms; -1 = dynamic (OGraf 2026-06) */
  actionDurations?: ActionDuration[];

  /** Custom actions supported by this graphic */
  customActions?: CustomAction[];

  /** Render requirements */
  renderRequirements?: RenderRequirement[];

  /**
   * @deprecated Playback mode should be set per rundown item, not per template.
   * This field is kept for backward compatibility only.
   * Use RundownItem.playbackMode instead.
   */
  playbackMode?: 'stackable' | 'solo';

  /** Optional Live desk declaration; validated separately from OGRAF. */
  v_olgrafik_desk?: DeskDeclaration;

  /** Vendor-specific fields (prefixed with v_) */
  [key: `v_${string}`]: any;
}

export interface JSONSchema {
  type: 'object';
  properties: {
    [key: string]: JSONSchemaProperty;
  };
  required?: string[];
}

export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: any;
  enum?: any[];
  minimum?: number;
  maximum?: number;
  items?: JSONSchemaProperty;
  properties?: {
    [key: string]: JSONSchemaProperty;
  };
}

export interface CustomAction {
  id: string;
  name: string;
  description?: string;
  /** null when the action takes no parameters */
  schema?: JSONSchema | null;
}

export interface ActionDuration {
  type: 'playAction' | 'stopAction' | 'updateAction' | 'customAction' | string;
  /** milliseconds, -1 = dynamic/unknown */
  duration?: number;
  steps?: { step?: number; duration: number }[];
  /** customAction id */
  id?: string;
}

export interface RenderRequirement {
  resolution?: {
    width?: { exact?: number; min?: number; max?: number; ideal?: number };
    height?: { exact?: number; min?: number; max?: number; ideal?: number };
  };
  frameRate?: { exact?: number; min?: number; max?: number; ideal?: number };
  accessToPublicInternet?: { exact: boolean };
  /** Minimum rendering engine versions, e.g. { type: 'CEF', version: { min: 139 } } (OGraf 2026-04) */
  engine?: { type: string; version?: { exact?: number; min?: number; max?: number } }[];
}

export interface ReturnPayload {
  statusCode: number;
  message?: string;
}

export interface PlayActionReturnPayload extends ReturnPayload {
  currentStep: number;
}

export interface PlayActionOptions {
  delta?: number;
  goto?: number;
  skipAnimation?: boolean;
}

export interface StopActionOptions {
  skipAnimation?: boolean;
}

export interface UpdateActionOptions {
  data: any;
  /** OGraf 2026-01: optional; render the update without animating */
  skipAnimation?: boolean;
}

export interface CustomActionOptions {
  id: string;
  payload?: any;
  /** OGraf 2026-01: optional; perform the action without animating */
  skipAnimation?: boolean;
}

export interface LoadOptions {
  data: any;
}

export interface GoToTimeOptions {
  timestamp: number;
}

export interface SetActionsScheduleOptions {
  schedule: ActionScheduleItem[];
}

export interface ActionScheduleItem {
  timestamp: number;
  action: 'play' | 'stop' | 'update' | 'custom';
  options?: any;
}

/**
 * OGRAF Web Component Interface
 * All graphics must implement this interface
 */
export interface OGrafGraphic extends HTMLElement {
  load(options: LoadOptions): Promise<ReturnPayload>;
  dispose(): Promise<ReturnPayload>;
  playAction(options: PlayActionOptions): Promise<PlayActionReturnPayload>;
  stopAction(options: StopActionOptions): Promise<ReturnPayload>;
  updateAction(options: UpdateActionOptions): Promise<ReturnPayload>;
  customAction(options: CustomActionOptions): Promise<ReturnPayload>;
  
  // Non-real-time only
  goToTime?(options: GoToTimeOptions): Promise<ReturnPayload>;
  setActionsSchedule?(options: SetActionsScheduleOptions): Promise<ReturnPayload>;
}

/**
 * Graphic instance state
 */
export interface GraphicState {
  id: string;
  manifestPath: string;
  manifest: OGrafManifest;
  currentStep: number;
  isPlaying: boolean;
  data: any;
  element?: OGrafGraphic;
}

/**
 * Template info for UI
 */
export interface OGrafTemplateInfo {
  type: 'ograf';
  /** Validated declaration, or the legacy default for a known kind. */
  desk?: DeskTemplate;
  deskWarnings?: string[];
  manifestPath: string;
  manifest: OGrafManifest;
  description: string;
  uicolor: number;
  webplayout: string;
  /** Path below templates/ used in URLs, e.g. "sets/iof/iof-results" or "my-graphic" */
  directoryName: string;
  dataSourceConfig?: any; // TemplateDataSourceConfig | null - using any to avoid circular dependency
  /** Template set this graphic belongs to ('custom' for graphics outside templates/sets) */
  setId: string;
  /** Screen zone (manifest v_olgrafik_zone): graphics in clashing zones replace each other */
  zone?: GraphicZone;
}

export type GraphicZone = 'main' | 'lower' | 'side' | 'corner' | 'full';

/** A template set: graphics that share one look; a project uses exactly one set */
export interface TemplateSetInfo {
  id: string;
  name: string;
  description?: string;
  author?: string;
  colors?: string[];
  fonts?: string;
  /** Federation looks (IOF, ČO, Svensk Orientering): only for events approved to use them */
  approvedEventsOnly?: boolean;
  /** The look's own logo (set.json "logo") as a data URL, for previews in Plan */
  logoPreview?: string;
  templateCount: number;
  /** built-in: ships with the app; imported: installed from a zip into the templates folder */
  source?: 'built-in' | 'imported';
  /** An imported look with the id of a built-in one: it is used instead of the built-in copy */
  replacesBuiltIn?: boolean;
}

export const CUSTOM_TEMPLATE_SET = 'custom';

/**
 * Built-in tools that belong to no look (templates/system/, e.g. the output test pattern).
 * They are never listed as a set or offered in the live desk, and work with every event.
 */
export const SYSTEM_TEMPLATE_SET = 'system';

/**
 * Which zones clash: playing a graphic takes clashing graphics off air first.
 * Tables in the upper centre reach down into the lower-third and side areas.
 */
export const ZONE_CLASHES: Record<GraphicZone, GraphicZone[]> = {
  main: ['main', 'lower', 'side', 'full'],
  lower: ['lower', 'main', 'full'],
  side: ['side', 'main', 'full'],
  corner: ['corner'],
  full: ['main', 'lower', 'side', 'full']
};

export function zonesClash(a?: GraphicZone, b?: GraphicZone): boolean {
  if (!a || !b) return false;
  return ZONE_CLASHES[a]?.includes(b) ?? false;
}


/** True for graphics with more than one step: 0 = auto (legacy), -1 = dynamic (OGraf), or > 1 */
export function isMultiStep(manifest?: { stepCount?: number } | null): boolean {
  const n = manifest?.stepCount;
  return n === 0 || n === -1 || (typeof n === 'number' && n > 1);
}

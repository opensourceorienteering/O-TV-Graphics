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
  
  /** Version of the graphic (semver) */
  version: string;
  
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
  
  /** JSON Schema for data validation */
  schema: JSONSchema;
  
  /** Supports real-time rendering (live broadcast) */
  supportsRealTime: boolean;
  
  /** Supports non-real-time rendering (post-production) */
  supportsNonRealTime: boolean;
  
  /** Number of steps (0 = auto, 1 = single, >1 = multi-step) */
  stepCount?: number;

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
  schema?: JSONSchema;
}

export interface RenderRequirement {
  resolution?: {
    width?: { exact?: number; min?: number; max?: number; ideal?: number };
    height?: { exact?: number; min?: number; max?: number; ideal?: number };
  };
  frameRate?: { exact?: number; min?: number; max?: number; ideal?: number };
  accessToPublicInternet?: { exact: boolean };
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
}

export interface CustomActionOptions {
  id: string;
  payload?: any;
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
  manifestPath: string;
  manifest: OGrafManifest;
  description: string;
  uicolor: number;
  webplayout: string;
  directoryName: string; // Directory name for URL construction (e.g., "runner-spotlight")
  dataSourceConfig?: any; // TemplateDataSourceConfig | null - using any to avoid circular dependency
}


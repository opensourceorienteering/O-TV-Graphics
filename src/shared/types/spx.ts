/**
 * SPX Graphics Controller Type Definitions
 * Based on SPX-GC template system
 * For backward compatibility with legacy templates
 */

export type SPXFieldType =
  | 'textfield'
  | 'textarea'
  | 'dropdown'
  | 'filelist'
  | 'number'
  | 'checkbox'
  | 'color'
  | 'button'
  | 'hidden'
  | 'caption'
  | 'instruction'
  | 'divider'
  | 'spacer';

export interface SPXDataField {
  field: string;
  ftype: SPXFieldType;
  title: string;
  value: any;
  
  // For dropdown
  items?: Array<{ text: string; value: any }>;
  
  // For filelist
  assetfolder?: string;
  extension?: string;
  
  // For project variables
  prvar?: string;
  
  // For number
  min?: number;
  max?: number;
  step?: number;
  
  // For textarea
  rows?: number;
}

export interface SPXTemplateDefinition {
  description: string;
  playserver: string;
  playchannel: string;
  playlayer: string;
  webplayout: string;
  steps: string;
  out: string;
  uicolor: string;
  dataformat: 'json' | 'xml';
  DataFields: SPXDataField[];
  
  // Optional custom controls
  customControls?: SPXCustomControl[];
}

export interface SPXCustomControl {
  ftype: 'button' | 'togglebutton' | 'selectbutton';
  description: string;
  bgclass: string;
  fcall: string;
  text?: string;
  text0?: string;
  text1?: string;
  items?: Array<{ text: string; value: any }>;
}

export interface SPXTemplateInfo {
  type: 'spx';
  relpath: string;
  description: string;
  playserver: string;
  playchannel: string;
  playlayer: string;
  webplayout: string;
  out: string;
  uicolor: number;
  dataformat: 'json' | 'xml';
  DataFields: SPXDataField[];
}

export interface SPXRundownItem {
  id: string;
  templateId: string;
  templatePath: string;
  fields: Record<string, any>;
  onair: boolean;
  layer: string;
  out: string;
  timestamp?: number;

  /**
   * Optional instance name for this rundown item
   * Allows operators to give descriptive names to template instances
   * Example: "M21 Final Results", "W35 Control 3 Results"
   */
  instanceName?: string;

  /**
   * Playback mode - controls how this item interacts with other playing items
   * - 'solo': Stops all other graphics before playing
   * - 'stackable': Plays alongside other graphics (default)
   */
  playbackMode?: 'stackable' | 'solo';

  /**
   * Current step number for multi-step templates
   * Tracks which step is currently on-air (1-based)
   * Used by Data Preview to show the next upcoming step
   * Only relevant when onair === true
   */
  currentStep?: number;

  /** LiveResults integration metadata */
  liveResultsData?: {
    competitionId?: number;
    className?: string;
    autoUpdate?: boolean; // Auto-update from LiveResults
    lastUpdate?: number; // Timestamp of last update
    // Additional fields for template-specific data mapping
    runnerName?: string; // For lower-third templates
    bibNumber?: string; // For lower-third templates
    controlCode?: string; // For control-specific templates
    maxRows?: number; // For paginated templates

    /**
     * Data source UI control values (new datasource configuration system)
     * Stores values from UI controls defined in template's datasource config
     * Example: { className: "M21", controlCode: "F", runnerName: "John Doe" }
     */
    dataSourceValues?: Record<string, any>;
  };
}

export interface SPXProjectProfile {
  name: string;
  templates: (SPXTemplateInfo | any)[];
  variables?: SPXProjectVariable[];
  customControls?: SPXCustomControl[];
}

export interface SPXProjectVariable {
  prvar: string;
  ftype: SPXFieldType;
  title: string;
  value: any;
  users?: string[]; // Template IDs using this variable
}

export interface SPXRundown {
  id: string;
  name: string;
  projectId: string;
  items: SPXRundownItem[];
  created: number;
  modified: number;

  /**
   * Data source configuration for this rundown
   * Stored at rundown level per requirements
   */
  dataSource?: {
    sourceId: string;           // Reference to configured data source
    baseUrl: string;            // LiveResults API base URL
    competitionId?: number;     // Selected competition ID
    competitionName?: string;   // Competition name from API
  };

  /**
   * Global settings for this rundown
   */
  settings?: {
    competitionNameOverride?: string;  // Custom name for graphics
    raceLocation?: string;             // Location for display
  };

  /**
   * Template allowlist - only these templates can be used in this rundown
   * Empty array means no templates are allowed (must be configured)
   * Undefined means all templates are allowed (backward compatibility)
   */
  allowedTemplates?: string[];  // Array of template IDs

  /**
   * @deprecated Use dataSource instead
   * LiveResults integration settings for this rundown
   * Kept for backward compatibility - will be migrated to dataSource on load
   */
  liveResults?: {
    competitionId?: number;
    competitionName?: string;
    autoUpdate?: boolean;
    updateInterval?: number; // milliseconds (default: 15000)
  };
}

/**
 * Project file structure
 * Stored in DATAROOT/projects/{projectId}/project.json
 */
export interface SPXProject {
  id: string;
  name: string;
  description?: string;
  created: number;
  modified: number;

  /** Project-level variables */
  variables?: SPXProjectVariable[];

  /** Custom controls for this project */
  customControls?: SPXCustomControl[];

  /** Default settings */
  settings?: {
    defaultLayer?: string;
    defaultOut?: string;
    autoSave?: boolean;
  };

  /**
   * LiveResults integration settings
   * @deprecated Use rundown-level liveResults instead
   */
  liveResults?: {
    competitionId?: number;
    competitionName?: string;
    autoUpdate?: boolean;
    updateInterval?: number; // milliseconds (default: 15000)
  };
}

/**
 * Project list item (for project browser)
 */
export interface SPXProjectListItem {
  id: string;
  name: string;
  description?: string;
  created: number;
  modified: number;
  rundownCount?: number;
}

/**
 * Rundown list item (for rundown browser)
 */
export interface SPXRundownListItem {
  id: string;
  name: string;
  projectId: string;
  itemCount: number;
  created: number;
  modified: number;
}


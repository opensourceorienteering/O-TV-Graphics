/**
 * Template Data Source Configuration Types
 * 
 * Defines how templates fetch and display data from external sources (LiveResults API, etc.)
 * Sidecar files: `{template-id}.datasource.json`
 */

/**
 * Data source configuration for a template
 * Stored in sidecar file: `{template-id}.datasource.json`
 */
export interface TemplateDataSourceConfig {
  /** Schema version for future compatibility */
  version: '1.0';

  /** Data source mode */
  mode: 'manual' | 'api' | 'hybrid';

  /** API configuration (required if mode is 'api' or 'hybrid') */
  api?: ApiDataSourceConfig;

  /** Manual field configuration (required if mode is 'manual' or 'hybrid') */
  manual?: ManualFieldConfig;
}

/**
 * API data source configuration
 */
export interface ApiDataSourceConfig {
  /** Which API provider to use */
  provider: 'liveresults' | 'custom';

  /** Optional class selection: an empty class combines every class in the event. */
  classScope?: 'optional';

  /** Field mappings: template field -> API data path */
  fieldMappings: FieldMapping[];

  /** UI controls to show in Template Settings Panel */
  uiControls: UIControl[];

  /**
   * @deprecated Auto-update is now the STANDARD for all API templates.
   * This field is no longer used. Auto-update defaults to enabled and can be
   * disabled per rundown item in the Template Settings Panel.
   * Polling interval is standardized at 15 seconds.
   */
  autoUpdate?: {
    /** @deprecated No longer used - auto-update is always enabled by default */
    defaultEnabled: boolean;
    /** @deprecated No longer used - polling interval is standardized at 15 seconds */
    intervalMs?: number;
  };
}

/**
 * Field mapping from API data to template field
 */
export interface FieldMapping {
  /** Template field name (from OGRAF schema) */
  templateField: string;

  /** API data path (dot notation, e.g., "runner.name" or "results[0].time") */
  apiPath: string;

  /** Optional transformation function name */
  transform?: 'formatTime' | 'formatDate' | 'uppercase' | 'lowercase' | 'trim';

  /** Whether this field is required from API */
  required?: boolean;

  /** Whether this field is auto-populated from API (default: true for API mode) */
  autoPopulated?: boolean;

  /** Whether operator can override the auto-populated value (default: false) */
  allowOverride?: boolean;

  /** Whether to show this field in the operator UI (default: based on allowOverride) */
  showInUI?: boolean;

  /** Help text to show in UI when field is editable */
  uiHelpText?: string;

  /** UI label (defaults to templateField if not specified) */
  uiLabel?: string;
}

/**
 * Manual field configuration
 */
export interface ManualFieldConfig {
  /** Fields that should be manually editable */
  fields: string[];

  /** Fields that should be hidden from manual editing */
  hiddenFields?: string[];
}

/**
 * UI Control types for API data selection
 */
export type UIControl =
  | ClassSelectorControl
  | RunnerSearchControl
  | ControlPointSelectorControl
  | LegSelectorControl
  | TeamSearchControl
  | CustomControl;

/**
 * Base UI control interface
 */
interface BaseUIControl {
  /** Control type */
  type: string;

  /** Label to display above the control */
  label: string;

  /** Help text to display below the control */
  helpText?: string;

  /** Whether this control is required */
  required?: boolean;

  /** Field name to store the selected value */
  storeAs: string;
}

/**
 * Class selector dropdown
 */
export interface ClassSelectorControl extends BaseUIControl {
  type: 'class-selector';
  /** Whether to show compact version */
  compact?: boolean;
}

/**
 * Runner search with autocomplete
 */
export interface RunnerSearchControl extends BaseUIControl {
  type: 'runner-search';
  /** Search by bib number, name, or both */
  searchBy: 'bib' | 'name' | 'both';
  /** Placeholder text */
  placeholder?: string;
  /** Fields to populate when runner is selected */
  populateFields?: {
    /** Template field name -> runner data property */
    [templateField: string]: 'name' | 'bib' | 'club' | 'className' | 'startTime';
  };
}

/**
 * Control point selector
 */
export interface ControlPointSelectorControl extends BaseUIControl {
  type: 'control-point-selector';
  /** Whether to allow selecting multiple control points */
  multiple?: boolean;
  /** Whether to include finish as an option */
  includeFinish?: boolean;
}

/**
 * Leg selector (for relay races)
 */
export interface LegSelectorControl extends BaseUIControl {
  type: 'leg-selector';
  /** Maximum number of legs to show */
  maxLegs?: number;
}

/**
 * Team search (for relay races)
 */
export interface TeamSearchControl extends BaseUIControl {
  type: 'team-search';
  /** Search by team name, club, or both */
  searchBy: 'teamName' | 'club' | 'both';
  /** Placeholder text */
  placeholder?: string;
  /** Fields to populate when team is selected */
  populateFields?: {
    /** Template field name -> team data property */
    [templateField: string]: 'teamName' | 'club' | 'className' | 'bib';
  };
}

/**
 * Custom control (for future extensibility)
 */
export interface CustomControl extends BaseUIControl {
  type: 'custom';
  /** Custom component name to render */
  component: string;
  /** Additional props to pass to the component */
  props?: Record<string, any>;
}

/**
 * Data fetching strategy
 */
export interface DataFetchStrategy {
  /** API endpoint or data source identifier */
  endpoint: string;

  /** HTTP method (for custom APIs) */
  method?: 'GET' | 'POST';

  /** Query parameters (can reference UI control values) */
  params?: Record<string, string | number | boolean>;

  /** Request body (for POST requests) */
  body?: Record<string, any>;

  /** Response data path (dot notation to extract data from response) */
  responsePath?: string;
}

/**
 * Extended template info with data source configuration
 */
export interface TemplateInfoWithDataSource {
  /** Original template info */
  templateInfo: any; // OGrafTemplateInfo

  /** Data source configuration (null if no sidecar file exists) */
  dataSourceConfig: TemplateDataSourceConfig | null;
}


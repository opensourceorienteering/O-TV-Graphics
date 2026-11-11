/**
 * Data Source Abstraction Layer
 * Defines interfaces for pluggable data sources (LiveResults, manual entry, CSV, etc.)
 */

import { LiveResultsCompetition, LiveResultsClass, LiveResultsResult } from './liveresults';
import type { ConfigSchema, ExtFieldDecl, PluginManifest } from '../timing-sdk';

/**
 * Data source type identifier: a built-in type or the id of a timing plugin
 */
export type BuiltInDataSourceType = 'liveresults' | 'manual' | 'csv' | 'mysql' | 'iofxml' | 'meos' | 'custom';
export type DataSourceType = BuiltInDataSourceType | (string & {});

/** Where a source type comes from */
export type DataSourceKind = 'native' | 'builtin' | 'code' | 'sql-profile';

/**
 * Data source configuration
 */
export interface DataSourceConfig {
  /** Unique identifier for this data source instance */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Data source type */
  type: DataSourceType;
  
  /** Whether this data source is enabled */
  enabled: boolean;

  /** Packaged with Split Control; connection details cannot be edited or deleted. */
  builtIn?: boolean;
  
  /** Type-specific configuration */
  config: Record<string, any>;
}

/**
 * LiveResults-specific configuration
 */
export interface LiveResultsDataSourceConfig extends DataSourceConfig {
  type: 'liveresults';
  config: {
    baseUrl: string;
    cacheInterval?: number;
    timeout?: number;
    /** 'auto' (default) picks the REST API for https://api.orienteering.services */
    api?: 'legacy' | 'rest' | 'auto';
    /** Faster polling for a local simulator (localhost only; ignored for public APIs) */
    localPollFloorMs?: number;
    /** REST only: refetch as soon as the Liveresultat push channel reports a change (default true) */
    push?: boolean;
    /** Push channel URL (default wss://ws.orienteering.services) */
    pushUrl?: string;
  };
}

/**
 * Manual entry data source configuration
 */
export interface ManualDataSourceConfig extends DataSourceConfig {
  type: 'manual';
  config: Record<string, never>; // No additional config needed
}

/**
 * CSV data source configuration
 */
export interface CSVDataSourceConfig extends DataSourceConfig {
  type: 'csv';
  config: {
    filePath: string;
    delimiter?: string;
    encoding?: string;
  };
}

/**
 * MySQL/MariaDB data source configuration
 */
export interface MySQLDataSourceConfig extends DataSourceConfig {
  type: 'mysql';
  config: {
    host: string;
    port?: number;
    database: string;
    user: string;
    password: string;
    connectionLimit?: number;
    connectTimeout?: number;
    ssl?: {
      enabled: boolean;
      rejectUnauthorized?: boolean;
    };
    /** IANA zone of the event, used for live clocks (default Europe/Stockholm) */
    timezone?: string;
    /** Live poll interval in ms (default 2000, minimum 1000) */
    pollIntervalMs?: number;
  };
}

/**
 * IOF XML 3.0 file data source configuration
 */
export interface IofXmlDataSourceConfig extends DataSourceConfig {
  type: 'iofxml';
  config: {
    /** ResultList or StartList exported by the timing software */
    filePath: string;
    /** Competition id to use for this file in Split Control (default 1) */
    competitionId?: number;
    /** IANA zone of the event (default Europe/Stockholm) */
    timezone?: string;
    /** Only these control codes become split columns (default: all) */
    radioControls?: number[];
    /** How often to check the file (ms, default 2000, minimum 1000) */
    pollIntervalMs?: number;
  };
}

/**
 * MeOS information server data source configuration
 */
export interface MeosDataSourceConfig extends DataSourceConfig {
  type: 'meos';
  config: {
    /** MeOS information server, e.g. http://192.168.1.10:2009 (default http://localhost:2009) */
    url: string;
    /** Competition id to use for this event in Split Control (default 1) */
    competitionId?: number;
    /** IANA zone of the event (default Europe/Stockholm) */
    timezone?: string;
    /** Live poll interval in ms (default 1000, minimum 500) */
    pollIntervalMs?: number;
  };
}

/**
 * Competition data (normalized across all data sources)
 */
export interface Competition {
  id: number;
  name: string;
  organizer?: string;
  date?: string;
  [key: string]: any; // Allow additional fields
}

/**
 * Class data (normalized across all data sources)
 */
export interface Class {
  className: string;
  displayName?: string;
  numberOfEntries?: number;
  [key: string]: any; // Allow additional fields
}

/**
 * Result data (normalized across all data sources)
 */
export interface Result {
  place?: number;
  name: string;
  club?: string;
  time?: string;
  status?: string;
  [key: string]: any; // Allow additional fields
}

/**
 * Data source interface
 * All data sources must implement this interface
 */
export interface IDataSource {
  /** Data source configuration */
  readonly config: DataSourceConfig;
  
  /** Whether the data source is initialized */
  readonly initialized: boolean;
  
  /**
   * Initialize the data source
   * @returns Promise that resolves when initialization is complete
   */
  initialize(): Promise<void>;
  
  /**
   * Destroy the data source and clean up resources
   */
  destroy(): void;
  
  /**
   * Get list of available competitions
   * @returns Promise that resolves to array of competitions
   */
  getCompetitions(): Promise<Competition[]>;
  
  /**
   * Get list of classes for a competition
   * @param competitionId Competition ID
   * @returns Promise that resolves to array of classes
   */
  getClasses(competitionId: number): Promise<Class[]>;
  
  /**
   * Get results for a specific class
   * @param competitionId Competition ID
   * @param className Class name
   * @returns Promise that resolves to array of results
   */
  getResults(competitionId: number, className: string): Promise<Result[]>;
  
  /**
   * Start polling for updates (if supported)
   * @param competitionId Competition ID
   * @param className Class name
   * @param interval Polling interval in milliseconds
   */
  startPolling?(competitionId: number, className: string, interval: number): void;
  
  /**
   * Stop polling for updates (if supported)
   * @param competitionId Competition ID
   * @param className Class name
   */
  stopPolling?(competitionId: number, className: string): void;
  
  /**
   * Check if data source supports real-time updates
   */
  supportsRealTime(): boolean;
}

/**
 * Data source factory function type
 */
export type DataSourceFactory = (config: DataSourceConfig) => IDataSource;

/**
 * Data source registry entry (internal use - contains factory function)
 */
export interface DataSourceRegistryEntry {
  type: DataSourceType;
  factory: DataSourceFactory;
  displayName: string;
  description: string;
  /** native = Liveresultat; the others are timing plugins */
  kind?: DataSourceKind;
  /** Settings form for plugin sources */
  configSchema?: ConfigSchema;
  /** Fields the source adds on top of the base tags (x.<type>.<key>) */
  extFields?: ExtFieldDecl[];
}

/**
 * Data source type info (serializable for IPC)
 */
export interface DataSourceTypeInfo {
  type: DataSourceType;
  displayName: string;
  description: string;
  kind?: DataSourceKind;
  configSchema?: ConfigSchema;
  extFields?: ExtFieldDecl[];
}

/** A loaded timing plugin, for the settings screen */
export interface TimingPluginInfo {
  id: string;
  name: string;
  description?: string;
  version: string;
  sdk: string;
  kind: 'builtin' | 'code' | 'sql-profile';
  /** File the plugin was loaded from (not for built-ins) */
  path?: string;
  capabilities: NonNullable<PluginManifest['capabilities']>;
  extFields: ExtFieldDecl[];
}

export interface TimingPluginList {
  /** The user's plugins folder (null before it is loaded) */
  folder: string | null;
  plugins: TimingPluginInfo[];
  /** Files in the folder that failed to load, with the reason */
  failures: { path: string; error: string }[];
}

/**
 * Helper function to convert LiveResults types to normalized types
 */
export function convertLiveResultsCompetition(lr: LiveResultsCompetition): Competition {
  return {
    id: lr.id,
    name: lr.name,
    organizer: lr.organizer,
    date: lr.date
  };
}

export function convertLiveResultsClass(lr: LiveResultsClass): Class {
  return {
    className: lr.className,
    displayName: lr.className,
    numberOfEntries: 0 // LiveResultsClass doesn't have this field
  };
}

export function convertLiveResultsResult(lr: LiveResultsResult): Result {
  return {
    place: parseInt(lr.place, 10) || undefined,
    name: lr.name,
    club: lr.club,
    time: lr.result, // 'result' field contains the time
    status: lr.status.toString() // Convert number to string
  };
}


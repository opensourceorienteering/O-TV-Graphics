import type { DataSourceConfig } from "./types/dataSource";

/**
 * Stable connectors shipped with Split Control. Their connection details are part
 * of the application, not user configuration. Operators may enable or disable
 * them, but upgrades always restore missing definitions and canonical URLs.
 */
export const BUILT_IN_DATA_SOURCES: readonly DataSourceConfig[] = [
  {
    id: "liveresults-default",
    type: "liveresults",
    name: "LiveResults REST",
    enabled: true,
    builtIn: true,
    config: {
      baseUrl: "https://api.orienteering.services",
      cacheInterval: 10000,
      timeout: 10000,
      api: "rest",
      push: true,
    },
  },
  {
    id: "liveresults-legacy",
    type: "liveresults",
    name: "LiveResults Legacy",
    enabled: true,
    builtIn: true,
    config: {
      baseUrl: "https://liveresultat.orientering.se",
      cacheInterval: 15000,
      timeout: 10000,
      api: "legacy",
    },
  },
] as const;

export const BUILT_IN_DATA_SOURCE_IDS = new Set(
  BUILT_IN_DATA_SOURCES.map((source) => source.id),
);

export function getBuiltInDataSource(id: string): DataSourceConfig | undefined {
  return BUILT_IN_DATA_SOURCES.find((source) => source.id === id);
}

export function mergeBuiltInDataSources(
  configured: DataSourceConfig[] = [],
): DataSourceConfig[] {
  const configuredById = new Map(configured.map((source) => [source.id, source]));
  const builtIns = BUILT_IN_DATA_SOURCES.map((source) => ({
    ...source,
    config: { ...source.config },
    enabled: configuredById.get(source.id)?.enabled ?? source.enabled,
  }));
  const custom = configured.filter(
    (source) => !BUILT_IN_DATA_SOURCE_IDS.has(source.id),
  );
  return [...builtIns, ...custom];
}

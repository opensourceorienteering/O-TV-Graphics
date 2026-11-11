/**
 * Data Source Factories
 * Registers all built-in data source types
 */

import { getDataSourceRegistry } from '../DataSourceRegistry';
import { createLiveResultsDataSource } from './LiveResultsDataSource';
import { registerBuiltInTimingPlugins } from '../timing/TimingPlugins';

/**
 * Register all built-in data source types: Liveresultat (the core's native API) and the
 * built-in timing plugins (MeOS information server, MOP database, IOF XML file).
 * Plugins from the user's plugins folder are loaded separately (loadTimingPlugins).
 */
export function registerBuiltInDataSources(): void {
  const registry = getDataSourceRegistry();

  registry.register({
    type: 'liveresults',
    factory: createLiveResultsDataSource,
    displayName: 'LiveResults',
    description: 'Fetch live orienteering results from LiveResults API',
    kind: 'native'
  });

  registerBuiltInTimingPlugins();
}

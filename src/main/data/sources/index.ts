/**
 * Data Source Factories
 * Registers all built-in data source types
 */

import { getDataSourceRegistry } from '../DataSourceRegistry';
import { createLiveResultsDataSource } from './LiveResultsDataSource';
import { createMySQLDataSource } from './MySQLDataSource';
import { createIofXmlDataSource } from './IofXmlDataSource';
import { createMeosDataSource } from './MeosDataSource';

/**
 * Register all built-in data source factories
 */
export function registerBuiltInDataSources(): void {
  const registry = getDataSourceRegistry();

  // Register LiveResults data source
  registry.register({
    type: 'liveresults',
    factory: createLiveResultsDataSource,
    displayName: 'LiveResults',
    description: 'Fetch live orienteering results from LiveResults API'
  });

  // MeOS information server (read straight from MeOS, no database needed)
  registry.register({
    type: 'meos',
    factory: createMeosDataSource,
    displayName: 'MeOS (information server)',
    description: 'Live results, radio splits and relay legs straight from MeOS (Services > Information server)'
  });

  // Register MySQL/MariaDB data source
  registry.register({
    type: 'mysql',
    factory: createMySQLDataSource,
    displayName: 'MySQL/MariaDB Database',
    description: 'MeOS Online Protocol (MOP) database: results, radio splits and relay legs'
  });

  // IOF XML 3.0 result/start list file (OE/OS, OLA, MeOS, Helga exports)
  registry.register({
    type: 'iofxml',
    factory: createIofXmlDataSource,
    displayName: 'IOF XML 3.0 file',
    description: 'ResultList/StartList exported by timing software; re-read whenever the file changes'
  });

  // Future data sources can be registered here:
  // - Manual entry
  // - CSV import
  // - Custom API
}


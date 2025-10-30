/**
 * Data Source Factories
 * Registers all built-in data source types
 */

import { getDataSourceRegistry } from '../DataSourceRegistry';
import { createLiveResultsDataSource } from './LiveResultsDataSource';
import { createMySQLDataSource } from './MySQLDataSource';

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

  // Register MySQL/MariaDB data source
  registry.register({
    type: 'mysql',
    factory: createMySQLDataSource,
    displayName: 'MySQL/MariaDB Database',
    description: 'Connect to MySQL or MariaDB database with MOP/SMGraphics schema'
  });

  // Future data sources can be registered here:
  // - Manual entry
  // - CSV import
  // - Custom API
}


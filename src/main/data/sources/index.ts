/**
 * Data Source Factories
 * Registers all built-in data source types
 */

import { registerBuiltInTimingPlugins } from '../timing/TimingPlugins';

/**
 * Register the built-in data source types: the built-in timing plugins (Liveresultat, MeOS
 * information server, MOP database, IOF XML file). Plugins from the user's plugins folder are
 * loaded separately (loadTimingPlugins).
 */
export function registerBuiltInDataSources(): void {
  registerBuiltInTimingPlugins();
}

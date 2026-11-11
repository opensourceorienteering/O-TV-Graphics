/**
 * The application-wide Liveresultat hub (Settings → liveresults in config.json), used by
 * graphics and IPC calls that do not name a data source. Everything else uses the hub of its
 * data source (PluginDataSource.getClient()).
 */

import { TimingHub } from './TimingHub';
import { createLiveresultatSource } from './liveresultat/LiveresultatSource';

export type { TimingHub } from './TimingHub';

let hub: TimingHub | null = null;

export function initDefaultTimingHub(config: { baseUrl: string; cacheInterval?: number } & Record<string, unknown>): TimingHub {
  hub?.destroy();
  const source = createLiveresultatSource({ ...config });
  hub = new TimingHub(source, { pluginId: 'liveresults', label: config.baseUrl, pollIntervalMs: config.cacheInterval });
  return hub;
}

export function getDefaultTimingHub(): TimingHub {
  if (!hub) throw new Error('Timing hub not initialized. Call initDefaultTimingHub first.');
  return hub;
}

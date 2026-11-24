/**
 * Timing plugins: the built-in ones and those found in the user's plugins folder.
 *
 * Each plugin becomes a data source type; its id is the type saved in events. A plugin
 * cannot take the id of a built-in source or of Liveresultat.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { getLogger } from '../../utils/logger';
import { getDataSourceRegistry } from '../DataSourceRegistry';
import type { PluginManifest, TimingPlugin } from '../../../shared/timing-sdk';
import { TIMING_SDK_VERSION } from '../../../shared/timing-sdk';
import type { TimingPluginInfo, TimingPluginList } from '../../../shared/types/dataSource';
import { PluginDataSource } from './PluginDataSource';
import { BUILT_IN_TIMING_PLUGINS, sqlProfilePlugin } from './builtInPlugins';
import { parseSqlProfile } from './sql/SqlProfile';

const logger = getLogger();

const RESERVED = new Set(['liveresults', 'manual', 'csv', 'custom']);
const ID_RE = /^[a-z][a-z0-9-]{1,40}$/;

const loaded = new Map<string, TimingPluginInfo>();
let failures: { path: string; error: string }[] = [];
let pluginsFolder: string | null = null;

/** Does the plugin's sdk range accept this build? Only the major version must match. */
export function sdkCompatible(range: string): boolean {
  const m = /(\d+)/.exec(range ?? '');
  if (!m) return false;
  const major = Number(TIMING_SDK_VERSION.split('.')[0]);
  return Number(m[1]) === major;
}

export function validateManifest(m: PluginManifest | undefined): PluginManifest {
  if (!m || typeof m !== 'object') throw new Error('The plugin has no manifest');
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) throw new Error(`Plugin id "${m.id}" must be lowercase letters, digits and hyphens`);
  if (!m.name) throw new Error(`Plugin ${m.id}: "name" is required`);
  if (!m.version) throw new Error(`Plugin ${m.id}: "version" is required`);
  if (!sdkCompatible(m.sdk)) throw new Error(`Plugin ${m.id} needs timing SDK ${m.sdk}; this Split Control has ${TIMING_SDK_VERSION}`);
  return m;
}

export function registerTimingPlugin(plugin: TimingPlugin, origin: { kind: TimingPluginInfo['kind']; path?: string }): void {
  const manifest = validateManifest(plugin?.manifest);
  if (typeof plugin.create !== 'function') throw new Error(`Plugin ${manifest.id}: create(config, ctx) is missing`);
  const existing = loaded.get(manifest.id);
  if (origin.kind !== 'builtin' && (RESERVED.has(manifest.id) || existing?.kind === 'builtin')) {
    throw new Error(`Plugin id "${manifest.id}" is taken by a source built into Split Control`);
  }
  if (existing && origin.kind !== 'builtin' && existing.path !== origin.path) {
    throw new Error(`Plugin id "${manifest.id}" is already used by ${existing.path}`);
  }
  getDataSourceRegistry().register({
    type: manifest.id,
    factory: config => new PluginDataSource(plugin, config),
    displayName: manifest.name,
    description: manifest.description ?? '',
    kind: origin.kind,
    configSchema: manifest.configSchema,
    extFields: manifest.extFields
  });
  loaded.set(manifest.id, {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    sdk: manifest.sdk,
    kind: origin.kind,
    path: origin.path,
    capabilities: manifest.capabilities ?? {},
    extFields: manifest.extFields ?? []
  });
}

export function registerBuiltInTimingPlugins(): void {
  for (const plugin of BUILT_IN_TIMING_PLUGINS) registerTimingPlugin(plugin, { kind: 'builtin' });
}

/** Load one entry of the plugins folder: a profile file, a folder with profile.yaml, or a code plugin folder */
function loadEntry(full: string): void {
  const stat = fs.statSync(full);
  const isProfileFile = (p: string) => /\.(ya?ml)$/i.test(p);
  if (stat.isFile()) {
    if (!isProfileFile(full)) return;
    const profile = parseSqlProfile(fs.readFileSync(full, 'utf8'), path.basename(full));
    registerTimingPlugin(sqlProfilePlugin(profile), { kind: 'sql-profile', path: full });
    return;
  }
  if (!stat.isDirectory()) return;
  for (const name of ['profile.yaml', 'profile.yml']) {
    const p = path.join(full, name);
    if (fs.existsSync(p)) {
      const profile = parseSqlProfile(fs.readFileSync(p, 'utf8'), `${path.basename(full)}/${name}`);
      registerTimingPlugin(sqlProfilePlugin(profile), { kind: 'sql-profile', path: p });
      return;
    }
  }
  let main = 'index.js';
  const pkgPath = path.join(full, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (typeof pkg.main === 'string') main = pkg.main;
  }
  const entry = path.resolve(full, main);
  if (!fs.existsSync(entry)) return; // not a plugin folder
  // Plugins are CommonJS, loaded with Node's own require (not bundled)
  const requireFromPlugin = createRequire(entry);
  delete requireFromPlugin.cache[entry];
  const mod = requireFromPlugin(entry);
  const plugin: TimingPlugin = mod?.default ?? mod;
  registerTimingPlugin(plugin, { kind: 'code', path: entry });
}

/**
 * Load every plugin in the folder. A plugin that fails is reported (listTimingPlugins) and
 * skipped; the others still load. Calling it again reloads the folder.
 */
export function loadTimingPlugins(folder: string): TimingPluginList {
  pluginsFolder = folder;
  // Forget plugins from an earlier load
  for (const [id, info] of loaded) {
    if (info.kind !== 'builtin') {
      getDataSourceRegistry().unregister(id);
      loaded.delete(id);
    }
  }
  failures = [];
  try {
    fs.mkdirSync(folder, { recursive: true });
  } catch (error) {
    logger.warn('Could not create the timing plugins folder', { folder, error: String(error) });
  }
  let names: string[];
  try {
    names = fs.readdirSync(folder).filter(n => !n.startsWith('.')).sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const full = path.join(folder, name);
    try {
      loadEntry(full);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: full, error: message });
      logger.warn('Timing plugin failed to load', { path: full, error: message });
    }
  }
  const list = listTimingPlugins();
  logger.info('Timing plugins loaded', {
    folder,
    plugins: list.plugins.filter(p => p.kind !== 'builtin').map(p => p.id),
    failures: failures.length
  });
  return list;
}

export function listTimingPlugins(): TimingPluginList {
  return { folder: pluginsFolder, plugins: [...loaded.values()], failures: [...failures] };
}

/** For tests */
export function resetTimingPlugins(): void {
  for (const id of loaded.keys()) getDataSourceRegistry().unregister(id);
  loaded.clear();
  failures = [];
  pluginsFolder = null;
}

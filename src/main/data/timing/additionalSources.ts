/**
 * Additional sources: data next to the event's timing source (GPS speed, heart rate …).
 *
 * The timing source alone decides who is in a class and every base tag (places, times,
 * statuses …). An additional source can only add the fields its plugin declares, under its own
 * namespace: results[].x.<plugin> for runners and x.<plugin> for the class. So sources never
 * interfere:
 *  - nothing an additional source says changes a base tag or another source's fields;
 *  - each plugin has one namespace: a second source of the same plugin (or of the timing
 *    source's plugin) is left out, with a warning;
 *  - a slow or failing additional source never holds up or blanks the timing data: after a few
 *    seconds the graphic gets the timing data with that source's last good fields (or none).
 *
 * Runners are matched by bib, then by name and club, then by name when it is unique in both.
 */

import { getLogger } from '../../utils/logger';
import { getDataSourceRegistry } from '../DataSourceRegistry';
import { mapTimingClasses } from '../timingScope';
import type { AdditionalSource } from '../../../shared/types/event';
import type { Ext } from '../../../shared/timing-sdk';
import type { ClassResults, ResultRow } from './model';
import type { TimingHub } from './TimingHub';

const logger = getLogger();

/** Longest an additional source may take before the graphic goes out without its new data */
let additionalTimeoutMs = 3000;

/** For tests */
export function setAdditionalTimeoutMs(ms: number): void {
  additionalTimeoutMs = ms;
}

export interface Supplement {
  sourceId: string;
  pluginId: string;
  /** Runner fields of this plugin, for each matched runner */
  runner(row: Pick<ResultRow, 'name' | 'club' | 'bib'>): Ext | undefined;
  /** Class / competition fields of this plugin */
  classExt?: Ext;
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Index another source's rows to find the timing source's runners among them */
export function runnerMatcher(rows: ResultRow[], pluginId: string): Supplement['runner'] {
  const byBib = new Map<string, ResultRow>();
  const byNameClub = new Map<string, ResultRow>();
  const byName = new Map<string, ResultRow | null>(); // null: the name is not unique
  for (const r of rows) {
    if (!r.ext?.[pluginId]) continue;
    if (r.bib) byBib.set(norm(r.bib), r);
    byNameClub.set(`${norm(r.name)}|${norm(r.club)}`, r);
    byName.set(norm(r.name), byName.has(norm(r.name)) ? null : r);
  }
  return (row) => {
    const hit =
      (row.bib ? byBib.get(norm(row.bib)) : undefined) ??
      byNameClub.get(`${norm(row.name)}|${norm(row.club)}`) ??
      byName.get(norm(row.name)) ??
      undefined;
    return hit?.ext?.[pluginId];
  };
}

/** Last good data of each additional source, per class: used while it is slow or failing */
const lastGood = new Map<string, { rows: ResultRow[]; classExt?: Ext }>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
    promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
  });
}

/** The additional sources to use: known, not the timing source, one per plugin */
export function usableAdditionalSources(timingSourceId: string | undefined, list: AdditionalSource[] | undefined): (AdditionalSource & { hub: TimingHub; pluginId: string })[] {
  const registry = getDataSourceRegistry();
  const timingHub: TimingHub | undefined = timingSourceId ? (registry.get(timingSourceId) as any)?.getClient?.() : undefined;
  const taken = new Set<string>(timingHub ? [timingHub.pluginId] : []);
  const out: (AdditionalSource & { hub: TimingHub; pluginId: string })[] = [];
  for (const a of list ?? []) {
    if (!a?.sourceId || a.sourceId === timingSourceId) continue;
    const hub: TimingHub | undefined = (registry.get(a.sourceId) as any)?.getClient?.();
    if (!hub) {
      logger.warn('Additional source not set up', { sourceId: a.sourceId });
      continue;
    }
    if (taken.has(hub.pluginId)) {
      logger.warn('Additional source left out: another source of the event already uses its plugin', { sourceId: a.sourceId, plugin: hub.pluginId });
      continue;
    }
    taken.add(hub.pluginId);
    out.push({ ...a, hub, pluginId: hub.pluginId });
  }
  return out;
}

async function fetchSupplement(a: AdditionalSource & { hub: TimingHub; pluginId: string }, className: string): Promise<{ rows: ResultRow[]; classExt?: Ext }> {
  const ds: any = getDataSourceRegistry().get(a.sourceId);
  if (ds && !ds.initialized) await ds.initialize();
  const competitionId = a.competitionId ?? (await a.hub.getCompetitions()).data[0]?.id;
  if (competitionId === undefined) return { rows: [] };
  const classes = (await a.hub.getClasses(competitionId)).data.map(c => c.className);
  // The same class when the source has it; otherwise every class it has (runners are matched)
  const names = classes.includes(className) ? [className] : classes;
  const results: ClassResults[] = (await mapTimingClasses(names, name => a.hub.getClassResults(competitionId, name, { maxAgeMs: 1000 }))).map(r => r.data);
  return {
    rows: results.flatMap(r => r.rows),
    classExt: classes.includes(className) ? results[0]?.ext?.[a.pluginId] : undefined
  };
}

/** The fields every additional source adds for a class (each on its own, never failing) */
export async function supplementsFor(timingSourceId: string | undefined, list: AdditionalSource[] | undefined, className: string): Promise<Supplement[]> {
  const sources = usableAdditionalSources(timingSourceId, list);
  return Promise.all(sources.map(async a => {
    const key = `${a.sourceId}|${a.competitionId ?? ''}|${className}`;
    let data = lastGood.get(key);
    try {
      data = await withTimeout(fetchSupplement(a, className), additionalTimeoutMs);
      lastGood.set(key, data);
    } catch (error) {
      logger.warn('Additional source failed: graphics keep its last good fields', { sourceId: a.sourceId, className, error: error instanceof Error ? error.message : String(error) });
    }
    return {
      sourceId: a.sourceId,
      pluginId: a.pluginId,
      runner: runnerMatcher(data?.rows ?? [], a.pluginId),
      ...(data?.classExt ? { classExt: data.classExt } : {})
    };
  }));
}

/** For tests */
export function clearAdditionalSourceCache(): void {
  lastGood.clear();
}

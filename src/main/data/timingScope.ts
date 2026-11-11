const classCache = new WeakMap<object, Map<number, { expires: number; request: Promise<string[]> }>>();

/** Class scope shared by mapping, radio selectors and live polling. */
export async function timingClasses(client: any, competitionId: number, selected?: string): Promise<string[]> {
  if (selected) return [selected];
  if (!client?.getClasses) throw new Error('The timing source cannot list classes');
  const cache = classCache.get(client) ?? new Map();
  classCache.set(client, cache);
  const cached = cache.get(competitionId);
  if (cached && cached.expires > Date.now()) return cached.request;
  const request: Promise<string[]> = client.getClasses(competitionId).then((response: any) =>
    [...new Set<string>((response.data ?? []).map((c: any) => String(c.className || '')).filter(Boolean))]);
  cache.set(competitionId, { expires: Date.now() + 30_000, request });
  try { return await request; } catch (error) { cache.delete(competitionId); throw error; }

}

/** Bound all-class requests so a large event cannot flood its timing source. */
export async function mapTimingClasses<T>(classes: string[], fetch: (name: string) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < classes.length; i += 4) results.push(...await Promise.all(classes.slice(i, i + 4).map(fetch)));
  return results;
}

/** Radio controls of a class (or of every class), as the timing source names them */
export async function timingControls(
  client: any,
  competitionId: number,
  className?: string,
): Promise<{ className: string; code: number; sourceName: string }[]> {
  const classes = await timingClasses(client, competitionId, className);
  const snapshots = await mapTimingClasses<any>(classes, name => client.getClassResults(competitionId, name, { maxAgeMs: 30_000 }));
  return snapshots.flatMap((res, index) => (res.data.splitcontrols ?? []).map((c: any) => ({
    className: classes[index],
    code: typeof c === "object" ? c.code : c,
    sourceName: typeof c === "object" ? c.name : `Control ${c}`,
  })));
}

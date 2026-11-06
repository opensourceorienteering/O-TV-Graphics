/**
 * Build LiveResults-shaped class results from normalised rows.
 * Shared by the non-HTTP backends (MeOS MOP database, IOF XML files) so ranking, ties,
 * split places and ordering behave the same as Liveresultat.
 */

import type { LiveResultsClassResult, LiveResultsResult, LiveResultsSplitControl } from '../../../shared/types/liveresults';

export interface ResultRow {
  key: string;
  name: string;
  club: string;
  bib?: string;
  /** Nation code (IOC or ISO), when the source knows it */
  country?: string;
  status: number;        // LiveResults code
  ranked: boolean;       // false for out-of-competition
  start: number;         // hundredths since midnight
  /** Relays: when the team started (hundredths since midnight); results count from it */
  teamStart?: number;
  result: number;        // hundredths, 0 = none
  splits: Map<number, number>; // split code -> hundredths
}

/** Places "1", "=" for ties and "" for unranked, plus time behind, like LiveResults */
export function rank(rows: { time: number; eligible: boolean }[]): { place: string; timeplus: number }[] {
  const order = rows
    .map((r, i) => ({ i, time: r.time }))
    .filter((_, i) => rows[i].eligible && rows[i].time > 0)
    .sort((a, b) => a.time - b.time);
  const out = rows.map(() => ({ place: '', timeplus: 0 }));
  const best = order.length ? order[0].time : 0;
  order.forEach((entry, idx) => {
    const tie = idx > 0 && order[idx - 1].time === entry.time;
    out[entry.i] = { place: tie ? '=' : String(idx + 1), timeplus: entry.time - best };
  });
  return out;
}

export function buildClassResult(className: string, controls: LiveResultsSplitControl[], rows: ResultRow[]): LiveResultsClassResult {
  const finish = rank(rows.map(r => ({ time: r.result, eligible: r.ranked && r.status === 0 })));
  const perControl = controls.map(ctrl =>
    rank(rows.map(r => ({ time: r.splits.get(ctrl.code) ?? 0, eligible: r.ranked })))
  );

  const results: LiveResultsResult[] = rows.map((r, i) => {
    const splits: Record<string, number> = {};
    controls.forEach((ctrl, ci) => {
      const t = r.splits.get(ctrl.code);
      if (!t) return;
      splits[String(ctrl.code)] = t;
      splits[`${ctrl.code}_status`] = 0;
      const p = perControl[ci][i];
      if (p.place) splits[`${ctrl.code}_place`] = p.place === '=' ? Number(prevPlace(perControl[ci], rows, ctrl.code, t)) : Number(p.place);
      splits[`${ctrl.code}_timeplus`] = p.timeplus;
    });
    const passed = controls.filter(c => r.splits.get(c.code)).length;
    const progress = r.result > 0 || [1, 2, 3, 4, 5, 11, 20].includes(r.status)
      ? 100
      : controls.length ? Math.round((passed / (controls.length + 1)) * 100) : 0;
    return {
      place: finish[i].place,
      name: r.name,
      club: r.club,
      result: r.result > 0 ? String(r.result) : '',
      status: r.status,
      timeplus: finish[i].place ? String(finish[i].timeplus) : '',
      progress,
      start: r.start,
      ...(r.teamStart ? { teamstart: r.teamStart } : {}),
      bib: r.bib,
      ...(r.country ? { country: r.country } : {}),
      splits
    };
  });

  // Same order as Liveresultat: ranked by place, then running, then the rest
  const orderKey = (r: LiveResultsResult) =>
    r.place && r.place !== '' ? 0 : r.status === 10 || r.status === 9 ? 1 : 2;
  results.sort((a, b) => orderKey(a) - orderKey(b) || (Number(a.result) || 0) - (Number(b.result) || 0) || a.start - b.start);

  return { className, splitcontrols: controls, results, hash: '' };
}

/** For a tie ("=") the numeric place is that of the first runner with the same time */
function prevPlace(ranks: { place: string; timeplus: number }[], rows: ResultRow[], code: number, time: number): string {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].splits.get(code) === time && ranks[i].place && ranks[i].place !== '=') return ranks[i].place;
  }
  return '';
}


/**
 * From a source's facts to the standings graphics show.
 *
 * For a class whose entries carry the source's own `standing` (official results services),
 * the source's order and standings are kept. Otherwise Split Control works them out, the
 * same way for every source:
 *  - places by result among ranked runners with status ok; equal times share a place ("=")
 *  - time behind the leader; split places and time behind at every radio control
 *  - progress: 100 once finished or out, else the share of radio controls passed
 *  - order: placed, then running / not started, then the rest; then by result and start
 *  - relays: times from the team's start (team perspective)
 */

import type { ClassInfo, Control, Entry, Ext } from '../../../shared/timing-sdk';
import type { ClassResults, ResultControl, ResultRow, SplitResult } from './model';
import { STATUS_CODES } from './model';

/**
 * The control key graphics and saved settings use: visit * 1000 + code for codes below 1000
 * (1050 = first visit to 50, 2050 = second), otherwise code + 100000 per extra visit.
 */
export function splitCode(control: Pick<Control, 'id' | 'code' | 'visit'>): number {
  const code = control.code ?? parseInt(control.id, 10);
  const visit = Math.max(1, control.visit ?? 1);
  if (!Number.isFinite(code)) return 0;
  return code < 1000 ? visit * 1000 + code : code + (visit - 1) * 100000;
}

/** Statuses that end the race: progress 100 */
const OUT_CODES = new Set([1, 2, 3, 4, 5, 11, 20]);

/** Places with ties among eligible times: index -> { place, tied, behind } */
function rank(times: { time: number; eligible: boolean }[]): ({ place: number; tied: boolean; behind: number } | undefined)[] {
  const order = times
    .map((t, i) => ({ i, time: t.time }))
    .filter((_, i) => times[i].eligible && times[i].time > 0)
    .sort((a, b) => a.time - b.time);
  const out: ({ place: number; tied: boolean; behind: number } | undefined)[] = times.map(() => undefined);
  const best = order.length ? order[0].time : 0;
  let groupPlace = 0;
  order.forEach((entry, idx) => {
    const tied = idx > 0 && order[idx - 1].time === entry.time;
    if (!tied) groupPlace = idx + 1;
    out[entry.i] = { place: groupPlace, tied, behind: entry.time - best };
  });
  return out;
}

export interface BuildInput {
  competitionId: number;
  /** The class as chosen ("H21", relay leg "Mixed-2") */
  className: string;
  cls: ClassInfo;
  leg?: number;
  /** This class's entries (this leg's, for relays), in the source's order */
  entries: Entry[];
  pluginId: string;
  competitionExt?: Ext;
}

export function buildClassResults(input: BuildInput): ClassResults {
  const { cls, leg, pluginId } = input;
  const controls: ResultControl[] = [];
  const keyById = new Map<string, number>();
  for (const c of cls.radioControls ?? []) {
    if (c.leg !== undefined && c.leg !== (leg ?? 1)) continue;
    const key = splitCode(c);
    if (!key) continue;
    keyById.set(c.id, key);
    if (!controls.some(x => x.key === key)) {
      controls.push({ key, id: c.id, ...(c.code !== undefined ? { code: c.code } : {}), name: c.name || `Control ${c.code ?? c.id}` });
    }
  }

  const official = input.entries.some(e => e.standing);
  type Work = { e: Entry; row: ResultRow; result: number; startOrder: number };
  const work: Work[] = [];

  for (const e of input.entries) {
    const code = STATUS_CODES[e.status];
    if (code === null || code === undefined) continue;
    const start = e.start ?? e.team?.start;
    const teamStart = e.team?.start;
    const offset = teamStart && start ? Math.max(0, start - teamStart) : 0;
    const own = e.time ?? (e.finish !== undefined && e.start !== undefined ? e.finish - e.start : undefined);
    const ownTime = own && own > 0 ? own : 0;
    const teamTime = e.team?.time && e.team.time > 0 ? e.team.time : 0;
    const anyResult = teamTime || (ownTime ? ownTime + offset : 0);
    // The source's standings keep its result whatever the status; worked-out ones only count ok
    const result = official ? anyResult : code === 0 ? anyResult : 0;

    const splits: Record<number, SplitResult> = {};
    for (const p of e.passings ?? []) {
      const key = keyById.get(p.controlId);
      if (!key) continue;
      let t: number | undefined;
      if (p.teamTime !== undefined && p.teamTime > 0) t = p.teamTime;
      else {
        const ms = p.time ?? (p.at !== undefined && e.start !== undefined ? p.at - e.start : undefined);
        if (ms !== undefined && ms > 0) t = ms + offset;
      }
      if (t === undefined) continue;
      const st = p.standing;
      splits[key] = {
        time: t,
        status: st?.status !== undefined ? (STATUS_CODES[st.status] ?? 0) : 0,
        ...(official && st?.place !== undefined ? { place: st.place } : {}),
        ...(official && st?.behind !== undefined ? { behind: st.behind } : {})
      };
    }

    const ext = e.ext && Object.keys(e.ext).length ? { [pluginId]: e.ext } : undefined;
    const row: ResultRow = {
      entryId: e.id,
      name: e.name?.full ?? [e.name?.given, e.name?.family].filter(Boolean).join(' '),
      club: e.team ? e.team.name : (e.club?.short || e.club?.name || ''),
      ...(e.bib || e.team?.bib ? { bib: e.bib || e.team?.bib } : {}),
      ...(e.country || e.club?.country ? { country: e.country || e.club?.country } : {}),
      status: e.status,
      statusCode: code,
      ranked: e.ranked !== false,
      tied: false,
      // The source's standings keep a time it gives as 0 (Liveresultat lists DNS that way)
      ...(result > 0 || (official && (e.time !== undefined || e.team?.time !== undefined)) ? { time: result } : {}),
      ...(start ? { start } : {}),
      ...(teamStart ? { teamStart } : {}),
      progress: 0,
      splits,
      ...(e.team ? { team: { id: e.team.id, name: e.team.name, ...(e.team.bib ? { bib: e.team.bib } : {}), leg: e.team.leg } } : {}),
      ...(ext ? { ext } : {})
    };
    work.push({ e, row, result, startOrder: start ?? 0 });
  }

  const passedCount = (row: ResultRow) => controls.filter(c => row.splits[c.key]?.time).length;
  const computedProgress = (w: Work) =>
    w.result > 0 || OUT_CODES.has(w.row.statusCode)
      ? 100
      : controls.length ? Math.round((passedCount(w.row) / (controls.length + 1)) * 100) : 0;

  if (official) {
    for (const w of work) {
      const st = w.e.standing;
      if (st?.place !== undefined) w.row.place = st.place;
      w.row.tied = !!st?.tied;
      if (st?.behind !== undefined) w.row.behind = st.behind;
      w.row.progress = st?.progress ?? computedProgress(w);
    }
  } else {
    const finish = rank(work.map(w => ({ time: w.result, eligible: w.row.ranked && w.row.statusCode === 0 })));
    work.forEach((w, i) => {
      const r = finish[i];
      if (r) { w.row.place = r.place; w.row.tied = r.tied; w.row.behind = r.behind; }
    });
    for (const c of controls) {
      const at = rank(work.map(w => ({ time: w.row.splits[c.key]?.time ?? 0, eligible: w.row.ranked })));
      work.forEach((w, i) => {
        const s = w.row.splits[c.key];
        if (!s) return;
        const r = at[i];
        if (r) { s.place = r.place; s.behind = r.behind; } else { s.behind = 0; }
      });
    }
    for (const w of work) w.row.progress = computedProgress(w);
    const orderKey = (w: Work) => (w.row.place !== undefined ? 0 : w.row.statusCode === 10 || w.row.statusCode === 9 ? 1 : 2);
    work.sort((a, b) => orderKey(a) - orderKey(b) || a.result - b.result || a.startOrder - b.startOrder);
  }

  const out: ClassResults = {
    competitionId: input.competitionId,
    className: input.className,
    classId: cls.id,
    ...(leg ? { leg } : {}),
    controls,
    rows: work.map(w => w.row)
  };
  if (cls.course && cls.kind !== 'relay') out.course = cls.course;
  const ext = { ...(input.competitionExt ?? {}), ...(cls.ext ?? {}) };
  if (Object.keys(ext).length) out.ext = { [pluginId]: ext };
  return out;
}

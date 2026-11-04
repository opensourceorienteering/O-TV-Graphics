import type { ControlState } from '../../../shared/types/event';

type PollingStatus = NonNullable<ControlState['polling']>[number];

export interface PollingSummary {
  sourceId?: string;
  sourceName: string;
  sourceType?: PollingStatus['sourceType'];
  apiFlavor?: PollingStatus['apiFlavor'];
  lastPoll?: number;
  waiting: boolean;
  stale: boolean;
  ok: boolean;
  error?: string;
}

export function summarizePollingStatus(
  polling: PollingStatus[] | undefined,
  now: number
): PollingSummary[] {
  const groups = new Map<string, PollingStatus[]>();
  for (const status of polling ?? []) {
    const key = status.sourceId ?? `${status.sourceName ?? 'Liveresultat'}|${status.apiFlavor ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(status);
    groups.set(key, group);
  }

  return [...groups.values()].map(statuses => {
    const first = statuses[0];
    const waiting = statuses.some(status => !status.lastPoll);
    const stale = statuses.some(status =>
      !!status.lastPoll && now - status.lastPoll > Math.max(30000, (status.interval || 10000) * 3)
    );
    const error = statuses.find(status => status.lastError)?.lastError
      ?? (statuses.some(status => status.errorCount) ? 'Polling error' : undefined);
    return {
      sourceId: first.sourceId,
      sourceName: first.sourceName || 'Liveresultat',
      sourceType: first.sourceType,
      apiFlavor: first.apiFlavor,
      lastPoll: statuses.reduce<number | undefined>((latest, status) =>
        status.lastPoll === undefined ? latest : Math.max(latest ?? status.lastPoll, status.lastPoll), undefined),
      waiting,
      stale,
      ok: !waiting && !stale && !error,
      error
    };
  });
}

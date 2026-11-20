/**
 * What the content rules blocked for graphics, reported by the graphics pages (output window,
 * OBS/vMix web output, preview frames). Listed in Settings → Internet access with Allow buttons.
 */
import { BlockedLog, blockedOrigin, type BlockedEntry } from '../../shared/blockedAddresses';

const log = new BlockedLog();
let notify: () => void = () => undefined;

/** Called after each new report (the operator UI refreshes its list) */
export function setBlockedNotifier(fn: () => void): void {
  notify = fn;
}

/** A report from a graphics page; anything that isn't a plain web address is ignored */
export function recordBlocked(report: unknown): void {
  const r = (report ?? {}) as { origin?: unknown; graphics?: unknown };
  const origin = blockedOrigin(String(r.origin ?? ''));
  if (!origin || origin !== r.origin) return;
  const graphics = (Array.isArray(r.graphics) ? r.graphics : []).map((g) => String(g).slice(0, 120)).slice(0, 10);
  log.add({ origin, graphics, at: Date.now() });
  notify();
}

export function blockedList(allowed: string[]): BlockedEntry[] {
  return log.list(allowed);
}

export function clearBlocked(): void {
  log.clear();
}

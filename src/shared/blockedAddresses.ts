/**
 * Addresses the content rules blocked for graphics, so the operator can see what a graphic tried
 * to reach and allow it (Settings → Internet access). Shared by the pages that report and the
 * main process that keeps the list.
 */

/** The allowlist entry a blocked request would need ("https://host"), or null if it can't be allowed */
export function blockedOrigin(blockedURI: string): string | null {
  let url: URL;
  try {
    url = new URL(blockedURI);
  } catch {
    return null;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || !url.hostname) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  return `https://${url.hostname.toLowerCase()}`;
}

export interface BlockedEntry {
  origin: string;
  /** Graphics on the page when it was blocked, by name */
  graphics: string[];
  /** When it was last blocked (ms) */
  last: number;
  count: number;
}

const KEEP = 20;

/** Does the allowlist cover this origin (exact, or a "https://*.domain" entry)? */
function covered(origin: string, allowed: string[]): boolean {
  const host = origin.replace(/^https:\/\//, '');
  return allowed.some((a) => {
    const entry = a.replace(/^https:\/\//, '');
    return entry === host || (entry.startsWith('*.') && host.endsWith(entry.slice(1)));
  });
}

export class BlockedLog {
  private entries = new Map<string, BlockedEntry>();

  add(report: { origin: string; graphics: string[]; at: number }): void {
    const previous = this.entries.get(report.origin);
    this.entries.delete(report.origin);
    this.entries.set(report.origin, {
      origin: report.origin,
      graphics: [...new Set([...(previous?.graphics ?? []), ...report.graphics])].sort(),
      last: report.at,
      count: (previous?.count ?? 0) + 1,
    });
    while (this.entries.size > KEEP) this.entries.delete(this.entries.keys().next().value!);
  }

  /** Newest first, without addresses the allowlist now covers */
  list(allowed: string[]): BlockedEntry[] {
    return [...this.entries.values()].filter((e) => !covered(e.origin, allowed)).sort((a, b) => b.last - a.last);
  }

  clear(): void {
    this.entries.clear();
  }
}

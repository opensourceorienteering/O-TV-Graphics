/**
 * Bibs as operators type them. A virtual bib ("V101", assigned in Split Control when the event
 * has no bibs) is found by its number alone ("101"): virtual numbers are never given out when a
 * real bib has the same number, so the number is unambiguous. If a later start-list refresh
 * brings a real bib with that number anyway, the real bib wins.
 */

export interface HasBibs {
  bib?: string;
  virtualBib?: string;
}

/** The number of a virtual bib ("V101" -> "101"), lower case; other text unchanged */
export function bibNumber(bib?: string | null): string {
  return String(bib ?? "").trim().replace(/^v(?=\d)/i, "").toLowerCase();
}

/** How a typed bib matches a runner: 0 = real bib, 1 = virtual bib, -1 = no match */
export function bibMatch(runner: HasBibs, typed: string): number {
  const q = typed.trim().toLowerCase();
  if (!q) return -1;
  if (runner.bib && runner.bib.trim().toLowerCase() === q) return 0;
  if (runner.virtualBib && bibNumber(runner.virtualBib) === bibNumber(q)) return 1;
  return -1;
}

/** True when the runner's bib, or virtual bib number, starts with what is typed */
export function bibStartsWith(runner: HasBibs, typed: string): boolean {
  const q = typed.trim().toLowerCase();
  if (!q) return false;
  if (runner.bib && runner.bib.trim().toLowerCase().startsWith(q)) return true;
  return !!runner.virtualBib && bibNumber(runner.virtualBib).startsWith(bibNumber(q));
}

/** Runners whose bib is exactly what was typed; a real bib beats a virtual one */
export function findByBib<T extends HasBibs>(runners: T[], typed: string): T[] {
  const real = runners.filter((r) => bibMatch(r, typed) === 0);
  return real.length ? real : runners.filter((r) => bibMatch(r, typed) === 1);
}

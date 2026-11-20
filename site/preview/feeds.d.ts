/** Types for feeds.js (sample event, course and weather data) */
export function sampleFeeds(options?: { date?: string; className?: string }): Record<string, Record<string, unknown>>;
export function graphicFeedData(
  graphic: { desk?: { feeds?: readonly string[] }; schema?: { properties?: Record<string, { default?: unknown } | undefined> } } | null | undefined,
  timing: Record<string, unknown>,
): Record<string, unknown>;

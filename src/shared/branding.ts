/**
 * Built-in event logos. The IOF logo is no longer offered; events that still point at it
 * show no logo instead of a broken image.
 */
import type { ProjectPresentation } from './types/spx';

export const TYR_LOGO_URL = '/built-in-assets/tyr-logo.png';
export const RETIRED_LOGO_URLS = ['/built-in-assets/iof-logo.svg'];

/** Presentation settings as graphics should see them (retired logos removed) */
export function presentationForGraphics(p: ProjectPresentation | undefined): ProjectPresentation {
  const presentation = { ...(p ?? {}) };
  if (presentation.logoUrl && RETIRED_LOGO_URLS.includes(presentation.logoUrl)) delete presentation.logoUrl;
  // the built-in Tyr badge is always drawn with its own transparency
  if (presentation.logoUrl === TYR_LOGO_URL) delete presentation.logoPlate;
  return presentation;
}

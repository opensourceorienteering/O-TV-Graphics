/**
 * Event logos. An event shows the look's own logo (template), an uploaded logo (custom) or no
 * logo. The OK Tyr logo that used to come with the app and the IOF logo are no longer offered:
 * events that chose them show the look's own logo.
 */
import type { LogoMode, ProjectPresentation } from './types/spx';

export const RETIRED_LOGO_URLS = ['/built-in-assets/tyr-logo.png', '/built-in-assets/iof-logo.svg'];

/** Which logo an event shows; events from before the choice existed keep what they showed */
export function logoModeOf(p: ProjectPresentation | undefined): LogoMode {
  if (p?.logoMode === 'template' || p?.logoMode === 'custom' || p?.logoMode === 'none') {
    return p.logoMode === 'custom' && !customLogoUrl(p) ? 'template' : p.logoMode;
  }
  return customLogoUrl(p) ? 'custom' : 'template';
}

/** The uploaded logo, if the event has one (retired built-in logos don't count) */
export function customLogoUrl(p: ProjectPresentation | undefined): string | undefined {
  const url = p?.logoUrl;
  return url && !RETIRED_LOGO_URLS.includes(url) ? url : undefined;
}

/** Presentation settings as graphics should see them: the logo mode, and logoUrl only for a custom logo */
export function presentationForGraphics(p: ProjectPresentation | undefined): ProjectPresentation {
  const presentation = { ...(p ?? {}) };
  presentation.logoMode = logoModeOf(p);
  if (presentation.logoMode !== 'custom') {
    delete presentation.logoUrl;
    delete presentation.logoPlate;
  }
  return presentation;
}

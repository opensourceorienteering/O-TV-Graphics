/**
 * Applying a changed internet allowlist. Content rules attach to a page when it loads, so the
 * graphics window and open OBS/vMix web outputs keep their old rules until they reload. They
 * reload once nothing is on air (a reload on air would blink the broadcast); preview frames
 * reload before their next graphic.
 */
export interface RulesReloadDeps {
  /** Graphics on air right now */
  onAirCount: () => number;
  /** Reload the graphics window and every web output page */
  reloadPages: () => void;
  /** Tell the operator UI's preview frames to reload before their next graphic */
  notifyPreviews: () => void;
}

const CHECK_EVERY_MS = 2000;
const QUIET_CHECKS = 2;

export class RulesReloader {
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Checks in a row with nothing on air, since something last was */
  private quiet = 0;

  constructor(private deps: RulesReloadDeps) {}

  changed(): void {
    this.deps.notifyPreviews();
    if (this.timer) return;
    // Idle right now (nothing loaded at all): reload at once
    if (this.deps.onAirCount() === 0) {
      this.reload();
      return;
    }
    // Otherwise wait until air has been clear for two checks in a row, so an out-animation
    // or a graphic just being loaded is never cut by the reload
    this.quiet = 0;
    this.timer = setInterval(() => {
      this.quiet = this.deps.onAirCount() === 0 ? this.quiet + 1 : 0;
      if (this.quiet >= QUIET_CHECKS) this.reload();
    }, CHECK_EVERY_MS);
  }

  private reload(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deps.reloadPages();
  }
}

let current: RulesReloader | null = null;

export function setRulesReloader(reloader: RulesReloader): void {
  current = reloader;
}

/** Call after the allowlist changed (Settings, or allowed at import) */
export function graphicsRulesChanged(): void {
  current?.changed();
}

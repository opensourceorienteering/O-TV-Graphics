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

export class RulesReloader {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: RulesReloadDeps) {}

  changed(): void {
    this.deps.notifyPreviews();
    if (this.tryReload() || this.timer) return;
    this.timer = setInterval(() => this.tryReload(), CHECK_EVERY_MS);
  }

  private tryReload(): boolean {
    if (this.deps.onAirCount() > 0) return false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.deps.reloadPages();
    return true;
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

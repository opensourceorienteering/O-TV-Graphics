/**
 * Output pages (graphics window, OBS/vMix web output) and the internet allowlist. A page's
 * content rules are fixed when it loads; the app numbers each allowlist change and tells every
 * page that connects. A page that missed a change (it was disconnected at the time) reloads,
 * once it shows nothing, to pick up the new rules.
 */
export function createRulesVersionGate(deps: { reload: () => void; showing: () => number }) {
  let mine: number | null = null;
  let stale = false;
  const check = () => {
    if (stale && deps.showing() === 0) {
      stale = false;
      deps.reload();
    }
  };
  return {
    /** The app's current rules version, sent on every connect */
    version(v: number) {
      if (mine === null) mine = v;
      else if (v !== mine) stale = true;
      check();
    },
    /** Call after graphics leave the page */
    check,
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { RulesReloader } from '../rulesReload';

afterEach(() => vi.useRealTimers());

function setup(onAir: number) {
  const state = { onAir };
  const deps = { onAirCount: () => state.onAir, reloadPages: vi.fn(), notifyPreviews: vi.fn() };
  return { state, deps, reloader: new RulesReloader(deps) };
}

describe('applying a changed internet allowlist', () => {
  it('reloads the output pages straight away when nothing is on air', () => {
    const { deps, reloader } = setup(0);
    reloader.changed();
    expect(deps.notifyPreviews).toHaveBeenCalledTimes(1);
    expect(deps.reloadPages).toHaveBeenCalledTimes(1);
  });
  it('waits while a graphic is on air, then reloads once air is clear', () => {
    vi.useFakeTimers();
    const { state, deps, reloader } = setup(1);
    reloader.changed();
    expect(deps.reloadPages).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(deps.reloadPages).not.toHaveBeenCalled();
    state.onAir = 0;
    vi.advanceTimersByTime(2000);
    expect(deps.reloadPages).not.toHaveBeenCalled(); // quiet for one check only: an out-animation may still run
    vi.advanceTimersByTime(2000);
    expect(deps.reloadPages).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(deps.reloadPages).toHaveBeenCalledTimes(1);
  });
  it('starts the quiet period again when something goes on air in between', () => {
    vi.useFakeTimers();
    const { state, deps, reloader } = setup(1);
    reloader.changed();
    state.onAir = 0;
    vi.advanceTimersByTime(2000);
    state.onAir = 1;
    vi.advanceTimersByTime(2000);
    state.onAir = 0;
    vi.advanceTimersByTime(2000);
    expect(deps.reloadPages).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(deps.reloadPages).toHaveBeenCalledTimes(1);
  });
  it('reloads once for several changes made while on air', () => {
    vi.useFakeTimers();
    const { state, deps, reloader } = setup(2);
    reloader.changed();
    reloader.changed();
    state.onAir = 0;
    vi.advanceTimersByTime(4000);
    expect(deps.reloadPages).toHaveBeenCalledTimes(1);
  });
});

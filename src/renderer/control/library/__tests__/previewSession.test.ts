import { describe, expect, it, vi } from 'vitest';
import { PreviewSession } from '../previewSession';

/** A renderer whose load() finishes only when we say so */
function slowRenderer() {
  let finish!: () => void;
  const done = new Promise<void>((res) => { finish = res; });
  const loaded = new Set<string>();
  const r = {
    loadGraphic: vi.fn(async (id: string) => { loaded.add(id); await done; return { statusCode: 200 }; }),
    playGraphic: vi.fn(async () => ({ statusCode: 200, currentStep: 0 })),
    stopGraphic: vi.fn(async () => ({ statusCode: 200 })),
    updateGraphic: vi.fn(async () => ({ statusCode: 200 })),
    isLoaded: (id: string) => loaded.has(id),
    clearAll: vi.fn(async () => { loaded.clear(); }),
  };
  return { r, finish };
}

const tpl = { manifest: { id: 'x' }, directoryName: 'x' } as any;

describe('preview session', () => {
  it('waits for the first load before Show, and plays once', async () => {
    const { r, finish } = slowRenderer();
    const s = new PreviewSession(r, tpl, () => ({ a: 1 }));
    const opening = s.open();
    const show = s.show();
    await Promise.resolve();
    expect(r.playGraphic).not.toHaveBeenCalled();
    finish();
    await Promise.all([opening, show]);
    expect(r.loadGraphic).toHaveBeenCalledTimes(1);
    expect(r.playGraphic).toHaveBeenCalledTimes(1);
  });
  it('sends fresh data before showing again after Hide', async () => {
    const { r, finish } = slowRenderer();
    let n = 0;
    const s = new PreviewSession(r, tpl, () => ({ n: ++n }));
    const opening = s.open(); finish(); await opening;
    await s.hide();
    await s.show();
    expect(r.updateGraphic).toHaveBeenLastCalledWith('library-preview', { n: 2 });
    expect(r.playGraphic).toHaveBeenLastCalledWith('library-preview', {});
  });
  it('does nothing on Show when the graphic is already showing', async () => {
    const { r, finish } = slowRenderer();
    const s = new PreviewSession(r, tpl, () => ({}));
    const opening = s.open(); finish(); await opening;
    await s.show();
    expect(r.playGraphic).toHaveBeenCalledTimes(1);
  });
  it('clears a graphic that finishes loading after the preview was closed', async () => {
    const { r, finish } = slowRenderer();
    const s = new PreviewSession(r, tpl, () => ({}));
    const opening = s.open();
    s.close();
    finish();
    await opening;
    expect(r.playGraphic).not.toHaveBeenCalled();
    expect(r.clearAll).toHaveBeenCalled();
  });
});

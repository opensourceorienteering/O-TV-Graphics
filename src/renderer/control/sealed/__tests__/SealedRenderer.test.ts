import { describe, expect, it } from 'vitest';
import { SealedRenderer, previewFrameUrl } from '../SealedRenderer';

/** A fake page: the iframe records what the parent posts; tests deliver replies by hand */
function fakeEnv() {
  const listeners: Array<(e: any) => void> = [];
  const posted: any[] = [];
  const frameWindow = { postMessage: (m: any) => posted.push(m) };
  const iframe: any = { style: {}, attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, contentWindow: frameWindow, remove() {}, srcSets: 0 };
  Object.defineProperty(iframe, 'src', { set(v) { iframe._src = v; iframe.srcSets++; }, get() { return iframe._src; } });
  const win: any = { addEventListener: (_t: string, l: any) => listeners.push(l), removeEventListener: () => {} };
  const doc: any = { createElement: () => iframe };
  const host: any = { appendChild: () => {} };
  const deliver = (data: any, source: any = frameWindow) => listeners.forEach((l) => l({ data, source }));
  return { win, doc, host, iframe, posted, deliver, frameWindow };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('sealed renderer', () => {
  it('builds the frame address on 127.0.0.1', () => {
    expect(previewFrameUrl(5657)).toBe('http://127.0.0.1:5657/preview-frame?webPort=5657');
  });
  it('loads through the frame and remembers what is loaded', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    env.deliver({ ready: true });
    const loading = r.loadGraphic('x', { id: 'm' } as any, 'sets/s/a', { a: 1 });
    await tick();
    const req = env.posted.at(-1);
    expect(req).toMatchObject({ op: 'load', id: 'x', directory: 'sets/s/a', data: { a: 1 } });
    env.deliver({ requestId: req.requestId, ok: true, result: { statusCode: 200 } });
    await expect(loading).resolves.toEqual({ statusCode: 200 });
    expect(r.isLoaded('x')).toBe(true);
  });
  it('ignores a reply from any other window', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    env.deliver({ ready: true });
    let settled = false;
    void r.playGraphic('x', {}).then(() => (settled = true), () => (settled = true));
    await tick();
    env.deliver({ requestId: env.posted.at(-1).requestId, ok: true }, { postMessage() {} });
    await tick();
    expect(settled).toBe(false);
  });
  it('rejects with the frame’s error', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    env.deliver({ ready: true });
    const p = r.stopGraphic('x');
    await tick();
    env.deliver({ requestId: env.posted.at(-1).requestId, ok: false, error: 'Graphic not loaded' });
    await expect(p).rejects.toThrow('Graphic not loaded');
  });
  it('reloads the frame before loading a graphic from another folder', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    env.deliver({ ready: true });
    const first = r.loadGraphic('x', {} as any, 'sets/s/a', {});
    await tick();
    env.deliver({ requestId: env.posted.at(-1).requestId, ok: true });
    await first;
    const sets = env.iframe.srcSets;
    const second = r.loadGraphic('x', {} as any, 'sets/s/b', {});
    await tick();
    expect(env.iframe.srcSets).toBe(sets + 1);
    expect(r.isLoaded('x')).toBe(false);
    env.deliver({ ready: true });
    await tick();
    env.deliver({ requestId: env.posted.at(-1).requestId, ok: true });
    await second;
    expect(r.isLoaded('x')).toBe(true);
  });
  it('reloads the frame before its next graphic after the internet allowlist changed', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    env.deliver({ ready: true });
    const first = r.loadGraphic('x', {} as any, 'sets/s/a', {});
    await tick();
    env.deliver({ requestId: env.posted.at(-1).requestId, ok: true });
    await first;
    const sets = env.iframe.srcSets;
    SealedRenderer.rulesChanged();
    const again = r.loadGraphic('x', {} as any, 'sets/s/a', {});
    await tick();
    expect(env.iframe.srcSets).toBe(sets + 1);
    env.deliver({ ready: true });
    await tick();
    env.deliver({ requestId: env.posted.at(-1).requestId, ok: true });
    await again;
  });
});

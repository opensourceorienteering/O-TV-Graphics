import { afterEach, describe, expect, it, vi } from 'vitest';
import { SealedRenderer, previewFrameUrl, sealedOutputUrl } from '../SealedRenderer';

/** A fake page: the iframe records what the parent posts; tests deliver replies by hand */
function fakeEnv() {
  const listeners: Array<(e: any) => void> = [];
  const posted: any[] = [];
  const targets: string[] = [];
  const frameWindow = { postMessage: (m: any, target: string) => { posted.push(m); targets.push(target); } };
  const iframe: any = { style: {}, attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { this.attrs[k] = v; }, contentWindow: frameWindow, remove() {}, srcSets: 0 };
  Object.defineProperty(iframe, 'src', { set(v) { iframe._src = v; iframe.srcSets++; }, get() { return iframe._src; } });
  const win: any = { addEventListener: (_t: string, l: any) => listeners.push(l), removeEventListener: () => {} };
  const doc: any = { createElement: () => iframe };
  const host: any = { appendChild: () => {} };
  const deliver = (data: any, source: any = frameWindow, origin = 'http://127.0.0.1:5657') => {
    // A ready message names the page load it comes from, like the real frame does
    const msg = data?.ready && data.gen === undefined ? { ...data, gen: Number(new URL(iframe._src).searchParams.get('gen')) } : data;
    listeners.forEach((l) => l({ data: msg, source, origin }));
  };
  return { win, doc, host, iframe, posted, targets, deliver, frameWindow };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const genOf = (iframe: any) => Number(new URL(iframe._src).searchParams.get('gen'));
afterEach(() => vi.useRealTimers());

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
  it('sends to the origin the frame ended up on (in development it is redirected)', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    env.deliver({ ready: true }, env.frameWindow, 'http://127.0.0.1:5175');
    void r.playGraphic('x', {}).catch(() => undefined);
    await tick();
    expect(env.targets.at(-1)).toBe('http://127.0.0.1:5175');
  });
  it("moves the program monitor's web output to 127.0.0.1, away from the operator UI's origin", () => {
    expect(sealedOutputUrl('http://localhost:5657/output?wsPort=5656&webPort=5657')).toBe('http://127.0.0.1:5657/output?wsPort=5656&webPort=5657');
    expect(sealedOutputUrl('http://192.168.1.20:5657/output')).toBe('http://192.168.1.20:5657/output');
  });
  it('rejects requests still waiting when the frame reloads', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    env.deliver({ ready: true });
    const first = r.loadGraphic('x', {} as any, 'sets/s/a', {});
    await tick();
    env.deliver({ requestId: env.posted.at(-1).requestId, ok: true });
    await first;
    const waiting = r.updateGraphic('x', {});
    await tick();
    void r.loadGraphic('y', {} as any, 'sets/s/b', {}).catch(() => undefined);
    await expect(waiting).rejects.toThrow('Preview reloaded');
  });
  it('fails a request the frame never answers, instead of waiting for ever', async () => {
    vi.useFakeTimers();
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    env.deliver({ ready: true });
    const p = r.playGraphic('x', {});
    const check = expect(p).rejects.toThrow('The preview did not answer');
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
  });
  it('ignores a late ready message from the page before a reload', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    const oldGen = genOf(env.iframe);
    env.deliver({ ready: true });
    const first = r.loadGraphic('x', {} as any, 'sets/s/a', {});
    await tick();
    env.deliver({ requestId: env.posted.at(-1).requestId, ok: true });
    await first;
    const posted = env.posted.length;
    void r.loadGraphic('x', {} as any, 'sets/s/b', {}).catch(() => undefined);
    env.deliver({ ready: true, gen: oldGen });
    await tick();
    expect(env.posted.length).toBe(posted);
  });
  it('rejects a request when the preview closes before the frame is ready', async () => {
    const env = fakeEnv();
    const r = new SealedRenderer(env.host, previewFrameUrl(5657), { win: env.win, doc: env.doc });
    const p = r.playGraphic('x', {});
    r.dispose();
    env.deliver({ ready: true });
    await expect(p).rejects.toThrow('Preview closed');
  });
});

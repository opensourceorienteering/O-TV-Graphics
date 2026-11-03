import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The runtime is browser JS shared by downloadable looks; these tests exercise its lifecycle
// with a minimal surface, leaving text measurement and HTML patching to browser integration.
let createGraphic: any;
beforeEach(async () => {
  vi.stubGlobal('document', {});
  vi.stubGlobal('HTMLElement', class { shadowRoot = { innerHTML: '' }; attachShadow() {} });
  const modulePath = '../../../templates/sets/_core/graphic.js';
  ({ createGraphic } = await import(modulePath));
});
afterEach(() => vi.unstubAllGlobals());

function graphic(view?: any) {
  const Graphic = createGraphic('relay-overview', { id: 'test', durations: { in: 0, out: 0, step: 0, stepOut: 0 } }, view);
  const instance = new Graphic();
  instance.root = {
    innerHTML: '', firstChild: {}, dataset: { state: 'out' },
    querySelector: () => null, querySelectorAll: () => [],
    classList: { toggle: vi.fn() }, style: { setProperty: vi.fn(), removeProperty: vi.fn() },
  };
  instance.patch = vi.fn((html: string) => { instance.root.innerHTML = html; });
  return instance;
}

describe('custom graphic views', () => {
  it('shares paging, update patching, animation state and ticker cleanup', async () => {
    const view = vi.fn((data: any, ctx: any) => ({ html: `${data.title} / ${ctx.step}`, steps: data.pages }));
    const instance = graphic(view);
    await instance.updateAction({ data: { title: 'Relay', pages: 3 } });
    expect(view).toHaveBeenCalledWith({ title: 'Relay', pages: 3 }, expect.objectContaining({ kind: 'relay-overview', id: 'test', step: 1 }));
    await instance.playAction({ skipAnimation: true });
    expect(instance.root.dataset.state).toBe('on');
    expect(instance.ticker).not.toBeNull();
    await instance.customAction({ id: 'next-page', skipAnimation: true });
    expect(instance.root.innerHTML).toBe('Relay / 2');
    await instance.updateAction({ data: { title: 'Leg 2', pages: 3 } });
    expect(instance.patch).toHaveBeenCalledWith('Leg 2 / 2');
    await instance.updateAction({ data: { title: 'Final', pages: 1 } });
    expect(instance.step).toBe(1);
    expect(instance.root.innerHTML).toBe('Final / 1');
    await instance.stopAction({ skipAnimation: true });
    expect(instance.root.dataset.state).toBe('out');
    expect(instance.ticker).toBeNull();
    await instance.dispose();
    expect(instance.shadowRoot.innerHTML).toBe('');
  });
  it('uses the custom view when checking time-dependent redraws', () => {
    let key = 'first';
    const instance = graphic(() => ({ html: key, key, rekey: true }));
    instance.render();
    key = 'next';
    instance.tick();
    expect(instance.root.innerHTML).toBe('next');
  });
  it('patches focus steps on the same page and animates actual page changes', async () => {
    const instance = graphic((_data: any, ctx: any) => ({ html: `step ${ctx.step}`, steps: 3, pageKey: ctx.step < 3 ? 'page-1' : 'page-2' }));
    instance.render();
    await instance.playAction({ skipAnimation: true });
    const states = vi.spyOn(instance, 'setState');
    await instance.playAction({ delta: 1 });
    expect(instance.patch).toHaveBeenCalledWith('step 2');
    expect(states.mock.calls.map((c: any) => c[0])).toEqual(['on']);
    states.mockClear();
    await instance.playAction({ delta: 1 });
    expect(states.mock.calls.map((c: any) => c[0])).toEqual(['step-out', 'step', 'on']);
    await instance.dispose();
  });
  it('rejects invalid view contracts clearly', () => {
    expect(() => createGraphic('relay', {}, {})).toThrow('must be a function');
    expect(() => graphic(() => 'markup').render()).toThrow('must return { html: string }');
  });
  it('keeps the built-in renderer available to existing two-argument graphics', () => {
    const Graphic = createGraphic('free-text', { id: 'test' });
    const instance = new Graphic();
    instance.root = graphic(() => ({ html: '' })).root;
    instance.data = { text: 'Welcome' };
    instance.render();
    expect(instance.root.innerHTML).toContain('Welcome');
  });
});

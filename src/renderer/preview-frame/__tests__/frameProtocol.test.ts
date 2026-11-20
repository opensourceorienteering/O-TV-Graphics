import { describe, expect, it, vi } from 'vitest';
import { createFrameHandler, handleFrameRequest } from '../frameProtocol';

const renderer = () => ({
  loadGraphic: vi.fn(async () => ({ statusCode: 200 })),
  playGraphic: vi.fn(async () => ({ statusCode: 200, currentStep: 1 })),
  stopGraphic: vi.fn(async () => ({ statusCode: 200 })),
  updateGraphic: vi.fn(async () => ({ statusCode: 200 })),
  clearAll: vi.fn(async () => undefined),
});

describe('preview frame protocol', () => {
  it('turns a failing load into an error reply', async () => {
    const r = renderer();
    r.loadGraphic.mockRejectedValueOnce(new Error('Bad module'));
    expect(await handleFrameRequest(r as any, { requestId: 1, op: 'load', id: 'g', manifest: {} as any, directory: 'd', data: {} }))
      .toEqual({ requestId: 1, ok: false, error: 'Bad module' });
  });
  it('passes each operation to the renderer', async () => {
    const r = renderer();
    await handleFrameRequest(r as any, { requestId: 2, op: 'load', id: 'g', manifest: { id: 'm' } as any, directory: 'sets/s/g', data: { a: 1 } });
    expect(r.loadGraphic).toHaveBeenCalledWith('g', { id: 'm' }, 'sets/s/g', { a: 1 });
    expect(await handleFrameRequest(r as any, { requestId: 3, op: 'play', id: 'g', options: { delta: 1 } })).toEqual({ requestId: 3, ok: true, result: { statusCode: 200, currentStep: 1 } });
    await handleFrameRequest(r as any, { requestId: 4, op: 'clear' });
    expect(r.clearAll).toHaveBeenCalled();
  });
  it('refuses something that is not a request', async () => {
    expect(await handleFrameRequest(renderer() as any, { requestId: 5, op: 'format-disk' } as any)).toMatchObject({ requestId: 5, ok: false });
  });
  it('handles requests one at a time, in order', async () => {
    const order: string[] = [];
    let finishClear!: () => void;
    const r = renderer();
    r.clearAll.mockImplementationOnce(() => new Promise<undefined>((res) => { finishClear = () => { order.push('clear done'); res(undefined); }; }));
    r.loadGraphic.mockImplementationOnce(async () => { order.push('load'); return { statusCode: 200 }; });
    const handle = createFrameHandler(r as any);
    const cleared = handle({ requestId: 1, op: 'clear' });
    const loaded = handle({ requestId: 2, op: 'load', id: 'g', manifest: {} as any, directory: 'd', data: {} });
    await new Promise((res) => setTimeout(res, 0));
    expect(order).toEqual([]);
    finishClear();
    await Promise.all([cleared, loaded]);
    expect(order).toEqual(['clear done', 'load']);
  });
});

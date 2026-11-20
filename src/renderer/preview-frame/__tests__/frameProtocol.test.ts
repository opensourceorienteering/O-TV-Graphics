import { describe, expect, it, vi } from 'vitest';
import { handleFrameRequest } from '../frameProtocol';

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
});

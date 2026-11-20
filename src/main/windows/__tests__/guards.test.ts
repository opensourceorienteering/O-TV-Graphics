import { describe, expect, it, vi } from 'vitest';
import { allowNavigation, graphicsWindowPreferences, guardWindow } from '../guards';

describe('window guards', () => {
  it('gives the graphics window no preload and a sandbox', () => {
    const p = graphicsWindowPreferences();
    expect(p.preload).toBeUndefined();
    expect(p).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true });
  });
  it('keeps a window on its own page', () => {
    expect(allowNavigation('file:///app/dist/index.html#/live', 'file:///app/dist/index.html#/events')).toBe(true);
    expect(allowNavigation('http://localhost:5175/graphics.html?a=1', 'http://localhost:5175/graphics.html?a=2')).toBe(true);
    expect(allowNavigation('file:///app/dist/graphics.html', 'https://evil.example/')).toBe(false);
    expect(allowNavigation('http://localhost:5175/', 'http://localhost:5175/other.html')).toBe(false);
  });
  it('denies every popup and blocks navigation away', () => {
    const handlers: Record<string, any> = {};
    const win: any = { webContents: { setWindowOpenHandler: (h: any) => (handlers.open = h), on: (n: string, h: any) => (handlers[n] = h), getURL: () => 'file:///a/index.html' } };
    guardWindow(win);
    expect(handlers.open({ url: 'https://x.example' })).toEqual({ action: 'deny' });
    const e = { preventDefault: vi.fn() };
    handlers['will-navigate'](e, 'https://x.example');
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

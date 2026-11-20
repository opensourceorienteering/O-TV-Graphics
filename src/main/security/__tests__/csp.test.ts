import { describe, expect, it } from 'vitest';
import { buildAppCsp, buildGraphicsCsp, isGraphicsPage, normalizeAllowedOrigin } from '../csp';

const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(name + ' ')) ?? '';

describe('allowlist entries', () => {
  it.each([
    ['HTTPS://Maps.Example.com/', 'https://maps.example.com'],
    ['https://*.tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
    ['  https://www.livelox.com  ', 'https://www.livelox.com'],
    ['http://maps.example.com', 'https://maps.example.com'],
    ['HTTP://Tiles.Example.com/', 'https://tiles.example.com'],
    ['www.livelox.com', 'https://www.livelox.com'],
  ])('normalises %s', (input, value) => expect(normalizeAllowedOrigin(input)).toEqual({ ok: true, value }));
  it.each(['ftp://x.example', 'https://x.example/path', 'https://x.example:8443', 'https://', 'maps example', 'https://*.', 'https://x.example?a=1', 'wss://x.example'])(
    'refuses %s with a reason', (input) => expect(normalizeAllowedOrigin(input)).toMatchObject({ ok: false, reason: expect.any(String) }));
});

describe('graphics pages', () => {
  it('recognises the pages that run graphics', () => {
    expect(isGraphicsPage('file:///a/dist/graphics.html?webPort=5657')).toBe(true);
    expect(isGraphicsPage('http://127.0.0.1:5657/output/abc')).toBe(true);
    expect(isGraphicsPage('http://127.0.0.1:5657/output')).toBe(true);
    expect(isGraphicsPage('http://127.0.0.1:5657/preview-frame?x=1')).toBe(true);
    expect(isGraphicsPage('http://127.0.0.1:5175/preview-frame.html')).toBe(true);
    expect(isGraphicsPage('http://localhost:5657/preview')).toBe(true);
    expect(isGraphicsPage('http://localhost:5175/')).toBe(false);
    expect(isGraphicsPage('file:///a/dist/index.html')).toBe(false);
    expect(isGraphicsPage('http://localhost:5657/output-settings')).toBe(false);
  });
});

describe('content rules', () => {
  it('adds allowed origins to graphics pages only', () => {
    const g = buildGraphicsCsp({ dev: false, webPort: 5657, wsPort: 5656, wsHost: '192.168.1.20', allowed: ['https://www.livelox.com'] });
    for (const d of ['script-src', 'style-src', 'img-src', 'font-src', 'media-src', 'frame-src', 'connect-src']) expect(directive(g, d)).toContain('https://www.livelox.com');
    expect(directive(g, 'connect-src')).toContain('wss://www.livelox.com');
    expect(directive(g, 'connect-src')).toContain('ws://192.168.1.20:5656');
    expect(directive(g, 'connect-src')).toContain("'self'");
    expect(buildAppCsp({ dev: false, webPort: 5657, wsPort: 5656 })).not.toContain('livelox');
  });
  it('keeps today’s operator UI rules', () => {
    const app = buildAppCsp({ dev: false, webPort: 5657, wsPort: 5656 });
    expect(directive(app, 'script-src')).toBe("script-src 'self' http://localhost:5657 https://cdnjs.cloudflare.com");
    expect(directive(app, 'frame-src')).toContain('http://localhost:5657');
  });
  it('lets the operator UI frame the preview frame on 127.0.0.1', () => {
    expect(directive(buildAppCsp({ dev: false, webPort: 5657, wsPort: 5656 }), 'frame-src')).toContain('http://127.0.0.1:5657');
    expect(directive(buildAppCsp({ dev: true, webPort: 5657, wsPort: 5656 }), 'frame-src')).toContain('http://127.0.0.1:5175');
  });
  it("lets graphics pages on 127.0.0.1 reach the app's socket", () => {
    const g = buildGraphicsCsp({ dev: false, webPort: 5657, wsPort: 5656, wsHost: 'localhost', allowed: [] });
    expect(directive(g, 'connect-src')).toContain('ws://127.0.0.1:5656');
  });
});

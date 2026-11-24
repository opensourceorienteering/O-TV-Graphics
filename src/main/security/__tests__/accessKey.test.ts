import { describe, expect, it } from 'vitest';
import { appOrigins, cleanRemoteAccess, generateAccessKey, isLocalAddress, keyFromHttp, keyMatches, remoteAllowed } from '../accessKey';

const settings = { requireKey: true, key: 'k'.repeat(24) };

describe('remote access key', () => {
  it('treats only this computer as local', () => {
    for (const a of ['127.0.0.1', '127.5.4.3', '::1', '::ffff:127.0.0.1']) expect(isLocalAddress(a)).toBe(true);
    for (const a of ['192.168.1.20', '::ffff:10.0.0.2', 'fe80::1', '', undefined]) expect(isLocalAddress(a)).toBe(false);
  });
  it('reads the key from a bearer token, its own header or the address', () => {
    expect(keyFromHttp({ headers: { authorization: 'Bearer abc' }, query: {} })).toBe('abc');
    expect(keyFromHttp({ headers: { 'x-split-key': 'def' }, query: {} })).toBe('def');
    expect(keyFromHttp({ headers: {}, query: { key: 'ghi' } })).toBe('ghi');
    expect(keyFromHttp({ headers: {}, query: { key: ['a', 'b'] } })).toBe('');
    expect(keyFromHttp({ headers: {}, query: {} })).toBe('');
  });
  it('compares keys exactly', () => {
    expect(keyMatches(settings.key, settings.key)).toBe(true);
    expect(keyMatches('k'.repeat(23), settings.key)).toBe(false);
    expect(keyMatches('', settings.key)).toBe(false);
    expect(keyMatches('x', '')).toBe(false);
  });
  const here = { own: ['192.168.1.10'], origins: appOrigins({ webPort: 5657, dev: false, own: ['192.168.1.10'] }) };
  const local = { address: '127.0.0.1', host: '127.0.0.1:5657', key: '' };
  it('lets this computer in, and others only with the key while it is required', () => {
    expect(remoteAllowed(local, settings, here)).toBe(true);
    expect(remoteAllowed({ address: '192.168.1.20', host: '192.168.1.10:5657', key: '' }, settings, here)).toBe(false);
    expect(remoteAllowed({ address: '192.168.1.20', host: '192.168.1.10:5657', key: 'wrong' }, settings, here)).toBe(false);
    expect(remoteAllowed({ address: '192.168.1.20', host: '192.168.1.10:5657', key: settings.key }, settings, here)).toBe(true);
    expect(remoteAllowed({ address: '192.168.1.20', host: 'x', key: '' }, { ...settings, requireKey: false }, here)).toBe(true);
  });
  it("counts this computer's own network address as this computer (OBS pointed at the LAN address)", () => {
    expect(remoteAllowed({ address: '192.168.1.10', host: '192.168.1.10:5657', key: '' }, settings, here)).toBe(true);
    expect(remoteAllowed({ ...local, origin: 'http://192.168.1.10:5657' }, settings, here)).toBe(true);
  });
  it("accepts the app's own pages: no Origin, file:// and its own addresses", () => {
    for (const origin of [undefined, 'file://', 'http://localhost:5657', 'http://127.0.0.1:5657', 'http://[::1]:5657'])
      expect(remoteAllowed({ ...local, origin }, settings, here)).toBe(true);
  });
  it('treats a website open in a browser on this computer as another computer', () => {
    for (const origin of ['https://evil.example', 'null', 'http://localhost:9999', 'http://127.0.0.1:5175'])
      expect(remoteAllowed({ ...local, origin }, settings, here)).toBe(false);
    expect(remoteAllowed({ ...local, origin: 'https://evil.example', key: settings.key }, settings, here)).toBe(true);
  });
  it('refuses a request addressed to another name that points here (DNS rebinding)', () => {
    expect(remoteAllowed({ ...local, host: 'evil.example:5657' }, settings, here)).toBe(false);
    expect(remoteAllowed({ ...local, host: 'localhost:5657' }, settings, here)).toBe(true);
    expect(remoteAllowed({ ...local, host: '[::1]:5656' }, settings, here)).toBe(true);
    expect(remoteAllowed({ ...local, host: undefined }, settings, here)).toBe(false);
  });
  it('accepts the development server in development only', () => {
    const dev = { ...here, origins: appOrigins({ webPort: 5657, dev: true, own: [] }) };
    expect(remoteAllowed({ ...local, origin: 'http://localhost:5175' }, settings, dev)).toBe(true);
  });
  it('makes long random keys', () => {
    const a = generateAccessKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(generateAccessKey()).not.toBe(a);
  });
  it('cleans stored settings: required by default, a key always present', () => {
    expect(cleanRemoteAccess(undefined)).toMatchObject({ value: { requireKey: true }, created: true });
    expect(cleanRemoteAccess(undefined).value.key).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(cleanRemoteAccess({ requireKey: false, key: settings.key })).toEqual({ value: { requireKey: false, key: settings.key }, created: false });
    expect(cleanRemoteAccess({ requireKey: 'no', key: 'short' }).created).toBe(true);
  });
});

import { linkWithKey } from '../accessKey';
describe('links for other computers', () => {
  it('carry the key while it is required', () => {
    expect(linkWithKey('http://10.0.0.5:5657/output', settings)).toBe(`http://10.0.0.5:5657/output?key=${settings.key}`);
    expect(linkWithKey('http://10.0.0.5:5657/director?source=lr&comp=1', settings)).toBe(`http://10.0.0.5:5657/director?source=lr&comp=1&key=${settings.key}`);
    expect(linkWithKey('http://10.0.0.5:5657/output', { ...settings, requireKey: false })).toBe('http://10.0.0.5:5657/output');
  });
});

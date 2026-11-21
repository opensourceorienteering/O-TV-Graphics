import { describe, expect, it } from 'vitest';
import { cleanRemoteAccess, generateAccessKey, isLocalAddress, keyFromHttp, keyMatches, remoteAllowed } from '../accessKey';

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
  it('lets this computer in, and others only with the key while it is required', () => {
    expect(remoteAllowed({ address: '127.0.0.1', key: '' }, settings)).toBe(true);
    expect(remoteAllowed({ address: '192.168.1.20', key: '' }, settings)).toBe(false);
    expect(remoteAllowed({ address: '192.168.1.20', key: 'wrong' }, settings)).toBe(false);
    expect(remoteAllowed({ address: '192.168.1.20', key: settings.key }, settings)).toBe(true);
    expect(remoteAllowed({ address: '192.168.1.20', key: '' }, { ...settings, requireKey: false })).toBe(true);
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

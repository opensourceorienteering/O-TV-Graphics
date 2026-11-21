import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
vi.mock('../logger', () => { const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }; return { getLogger: () => l, logger: l }; });
import { loadConfig } from '../config';

describe('remote access key in config.json', () => {
  it('makes a key on first start of this version, requires it, and keeps it across starts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({ general: { dataroot: path.join(dir, 'data'), logfolder: path.join(dir, 'logs') } }));
    const first = await loadConfig(file);
    expect(first.remoteAccess).toMatchObject({ requireKey: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).remoteAccess.key).toBe(first.remoteAccess!.key);
    const second = await loadConfig(file);
    expect(second.remoteAccess).toEqual(first.remoteAccess);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it('keeps the operator turning it off', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const file = path.join(dir, 'config.json');
    const key = 'a'.repeat(24);
    fs.writeFileSync(file, JSON.stringify({ general: { dataroot: path.join(dir, 'data'), logfolder: path.join(dir, 'logs') }, remoteAccess: { requireKey: false, key } }));
    expect((await loadConfig(file)).remoteAccess).toEqual({ requireKey: false, key });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

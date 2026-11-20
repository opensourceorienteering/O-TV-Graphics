import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
vi.mock('../logger', () => { const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }; return { getLogger: () => l, logger: l }; });
import { loadConfig } from '../config';

describe('internet allowlist from config.json', () => {
  it('keeps only valid entries, normalised, so a hand edit cannot inject content rules', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify({
      general: { dataroot: path.join(dir, 'data'), logfolder: path.join(dir, 'logs') },
      graphicsAllowedOrigins: ['https://ok.example', "x; script-src *", 'http://Up.Example', 42, 'https://ok.example'],
    }));
    const cfg = await loadConfig(file);
    expect(cfg.graphicsAllowedOrigins).toEqual(['https://ok.example', 'https://up.example']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

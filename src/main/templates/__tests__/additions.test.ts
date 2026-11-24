/** Graphics added to a look (built-in looks especially) live beside it and survive app updates */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../utils/logger', () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: l, getLogger: () => l };
});
import { OGrafManager } from '../OGrafManager';

const REPO_TEMPLATES = path.resolve(__dirname, '../../../../templates');
let tmp: string;

/** A graphic folder copied from the system test pattern under a new id */
export function writeGraphic(dir: string, id: string, extra: Record<string, unknown> = {}) {
  const pattern = path.join(REPO_TEMPLATES, 'system', 'output-test-pattern');
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(pattern)) if (!f.endsWith('.ograf.json')) fs.copyFileSync(path.join(pattern, f), path.join(dir, f));
  const manifest = JSON.parse(fs.readFileSync(path.join(pattern, 'output-test-pattern.ograf.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, `${path.basename(dir)}.ograf.json`), JSON.stringify({ ...manifest, id, name: id, ...extra }));
}

async function manager() {
  const m = new OGrafManager(path.join(tmp, 'app'), path.join(tmp, 'user'));
  await m.initialize();
  await m.discoverTemplates();
  return m;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'additions-'));
  for (const part of ['system', 'sets/_core', 'sets/standard', 'sets/package.json'])
    fs.cpSync(path.join(REPO_TEMPLATES, part), path.join(tmp, 'app', part), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'user'), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('additions to a look', () => {
  it('loads a graphic added to a built-in look as part of that look', async () => {
    writeGraphic(path.join(tmp, 'user', 'additions', 'standard', 'guest-strap'), 'guest-strap');
    const m = await manager();
    expect(m.getTemplateById('guest-strap')).toMatchObject({ setId: 'standard', addition: true, directoryName: 'additions/standard/guest-strap' });
    // 23 bundled graphics (with the GPS tower, pace and progress) + the addition
    expect(m.getTemplateSets().find((s) => s.id === 'standard')).toMatchObject({ additions: 1, templateCount: 24 });
  });
  it('lists an addition for a look this computer does not have as not in a look', async () => {
    writeGraphic(path.join(tmp, 'user', 'additions', 'nowhere', 'x'), 'x-1');
    const m = await manager();
    expect(m.getTemplateById('x-1')).toMatchObject({ setId: 'custom', addition: true });
  });
  it('never takes the additions folder itself for a graphic', async () => {
    writeGraphic(path.join(tmp, 'user', 'additions', 'standard', 'guest-strap'), 'guest-strap');
    const m = await manager();
    expect(m.getAllTemplates().filter((t) => t.setId === 'custom')).toEqual([]);
  });
  it('reads which graphics replace which, for built-in and imported looks', async () => {
    fs.mkdirSync(path.join(tmp, 'user', 'additions', 'standard'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'user', 'additions', 'standard', 'overrides.json'), JSON.stringify({ replaces: { 'guest-strap': 'standard-free-text' } }));
    const m = await manager();
    expect(m.getReplacements('standard')).toEqual({ 'guest-strap': 'standard-free-text' });
    expect(m.getReplacements('bold')).toEqual({});
  });
  it('gives a look graphic a Live entry from the desk patch beside the look, taking only desk settings', async () => {
    fs.mkdirSync(path.join(tmp, 'user', 'additions', 'standard'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'user', 'additions', 'standard', 'desk.json'), JSON.stringify({
      'standard-name-strap': {
        v_olgrafik_desk: { label: 'Name strap', fields: ['name', 'title', 'club'] },
        v_olgrafik_zone: 'lower',
        main: 'evil.js',
        id: 'other',
      },
    }));
    const m = await manager();
    const strap = m.getTemplateById('standard-name-strap')!;
    expect(strap.desk).toMatchObject({ key: 'name-strap', label: 'Name strap', fields: ['name', 'title', 'club'] });
    expect(strap.zone).toBe('lower');
    expect(strap.manifest.main).not.toBe('evil.js');
    expect(strap.manifest.id).toBe('standard-name-strap');
  });
  it('a look graphic without a patch has no Live entry', async () => {
    const m = await manager();
    expect(m.getTemplateById('standard-name-strap')!.desk).toBeUndefined();
  });
  it('marks a graphic that replaces another, so Live and the library know it works', async () => {
    writeGraphic(path.join(tmp, 'user', 'additions', 'standard', 'guest-strap'), 'guest-strap');
    fs.writeFileSync(path.join(tmp, 'user', 'additions', 'standard', 'overrides.json'), JSON.stringify({ replaces: { 'guest-strap': 'standard-free-text' } }));
    const m = await manager();
    expect(m.getTemplateById('guest-strap')!.replaces).toBe('standard-free-text');
  });
  it('flags a graphic that cannot render in real time (Split Control plays graphics live)', async () => {
    writeGraphic(path.join(tmp, 'user', 'offline-only'), 'offline-only', { supportsRealTime: false, supportsNonRealTime: true });
    const m = await manager();
    expect(m.getTemplateById('offline-only')!.deskWarnings).toEqual([expect.stringMatching(/real-time/)]);
  });
});

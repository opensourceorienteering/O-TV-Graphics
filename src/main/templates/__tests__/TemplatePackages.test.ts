/**
 * Looks as zip files: export, import into the writable templates folder, replace and remove.
 * The "app" here is set up like the installed app: only the Standard look is built in.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { strToU8, unzipSync, zipSync } from 'fflate';

vi.mock('../../utils/logger', () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: l, getLogger: () => l };
});

import { OGrafManager } from '../OGrafManager';
import {
  exportLookZip,
  lookFileName,
  wholeLookZip,
  importTemplateZip,
  previewTemplateZip,
  readTemplateZip,
  removeAddition,
  removeImportedLook,
} from '../TemplatePackages';

import { writeGraphic } from './additions.test';
import { deskEntriesForLook } from '../../../shared/deskDeclaration';

const REPO_TEMPLATES = path.resolve(__dirname, '../../../../templates');

let tmp: string;
let manager: OGrafManager;
/** The repository's templates, with every look: where the zips come from */
let full: OGrafManager;

/** Built-in templates as the installed app has them: Standard, the shared code, the test pattern */
function installedAppTemplates(dir: string) {
  for (const part of ['system', 'sets/_core', 'sets/standard', 'sets/package.json'])
    fs.cpSync(path.join(REPO_TEMPLATES, part), path.join(dir, part), { recursive: true });
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'looks-'));
  installedAppTemplates(path.join(tmp, 'app'));
  manager = new OGrafManager(path.join(tmp, 'app'), path.join(tmp, 'user'));
  await manager.initialize();
  await manager.discoverTemplates();
  full = new OGrafManager(REPO_TEMPLATES);
  await full.initialize();
  await full.discoverTemplates();
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const setIds = () => manager.getTemplateSets().map((s) => s.id).sort();

describe('looks as zip files', () => {
  it('starts with only the built-in Standard look', () => {
    expect(setIds()).toEqual(['standard']);
    expect(manager.getTemplateSets()[0]).toMatchObject({ source: 'built-in', templateCount: 20 });
  });

  it('exports a look as <set>/... with every file of the set', () => {
    const files = Object.keys(unzipSync(wholeLookZip(full, 'iof')));
    expect(files).toContain('iof/set.json');
    expect(files).toContain('iof/theme.css');
    expect(files).toContain('iof/iof-results/iof-results.ograf.json');
    expect(files.every((f) => f.startsWith('iof/'))).toBe(true);
    expect(files.some((f) => f.includes('_core'))).toBe(false);
  });

  it('imports a look into the templates folder and serves it next to the built-in ones', async () => {
    const zip = wholeLookZip(full, 'iof');
    expect(previewTemplateZip(manager, zip)).toEqual({
      internet: [],
      internetRefused: [],
      looks: [{ id: 'iof', name: 'IOF', graphics: 17, replaces: undefined }],
      graphics: [],
      additions: [],
    });
    await importTemplateZip(manager, zip);
    expect(setIds()).toEqual(['iof', 'standard']);
    expect(manager.getTemplateSets().find((s) => s.id === 'iof')).toMatchObject({ source: 'imported', templateCount: 17 });
    // Same URL layout as a built-in look, so its graphics find sets/_core/ in the app
    const results = manager.getAllTemplates().find((t) => t.manifest.id === 'iof-results')!;
    expect(results.directoryName).toBe('sets/iof/iof-results');
    expect(fs.existsSync(path.join(tmp, 'user', 'sets', 'iof', 'iof-results', 'graphic.js'))).toBe(true);
  });

  it('accepts a zip with the look files at the top level', async () => {
    const files = unzipSync(wholeLookZip(full, 'signal'));
    const flat = Object.fromEntries(Object.entries(files).map(([name, data]) => [name.replace(/^signal\//, ''), data]));
    await importTemplateZip(manager, zipSync(flat));
    expect(setIds()).toEqual(['signal', 'standard']);
  });

  it('replaces the built-in look with an imported copy, and brings it back on remove', async () => {
    const files = unzipSync(wholeLookZip(full, 'standard'));
    const meta = JSON.parse(Buffer.from(files['standard/set.json']).toString());
    files['standard/set.json'] = strToU8(JSON.stringify({ ...meta, name: 'Standard (club colours)' }));
    const zip = zipSync(files);
    expect(previewTemplateZip(manager, zip).looks[0].replaces).toBe('built-in');

    await importTemplateZip(manager, zip);
    expect(manager.getTemplateSets()).toEqual([
      expect.objectContaining({ id: 'standard', name: 'Standard (club colours)', source: 'imported', replacesBuiltIn: true, templateCount: 20 }),
    ]);
    expect(manager.getTemplateById('standard-results')!.manifestPath.startsWith(path.join(tmp, 'user'))).toBe(true);

    await removeImportedLook(manager, 'standard');
    expect(manager.getTemplateSets()).toEqual([
      expect.objectContaining({ id: 'standard', name: 'Standard', source: 'built-in' }),
    ]);
  });

  it('replaces an earlier import of the same look', async () => {
    await importTemplateZip(manager, wholeLookZip(full, 'cz'));
    const zip = wholeLookZip(full, 'cz');
    expect(previewTemplateZip(manager, zip).looks[0].replaces).toBe('imported');
    await importTemplateZip(manager, zip);
    expect(setIds()).toEqual(['cz', 'standard']);
    expect(fs.readdirSync(path.join(tmp, 'user', 'sets'))).toEqual(['cz']); // no leftovers
  });

  it('refuses a look whose graphic ids are taken by another look', async () => {
    const files = unzipSync(wholeLookZip(full, 'standard'));
    const renamed = Object.fromEntries(Object.entries(files).map(([n, d]) => [n.replace(/^standard\//, 'copy/'), d]));
    renamed['copy/set.json'] = strToU8(JSON.stringify({ id: 'copy', name: 'Copy' }));
    expect(() => previewTemplateZip(manager, zipSync(renamed))).toThrow(/"standard-.*" is already used by the "standard" look/);
    expect(fs.readdirSync(path.join(tmp, 'user', 'sets'))).toEqual([]);
  });

  it('imports a single OGraf graphic outside any look', async () => {
    const pattern = path.join(REPO_TEMPLATES, 'system', 'output-test-pattern');
    const files: Record<string, Uint8Array> = {};
    for (const f of fs.readdirSync(pattern))
      files[`my-plate/${f.replace('output-test-pattern', 'my-plate')}`] = fs.readFileSync(path.join(pattern, f));
    const manifest = JSON.parse(Buffer.from(files['my-plate/my-plate.ograf.json']).toString());
    files['my-plate/my-plate.ograf.json'] = strToU8(JSON.stringify({ ...manifest, id: 'my-plate', name: 'My plate' }));
    await importTemplateZip(manager, zipSync(files));
    const plate = manager.getTemplateById('my-plate')!;
    expect(plate).toMatchObject({ setId: 'custom', directoryName: 'my-plate' });
  });

  it('finds a graphic whose manifest is not named after its folder', async () => {
    const pattern = path.join(REPO_TEMPLATES, 'system', 'output-test-pattern');
    const manifest = JSON.parse(fs.readFileSync(path.join(pattern, 'output-test-pattern.ograf.json'), 'utf8'));
    const files: Record<string, Uint8Array> = { 'mylook/set.json': strToU8(JSON.stringify({ id: 'mylook', name: 'My look' })) };
    for (const f of fs.readdirSync(pattern)) if (!f.endsWith('.ograf.json')) files[`mylook/strap/${f}`] = fs.readFileSync(path.join(pattern, f));
    files['mylook/strap/project-1-rt.ograf.json'] = strToU8(JSON.stringify({ ...manifest, id: 'project-1-rt', name: 'Strap', v_olgrafik_set: 'mylook' }));
    await importTemplateZip(manager, zipSync(files));
    expect(manager.getAllTemplates().some((t) => t.directoryName === 'sets/mylook/strap')).toBe(true);
  });

  it('refuses a look whose graphic folder has two manifests, neither named after the folder', () => {
    const pattern = path.join(REPO_TEMPLATES, 'system', 'output-test-pattern');
    const manifest = JSON.parse(fs.readFileSync(path.join(pattern, 'output-test-pattern.ograf.json'), 'utf8'));
    const files: Record<string, Uint8Array> = { 'mylook/set.json': strToU8(JSON.stringify({ id: 'mylook', name: 'My look' })) };
    for (const f of fs.readdirSync(pattern)) if (!f.endsWith('.ograf.json')) {
      files[`mylook/ok/${f}`] = fs.readFileSync(path.join(pattern, f));
      files[`mylook/twice/${f}`] = fs.readFileSync(path.join(pattern, f));
    }
    files['mylook/ok/ok.ograf.json'] = strToU8(JSON.stringify({ ...manifest, id: 'ok-1', name: 'Ok' }));
    files['mylook/twice/a.ograf.json'] = strToU8(JSON.stringify({ ...manifest, id: 'twice-a', name: 'A' }));
    files['mylook/twice/b.ograf.json'] = strToU8(JSON.stringify({ ...manifest, id: 'twice-b', name: 'B' }));
    expect(() => previewTemplateZip(manager, zipSync(files))).toThrow(/"twice" in the look "mylook" has several manifests \(a\.ograf\.json, b\.ograf\.json\)/);
  });

  it('lists the internet addresses a look asks for that are not allowed yet', () => {
    const pattern = path.join(REPO_TEMPLATES, 'system', 'output-test-pattern');
    const manifest = JSON.parse(fs.readFileSync(path.join(pattern, 'output-test-pattern.ograf.json'), 'utf8'));
    const files: Record<string, Uint8Array> = { 'mylook/set.json': strToU8(JSON.stringify({ id: 'mylook', name: 'My look' })) };
    for (const f of fs.readdirSync(pattern)) if (!f.endsWith('.ograf.json')) files[`mylook/gps/${f}`] = fs.readFileSync(path.join(pattern, f));
    files['mylook/gps/gps.ograf.json'] = strToU8(JSON.stringify({ ...manifest, id: 'gps-1', name: 'GPS', v_olgrafik_internet: ['https://Maps.Example.com', 'http://bad', 'https://tiles.example'] }));
    const zip = zipSync(files);
    expect(previewTemplateZip(manager, zip, ['https://tiles.example']).internet).toEqual(['https://maps.example.com']);
    expect(previewTemplateZip(manager, zip, ['https://tiles.example']).internetRefused).toEqual([{ input: 'http://bad', reason: expect.any(String) }]);
    expect(previewTemplateZip(manager, zip, ['https://tiles.example', 'https://maps.example.com']).internet).toEqual([]);
  });

  it('rejects unsafe paths, damaged files and zips without graphics', () => {
    expect(() => readTemplateZip(zipSync({ '../evil/set.json': strToU8('{}') }))).toThrow(/unsafe path/);
    expect(() => readTemplateZip(strToU8('not a zip'))).toThrow(/not a zip/);
    expect(() => readTemplateZip(zipSync({ 'readme.txt': strToU8('hi') }))).toThrow(/no look/);
    expect(() => readTemplateZip(zipSync({ 'x/set.json': strToU8('{"id":"_core"}'), 'x/a/a.ograf.json': strToU8('{"id":"a"}') })))
      .toThrow(/can't be used as a look id/);
    expect(() => readTemplateZip(zipSync({ 'x/set.json': strToU8('{"id":"x"}') }))).toThrow(/has no graphics/);
  });

  it('only removes imported looks', async () => {
    await expect(removeImportedLook(manager, 'standard')).rejects.toThrow(/not an imported look/);
  });
});

describe('additions travel as .splitlook files', () => {
  const additionsDir = () => path.join(tmp, 'user', 'additions', 'standard');
  async function addGuestStrap() {
    writeGraphic(path.join(additionsDir(), 'guest-strap'), 'guest-strap', { v_olgrafik_kind: 'free-text' });
    fs.writeFileSync(path.join(additionsDir(), 'overrides.json'), JSON.stringify({ replaces: { 'guest-strap': 'standard-free-text' } }));
    manager.clearCache();
    await manager.discoverTemplates();
  }
  async function freshManager() {
    fs.rmSync(path.join(tmp, 'user'), { recursive: true, force: true });
    const m = new OGrafManager(path.join(tmp, 'app'), path.join(tmp, 'user'));
    await m.initialize();
    await m.discoverTemplates();
    return m;
  }

  it('exports only the additions of a built-in look, and imports them back into additions/', async () => {
    await addGuestStrap();
    const zip = exportLookZip(manager, 'standard');
    const names = Object.keys(unzipSync(zip)).sort();
    expect(names).toContain('standard/set.json');
    expect(names).toContain('standard/overrides.json');
    expect(names.some((n) => n.startsWith('standard/guest-strap/'))).toBe(true);
    expect(names.some((n) => n.startsWith('standard/standard-results/'))).toBe(false);
    expect(JSON.parse(Buffer.from(unzipSync(zip)['standard/set.json']).toString())).toMatchObject({ id: 'standard', extends: 'standard' });

    const fresh = await freshManager();
    expect(previewTemplateZip(fresh, zip)).toMatchObject({ looks: [], graphics: [], additions: [{ lookId: 'standard', lookName: 'Standard', graphics: 1 }] });
    await importTemplateZip(fresh, zip);
    expect(fresh.getAllTemplates().find((t) => t.manifest.id === 'guest-strap')).toMatchObject({ setId: 'standard', addition: true });
    expect(fresh.getReplacements('standard')).toEqual({ 'guest-strap': 'standard-free-text' });
    expect(fs.existsSync(path.join(tmp, 'user', 'sets', 'standard'))).toBe(false);
    expect(fresh.getTemplateSets().find((s) => s.id === 'standard')).toMatchObject({ source: 'built-in', additions: 1 });
  });

  it('importing the same file twice leaves one copy of each addition', async () => {
    await addGuestStrap();
    const zip = exportLookZip(manager, 'standard');
    await importTemplateZip(manager, zip);
    await importTemplateZip(manager, zip);
    expect(manager.getAllTemplates().filter((t) => t.manifest.id === 'guest-strap')).toHaveLength(1);
    expect(fs.readdirSync(additionsDir()).sort()).toEqual(['guest-strap', 'overrides.json']);
  });

  it('keeps other overrides of the look when merging', async () => {
    await addGuestStrap();
    const zip = exportLookZip(manager, 'standard');
    fs.writeFileSync(path.join(additionsDir(), 'overrides.json'), JSON.stringify({ replaces: { other: 'standard-clock' } }));
    await importTemplateZip(manager, zip);
    expect(manager.getReplacements('standard')).toEqual({ other: 'standard-clock', 'guest-strap': 'standard-free-text' });
  });

  it('installs additions for a look this computer does not have, under Needs attention', async () => {
    const zip = zipSync({
      'gps-pack/set.json': strToU8(JSON.stringify({ id: 'gps-pack', name: 'GPS pack', extends: 'gps-pack' })),
      'gps-pack/tracker/tracker.ograf.json': strToU8(JSON.stringify({ id: 'tracker', name: 'Tracker', main: 'graphic.js' })),
      'gps-pack/tracker/graphic.js': strToU8('export default class {}'),
    });
    expect(previewTemplateZip(manager, zip).additions).toEqual([{ lookId: 'gps-pack', lookName: null, graphics: 1 }]);
    await importTemplateZip(manager, zip);
    expect(fs.existsSync(path.join(tmp, 'user', 'additions', 'gps-pack', 'tracker', 'tracker.ograf.json'))).toBe(true);
  });

  it('only takes replacements for graphics the file brings', async () => {
    const zip = zipSync({
      'standard/set.json': strToU8(JSON.stringify({ id: 'standard', extends: 'standard' })),
      'standard/overrides.json': strToU8(JSON.stringify({ replaces: { 'standard-clock': 'standard-results', x: 'standard-free-text' } })),
      'standard/x/x.ograf.json': strToU8(JSON.stringify({ id: 'x', name: 'X', main: 'graphic.js' })),
    });
    await importTemplateZip(manager, zip);
    expect(manager.getReplacements('standard')).toEqual({ x: 'standard-free-text' });
  });

  it('names the file after the look, safely on every system', () => {
    expect(lookFileName('IOF / Sprint: "final"')).toBe('IOF - Sprint - final');
    expect(lookFileName('...')).toBe('look');
  });

  it('removing an addition brings back the graphic it replaced', async () => {
    await addGuestStrap();
    const deskFor = () => deskEntriesForLook(manager.getAllTemplates().filter((t) => t.setId === 'standard'), manager.getReplacements('standard'));
    expect(deskFor().get('free-text')?.template.manifest.id).toBe('guest-strap');
    await removeAddition(manager, 'standard', 'guest-strap');
    expect(fs.existsSync(path.join(additionsDir(), 'guest-strap'))).toBe(false);
    expect(manager.getReplacements('standard')).toEqual({});
    expect(deskFor().get('free-text')?.template.manifest.id).toBe('standard-free-text');
  });

  it('only removes additions', async () => {
    await expect(removeAddition(manager, 'standard', 'standard-free-text')).rejects.toThrow('not a graphic added to this look');
    await expect(removeAddition(manager, '../sets', 'x')).rejects.toThrow();
  });

  it('refuses to export a built-in look with no additions', () => {
    expect(() => exportLookZip(manager, 'standard')).toThrow('This look has no additions to export');
  });
});

describe('packaging', () => {
  it('ships only the Standard look with the app', () => {
    const builder = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../electron-builder.json'), 'utf-8'));
    const templates = builder.files.filter((f: string) => f.startsWith('templates'));
    expect(templates).toContain('templates/sets/standard/**/*');
    expect(templates).toContain('templates/sets/_core/**/*');
    expect(templates).toContain('templates/system/**/*');
    expect(templates).not.toContain('templates');
    expect(templates.some((f: string) => /iof|classic|cz|bold|brutal|signal/.test(f))).toBe(false);
  });
});

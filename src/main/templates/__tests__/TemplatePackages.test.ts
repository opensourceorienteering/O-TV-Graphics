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
  importTemplateZip,
  previewTemplateZip,
  readTemplateZip,
  removeImportedLook,
} from '../TemplatePackages';

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
    expect(manager.getTemplateSets()[0]).toMatchObject({ source: 'built-in', templateCount: 19 });
  });

  it('exports a look as <set>/... with every file of the set', () => {
    const files = Object.keys(unzipSync(exportLookZip(full, 'iof')));
    expect(files).toContain('iof/set.json');
    expect(files).toContain('iof/theme.css');
    expect(files).toContain('iof/iof-results/iof-results.ograf.json');
    expect(files.every((f) => f.startsWith('iof/'))).toBe(true);
    expect(files.some((f) => f.includes('_core'))).toBe(false);
  });

  it('imports a look into the templates folder and serves it next to the built-in ones', async () => {
    const zip = exportLookZip(full, 'iof');
    expect(previewTemplateZip(manager, zip)).toEqual({
      looks: [{ id: 'iof', name: 'IOF', graphics: 17, replaces: undefined }],
      graphics: [],
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
    const files = unzipSync(exportLookZip(full, 'signal'));
    const flat = Object.fromEntries(Object.entries(files).map(([name, data]) => [name.replace(/^signal\//, ''), data]));
    await importTemplateZip(manager, zipSync(flat));
    expect(setIds()).toEqual(['signal', 'standard']);
  });

  it('replaces the built-in look with an imported copy, and brings it back on remove', async () => {
    const files = unzipSync(exportLookZip(full, 'standard'));
    const meta = JSON.parse(Buffer.from(files['standard/set.json']).toString());
    files['standard/set.json'] = strToU8(JSON.stringify({ ...meta, name: 'Standard (club colours)' }));
    const zip = zipSync(files);
    expect(previewTemplateZip(manager, zip).looks[0].replaces).toBe('built-in');

    await importTemplateZip(manager, zip);
    expect(manager.getTemplateSets()).toEqual([
      expect.objectContaining({ id: 'standard', name: 'Standard (club colours)', source: 'imported', replacesBuiltIn: true, templateCount: 19 }),
    ]);
    expect(manager.getTemplateById('standard-results')!.manifestPath.startsWith(path.join(tmp, 'user'))).toBe(true);

    await removeImportedLook(manager, 'standard');
    expect(manager.getTemplateSets()).toEqual([
      expect.objectContaining({ id: 'standard', name: 'Standard', source: 'built-in' }),
    ]);
  });

  it('replaces an earlier import of the same look', async () => {
    await importTemplateZip(manager, exportLookZip(full, 'cz'));
    const zip = exportLookZip(full, 'cz');
    expect(previewTemplateZip(manager, zip).looks[0].replaces).toBe('imported');
    await importTemplateZip(manager, zip);
    expect(setIds()).toEqual(['cz', 'standard']);
    expect(fs.readdirSync(path.join(tmp, 'user', 'sets'))).toEqual(['cz']); // no leftovers
  });

  it('refuses a look whose graphic ids are taken by another look', async () => {
    const files = unzipSync(exportLookZip(full, 'standard'));
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

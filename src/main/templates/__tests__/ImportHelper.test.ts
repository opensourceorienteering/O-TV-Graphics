/** Finishing the import helper: where a graphic goes and what is written for it */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../../utils/logger', () => {
  const l = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { logger: l, getLogger: () => l };
});
import { OGrafManager } from '../OGrafManager';
import { finishGraphic } from '../ImportHelper';
import { deskEntriesForLook } from '../../../shared/deskDeclaration';
import { writeGraphic } from './additions.test';

const REPO_TEMPLATES = path.resolve(__dirname, '../../../../templates');
let tmp: string;
let manager: OGrafManager;
const user = (...p: string[]) => path.join(tmp, 'user', ...p);

async function rediscover() {
  manager.clearCache();
  await manager.discoverTemplates();
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-'));
  for (const part of ['system', 'sets/_core', 'sets/standard', 'sets/package.json'])
    fs.cpSync(path.join(REPO_TEMPLATES, part), path.join(tmp, 'app', part), { recursive: true });
  // A loose graphic from OGraf Studio, with its own field names
  writeGraphic(user('studio-strap'), 'studio-strap', {
    schema: { type: 'object', properties: { headline: { type: 'string' }, contestants: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } } } },
  });
  manager = new OGrafManager(path.join(tmp, 'app'), user());
  await manager.initialize();
  await manager.discoverTemplates();
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const desk = { label: 'Guest strap', short: 'Guest', inputs: ['class', 'runner', 'control'], required: ['class', 'runner'], feeds: ['timing'], fields: [] };
const fieldMap = { headline: 'runnerName', contestants: { from: 'results', items: { name: 'name' } } };

describe('finishing a loose graphic', () => {
  it('moves it into a built-in look as an addition, with its Live entry, field map and timing data', async () => {
    const done = await finishGraphic(manager, {
      graphicId: 'studio-strap', target: { lookId: 'standard' }, kind: 'standard-guest-strap', zone: 'lower', desk, fieldMap,
    });
    expect(done).toEqual({ id: 'studio-strap', setId: 'standard' });
    expect(manager.getTemplateById('studio-strap')!.manifest.name).toBe('Guest strap');
    expect(fs.existsSync(user('studio-strap'))).toBe(false);
    const t = manager.getTemplateById('studio-strap')!;
    expect(t).toMatchObject({ setId: 'standard', addition: true, zone: 'lower', directoryName: 'additions/standard/studio-strap' });
    expect(t.desk).toMatchObject({ key: 'standard-guest-strap', label: 'Guest strap', params: ['class', 'runner', 'control'], live: true });
    expect(t.deskWarnings).toEqual([]);
    expect((t.manifest as any).v_olgrafik_fieldMap).toEqual(fieldMap);
    expect(t.dataSourceConfig?.api?.uiControls?.map((c: any) => c.type)).toEqual(['class-selector', 'control-point-selector', 'runner-search']);
  });

  it('can take over another graphic of the look', async () => {
    await finishGraphic(manager, {
      graphicId: 'studio-strap', target: { lookId: 'standard' }, kind: 'standard-guest-strap', zone: 'lower',
      desk: { ...desk, inputs: [], required: [], feeds: [], fields: ['headline'] }, fieldMap: {}, replaces: 'standard-free-text',
    });
    const entries = deskEntriesForLook(manager.getAllTemplates().filter((t) => t.setId === 'standard'), manager.getReplacements('standard'));
    expect(entries.get('free-text')?.template.manifest.id).toBe('studio-strap');
  });

  it('starts a new look for it, with a unique id when the name is taken', async () => {
    writeGraphic(user('sets', 'club', 'x'), 'club-x');
    fs.writeFileSync(user('sets', 'club', 'set.json'), JSON.stringify({ id: 'club', name: 'Club' }));
    await rediscover();
    const done = await finishGraphic(manager, {
      graphicId: 'studio-strap', target: { newLookName: 'Club' }, kind: 'club-2-guest', zone: 'lower', desk: { ...desk, inputs: [], required: [], feeds: [], fields: ['headline'] }, fieldMap: {},
    });
    expect(done.setId).toBe('club-2');
    expect(JSON.parse(fs.readFileSync(user('sets', 'club-2', 'set.json'), 'utf8'))).toMatchObject({ id: 'club-2', name: 'Club' });
    expect(manager.getTemplateSets().find((s) => s.id === 'club-2')).toMatchObject({ source: 'imported' });
  });

  it('gives it a new id and folder when the look already has that folder', async () => {
    writeGraphic(user('additions', 'standard', 'studio-strap'), 'someone-else');
    await rediscover();
    const done = await finishGraphic(manager, {
      graphicId: 'studio-strap', target: { lookId: 'standard' }, kind: 'standard-guest-strap', desk: { ...desk, inputs: [], required: [], feeds: [], fields: ['headline'] }, fieldMap: {},
    });
    expect(done.id).toBe('studio-strap-2');
    expect(manager.getTemplateById('studio-strap-2')).toMatchObject({ setId: 'standard', directoryName: 'additions/standard/studio-strap-2' });
    expect(manager.getTemplateById('someone-else')).toBeDefined();
  });

  it('refuses what would not work in Live, and unsafe names', async () => {
    await expect(finishGraphic(manager, { graphicId: 'studio-strap', target: { lookId: 'standard' }, kind: 'bad kind!', desk, fieldMap })).rejects.toThrow();
    await expect(finishGraphic(manager, { graphicId: 'studio-strap', target: { lookId: '../x' }, kind: 'standard-a', desk, fieldMap })).rejects.toThrow();
    await expect(finishGraphic(manager, { graphicId: 'studio-strap', target: { lookId: 'standard' }, kind: 'standard-a', desk: { ...desk, label: '' }, fieldMap })).rejects.toThrow();
    await expect(finishGraphic(manager, { graphicId: 'studio-strap', target: { lookId: 'standard' }, kind: 'standard-a', desk, fieldMap: { nothere: 'runnerName' } })).rejects.toThrow(/nothere/);
    expect(fs.existsSync(user('studio-strap'))).toBe(true);
  });
});

describe('finishing a graphic that is already in a look', () => {
  it('gives the Name strap a Live entry with a patch beside the look, keeping the app files as they are', async () => {
    const before = fs.readFileSync(path.join(tmp, 'app', 'sets', 'standard', 'standard-name-strap', 'standard-name-strap.ograf.json'), 'utf8');
    await finishGraphic(manager, {
      graphicId: 'standard-name-strap', target: { lookId: 'standard' }, kind: 'name-strap', zone: 'lower',
      desk: { label: 'Name strap', short: 'Name', inputs: [], required: [], feeds: [], fields: ['name', 'title', 'club'] }, fieldMap: {},
    });
    expect(manager.getTemplateById('standard-name-strap')!.desk).toMatchObject({ key: 'name-strap', fields: ['name', 'title', 'club'] });
    expect(fs.readFileSync(path.join(tmp, 'app', 'sets', 'standard', 'standard-name-strap', 'standard-name-strap.ograf.json'), 'utf8')).toBe(before);
    expect(JSON.parse(fs.readFileSync(user('additions', 'standard', 'desk.json'), 'utf8'))['standard-name-strap']).toBeDefined();
  });
  it('only finishes into its own look', async () => {
    await expect(finishGraphic(manager, {
      graphicId: 'standard-name-strap', target: { newLookName: 'Other' }, kind: 'name-strap', desk: { ...desk, inputs: [], required: [], feeds: [], fields: ['name'] }, fieldMap: {},
    })).rejects.toThrow(/its own look/);
  });
});

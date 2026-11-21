/**
 * Finishing the import helper for one graphic: it gets a place in a look and a Live entry.
 *
 * - A graphic outside any look (an OGraf Studio export, say) is moved into the chosen look:
 *   beside a built-in look (additions/<look>/), into an imported look (sets/<look>/), or into a
 *   new look. Its manifest gets its id, kind, position, Live entry and field map.
 * - A graphic already in a look (a built-in Name strap, say) stays where it is; its Live entry is
 *   saved as a desk patch beside the look (desk.json), so the app's own files are never changed.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CUSTOM_TEMPLATE_SET, SYSTEM_TEMPLATE_SET, type GraphicZone, type OGrafManifest } from '../../shared/types/ograf';
import { resolveDeskDeclaration } from '../../shared/deskDeclaration';
import { slug } from '../../shared/slug';
import type { FieldMap } from '../../shared/fieldMap';
import type { OGrafManager } from './OGrafManager';
import { extensionFolder, isValidId, readOverrides, TemplatePackageError, writeOverrides } from './TemplatePackages';
import { pickManifestFile } from './manifestFile';

export interface FinishRequest {
  graphicId: string;
  target: { lookId: string } | { newLookName: string };
  kind: string;
  zone?: GraphicZone;
  /** v_olgrafik_desk */
  desk: { label: string; short?: string; inputs: string[]; required: string[]; feeds: string[]; fields: string[] };
  fieldMap: FieldMap;
  /** A graphic of the look this one is used instead of in Live */
  replaces?: string | null;
}

const fail = (message: string): never => {
  throw new TemplatePackageError(message);
};

const ZONES = ['main', 'lower', 'side', 'corner', 'full'];

/** Live entry, field map and position as the manifest carries them; refused if Live couldn't use them */
function deskSettings(base: OGrafManifest, request: FinishRequest): Record<string, unknown> {
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(String(request.kind))) fail('Invalid kind');
  if (request.zone !== undefined && !ZONES.includes(request.zone)) fail('Invalid position');
  const settings: Record<string, unknown> = {
    v_olgrafik_kind: request.kind,
    v_olgrafik_desk: { ...request.desk, short: request.desk.short?.trim() || request.desk.label },
    ...(Object.keys(request.fieldMap ?? {}).length ? { v_olgrafik_fieldMap: request.fieldMap } : {}),
    ...(request.zone ? { v_olgrafik_zone: request.zone } : {}),
  };
  const { desk, warnings } = resolveDeskDeclaration({ ...base, ...settings } as OGrafManifest);
  if (!desk || warnings.length) fail(`Live can't use this yet: ${warnings.join('; ') || 'no Live entry'}`);
  return settings;
}

/** Live's own data for a list of runners at a timing point (and a runner, if one is picked) */
function dataSourceFor(request: FinishRequest): object | null {
  const usesList = Object.values(request.fieldMap ?? {}).some((v) => typeof v === 'object');
  if (!usesList) return null;
  const controls: object[] = [
    { type: 'class-selector', label: 'Class', helpText: 'Class to show', required: true, storeAs: 'className', compact: true },
    { type: 'control-point-selector', label: 'Timing point', helpText: 'Finish or a radio control', required: false, storeAs: 'controlCode', multiple: false, includeFinish: true },
  ];
  if (request.desk.inputs.includes('runner')) {
    controls.push({
      type: 'runner-search', label: 'Runner', helpText: 'Search by name or bib', required: true, storeAs: 'runnerId', searchBy: 'both',
      placeholder: 'Name or bib...', populateFields: { runnerName: 'name', runnerClub: 'club', runnerBib: 'bib' },
    });
  }
  return {
    version: '1.0',
    mode: 'api',
    api: {
      provider: 'liveresults',
      fieldMappings: [
        { templateField: 'className', apiPath: 'className', required: true, autoPopulated: true, allowOverride: true, showInUI: false },
        { templateField: 'results', apiPath: 'results', required: true, autoPopulated: true, allowOverride: false, showInUI: false },
        { templateField: 'controlName', apiPath: 'controlName', required: false, autoPopulated: true, allowOverride: true, showInUI: false },
      ],
      uiControls: controls,
      autoUpdate: { defaultEnabled: true },
    },
  };
}

async function rediscover(manager: OGrafManager) {
  manager.clearCache();
  await manager.discoverTemplates();
}

/** What this graphic replaces in Live: set, or cleared when nothing is chosen */
function saveReplacement(dir: string, newId: string, replaces: string | null | undefined) {
  if (replaces !== null && replaces !== undefined && (typeof replaces !== 'string' || replaces === newId)) fail('Invalid replacement');
  const current = readOverrides(dir);
  if (replaces) current[newId] = replaces;
  else delete current[newId];
  writeOverrides(dir, current);
}

/** A kind no other graphic of the look has: two graphics with one kind would push one out of Live */
function checkKindFree(manager: OGrafManager, lookId: string, kind: string, selfId: string) {
  const clash = manager.getAllTemplates().find((t) => t.setId === lookId && t.manifest.id !== selfId && (t.desk?.kind === kind || t.desk?.key === kind));
  if (clash) fail(`The kind "${kind}" is already used by ${clash.manifest.name} in this look`);
}

/** Write a file in a temporary place, then swap it in, so a failed write leaves the old one */
function writeAtomic(file: string, text: string) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

const MAX_ID = 64;

export async function finishGraphic(manager: OGrafManager, request: FinishRequest): Promise<{ id: string; setId: string }> {
  const userDir = manager.getUserDirectory() ?? fail('There is no templates folder to write to');
  const graphic = manager.getTemplateById(String(request.graphicId)) ?? fail('That graphic is no longer there');
  if (!request.desk?.label?.trim()) fail('Give the graphic a name for Live');
  const sets = manager.getTemplateSets();

  // Already in a look: a desk patch beside the look
  if (graphic.setId !== CUSTOM_TEMPLATE_SET) {
    if (graphic.setId === SYSTEM_TEMPLATE_SET) fail('The test pattern is not offered in Live');
    if (!('lookId' in request.target) || request.target.lookId !== graphic.setId) fail('A graphic already in a look stays in its own look');
    // Its own kind stays: other parts of the app find graphics by kind
    const ownKind = typeof graphic.manifest.v_olgrafik_kind === 'string' ? graphic.manifest.v_olgrafik_kind : '';
    if (ownKind && request.kind !== ownKind) fail(`A look's graphic keeps its kind ("${ownKind}")`);
    if (!ownKind) checkKindFree(manager, graphic.setId, request.kind, graphic.manifest.id);
    const settings = deskSettings(graphic.manifest, request);
    if (ownKind) delete settings.v_olgrafik_kind;
    const dir = path.join(userDir, ...extensionFolder(manager, graphic.setId).split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'desk.json');
    let patches: Record<string, unknown> = {};
    try {
      const read = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (read && typeof read === 'object' && !Array.isArray(read)) patches = read;
    } catch {
      // first patch for this look
    }
    writeAtomic(file, JSON.stringify({ ...patches, [graphic.manifest.id]: settings }, null, 2) + '\n');
    saveReplacement(dir, graphic.manifest.id, request.replaces);
    await rediscover(manager);
    return { id: graphic.manifest.id, setId: graphic.setId };
  }

  // Outside any look: everything is checked before anything is written
  const source = path.dirname(graphic.manifestPath);
  if (!source.startsWith(userDir + path.sep)) fail('Only imported graphics can be moved into a look');
  const settings = deskSettings(graphic.manifest, request);
  let lookId: string;
  let newLookName: string | null = null;
  if ('lookId' in request.target) {
    lookId = String(request.target.lookId);
    if (!isValidId(lookId) || !sets.some((s) => s.id === lookId)) fail('Choose a look');
    checkKindFree(manager, lookId, request.kind, graphic.manifest.id);
  } else {
    newLookName = String(request.target.newLookName ?? '').trim() || fail('Give the new look a name');
    if (newLookName.length > 80) fail('Use a shorter name for the look');
    const wanted = newLookName.toLowerCase();
    // The same name must be changed; the same id just gets -2, -3 ...
    if (sets.some((s) => s.name.toLowerCase() === wanted)) fail(`A look called "${newLookName}" already exists`);
    const base = slug(newLookName);
    lookId = base;
    for (let n = 2; !isValidId(lookId) || sets.some((s) => s.id === lookId) || fs.existsSync(path.join(userDir, 'sets', lookId)); n++) lookId = `${base}-${n}`;
  }
  const builtIn = sets.some((s) => s.id === lookId && s.source !== 'imported');
  const lookDir = path.join(userDir, ...(builtIn ? `additions/${lookId}` : `sets/${lookId}`).split('/'));

  // A unique id and folder: the graphic's own, else with -2, -3 ...
  const taken = (id: string) => fs.existsSync(path.join(lookDir, id)) || (id !== graphic.manifest.id && !!manager.getTemplateById(id));
  const base = (isValidId(graphic.manifest.id) ? graphic.manifest.id : slug(graphic.manifest.id)).slice(0, MAX_ID - 4);
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  if (!isValidId(id)) fail('Invalid graphic id');
  const target = path.join(lookDir, id);
  if (!target.startsWith(userDir + path.sep)) fail('Invalid look');
  const names = fs.readdirSync(source);
  const pick = pickManifestFile(path.basename(source), names);
  const manifestFile = pick && 'file' in pick ? pick.file : path.basename(graphic.manifestPath);
  // The operator's name for it in Live is its name in the library too
  const manifest = { ...JSON.parse(fs.readFileSync(path.join(source, manifestFile), 'utf-8')), ...settings, id, name: request.desk.label.trim() };

  // Now write: the new look, then the move, then the manifest swapped in
  if (newLookName !== null) {
    fs.mkdirSync(path.join(userDir, 'sets', lookId), { recursive: true });
    fs.writeFileSync(path.join(userDir, 'sets', lookId, 'set.json'), JSON.stringify({ id: lookId, name: newLookName }, null, 2) + '\n');
  }
  try {
    fs.mkdirSync(lookDir, { recursive: true });
    fs.renameSync(source, target);
  } catch (error) {
    if (newLookName !== null) fs.rmSync(path.join(userDir, 'sets', lookId), { recursive: true, force: true });
    throw error;
  }
  writeAtomic(path.join(target, `${id}.ograf.json`), JSON.stringify(manifest, null, 2) + '\n');
  if (manifestFile !== `${id}.ograf.json`) fs.rmSync(path.join(target, manifestFile), { force: true });
  const dataSource = dataSourceFor(request);
  for (const old of names.filter((n) => n.endsWith('.datasource.json') && n !== `${id}.datasource.json`)) fs.rmSync(path.join(target, old), { force: true });
  if (dataSource) writeAtomic(path.join(target, `${id}.datasource.json`), JSON.stringify(dataSource, null, 2) + '\n');
  else fs.rmSync(path.join(target, `${id}.datasource.json`), { force: true });
  saveReplacement(lookDir, id, request.replaces);
  await rediscover(manager);
  return { id, setId: lookId };
}

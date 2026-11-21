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
  if (!/^[a-z0-9][a-z0-9_-]{0,80}$/i.test(String(request.kind))) fail('Invalid kind');
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

function saveReplacement(dir: string, newId: string, replaces: string | null | undefined) {
  if (!replaces) return;
  if (typeof replaces !== 'string' || replaces === newId) fail('Invalid replacement');
  writeOverrides(dir, { ...readOverrides(dir), [newId]: replaces });
}

export async function finishGraphic(manager: OGrafManager, request: FinishRequest): Promise<{ id: string; setId: string }> {
  const userDir = manager.getUserDirectory() ?? fail('There is no templates folder to write to');
  const graphic = manager.getTemplateById(String(request.graphicId)) ?? fail('That graphic is no longer there');
  if (!request.desk?.label?.trim()) fail('Give the graphic a name for Live');
  const sets = manager.getTemplateSets();

  // Already in a look: a desk patch beside the look
  if (graphic.setId !== CUSTOM_TEMPLATE_SET) {
    if (graphic.setId === SYSTEM_TEMPLATE_SET) fail('The test pattern is not offered in Live');
    if (!('lookId' in request.target) || request.target.lookId !== graphic.setId) fail('A graphic already in a look stays in its own look');
    const settings = deskSettings(graphic.manifest, request);
    const dir = path.join(userDir, ...extensionFolder(manager, graphic.setId).split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'desk.json');
    let patches: Record<string, unknown> = {};
    try {
      patches = JSON.parse(fs.readFileSync(file, 'utf-8')) ?? {};
    } catch {
      // first patch for this look
    }
    fs.writeFileSync(file, JSON.stringify({ ...patches, [graphic.manifest.id]: settings }, null, 2) + '\n');
    saveReplacement(dir, graphic.manifest.id, request.replaces);
    await rediscover(manager);
    return { id: graphic.manifest.id, setId: graphic.setId };
  }

  // Outside any look: move it into one
  const source = path.dirname(graphic.manifestPath);
  if (!source.startsWith(userDir + path.sep)) fail('Only imported graphics can be moved into a look');
  let lookId: string;
  if ('lookId' in request.target) {
    lookId = String(request.target.lookId);
    if (!isValidId(lookId) || !sets.some((s) => s.id === lookId)) fail('Choose a look');
  } else {
    const name = String(request.target.newLookName ?? '').trim() || fail('Give the new look a name');
    if (sets.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== slug(name))) fail(`A look called "${name}" already exists`);
    lookId = slug(name);
    for (let n = 2; !isValidId(lookId) || sets.some((s) => s.id === lookId) || fs.existsSync(path.join(userDir, 'sets', lookId)); n++) lookId = `${slug(name)}-${n}`;
    fs.mkdirSync(path.join(userDir, 'sets', lookId), { recursive: true });
    fs.writeFileSync(path.join(userDir, 'sets', lookId, 'set.json'), JSON.stringify({ id: lookId, name }, null, 2) + '\n');
  }
  const settingsCheck = deskSettings(graphic.manifest, request);
  const lookDir = path.join(userDir, ...(sets.some((s) => s.id === lookId && s.source !== 'imported') ? `additions/${lookId}` : `sets/${lookId}`).split('/'));

  // A unique id and folder: the graphic's own, else with -2, -3 ...
  const taken = (id: string) => fs.existsSync(path.join(lookDir, id)) || (id !== graphic.manifest.id && !!manager.getTemplateById(id));
  const base = isValidId(graphic.manifest.id) ? graphic.manifest.id : slug(graphic.manifest.id);
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  const target = path.join(lookDir, id);
  if (!target.startsWith(userDir + path.sep)) fail('Invalid look');

  fs.mkdirSync(lookDir, { recursive: true });
  fs.renameSync(source, target);
  const names = fs.readdirSync(target);
  const pick = pickManifestFile(path.basename(source), names);
  const manifestFile = pick && 'file' in pick ? pick.file : path.basename(graphic.manifestPath);
  // The operator's name for it in Live is its name in the library too
  const manifest = { ...JSON.parse(fs.readFileSync(path.join(target, manifestFile), 'utf-8')), ...settingsCheck, id, name: request.desk.label.trim() };
  fs.rmSync(path.join(target, manifestFile));
  fs.writeFileSync(path.join(target, `${id}.ograf.json`), JSON.stringify(manifest, null, 2) + '\n');
  for (const old of names.filter((n) => n.endsWith('.datasource.json'))) fs.rmSync(path.join(target, old));
  const dataSource = dataSourceFor(request);
  if (dataSource) fs.writeFileSync(path.join(target, `${id}.datasource.json`), JSON.stringify(dataSource, null, 2) + '\n');
  saveReplacement(lookDir, id, request.replaces);
  await rediscover(manager);
  return { id, setId: lookId };
}

/**
 * Import and export looks (template sets) as zip files.
 *
 * A look zip holds one set folder: <set>/set.json, set.js, theme.css, fonts/ and one
 * folder per graphic. The files may also sit at the top of the zip. A zip can carry several
 * looks, and OGraf graphics outside any set (a folder with <name>.ograf.json).
 *
 * Imported looks go to the writable templates folder (DATAROOT/templates/sets/<set>/); the
 * graphics there still load the shared code (sets/_core/) that ships with the app.
 *
 * A look whose set.json says "extends": "<look>" carries only graphics added to that look (and
 * its overrides.json). Those go to DATAROOT/templates/additions/<look>/, so they survive app
 * updates. A built-in look exports this way: only what the operator added to it.
 */

import * as fs from 'fs';
import * as path from 'path';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { CUSTOM_TEMPLATE_SET, SYSTEM_TEMPLATE_SET } from '../../shared/types/ograf';
import { ADDITIONS, DESK_PATCH_KEYS, type OGrafManager } from './OGrafManager';
import { pickManifestFile } from './manifestFile';
import { normalizeAllowedOrigin } from '../security/csp';

/** Refuse zips that unpack to more than this (fonts and images included) */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 5000;
/** Folder names that are not looks */
const RESERVED = new Set(['_core', 'sets', 'fonts', ADDITIONS, SYSTEM_TEMPLATE_SET, CUSTOM_TEMPLATE_SET]);

export interface ZipLook {
  id: string;
  name: string;
  description?: string;
  /** Files of the look, by path inside the look folder */
  files: Map<string, Uint8Array>;
  graphicIds: string[];
}

export interface ZipGraphic {
  /** Folder name, used as the install folder */
  folder: string;
  id: string;
  name: string;
  files: Map<string, Uint8Array>;
}

/** Graphics added to a look, from a set.json with "extends" */
export interface ZipExtension {
  lookId: string;
  graphics: ZipGraphic[];
  /** New graphic id → the id it replaces, only for graphics in this file */
  replaces: Record<string, string>;
  /** Live entries for the look's own graphics (desk.json), only the desk settings of each */
  deskPatches: Record<string, Record<string, unknown>>;
}

export interface ZipContents {
  looks: ZipLook[];
  graphics: ZipGraphic[];
  extensions: ZipExtension[];
}

/** What an import would do, for the operator to confirm */
export interface ImportPreview {
  /** Internet addresses the graphics ask for that aren't on the allowlist yet */
  internet: string[];
  /** Addresses the graphics ask for that can't be allowed, with the reason */
  internetRefused: Array<{ input: string; reason: string }>;
  looks: Array<{ id: string; name: string; graphics: number; replaces?: 'imported' | 'built-in' }>;
  graphics: Array<{ id: string; name: string; replaces?: boolean }>;
  /** Graphics added to a look; lookName is null when this computer doesn't have the look */
  additions: Array<{ lookId: string; lookName: string | null; graphics: number }>;
}

export class TemplatePackageError extends Error {}

const fail = (message: string): never => {
  throw new TemplatePackageError(message);
};

/** A safe relative path inside the zip, or null for entries to skip (folders, macOS extras) */
function cleanEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/');
  if (name.endsWith('/')) return null;
  const parts = name.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length) return null;
  if (parts.some((p) => p === '..') || /^[a-zA-Z]:/.test(parts[0]) || name.startsWith('/'))
    fail(`The zip contains an unsafe path: ${raw}`);
  // macOS Finder adds these; they are not part of the look
  if (parts[0] === '__MACOSX' || parts.some((p) => p === '.DS_Store' || p === 'Thumbs.db')) return null;
  return parts.join('/');
}

export const isValidId = (id: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) && !RESERVED.has(id.toLowerCase());

function readJson(bytes: Uint8Array | undefined, what: string): any {
  if (!bytes) return undefined;
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf-8'));
  } catch {
    return fail(`${what} is not valid JSON`);
  }
}

/** The graphic folders directly inside a look folder, with their manifests */
function graphicFolders(lookFiles: Map<string, Uint8Array>, lookId: string): Array<{ folder: string; manifest: any }> {
  const byFolder = new Map<string, string[]>();
  for (const file of lookFiles.keys()) {
    const parts = file.split('/');
    if (parts.length !== 2) continue;
    const names = byFolder.get(parts[0]);
    if (names) names.push(parts[1]);
    else byFolder.set(parts[0], [parts[1]]);
  }
  const out: Array<{ folder: string; manifest: any }> = [];
  for (const [folder, names] of byFolder) {
    const pick = pickManifestFile(folder, names);
    if (!pick) continue;
    if ('ambiguous' in pick) {
      fail(`The graphic folder "${folder}" in the look "${lookId}" has several manifests (${pick.ambiguous.join(', ')}): keep one .ograf.json, or name it after the folder`);
      continue;
    }
    if (pick.file === 'manifest.json') continue;
    const manifest = readJson(lookFiles.get(`${folder}/${pick.file}`), `${folder}/${pick.file}`);
    if (manifest?.id) out.push({ folder, manifest });
  }
  return out;
}

/** desk.json as a file carries it: per graphic id, only the desk settings (never code or identity) */
function readDeskPatches(bytes: Uint8Array | undefined): Record<string, Record<string, unknown>> {
  const raw = readJson(bytes, 'desk.json');
  const out: Record<string, Record<string, unknown>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, patch] of Object.entries(raw)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(id) || !patch || typeof patch !== 'object' || Array.isArray(patch)) continue;
    const kept = Object.fromEntries(DESK_PATCH_KEYS.filter((k) => (patch as Record<string, unknown>)[k] !== undefined).map((k) => [k, (patch as Record<string, unknown>)[k]]));
    if (Object.keys(kept).length) out[id] = kept;
  }
  return out;
}

/** A set.json with "extends": the graphics it adds to that look and the replacements among them */
function readExtension(lookFiles: Map<string, Uint8Array>, meta: any): ZipExtension {
  const lookId = String(meta.extends ?? '').trim();
  if (!isValidId(lookId)) fail(`"${lookId}" can't be used as a look id: use letters, digits, - and _`);
  const graphics: ZipGraphic[] = graphicFolders(lookFiles, lookId).map(({ folder, manifest }) => {
    if (!isValidId(folder)) fail(`"${folder}" can't be used as a graphic folder name`);
    const files = new Map<string, Uint8Array>();
    for (const [file, data] of lookFiles) if (file.startsWith(`${folder}/`)) files.set(file.slice(folder.length + 1), data);
    return { folder, id: String(manifest.id), name: String(manifest.name || manifest.id), files };
  });
  const deskPatches = readDeskPatches(lookFiles.get('desk.json'));
  if (!graphics.length && !Object.keys(deskPatches).length) fail(`The file adds nothing to the look "${lookId}"`);
  const own = new Set(graphics.map((g) => g.id));
  const replaces: Record<string, string> = {};
  const declared = readJson(lookFiles.get('overrides.json'), 'overrides.json')?.replaces;
  if (declared && typeof declared === 'object') {
    // A file may only say what its own graphics replace
    for (const [newId, oldId] of Object.entries(declared)) {
      if (own.has(newId) && typeof oldId === 'string' && oldId.trim() && oldId !== newId) replaces[newId] = oldId;
    }
  }
  return { lookId, graphics, replaces, deskPatches };
}

/** Unpack a zip into the looks and graphics it holds. Nothing is written to disk. */
export function readTemplateZip(zip: Uint8Array): ZipContents {
  let entries: Record<string, Uint8Array>;
  let total = 0;
  let count = 0;
  try {
    entries = unzipSync(zip, {
      filter: (file) => {
        count++;
        total += file.originalSize;
        if (count > MAX_FILES) fail(`The zip has more than ${MAX_FILES} files`);
        if (total > MAX_UNPACKED_BYTES) fail('The zip unpacks to more than 200 MB');
        return true;
      },
    });
  } catch (error) {
    if (error instanceof TemplatePackageError) throw error;
    return fail('The file is not a zip file, or it is damaged');
  }

  const files = new Map<string, Uint8Array>();
  for (const [raw, data] of Object.entries(entries)) {
    const name = cleanEntryName(raw);
    if (name) files.set(name, data);
  }

  // A look is the folder of each set.json; a graphic is the folder of a <name>.ograf.json
  // that is not inside a look.
  const lookDirs = [...files.keys()]
    .filter((f) => f === 'set.json' || f.endsWith('/set.json'))
    .map((f) => (f === 'set.json' ? '' : f.slice(0, -'/set.json'.length)))
    .filter((dir) => !dir.split('/').some((p) => p.startsWith('_')));
  const inLook = (file: string) => lookDirs.some((dir) => dir === '' || file.startsWith(`${dir}/`));
  const within = (dir: string) => {
    const out = new Map<string, Uint8Array>();
    for (const [file, data] of files) {
      if (dir === '') out.set(file, data);
      else if (file.startsWith(`${dir}/`)) out.set(file.slice(dir.length + 1), data);
    }
    return out;
  };

  const looks: ZipLook[] = [];
  const extensions: ZipExtension[] = [];
  for (const dir of lookDirs) {
    const lookFiles = within(dir);
    const meta = readJson(lookFiles.get('set.json'), `${dir || 'The'} set.json`) || {};
    if (meta.extends !== undefined) {
      const extension = readExtension(lookFiles, meta);
      if (extensions.some((e) => e.lookId === extension.lookId)) fail(`The file adds to the look "${extension.lookId}" twice`);
      extensions.push(extension);
      continue;
    }
    const folderName = dir.split('/').pop() || '';
    const id = String(meta.id || folderName || '').trim();
    if (!id) fail('A look in the zip has no id: add "id" to its set.json');
    if (!isValidId(id)) fail(`"${id}" can't be used as a look id: use letters, digits, - and _`);
    if (looks.some((l) => l.id === id)) fail(`The zip contains the look "${id}" twice`);
    const graphicIds = graphicFolders(lookFiles, id).map(({ manifest }) => String(manifest.id));
    if (!graphicIds.length) fail(`The look "${id}" has no graphics (no graphic folder with an .ograf.json)`);
    looks.push({ id, name: String(meta.name || id), description: meta.description, files: lookFiles, graphicIds });
  }

  const graphics: ZipGraphic[] = [];
  for (const file of files.keys()) {
    if (inLook(file)) continue;
    const m = /(?:^|\/)([^/]+)\/\1\.ograf\.json$/.exec(file) || /^([^/]+)\.ograf\.json$/.exec(file);
    if (!m) continue;
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const folder = m[1];
    // A graphic at the top of the zip takes every file that is not part of a look
    const graphicFiles = dir === '' ? new Map([...files].filter(([f]) => !inLook(f))) : within(dir);
    if (!isValidId(folder)) fail(`"${folder}" can't be used as a graphic folder name`);
    const manifest = readJson(files.get(file), file);
    if (!manifest?.id) fail(`${file} has no id`);
    if (graphics.some((g) => g.folder === folder)) fail(`The zip contains the graphic "${folder}" twice`);
    graphics.push({ folder, id: String(manifest.id), name: String(manifest.name || manifest.id), files: graphicFiles });
  }

  if (!looks.length && !graphics.length && !extensions.length)
    fail('The zip contains no look (set.json) and no OGraf graphic (.ograf.json)');
  return { looks, graphics, extensions };
}

/** Graphic ids already used outside the looks/graphics being replaced */
function checkIdClashes(manager: OGrafManager, contents: ZipContents): void {
  const replacing = new Set(contents.looks.map((l) => l.id));
  const replacedGraphicDirs = new Set(contents.graphics.map((g) => g.folder));
  // Graphics installed from an earlier copy of this file are replaced, not clashes
  const replacedAdditions = new Set(
    contents.extensions.flatMap((e) => e.graphics.map((g) => `${extensionFolder(manager, e.lookId)}/${g.folder}`)),
  );
  const userDir = manager.getUserDirectory();
  const taken = new Map<string, string>();
  for (const t of manager.getAllTemplates()) {
    const inUserDir = !!userDir && t.manifestPath.startsWith(userDir);
    if (inUserDir && replacedAdditions.has(t.directoryName)) continue;
    // A look being replaced takes its own graphics with it, but not graphics added to it
    if (!t.addition && replacing.has(t.setId)) continue;
    if (t.setId === CUSTOM_TEMPLATE_SET && userDir && t.manifestPath.startsWith(userDir) && replacedGraphicDirs.has(t.directoryName)) continue;
    taken.set(t.manifest.id, t.setId === CUSTOM_TEMPLATE_SET ? 'another graphic' : `the "${t.setId}" look`);
  }
  const seen = new Set<string>();
  const ids = [
    ...contents.looks.flatMap((l) => l.graphicIds),
    ...contents.graphics.map((g) => g.id),
    ...contents.extensions.flatMap((e) => e.graphics.map((g) => g.id)),
  ];
  for (const id of ids) {
    if (seen.has(id)) fail(`The graphic id "${id}" is used twice in the zip`);
    seen.add(id);
    const owner = taken.get(id);
    if (owner) fail(`The graphic id "${id}" is already used by ${owner}. Graphic ids must be unique.`);
  }
}

/** What importing this zip would add or replace; `allowed` is the current internet allowlist */
export function previewTemplateZip(manager: OGrafManager, zip: Uint8Array, allowed: string[] = []): ImportPreview {
  return previewContents(manager, readTemplateZip(zip), allowed);
}

/**
 * Internet addresses the zip's graphics declare (v_olgrafik_internet): those not allowed yet,
 * and those that can never be allowed (with the reason), so the operator sees both
 */
function declaredInternet(contents: ZipContents, allowed: string[]): { asked: string[]; refused: Array<{ input: string; reason: string }> } {
  const asked = new Set<string>();
  const refused = new Map<string, string>();
  const manifests = [
    ...contents.looks.flatMap((l) => [...l.files]),
    ...[...contents.graphics, ...contents.extensions.flatMap((e) => e.graphics)].flatMap((g) => [...g.files]),
  ]
    .filter(([name]) => name.endsWith('.ograf.json'));
  for (const [name, data] of manifests) {
    let manifest: { v_olgrafik_internet?: unknown };
    try { manifest = readJson(data, name) ?? {}; } catch { continue; }
    for (const entry of Array.isArray(manifest.v_olgrafik_internet) ? manifest.v_olgrafik_internet : []) {
      const result = normalizeAllowedOrigin(String(entry));
      if (!result.ok) refused.set(String(entry), result.reason);
      else if (!allowed.includes(result.value)) asked.add(result.value);
    }
  }
  return {
    asked: [...asked].sort(),
    refused: [...refused].sort(([a], [b]) => a.localeCompare(b)).map(([input, reason]) => ({ input, reason })),
  };
}

function previewContents(manager: OGrafManager, contents: ZipContents, allowed: string[] = []): ImportPreview {
  checkIdClashes(manager, contents);
  const internet = declaredInternet(contents, allowed);
  const sets = new Map(manager.getTemplateSets().map((s) => [s.id, s]));
  const userDir = manager.getUserDirectory();
  return {
    internet: internet.asked,
    internetRefused: internet.refused,
    looks: contents.looks.map((l) => {
      const existing = sets.get(l.id);
      return {
        id: l.id,
        name: l.name,
        graphics: l.graphicIds.length,
        replaces: existing ? (existing.source === 'imported' ? 'imported' : 'built-in') : undefined,
      };
    }),
    graphics: contents.graphics.map((g) => ({
      id: g.id,
      name: g.name,
      replaces: !!userDir && fs.existsSync(path.join(userDir, g.folder)),
    })),
    additions: contents.extensions.map((e) => ({ lookId: e.lookId, lookName: sets.get(e.lookId)?.name ?? null, graphics: e.graphics.length })),
  };
}

function writeFiles(dir: string, files: Map<string, Uint8Array>): void {
  for (const [file, data] of files) {
    const target = path.join(dir, ...file.split('/'));
    if (!target.startsWith(dir + path.sep)) fail(`The zip contains an unsafe path: ${file}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

/** Write a folder in a temporary place, then swap it in, so a failed import changes nothing */
function replaceFolder(target: string, files: Map<string, Uint8Array>): void {
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temp = path.join(parent, `.import-${path.basename(target)}-${stamp}`);
  const old = path.join(parent, `.old-${path.basename(target)}-${stamp}`);
  try {
    writeFiles(temp, files);
    if (fs.existsSync(target)) fs.renameSync(target, old);
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    if (fs.existsSync(old) && !fs.existsSync(target)) fs.renameSync(old, target);
    throw error;
  }
  fs.rmSync(old, { recursive: true, force: true });
}

async function rediscover(manager: OGrafManager) {
  manager.clearCache();
  return manager.discoverTemplates();
}

/** Install the looks and graphics of a zip, replacing earlier imports with the same id */
export async function importTemplateZip(manager: OGrafManager, zip: Uint8Array): Promise<ImportPreview> {
  const userDir = manager.getUserDirectory() ?? fail('There is no folder to import looks into');
  const contents = readTemplateZip(zip);
  const preview = previewContents(manager, contents);
  for (const look of contents.looks) {
    const files = new Map(look.files);
    // Keep the id the look was imported under, even if set.json had none
    const meta = readJson(files.get('set.json'), 'set.json') || {};
    files.set('set.json', Buffer.from(JSON.stringify({ ...meta, id: look.id }, null, 2) + '\n'));
    replaceFolder(path.join(userDir, 'sets', look.id), files);
  }
  for (const graphic of contents.graphics) replaceFolder(path.join(userDir, graphic.folder), graphic.files);
  for (const extension of contents.extensions) {
    const relative = extensionFolder(manager, extension.lookId);
    const dir = path.join(userDir, ...relative.split('/'));
    const replaces = readOverrides(dir);
    for (const graphic of extension.graphics) {
      // What the graphic (and whatever was in its folder before) replaced is now up to this file
      const before = manager.getAllTemplates().find((t) => t.directoryName === `${relative}/${graphic.folder}` && t.manifestPath.startsWith(userDir));
      if (before) delete replaces[before.manifest.id];
      delete replaces[graphic.id];
      replaceFolder(path.join(dir, graphic.folder), graphic.files);
    }
    writeOverrides(dir, { ...replaces, ...extension.replaces });
    if (Object.keys(extension.deskPatches).length) {
      fs.mkdirSync(dir, { recursive: true });
      writeFileSafe(path.join(dir, 'desk.json'), JSON.stringify({ ...readDeskJson(dir), ...extension.deskPatches }, null, 2) + '\n');
    }
  }
  await rediscover(manager);
  return preview;
}

function collectFiles(dir: string, prefix: string, out: Zippable): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) collectFiles(full, name, out);
    else if (entry.isFile()) out[name] = new Uint8Array(fs.readFileSync(full));
  }
}

export function readOverrides(dir: string): Record<string, string> {
  try {
    const replaces = JSON.parse(fs.readFileSync(path.join(dir, 'overrides.json'), 'utf-8'))?.replaces;
    if (!replaces || typeof replaces !== 'object' || Array.isArray(replaces)) return {};
    return Object.fromEntries(Object.entries(replaces).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

function readDeskJson(dir: string): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'desk.json'), 'utf-8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function writeFileSafe(file: string, text: string) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

export function writeOverrides(dir: string, replaces: Record<string, string>): void {
  const file = path.join(dir, 'overrides.json');
  if (!Object.keys(replaces).length) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ replaces }, null, 2) + '\n');
}

/**
 * Where graphics added to a look are installed, relative to the user templates folder: beside a
 * built-in look (additions/<look>), or inside an imported look (sets/<look>), so they travel and
 * are removed with it
 */
export function extensionFolder(manager: OGrafManager, lookId: string): string {
  const imported = manager.getTemplateSets().find((s) => s.id === lookId)?.source === 'imported';
  return imported ? `sets/${lookId}` : `${ADDITIONS}/${lookId}`;
}

/** Zip every file of a look as <set>/... */
export function wholeLookZip(manager: OGrafManager, setId: string): Uint8Array {
  const dir = manager.getSetDirectory(setId) ?? fail(`The look "${setId}" is not installed`);
  const files: Zippable = {};
  collectFiles(dir, setId, files);
  // Already-compressed files (fonts, images) are stored as they are
  return zipSync(files, { level: 6 });
}

/** The graphic folders added to a look */
function additionFolders(manager: OGrafManager, lookId: string): string[] {
  const userDir = manager.getUserDirectory();
  if (!userDir || !isValidId(lookId)) return [];
  const dir = path.join(userDir, ADDITIONS, lookId);
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/**
 * The .splitlook file for a look. An imported look travels whole. A built-in look travels as
 * only what was added to it (set.json with "extends", the added graphics, overrides.json):
 * the other computer has the rest.
 */
export function exportLookZip(manager: OGrafManager, setId: string): Uint8Array {
  const set = manager.getTemplateSets().find((s) => s.id === setId) ?? fail(`The look "${setId}" is not installed`);
  if (set.source === 'imported') return wholeLookZip(manager, setId);
  const folders = additionFolders(manager, setId);
  const dir0 = manager.getUserDirectory() ? path.join(manager.getUserDirectory()!, ADDITIONS, setId) : '';
  const deskPatches = dir0 ? readDeskJson(dir0) : {};
  if (!folders.length && !Object.keys(deskPatches).length) fail('This look has no additions to export');
  const dir = path.join(manager.getUserDirectory()!, ADDITIONS, setId);
  const files: Zippable = {
    [`${setId}/set.json`]: strToU8(JSON.stringify({ id: setId, name: set.name, extends: setId }, null, 2) + '\n'),
  };
  for (const folder of folders) collectFiles(path.join(dir, folder), `${setId}/${folder}`, files);
  const replaces = readOverrides(dir);
  if (Object.keys(replaces).length) files[`${setId}/overrides.json`] = strToU8(JSON.stringify({ replaces }, null, 2) + '\n');
  if (Object.keys(deskPatches).length) files[`${setId}/desk.json`] = strToU8(JSON.stringify(deskPatches, null, 2) + '\n');
  return zipSync(files, { level: 6 });
}

/** Remove an imported look. A built-in look it replaced comes back. */
export async function removeImportedLook(manager: OGrafManager, setId: string): Promise<void> {
  const userDir = manager.getUserDirectory();
  const set = manager.getTemplateSets().find((s) => s.id === setId);
  if (!userDir || !set || set.source !== 'imported') fail(`"${setId}" is not an imported look`);
  const dir = path.join(userDir!, 'sets', setId);
  if (!dir.startsWith(path.join(userDir!, 'sets') + path.sep)) fail('Invalid look');
  fs.rmSync(dir, { recursive: true, force: true });
  await rediscover(manager);
}

/** A look's name as a file name on every system ("IOF / Sprint" → "IOF - Sprint") */
export function lookFileName(name: string): string {
  // Control characters are not allowed in file names either
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/\s*[<>:"/\\|?*\x00-\x1f][\s<>:"/\\|?*\x00-\x1f]*/g, ' - ').replace(/\s+/g, ' ').replace(/^[\s.-]+|[\s.-]+$/g, '');
  const file = clean.slice(0, 80) || 'look';
  // Windows keeps these names for devices
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(file) ? `${file} look` : file;
}

/**
 * Remove a graphic added to a look, and what it replaced in that look: the replaced graphic
 * comes back in Live
 */
export async function removeAddition(manager: OGrafManager, lookId: string, graphicId: string): Promise<void> {
  const userDir = manager.getUserDirectory() ?? fail('There is no templates folder');
  if (!isValidId(lookId)) fail('Invalid look');
  const lookDir = path.join(userDir, ADDITIONS, lookId);
  const graphic = manager.getAllTemplates().find(
    (t) => t.addition && t.manifest.id === graphicId && t.directoryName.startsWith(`${ADDITIONS}/${lookId}/`),
  ) ?? fail(`"${graphicId}" is not a graphic added to this look`);
  const dir = path.join(userDir, ...graphic.directoryName.split('/'));
  if (path.dirname(dir) !== lookDir) fail('Invalid graphic');
  fs.rmSync(dir, { recursive: true, force: true });
  const replaces = readOverrides(lookDir);
  if (graphicId in replaces) {
    delete replaces[graphicId];
    writeOverrides(lookDir, replaces);
  }
  await rediscover(manager);
}

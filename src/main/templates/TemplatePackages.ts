/**
 * Import and export looks (template sets) as zip files.
 *
 * A look zip holds one set folder: <set>/set.json, set.js, theme.css, fonts/ and one
 * folder per graphic. The files may also sit at the top of the zip. A zip can carry several
 * looks, and OGraf graphics outside any set (a folder with <name>.ograf.json).
 *
 * Imported looks go to the writable templates folder (DATAROOT/templates/sets/<set>/); the
 * graphics there still load the shared code (sets/_core/) that ships with the app.
 */

import * as fs from 'fs';
import * as path from 'path';
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { CUSTOM_TEMPLATE_SET, SYSTEM_TEMPLATE_SET } from '../../shared/types/ograf';
import type { OGrafManager } from './OGrafManager';

/** Refuse zips that unpack to more than this (fonts and images included) */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;
const MAX_FILES = 5000;
/** Folder names that are not looks */
const RESERVED = new Set(['_core', 'sets', 'fonts', SYSTEM_TEMPLATE_SET, CUSTOM_TEMPLATE_SET]);

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

export interface ZipContents {
  looks: ZipLook[];
  graphics: ZipGraphic[];
}

/** What an import would do, for the operator to confirm */
export interface ImportPreview {
  looks: Array<{ id: string; name: string; graphics: number; replaces?: 'imported' | 'built-in' }>;
  graphics: Array<{ id: string; name: string; replaces?: boolean }>;
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

const isValidId = (id: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) && !RESERVED.has(id.toLowerCase());

function readJson(bytes: Uint8Array | undefined, what: string): any {
  if (!bytes) return undefined;
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf-8'));
  } catch {
    return fail(`${what} is not valid JSON`);
  }
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
  for (const dir of lookDirs) {
    const lookFiles = within(dir);
    const meta = readJson(lookFiles.get('set.json'), `${dir || 'The'} set.json`) || {};
    const folderName = dir.split('/').pop() || '';
    const id = String(meta.id || folderName || '').trim();
    if (!id) fail('A look in the zip has no id: add "id" to its set.json');
    if (!isValidId(id)) fail(`"${id}" can't be used as a look id: use letters, digits, - and _`);
    if (looks.some((l) => l.id === id)) fail(`The zip contains the look "${id}" twice`);
    const graphicIds: string[] = [];
    for (const [file, data] of lookFiles) {
      const m = /^([^/]+)\/\1\.ograf\.json$/.exec(file);
      if (!m) continue;
      const manifest = readJson(data, file);
      if (manifest?.id) graphicIds.push(String(manifest.id));
    }
    if (!graphicIds.length) fail(`The look "${id}" has no graphics (no <graphic>/<graphic>.ograf.json)`);
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

  if (!looks.length && !graphics.length)
    fail('The zip contains no look (set.json) and no OGraf graphic (.ograf.json)');
  return { looks, graphics };
}

/** Graphic ids already used outside the looks/graphics being replaced */
function checkIdClashes(manager: OGrafManager, contents: ZipContents): void {
  const replacing = new Set(contents.looks.map((l) => l.id));
  const replacedGraphicDirs = new Set(contents.graphics.map((g) => g.folder));
  const userDir = manager.getUserDirectory();
  const taken = new Map<string, string>();
  for (const t of manager.getAllTemplates()) {
    if (replacing.has(t.setId)) continue;
    if (t.setId === CUSTOM_TEMPLATE_SET && userDir && t.manifestPath.startsWith(userDir) && replacedGraphicDirs.has(t.directoryName)) continue;
    taken.set(t.manifest.id, t.setId === CUSTOM_TEMPLATE_SET ? 'another graphic' : `the "${t.setId}" look`);
  }
  const seen = new Set<string>();
  const ids = [...contents.looks.flatMap((l) => l.graphicIds), ...contents.graphics.map((g) => g.id)];
  for (const id of ids) {
    if (seen.has(id)) fail(`The graphic id "${id}" is used twice in the zip`);
    seen.add(id);
    const owner = taken.get(id);
    if (owner) fail(`The graphic id "${id}" is already used by ${owner}. Graphic ids must be unique.`);
  }
}

/** What importing this zip would add or replace */
export function previewTemplateZip(manager: OGrafManager, zip: Uint8Array): ImportPreview {
  return previewContents(manager, readTemplateZip(zip));
}

function previewContents(manager: OGrafManager, contents: ZipContents): ImportPreview {
  checkIdClashes(manager, contents);
  const sets = new Map(manager.getTemplateSets().map((s) => [s.id, s]));
  const userDir = manager.getUserDirectory();
  return {
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

/** Zip a look (built-in or imported) as <set>/... */
export function exportLookZip(manager: OGrafManager, setId: string): Uint8Array {
  const dir = manager.getSetDirectory(setId) ?? fail(`The look "${setId}" is not installed`);
  const files: Zippable = {};
  collectFiles(dir, setId, files);
  // Already-compressed files (fonts, images) are stored as they are
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

/**
 * A graphic's Live desk entry, declared in its manifest (docs/GRAPHIC-CAPABILITIES.md, step 2):
 *
 *   "v_olgrafik_desk": { "key": "relay-overview", "label": "Relay overview", "params": ["class"],
 *                        "required": ["class"], "feeds": ["timing"], "behaviours": ["holdOnAir"] }
 *
 * Without a declaration a graphic gets the standard entry of its kind (v_olgrafik_kind), so
 * existing looks need nothing. `false` keeps a graphic out of the desk. A declaration for a known
 * kind changes only what it names. Anything that isn't a standard building block is dropped with
 * a warning, so a wrong declaration never breaks the desk.
 */
import {
  DESK_BEHAVIOURS, DESK_FEEDS, DESK_PARAMS,
  type DeskBehaviour, type DeskFeed, type DeskParam, type PreviewData
} from './capabilities';
import { DESK_TEMPLATES, type DeskTemplate } from './desk';

const PREVIEW_DATA: readonly PreviewData[] = ['results', 'splits', 'starts'];
const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface DeskDeclarationResult {
  /** The graphic's desk entry, or null when it isn't offered in the Live desk */
  entry: DeskTemplate | null;
  /** Problems with the declaration (shown in Graphics library); the entry leaves them out */
  warnings: string[];
}

interface ManifestLike {
  v_olgrafik_kind?: unknown;
  v_olgrafik_desk?: unknown;
  schema?: { properties?: Record<string, unknown> } | unknown;
}

/** The standard desk entry of a graphic kind, if the app has one */
export function standardDeskEntry(kind: unknown): DeskTemplate | undefined {
  if (typeof kind !== 'string' || !kind) return undefined;
  return DESK_TEMPLATES.find(t => t.kind === kind) ?? DESK_TEMPLATES.find(t => t.fallbackIds?.includes(kind));
}

/** The desk entry a manifest declares (or its kind's standard entry), with any warnings */
export function resolveDeskEntry(manifest: ManifestLike): DeskDeclarationResult {
  const kind = typeof manifest.v_olgrafik_kind === 'string' ? manifest.v_olgrafik_kind : undefined;
  const base = standardDeskEntry(kind);
  const decl = manifest.v_olgrafik_desk;
  const warnings: string[] = [];
  if (decl === undefined || decl === null || decl === true) return { entry: base ?? null, warnings };
  if (decl === false) return { entry: null, warnings };
  if (typeof decl !== 'object' || Array.isArray(decl)) {
    return { entry: base ?? null, warnings: ['v_olgrafik_desk must be an object or false'] };
  }
  const d = decl as Record<string, unknown>;
  const schemaFields = new Set(Object.keys(((manifest.schema as any)?.properties as object) ?? {}));

  const text = (name: string, max = 60): string | undefined => {
    const v = d[name];
    if (v === undefined) return undefined;
    if (typeof v === 'string' && v.trim() && v.length <= max) return v.trim();
    warnings.push(`${name} must be a text of at most ${max} characters`);
    return undefined;
  };
  /** A list of known values; unknown ones are dropped with a warning */
  const list = <T extends string>(name: string, allowed: readonly T[], what: string): T[] | undefined => {
    const v = d[name];
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) { warnings.push(`${name} must be a list`); return undefined; }
    const out: T[] = [];
    for (const item of v) {
      if (typeof item === 'string' && (allowed as readonly string[]).includes(item)) { if (!out.includes(item as T)) out.push(item as T); }
      else warnings.push(`${name}: "${String(item)}" is not a standard ${what} (${allowed.join(', ')})`);
    }
    return out;
  };
  const fieldList = (name: string): string[] | undefined => {
    const v = d[name];
    if (v === undefined) return undefined;
    if (!Array.isArray(v)) { warnings.push(`${name} must be a list`); return undefined; }
    return v.filter((f): f is string => {
      const ok = typeof f === 'string' && schemaFields.has(f);
      if (!ok) warnings.push(`${name}: "${String(f)}" is not a field in the manifest's schema`);
      return ok;
    });
  };

  // the key: a new graphic needs its own; a known kind keeps its standard key
  let key = base?.key;
  if (d.key !== undefined) {
    if (typeof d.key !== 'string' || !KEY.test(d.key)) warnings.push('key must be lowercase letters, digits and dashes (at most 40)');
    else {
      const owner = DESK_TEMPLATES.find(t => t.key === d.key);
      if (owner && owner !== base) warnings.push(`key "${d.key}" belongs to the standard ${owner.label} graphic`);
      else key = d.key;
    }
  }
  if (!key) {
    warnings.push('A graphic of a new kind needs a "key" for the Live desk');
    return { entry: null, warnings };
  }

  const label = text('label') ?? base?.label;
  if (!label) {
    warnings.push('A graphic of a new kind needs a "label" for the Live desk');
    return { entry: null, warnings };
  }
  const params = list<DeskParam>('params', DESK_PARAMS, 'input') ?? base?.params ?? [];
  // inputs keep the palette's order: class, runner, control, page
  params.sort((a, b) => DESK_PARAMS.indexOf(a) - DESK_PARAMS.indexOf(b));
  let required = list<DeskParam>('required', DESK_PARAMS, 'input') ?? base?.required ?? [];
  required = required.filter(p => {
    if (params.includes(p)) return true;
    warnings.push(`required: "${p}" is not one of the graphic's inputs`);
    return false;
  });
  const feeds = list<DeskFeed>('feeds', DESK_FEEDS, 'feed') ?? base?.feeds ?? [];
  let behaviours = list<DeskBehaviour>('behaviours', DESK_BEHAVIOURS, 'behaviour') ?? base?.behaviours ?? [];
  const needs: Partial<Record<DeskBehaviour, DeskParam>> = { startControl: 'control', followNextStarter: 'runner', freeze: 'runner', titleFromClass: 'class' };
  behaviours = behaviours.filter(b => {
    const input = needs[b];
    if (!input || params.includes(input)) return true;
    warnings.push(`behaviours: "${b}" needs the "${input}" input`);
    return false;
  });

  let previewData = base?.previewData;
  if (d.previewData !== undefined) {
    if (typeof d.previewData === 'string' && (PREVIEW_DATA as readonly string[]).includes(d.previewData)) previewData = d.previewData as PreviewData;
    else warnings.push(`previewData must be one of ${PREVIEW_DATA.join(', ')}`);
  }
  let rowsPartner = base?.rowsPartner;
  if (d.rowsPartner !== undefined) {
    if (typeof d.rowsPartner === 'string' && KEY.test(d.rowsPartner) && d.rowsPartner !== key) rowsPartner = d.rowsPartner;
    else warnings.push('rowsPartner must be the key of another graphic');
  }

  const entry: DeskTemplate = {
    key,
    kind: kind ?? key,
    ...(base?.fallbackIds ? { fallbackIds: base.fallbackIds } : {}),
    label,
    short: text('short', 30) ?? (d.label !== undefined ? label : base?.short) ?? label,
    params,
    required,
    // a graphic needs a competition exactly when it reads timing data
    live: feeds.includes('timing'),
    fields: fieldList('fields') ?? base?.fields,
    settingsFields: fieldList('settingsFields') ?? base?.settingsFields,
    feeds,
    behaviours,
    ...(rowsPartner ? { rowsPartner } : {}),
    ...(previewData ? { previewData } : {})
  };
  for (const name of Object.keys(d)) {
    if (!['key', 'label', 'short', 'params', 'required', 'fields', 'settingsFields', 'feeds', 'behaviours', 'previewData', 'rowsPartner'].includes(name)) {
      warnings.push(`"${name}" is not part of a desk declaration`);
    }
  }
  return { entry, warnings };
}

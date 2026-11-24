import { DESK_BEHAVIOURS, DESK_FEEDS, DESK_PARAMS, previewDataForKind, type PreviewData } from './capabilities';
import { DESK_TEMPLATES, type DeskTemplate } from './desk';
import { fieldMapWarnings } from './fieldMap';
import type { OGrafManifest, OGrafTemplateInfo } from './types/ograf';

/** Optional manifest contract. Omitted properties inherit the known kind's defaults. */
export interface DeskDeclaration {
  key?: string;
  label?: string;
  short?: string;
  inputs?: DeskTemplate['params'];
  required?: DeskTemplate['required'];
  fields?: string[];
  settingsFields?: string[];
  feeds?: DeskTemplate['feeds'];
  behaviours?: DeskTemplate['behaviours'];
  rowsPartner?: string;
  previewData?: PreviewData | null;
  /** Timing plugin fields the graphic needs (see DeskTemplate.sourceFields) */
  sourceFields?: string[];
}

/** results[].x.<plugin>.<key> (per runner) or x.<plugin>.<key> (class / competition) */
export const SOURCE_FIELD_RE = /^(results\[\]\.)?x\.[a-z][a-z0-9-]*\.[A-Za-z_]\w*$/;

/** Invalid declarations fall back as a whole; they never prevent a graphic from loading. */
export function resolveDeskDeclaration(manifest: OGrafManifest): { desk?: DeskTemplate; warnings: string[] } {
  const result = resolveDesk(manifest);
  const mapWarnings = fieldMapWarnings((manifest as { v_olgrafik_fieldMap?: unknown }).v_olgrafik_fieldMap, manifest.schema)
    .map((w) => `v_olgrafik_fieldMap: ${w}`);
  return mapWarnings.length ? { ...result, warnings: [...result.warnings, ...mapWarnings] } : result;
}

function resolveDesk(manifest: OGrafManifest): { desk?: DeskTemplate; warnings: string[] } {
  const kind = typeof manifest.v_olgrafik_kind === 'string' ? manifest.v_olgrafik_kind : '';
  const known = DESK_TEMPLATES.find(t => t.kind === kind)
    ?? DESK_TEMPLATES.find(t => t.fallbackIds?.includes(manifest.id));
  const fallback = known ? { ...known, previewData: previewDataForKind(known.kind) } : undefined;
  const raw: unknown = manifest.v_olgrafik_desk;
  if (raw === undefined) return { desk: fallback, warnings: [] };
  const warnings: string[] = [];
  const warn = (message: string) => warnings.push(`v_olgrafik_desk: ${message}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warn('expected an object; using defaults');
    return { desk: fallback, warnings };
  }
  const d = raw as Record<string, unknown>;
  const allowed = new Set(['key', 'label', 'short', 'inputs', 'required', 'fields', 'settingsFields', 'feeds', 'behaviours', 'rowsPartner', 'previewData', 'sourceFields']);
  for (const key of Object.keys(d)) if (!allowed.has(key)) warn(`unknown property "${key}"`);
  for (const key of ['key', 'label', 'short', 'rowsPartner']) {
    if (d[key] !== undefined && (typeof d[key] !== 'string' || !(d[key] as string).trim())) warn(`${key} must be a non-empty string`);
  }
  const arrays = { inputs: DESK_PARAMS, required: DESK_PARAMS, feeds: DESK_FEEDS, behaviours: DESK_BEHAVIOURS, fields: null, settingsFields: null };
  for (const [key, values] of Object.entries(arrays)) {
    const value = d[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim() || (values && !(values as readonly string[]).includes(v))) || new Set(value).size !== value.length) {
      warn(`${key} must contain unique, supported names`);
    }
  }
  if (d.sourceFields !== undefined && (!Array.isArray(d.sourceFields) || d.sourceFields.some(f => typeof f !== 'string' || !SOURCE_FIELD_RE.test(f)))) {
    warn('sourceFields must look like "results[].x.<plugin>.<key>" or "x.<plugin>.<key>"');
  }
  if (d.previewData !== undefined && d.previewData !== null && !['results', 'splits', 'starts'].includes(d.previewData as string)) warn('unknown previewData');
  if (!known && !kind) warn('a new desk graphic needs v_olgrafik_kind');
  if (!known && (typeof d.label !== 'string' || !d.label.trim())) warn('a new desk graphic needs a label');
  if (warnings.length) return { desk: fallback, warnings };
  const declaration = d as DeskDeclaration;
  const desk: DeskTemplate = {
    ...fallback,
    key: declaration.key ?? known?.key ?? kind,
    kind: kind || known!.kind,
    label: declaration.label ?? known!.label,
    short: declaration.short ?? declaration.label ?? known!.short,
    params: declaration.inputs ?? known?.params ?? [],
    required: declaration.required ?? known?.required ?? [],
    fields: declaration.fields ?? known?.fields,
    settingsFields: declaration.settingsFields ?? known?.settingsFields,
    feeds: declaration.feeds ?? known?.feeds ?? [],
    behaviours: declaration.behaviours ?? known?.behaviours ?? [],
    rowsPartner: declaration.rowsPartner ?? known?.rowsPartner,
    ...(declaration.sourceFields?.length ? { sourceFields: declaration.sourceFields } : {}),
    previewData: declaration.previewData === null ? undefined : declaration.previewData ?? fallback?.previewData,
    live: false
  };
  desk.live = desk.feeds!.includes('timing');
  if (desk.required.some(p => !desk.params.includes(p))) warn('required inputs must also be listed in inputs');
  if (desk.behaviours!.includes('startControl') && !desk.params.includes('control')) warn('startControl needs the control input');
  if (desk.behaviours!.some(b => b === 'freeze' || b === 'followNextStarter') && !desk.params.includes('runner')) warn('freeze and followNextStarter need the runner input');
  for (const field of [...desk.fields ?? [], ...desk.settingsFields ?? []]) {
    if (!Object.prototype.hasOwnProperty.call(manifest.schema?.properties ?? {}, field)) warn(`field "${field}" is missing from schema.properties`);
  }
  return { desk: warnings.length ? fallback : desk, warnings };
}

export type DeskEntry = { def: DeskTemplate; template: OGrafTemplateInfo };

/**
 * The desk graphics of one look, by desk key. A graphic named in `replaces` (new id → replaced id,
 * from overrides.json) is left out and its key goes to the graphic that replaces it; everything
 * else in the replacing graphic's entry is its own (if it declares nothing, it takes the replaced
 * graphic's entry). Otherwise the first graphic of a key wins.
 */
export function deskEntriesForLook(templates: OGrafTemplateInfo[], replaces: Record<string, string>): Map<string, DeskEntry> {
  const defOf = (t: OGrafTemplateInfo) => t.desk ?? resolveDeskDeclaration(t.manifest).desk;
  const byId = new Map(templates.map(t => [t.manifest.id, t]));
  const replaced = new Set<string>();
  const entries = new Map<string, DeskEntry>();
  // Replacements first, so they hold the replaced graphic's key whatever the folder order
  // A graphic that is itself replaced replaces nothing (chains and cycles stay predictable)
  const targets = new Set(Object.values(replaces));
  for (const [newId, oldId] of Object.entries(replaces)) {
    if (targets.has(newId)) continue;
    const template = byId.get(newId);
    const old = byId.get(oldId);
    if (!template || !old || newId === oldId) continue;
    const oldDef = defOf(old);
    const ownDef = defOf(template);
    const def = ownDef ? { ...ownDef, key: oldDef?.key ?? ownDef.key } : oldDef;
    replaced.add(oldId);
    if (def && !entries.has(def.key)) entries.set(def.key, { def, template });
  }
  for (const template of templates) {
    if (replaced.has(template.manifest.id) || [...entries.values()].some(e => e.template === template)) continue;
    const def = defOf(template);
    if (def && !entries.has(def.key)) entries.set(def.key, { def, template });
  }
  return entries;
}

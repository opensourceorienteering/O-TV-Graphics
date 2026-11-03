import { DESK_BEHAVIOURS, DESK_FEEDS, DESK_PARAMS, previewDataForKind, type PreviewData } from './capabilities';
import { DESK_TEMPLATES, type DeskTemplate } from './desk';
import type { OGrafManifest } from './types/ograf';

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
}

/** Invalid declarations fall back as a whole; they never prevent a graphic from loading. */
export function resolveDeskDeclaration(manifest: OGrafManifest): { desk?: DeskTemplate; warnings: string[] } {
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
  const allowed = new Set(['key', 'label', 'short', 'inputs', 'required', 'fields', 'settingsFields', 'feeds', 'behaviours', 'rowsPartner', 'previewData']);
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

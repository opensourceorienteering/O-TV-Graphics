/**
 * Settings export / import: an operator's setup as one JSON file they can take to another
 * event or computer. Parts: output (app-wide), theme (event look + presentation) and
 * templates (event template settings + desk command numbers).
 */

import { getConfig, saveConfig, type AppConfig } from '../utils/config';
import { liveOutputsFor, loadEvent, updateEvent } from './EventService';
import { loadDeskCommands, saveDeskCommands } from './Desk';
import type { DeskCommandMap, DeskTemplateSettingsMap } from '../../shared/desk';
import type { ProjectPresentation } from '../../shared/types/spx';
import type { EventLiveOutputs } from '../../shared/types/event';

export type SettingsPart = 'output' | 'theme' | 'templates';
export const SETTINGS_PARTS: SettingsPart[] = ['output', 'theme', 'templates'];

export interface SettingsFile {
  app: 'Split Control';
  kind: 'settings';
  version: 1;
  exportedAt: string;
  /** Event the file was exported from (information only) */
  from?: string;
  output?: {
    resolution: AppConfig['general']['resolution'];
    ndi: Pick<AppConfig['output']['ndi'], 'enabled' | 'name' | 'fps' | 'colorFormat'>;
    web: AppConfig['output']['web'];
    /** The event's outputs in Live (absent in files from older versions) */
    live?: EventLiveOutputs;
  };
  theme?: { templateSet?: string; presentation?: ProjectPresentation };
  templates?: { settings: DeskTemplateSettingsMap; commands: DeskCommandMap; order?: string[] };
}

export async function buildSettingsExport(projectId: string, parts: SettingsPart[] = SETTINGS_PARTS): Promise<SettingsFile> {
  const project = await loadEvent(projectId);
  const config = getConfig();
  const file: SettingsFile = { app: 'Split Control', kind: 'settings', version: 1, exportedAt: new Date().toISOString(), from: project.name };
  if (parts.includes('output')) {
    const { enabled, name, fps, colorFormat } = config.output.ndi;
    file.output = {
      resolution: config.general.resolution, ndi: { enabled, name, fps, colorFormat }, web: { ...config.output.web },
      live: liveOutputsFor(project)
    };
  }
  if (parts.includes('theme')) file.theme = { templateSet: project.templateSet, presentation: project.settings?.presentation ?? {} };
  if (parts.includes('templates'))
    file.templates = { settings: project.settings?.templates ?? {}, commands: loadDeskCommands(), order: project.settings?.templateOrder };
  return file;
}

/** Check a parsed file before anything is applied; returns the parts it holds */
export function readSettingsFile(raw: unknown): { file: SettingsFile; parts: SettingsPart[] } {
  const file = raw as SettingsFile;
  if (!file || typeof file !== 'object' || file.app !== 'Split Control' || file.kind !== 'settings')
    throw new Error('This is not a Split Control settings file');
  if (file.version !== 1) throw new Error(`Settings file version ${String(file.version)} is not supported`);
  const parts = SETTINGS_PARTS.filter(p => file[p] !== undefined);
  if (!parts.length) throw new Error('The settings file is empty');
  return { file, parts };
}

/** Apply the chosen parts of a settings file to an event (and the app, for output) */
export async function applySettingsImport(projectId: string, raw: unknown, only?: SettingsPart[]) {
  const { file, parts } = readSettingsFile(raw);
  const apply = only?.length ? parts.filter(p => only.includes(p)) : parts;
  let requiresRestart = false;
  if (apply.includes('output') && file.output) {
    const current = getConfig();
    const o = file.output;
    const next: AppConfig = {
      ...current,
      general: { ...current.general, ...(o.resolution ? { resolution: o.resolution } : {}) },
      output: {
        ndi: { ...current.output.ndi, ...pick(o.ndi, ['enabled', 'name', 'fps', 'colorFormat']) },
        web: { ...current.output.web, ...pick(o.web, ['enabled', 'cors']) }
      }
    };
    requiresRestart = next.general.resolution !== current.general.resolution || next.output.web.enabled !== current.output.web.enabled;
    await saveConfig(next);
  }
  const project = await loadEvent(projectId);
  const settings = { ...(project.settings ?? {}) };
  let templateSet = project.templateSet;
  if (apply.includes('theme') && file.theme) {
    if (file.theme.templateSet) templateSet = file.theme.templateSet;
    if (file.theme.presentation) settings.presentation = file.theme.presentation;
  }
  if (apply.includes('templates') && file.templates) {
    settings.templates = file.templates.settings ?? {};
    if (Array.isArray(file.templates.order)) settings.templateOrder = file.templates.order.filter((k) => typeof k === 'string');
    if (file.templates.commands && Object.keys(file.templates.commands).length) saveDeskCommands(file.templates.commands);
  }
  if (apply.includes('theme') || apply.includes('templates')) await updateEvent(projectId, { templateSet, settings });
  if (apply.includes('output') && file.output?.live)
    await updateEvent(projectId, { liveOutputs: { web: !!file.output.live.web, ndi: !!file.output.live.ndi } });
  return { applied: apply, requiresRestart };
}

function pick<T extends object>(obj: T | undefined, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (obj && obj[k] !== undefined) out[k] = obj[k];
  return out;
}

/** What the Graphics library shows: looks, graphics needing attention, and search across looks */
import { CUSTOM_TEMPLATE_SET, SYSTEM_TEMPLATE_SET } from '../../../shared/types/ograf';
import type { OGrafTemplateInfo, TemplateSetInfo } from '../../../shared/types/ograf';

export interface LookCard {
  set: TemplateSetInfo;
  graphics: OGrafTemplateInfo[];
}

const byName = (a: OGrafTemplateInfo, b: OGrafTemplateInfo) => a.manifest.name.localeCompare(b.manifest.name);

/** Every look, built-in first then imported, each by name, with its graphics by name */
export function lookCards(sets: TemplateSetInfo[], templates: OGrafTemplateInfo[]): LookCard[] {
  return sets
    .filter((s) => s.id !== CUSTOM_TEMPLATE_SET && s.id !== SYSTEM_TEMPLATE_SET)
    .sort((a, b) => Number(a.source === 'imported') - Number(b.source === 'imported') || a.name.localeCompare(b.name))
    .map((set) => ({ set, graphics: templates.filter((t) => t.setId === set.id).sort(byName) }));
}

/** Graphics Live can't offer as they are: outside any look, or with a desk declaration problem */
export function needsAttention(templates: OGrafTemplateInfo[]): OGrafTemplateInfo[] {
  return templates.filter((t) => t.setId === CUSTOM_TEMPLATE_SET || (t.deskWarnings?.length ?? 0) > 0).sort(byName);
}

/** Graphics in any look matching name, description or id; each with the name of its look */
export function searchGraphics(
  templates: OGrafTemplateInfo[],
  sets: TemplateSetInfo[],
  query: string,
): Array<{ template: OGrafTemplateInfo; lookName: string }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return templates
    .filter((t) => `${t.manifest.name} ${t.description || ''} ${t.manifest.id}`.toLowerCase().includes(needle))
    .sort(byName)
    .map((template) => ({
      template,
      lookName: template.setId === CUSTOM_TEMPLATE_SET ? 'Not in a look' : sets.find((s) => s.id === template.setId)?.name ?? template.setId,
    }));
}

/** Technical details of a graphic (label, value); the ID is what OGraf Server API controllers use */
export function graphicDetails(template: OGrafTemplateInfo): Array<[string, string]> {
  const { id, version, author } = template.manifest;
  return [
    ['ID', id],
    ...(version ? [['Version', version] as [string, string]] : []),
    ...(author?.name ? [['Author', author.name] as [string, string]] : []),
  ];
}

/**
 * Template set rules: a project uses exactly one set, so graphics from different sets
 * (different looks) can never be mixed in one production.
 */

import { SYSTEM_TEMPLATE_SET, type OGrafTemplateInfo } from '../../shared/types/ograf';
import { DEFAULT_TEMPLATE_SET, type SPXProject } from '../../shared/types/spx';

/** Semantic roles for the original Classic graphics (from before v_olgrafik_kind), still
 * understood when such a look is imported. */
const LEGACY_GRAPHIC_KINDS: Record<string, string> = {
  'countdown-timer': 'clock',
  'results-list-paginated': 'results',
  'split-time-lower-third': 'standings-lower-third',
  'split-time-lower-third-runner': 'runner-lower-third'
};

/** A project's look; projects from before looks existed get the default look */
export function projectTemplateSet(project: Pick<SPXProject, 'templateSet'> | null | undefined): string {
  return project?.templateSet || DEFAULT_TEMPLATE_SET;
}

/** The style-independent role represented by a concrete graphic template. */
export function templateGraphicKind(template: Pick<OGrafTemplateInfo, 'manifest'> | null | undefined): string | undefined {
  if (!template) return undefined;
  const declared = template.manifest.v_olgrafik_kind;
  return typeof declared === 'string' && declared.trim()
    ? declared.trim()
    : LEGACY_GRAPHIC_KINDS[template.manifest.id];
}

/** Find the concrete graphic for a semantic role in a particular look. */
export function templateForGraphicKind(
  templates: OGrafTemplateInfo[],
  setId: string,
  graphicKind: string
): OGrafTemplateInfo | undefined {
  return templates.find(
    (template) => template.setId === setId && templateGraphicKind(template) === graphicKind
  );
}

/** Throws a readable error when a graphic is not part of the project's set */
export function assertTemplateInProjectSet(project: Pick<SPXProject, 'templateSet' | 'name'>, template: OGrafTemplateInfo): void {
  const setId = projectTemplateSet(project);
  // system tools (the output test pattern) work with every look
  if (template.setId === SYSTEM_TEMPLATE_SET) return;
  if (template.setId !== setId) {
    throw new Error(
      `"${template.manifest.name}" belongs to the "${template.setId}" template set, but project "${project.name}" uses "${setId}". ` +
      'Graphics from different sets cannot be mixed; pick a graphic from the project\'s set or change the project\'s set.'
    );
  }
}

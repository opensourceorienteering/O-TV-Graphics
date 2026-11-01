import type { EventFolder } from "../../shared/types/event";
import type { SPXProject, ProjectPresentation } from "../../shared/types/spx";
import { DEFAULT_TEMPLATE_SET } from "../../shared/types/spx";
const branding = ["logoUrl", "sponsorLogos"] as const;
const look = [
  "language",
  "international",
  "identity",
  "clubLogos",
  "clearClashing",
] as const;
const infoKeys = ["organiser", "series", "timeZone"] as const;
function copyKeys<T extends object>(
  target: T,
  source: Partial<T>,
  keys: readonly (keyof T)[],
): T {
  const result = { ...target };
  for (const key of keys) {
    if (source[key] === undefined) delete result[key];
    else result[key] = source[key] as T[keyof T];
  }
  return result;
}
export function inheritFolder(
  project: SPXProject,
  folder: EventFolder | undefined,
): SPXProject {
  if (!folder?.defaults || !project.folderInheritance) return project;
  const next = {
    ...project,
    settings: { ...project.settings },
    info: { ...project.info },
  };
  const defaults = folder.defaults;
  let presentation = { ...project.settings?.presentation };
  if (project.folderInheritance.look) {
    next.templateSet = defaults.templateSet || DEFAULT_TEMPLATE_SET;
    presentation = copyKeys(
      presentation,
      (defaults.presentation as ProjectPresentation) || {},
      look,
    );
  }
  if (project.folderInheritance.branding)
    presentation = copyKeys(
      presentation,
      (defaults.presentation as ProjectPresentation) || {},
      branding,
    );
  next.settings.presentation = presentation;
  if (project.folderInheritance.info)
    next.info = copyKeys(next.info, defaults.info || {}, infoKeys);
  if (project.folderInheritance.data) {
    const source = defaults.dataSource;
    const changed =
      source?.sourceId !== project.dataSource?.sourceId ||
      (source?.baseUrl || "") !== (project.dataSource?.baseUrl || "");
    next.dataSource = source?.sourceId
      ? {
          ...(!changed ? project.dataSource : {}),
          sourceId: source.sourceId,
          baseUrl: source.baseUrl,
        }
      : { sourceId: "" };
  }
  return next;
}
export function breakChangedInheritance(
  current: SPXProject,
  updates: Partial<SPXProject>,
): SPXProject["folderInheritance"] {
  const links = { ...current.folderInheritance, ...updates.folderInheritance };
  const changed = (a: unknown, b: unknown) =>
    JSON.stringify(a) !== JSON.stringify(b);
  const p = updates.settings?.presentation;
  if (
    updates.templateSet !== undefined &&
    updates.templateSet !== current.templateSet
  )
    links.look = false;
  if (p && look.some((k) => changed(p[k], current.settings?.presentation?.[k])))
    links.look = false;
  if (
    p &&
    branding.some((k) => changed(p[k], current.settings?.presentation?.[k]))
  )
    links.branding = false;
  if (
    updates.info &&
    infoKeys.some(
      (k) => k in updates.info! && changed(updates.info![k], current.info?.[k]),
    )
  )
    links.info = false;
  if (
    updates.dataSource &&
    (updates.dataSource.sourceId !== current.dataSource?.sourceId ||
      (updates.dataSource.baseUrl || "") !==
        (current.dataSource?.baseUrl || ""))
  )
    links.data = false;
  return { ...links, ...updates.folderInheritance };
}

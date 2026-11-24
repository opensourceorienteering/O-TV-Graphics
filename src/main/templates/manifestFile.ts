/**
 * Which file in a graphic folder is its OGraf manifest.
 *
 * The OGraf spec allows any `*.ograf.json` name; OGraf Studio, for example, writes
 * `project-<uuid>-rt.ograf.json`. Order: `<folder>.ograf.json`, then the legacy
 * `manifest.json`, then the folder's only `*.ograf.json`. Two or more other manifests are
 * ambiguous, and the folder is skipped.
 */
export type ManifestPick = { file: string } | { ambiguous: string[] } | null;

export function pickManifestFile(folder: string, fileNames: string[]): ManifestPick {
  if (fileNames.includes(`${folder}.ograf.json`)) return { file: `${folder}.ograf.json` };
  if (fileNames.includes('manifest.json')) return { file: 'manifest.json' };
  const others = fileNames.filter((f) => f.endsWith('.ograf.json')).sort();
  if (others.length === 1) return { file: others[0] };
  if (others.length > 1) return { ambiguous: others };
  return null;
}

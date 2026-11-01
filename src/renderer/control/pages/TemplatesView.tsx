import { t as tr } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  FolderOpen,
  Package,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useToast } from "../contexts/ToastContext";
import type {
  OGrafTemplateInfo,
  TemplateSetInfo,
} from "../../../shared/types/ograf";

/** Every look as a zip, on the website */
const LOOKS_URL = "https://opensourceorienteering.github.io/O-TV-Graphics/looks.html";

interface ImportPreview {
  looks: Array<{ id: string; name: string; graphics: number; replaces?: "imported" | "built-in" }>;
  graphics: Array<{ id: string; name: string; replaces?: boolean }>;
}

/** The confirmation shown before an import, in plain words */
function importQuestion(preview: ImportPreview): string {
  const lines = [
    ...preview.looks.map((look) =>
      look.replaces === "built-in"
        ? `${look.name}: ${tr("replaces the built-in look")}`
        : look.replaces === "imported"
          ? `${look.name}: ${tr("replaces the imported look")}`
          : `${look.name}: ${tr("new look")} (${look.graphics} ${tr("graphics")})`,
    ),
    ...preview.graphics.map(
      (g) => `${g.name}: ${g.replaces ? tr("replaces the imported graphic") : tr("new graphic")}`,
    ),
  ];
  return `${tr("Import this zip?")}\n\n${lines.join("\n")}`;
}

export function TemplatesView() {
  const [templates, setTemplates] = useState<OGrafTemplateInfo[]>([]);
  const [sets, setSets] = useState<TemplateSetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [setId, setSetId] = useState("all");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const loadTemplates = async (reload = false) => {
    setLoading(true);
    setError("");
    try {
      if (reload) {
        const refreshed = await window.electronAPI.invoke("templates:reload");
        if (!refreshed.success)
          throw new Error(
            refreshed.error || "Unable to scan the graphics library.",
          );
      }
      const [result, setResult] = await Promise.all([
        window.electronAPI.invoke("templates:getAll"),
        window.electronAPI.invoke("templates:getSets"),
      ]);
      if (!result.success)
        throw new Error(result.error || "Unable to load the graphics library.");
      setTemplates(result.templates || []);
      if (setResult?.success) setSets(setResult.sets || []);
    } catch (cause) {
      const detail =
        cause instanceof Error
          ? cause.message
          : "Unable to load the graphics library.";
      setError(`${detail} Check the templates folder, then scan again.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTemplates();
  }, []);

  const importLook = async () => {
    setBusy(true);
    try {
      const picked = await window.electronAPI.invoke("templates:pickImport");
      if (!picked.success) throw new Error(picked.error);
      if (picked.cancelled) return;
      if (!confirm(importQuestion(picked.preview))) return;
      const result = await window.electronAPI.invoke("templates:import", picked.filePath);
      if (!result.success) throw new Error(result.error);
      const names = [
        ...result.preview.looks.map((l: { name: string }) => l.name),
        ...result.preview.graphics.map((g: { name: string }) => g.name),
      ].join(", ");
      toast.showToast("success", `${tr("Imported")}: ${names}`);
      await loadTemplates();
    } catch (cause) {
      toast.showToast("error", `${tr("Import failed")}: ${cause instanceof Error ? cause.message : String(cause)}`, 10000);
    } finally {
      setBusy(false);
    }
  };

  const exportLook = async (set: TemplateSetInfo) => {
    setBusy(true);
    try {
      const result = await window.electronAPI.invoke("templates:exportSet", set.id);
      if (!result.success) throw new Error(result.error);
      if (!result.cancelled) toast.showToast("success", `${tr("Look exported")}: ${result.filePath}`);
    } catch (cause) {
      toast.showToast("error", `${tr("Export failed")}: ${cause instanceof Error ? cause.message : String(cause)}`, 10000);
    } finally {
      setBusy(false);
    }
  };

  const removeLook = async (set: TemplateSetInfo) => {
    const usage = await window.electronAPI.invoke("templates:setUsage", set.id);
    const events: string[] = usage?.success ? usage.events : [];
    const message = [
      set.replacesBuiltIn
        ? `${tr("Remove the imported")} ${set.name}? ${tr("The built-in look is used again.")}`
        : `${tr("Remove the imported")} ${set.name}?`,
      !set.replacesBuiltIn && events.length
        ? `${tr("These events use it and need another look before they go live:")} ${events.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!confirm(message)) return;
    setBusy(true);
    try {
      const result = await window.electronAPI.invoke("templates:removeSet", set.id);
      if (!result.success) throw new Error(result.error);
      toast.showToast("success", `${tr("Look removed")}: ${set.name}`);
      if (setId === set.id && !set.replacesBuiltIn) setSetId("all");
      await loadTemplates();
    } catch (cause) {
      toast.showToast("error", cause instanceof Error ? cause.message : String(cause), 10000);
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter(
      (template) =>
        (setId === "all" || template.setId === setId) &&
        (!needle ||
          `${template.manifest.name} ${template.description || ""} ${template.manifest.id}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [query, setId, templates]);

  const visibleSets = sets.length
    ? sets
    : [
        {
          id: "",
          name: "Graphics",
          templateCount: templates.length,
        } as TemplateSetInfo,
      ];

  return (
    <div className="library-screen">
      <header className="utility-heading">
        <div>
          <p className="eyebrow">{tr("Shared resources")}</p>
          <h1>{tr("Graphics library")}</h1>
          <p>{tr("Browse the graphics available when you prepare an event.")}</p>
        </div>
        <div className="row wrap">
          <button
            className="studio-button primary"
            onClick={() => void importLook()}
            disabled={busy || loading}
            title={tr("Install a look or OGraf graphic from a zip file")}
          >
            <Upload size={16} aria-hidden="true" />
            {tr("Import look…")}
          </button>
          <button
            className="studio-button"
            onClick={() =>
              void window.electronAPI.invoke("window:openExternal", LOOKS_URL).catch(() => undefined)
            }
            title={LOOKS_URL}
          >
            <ExternalLink size={16} aria-hidden="true" />
            {tr("Get more looks")}
          </button>
          <button
            className="studio-button"
            onClick={() => void window.electronAPI.invoke("templates:openFolder").catch(() => undefined)}
            title={tr("Imported looks and graphics are kept in this folder")}
          >
            <FolderOpen size={16} aria-hidden="true" />
            {tr("Open folder")}
          </button>
          <button
            className="studio-button"
            onClick={() => void loadTemplates(true)}
            disabled={loading}
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={loading ? "icon-spin" : ""}
            />
            {loading ? "Scanning…" : tr("Scan library")}
          </button>
        </div>
      </header>

      {error && (
        <div className="studio-error" role="alert">
          {error}
        </div>
      )}

      <div className="library-toolbar studio-panel">
        <label className="search-field">
           {tr("Find a graphic")} <span className="input-with-icon">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tr("Name or ID")}
            />
          </span>
        </label>
        <label>
           {tr("Graphic set")} <select
            value={setId}
            onChange={(event) => setSetId(event.target.value)}
          >
            <option value="all">{tr("All sets")}</option>
            {sets.map((set) => (
              <option key={set.id} value={set.id}>
                {set.name}
              </option>
            ))}
          </select>
        </label>
        <p className="library-count" role="status">
          {shown.length} {shown.length === 1 ? "graphic" : tr("graphics")}
        </p>
      </div>

      {loading && !templates.length ? (
        <div className="screen-state" role="status">
          <RefreshCw className="icon-spin" aria-hidden="true" />
          <p>{tr("Loading graphics…")}</p>
        </div>
      ) : shown.length ? (
        <div className="template-groups">
          {(setId === "all"
            ? visibleSets
            : visibleSets.filter((set) => set.id === setId)
          ).map((set) => {
            const group = shown.filter(
              (template) => !set.id || template.setId === set.id,
            );
            if (!group.length) return null;
            return (
              <section className="template-group" key={set.id || "all"}>
                <div className="template-group-heading">
                  <div>
                    <h2>
                      {set.name}{" "}
                      {set.source && (
                        <span className="look-source">
                          {set.source === "imported"
                            ? set.replacesBuiltIn
                              ? tr("Imported · replaces built-in")
                              : tr("Imported")
                            : tr("Built in")}
                        </span>
                      )}
                    </h2>
                    {set.description && <p>{set.description}</p>}
                  </div>
                  <div className="look-actions">
                    <span>{group.length}  {tr("graphics")}</span>
                    {set.source && (
                      <button
                        className="studio-button"
                        onClick={() => void exportLook(set)}
                        disabled={busy}
                        title={tr("Save this look as a zip file, to share it or use it on another computer")}
                      >
                        <Download size={15} aria-hidden="true" />
                        {tr("Export…")}
                      </button>
                    )}
                    {set.source === "imported" && (
                      <button
                        className="studio-button"
                        onClick={() => void removeLook(set)}
                        disabled={busy}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                        {tr("Remove")}
                      </button>
                    )}
                  </div>
                </div>
                <div className="template-grid">
                  {group.map((template) => (
                    <article
                      className="template-card"
                      key={template.manifest.id}
                    >
                      <div className="template-card-heading">
                        <h3>{template.manifest.name}</h3>
                        <span>v{template.manifest.version}</span>
                      </div>
                      <p>
                        {template.description ||
                          template.manifest.description ||
                          "Graphic template"}
                      </p>
                      <div className="template-badges">
                        {(template as any).dataSourceConfig && (
                          <span>{tr("Timing data")}</span>
                        )}
                        {template.manifest.stepCount !== undefined && (
                          <span>
                            {template.manifest.stepCount === -1
                              ? tr("Dynamic pages")
                              : template.manifest.stepCount === 0
                                ? tr("Automatic")
                                : template.manifest.stepCount === 1
                                  ? tr("Single step")
                                  : `${template.manifest.stepCount} steps`}
                          </span>
                        )}
                      </div>
                      <details>
                        <summary>{tr("Technical details")}</summary>
                        <dl>
                          <div>
                            <dt>{tr("ID")}</dt>
                            <dd>
                              <code>{template.manifest.id}</code>
                            </dd>
                          </div>
                          {template.manifest.author && (
                            <div>
                              <dt>{tr("Author")}</dt>
                              <dd>{template.manifest.author.name}</dd>
                            </div>
                          )}
                        </dl>
                      </details>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="screen-state studio-panel">
          <Package size={36} aria-hidden="true" />
          <h2>
            {templates.length ? tr("No matching graphics") : tr("No graphics found")}
          </h2>
          <p>
            {templates.length
              ? tr("Change the search or graphic-set filter.")
              : tr("Import a look, or add an OGraf package to the templates folder, then scan the library.")}
          </p>
          {templates.length ? (
            <button
              className="studio-button"
              onClick={() => {
                setQuery("");
                setSetId("all");
              }}
            >
               {tr("Clear filters")} </button>
          ) : (
            <button
              className="studio-button primary"
              onClick={() => void loadTemplates(true)}
            >
               {tr("Scan library")} </button>
          )}
        </div>
      )}
    </div>
  );
}

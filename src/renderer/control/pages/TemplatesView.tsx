import { t as tr } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { Package, RefreshCw, Search } from "lucide-react";
import type {
  OGrafTemplateInfo,
  TemplateSetInfo,
} from "../../../shared/types/ograf";

export function TemplatesView() {
  const [templates, setTemplates] = useState<OGrafTemplateInfo[]>([]);
  const [sets, setSets] = useState<TemplateSetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [setId, setSetId] = useState("all");

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
                    <h2>{set.name}</h2>
                    {set.description && <p>{set.description}</p>}
                  </div>
                  <span>{group.length}  {tr("graphics")}</span>
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
              : tr("Add an OGraf package to the templates folder, then scan the library.")}
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

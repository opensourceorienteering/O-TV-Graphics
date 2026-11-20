import { t as tr } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FolderOpen,
  Package,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { LibraryHome } from "../library/LibraryHome";
import { LookPage } from "../library/LookPage";
import { lookCards, needsAttention, searchGraphics } from "../library/libraryModel";
import "../library/library.css";
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
  /** The look whose page is open (and the graphic to select), or null for the looks */
  const [open, setOpen] = useState<{ lookId: string; templateId?: string } | null>(null);
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
      if (open?.lookId === set.id && !set.replacesBuiltIn) setOpen(null);
      await loadTemplates();
    } catch (cause) {
      toast.showToast("error", cause instanceof Error ? cause.message : String(cause), 10000);
    } finally {
      setBusy(false);
    }
  };

  const cards = useMemo(() => lookCards(sets, templates), [sets, templates]);
  const needs = useMemo(() => needsAttention(templates), [templates]);
  const results = useMemo(
    () => (query.trim() ? searchGraphics(templates, sets, query) : null),
    [query, sets, templates],
  );
  const openCard = open ? cards.find((c) => c.set.id === open.lookId) : undefined;

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

      {!openCard && (
        <div className="library-toolbar studio-panel">
          <label className="search-field">
            {tr("Find a graphic")}{" "}
            <span className="input-with-icon">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tr("Name or ID")}
              />
            </span>
          </label>
          <p className="library-count" role="status">
            {cards.length} {cards.length === 1 ? tr("look") : tr("looks")}
          </p>
        </div>
      )}

      {loading && !templates.length ? (
        <div className="screen-state" role="status">
          <RefreshCw className="icon-spin" aria-hidden="true" />
          <p>{tr("Loading graphics…")}</p>
        </div>
      ) : openCard ? (
        <LookPage
          key={openCard.set.id}
          card={openCard}
          initialTemplateId={open?.templateId}
          busy={busy}
          onBack={() => setOpen(null)}
          onExport={() => void exportLook(openCard.set)}
          onRemove={() => void removeLook(openCard.set)}
        />
      ) : cards.length || needs.length ? (
        <LibraryHome
          cards={cards}
          needs={needs}
          results={results}
          onOpen={(lookId, templateId) => {
            setQuery("");
            setOpen({ lookId, templateId });
          }}
        />
      ) : (
        <div className="screen-state studio-panel">
          <Package size={36} aria-hidden="true" />
          <h2>{tr("No graphics found")}</h2>
          <p>
            {tr("Import a look, or add an OGraf package to the templates folder, then scan the library.")}
          </p>
          <button className="studio-button primary" onClick={() => void loadTemplates(true)}>
            {tr("Scan library")}
          </button>
        </div>
      )}
    </div>
  );
}

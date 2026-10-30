import { t as tr } from "../i18n";
import { useState } from "react";
import { call } from "./api";

type Part = "output" | "theme" | "templates";
const PARTS: [Part, string, string][] = [
  ["output", "Output", "Resolution, NDI name and frame rate, web output (app-wide)"],
  ["theme", "Theme", "Look, colours, logos, language and identity rules of this event"],
  ["templates", "Templates", "These template settings and the command numbers"],
];

/** Final review: take this event's setup to another event or computer as one JSON file */
export function SettingsTransferCard({ eventId, onImported }: { eventId: string; onImported: () => void }) {
  const [exportParts, setExportParts] = useState<Part[]>(["output", "theme", "templates"]);
  const [pending, setPending] = useState<{ file: any; parts: Part[]; path: string; chosen: Part[] }>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const exportFile = () =>
    run(async () => {
      const res = await call<{ saved: string | null }>("event:exportSettings", eventId, exportParts);
      if (res.saved) setNotice(`Exported to ${res.saved}`);
    });
  const pickImport = () =>
    run(async () => {
      const res = await call<{ file: any; parts: Part[]; path: string } | null>("event:pickSettingsFile");
      if (res) setPending({ ...res, chosen: res.parts });
    });
  const applyImport = () =>
    run(async () => {
      if (!pending) return;
      const res = await call<{ applied: Part[]; requiresRestart: boolean }>("event:importSettings", eventId, pending.file, pending.chosen);
      setPending(undefined);
      setNotice(`Imported ${res.applied.join(", ")}${res.requiresRestart ? " · restart Split Control to apply the output changes" : ""}`);
      onImported();
    });

  return (
    <>
      <section className="connection-card">
        {error && <p role="alert" className="studio-error">{error}</p>}
        {notice && <p role="status">{tr(notice)}</p>}
        <div className="connection-card-heading">
          <div>
            <h3>{tr("Export / import settings")}</h3>
            <p>{tr("Take your setup to another event or computer as one JSON file.")}</p>
          </div>
        </div>
        <div className="part-checks">
          {PARTS.map(([id, label, hint]) => (
            <label key={id} className="inline-check" title={tr(hint)}>
              <input
                type="checkbox"
                checked={exportParts.includes(id)}
                onChange={(e) => setExportParts((p) => (e.target.checked ? [...p, id] : p.filter((x) => x !== id)))}
              />
              {tr(label)}
            </label>
          ))}
        </div>
        <div className="form-actions">
          <button type="button" className="studio-button" disabled={busy || !exportParts.length} onClick={() => void exportFile()}>
            {tr("Export settings…")}
          </button>
          <button type="button" className="studio-button" disabled={busy} onClick={() => void pickImport()}>
            {tr("Import settings…")}
          </button>
        </div>
        {pending && (
          <div className="import-review" role="group" aria-label={tr("Import")}>
            <p>
              <b>{pending.path.split(/[\\/]/).pop()}</b>
              {pending.file.from ? ` · ${tr("from")} ${pending.file.from}` : ""}
              {pending.file.exportedAt ? ` · ${new Date(pending.file.exportedAt).toLocaleString()}` : ""}
            </p>
            <div className="part-checks">
              {PARTS.filter(([id]) => pending.parts.includes(id)).map(([id, label, hint]) => (
                <label key={id} className="inline-check" title={tr(hint)}>
                  <input
                    type="checkbox"
                    checked={pending.chosen.includes(id)}
                    onChange={(e) =>
                      setPending((p) => p && { ...p, chosen: e.target.checked ? [...p.chosen, id] : p.chosen.filter((x) => x !== id) })
                    }
                  />
                  {tr(label)}
                </label>
              ))}
            </div>
            <p className="muted">{tr("Importing replaces those settings for this event. Output settings apply to the whole app.")}</p>
            <div className="form-actions">
              <button type="button" className="studio-button primary" disabled={busy || !pending.chosen.length} onClick={() => void applyImport()}>
                {tr("Import")}
              </button>
              <button type="button" className="studio-button" onClick={() => setPending(undefined)}>{tr("Cancel")}</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

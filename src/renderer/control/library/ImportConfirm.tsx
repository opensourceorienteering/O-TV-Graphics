/**
 * The confirmation before importing a look or graphic: what it adds or replaces, the warning
 * that looks contain code, and the internet addresses its graphics ask for (each can be allowed).
 */
import { t as tr } from "../i18n";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import "../components/DataSourceManager.css";

export interface ImportPreview {
  looks: Array<{ id: string; name: string; graphics: number; replaces?: "imported" | "built-in" }>;
  graphics: Array<{ id: string; name: string; replaces?: boolean }>;
  /** Graphics added to a look; lookName is null when this computer doesn't have the look */
  additions?: Array<{ lookId: string; lookName: string | null; graphics: number }>;
  internet?: string[];
  internetRefused?: Array<{ input: string; reason: string }>;
}

/** One line per look or graphic, in plain words */
export function importLines(preview: ImportPreview): string[] {
  return [
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
    ...(preview.additions ?? []).map((a) =>
      a.lookName
        ? `${a.lookName}: ${tr("adds graphics to this look")} (${a.graphics})`
        : `${a.lookId}: ${tr("adds graphics to a look this computer doesn't have. They appear under Needs attention.")} (${a.graphics})`,
    ),
  ];
}

export function ImportConfirm({
  preview,
  onConfirm,
  onCancel,
}: {
  preview: ImportPreview;
  /** Called with the internet addresses the operator agreed to allow */
  onConfirm: (allow: string[]) => void;
  onCancel: () => void;
}) {
  const asked = preview.internet ?? [];
  const [allow, setAllow] = useState<string[]>(asked);
  const toggle = (origin: string) =>
    setAllow((list) => (list.includes(origin) ? list.filter((o) => o !== origin) : [...list, origin]));

  return (
    <div className="modal-overlay" onClick={onCancel} onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 id="import-confirm-title">{tr("Import this file?")}</h3>
          <button className="icon-button" aria-label={tr("Cancel")} onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <ul>
            {importLines(preview).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="studio-warning" role="note">
            <AlertTriangle size={15} aria-hidden="true" />{" "}
            {tr("Looks contain code. Only import looks from people you trust.")}
          </p>
          {asked.length > 0 && (
            <fieldset>
              <legend>{tr("These graphics ask for internet access. Allow these addresses for graphics:")}</legend>
              {asked.map((origin) => (
                <label key={origin} className="row">
                  <input type="checkbox" checked={allow.includes(origin)} onChange={() => toggle(origin)} />{" "}
                  <code>{origin}</code>
                </label>
              ))}
              <p className="muted">{tr("You can change this later in Settings → Internet access.")}</p>
            </fieldset>
          )}
          {(preview.internetRefused?.length ?? 0) > 0 && (
            <div>
              <p>{tr("These addresses were asked for but can't be allowed, so graphics won't reach them:")}</p>
              <ul>
                {preview.internetRefused!.map((r) => (
                  <li key={r.input}>
                    <code>{r.input}</code> — {tr(r.reason)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="studio-button" onClick={onCancel}>
            {tr("Cancel")}
          </button>
          <button className="studio-button primary" autoFocus onClick={() => onConfirm(allow)}>
            {tr("Import")}
          </button>
        </div>
      </div>
    </div>
  );
}

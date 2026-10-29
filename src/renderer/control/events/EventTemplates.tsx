import { t as tr } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import {
  DESK_TEMPLATES,
  liveUpdatesDefault,
  type DeskCommandMap,
  type DeskTemplateSettings,
  type DeskTemplateSettingsMap,
} from "../../../shared/desk";
import type { SPXProject } from "../../../shared/types/spx";
import { call } from "./api";

type TemplateInfo = (typeof DESK_TEMPLATES)[number] & {
  templateId: string | null;
  available: boolean;
  schema: Record<string, any>;
};
type Part = "output" | "theme" | "templates";
const PARTS: [Part, string, string][] = [
  ["output", "Output", "Resolution, NDI name and frame rate, web output (app-wide)"],
  ["theme", "Theme", "Look, colours, logos, language and identity rules of this event"],
  ["templates", "Templates", "These template settings and the command numbers"],
];

/** Settings → Templates: per-graphic defaults, visibility in Live, numbers, export / import */
export function EventTemplates({
  eventId,
  event,
  onSaved,
  onDirtyChange,
}: {
  eventId: string;
  event: SPXProject;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [settings, setSettings] = useState<DeskTemplateSettingsMap>(event.settings?.templates ?? {});
  const [nums, setNums] = useState<Record<string, string>>({});
  const [open, setOpen] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportParts, setExportParts] = useState<Part[]>(["output", "theme", "templates"]);
  const [pending, setPending] = useState<{ file: any; parts: Part[]; path: string; chosen: Part[] }>();

  useEffect(() => {
    Promise.all([call<TemplateInfo[]>("desk:templates", eventId), call<DeskCommandMap>("desk:commands")])
      .then(([list, map]) => {
        setTemplates(list);
        setNums(Object.fromEntries(list.map((t) => [t.key, Object.entries(map).find(([, k]) => k === t.key)?.[0] ?? ""])));
      })
      .catch((e) => setError(e.message));
  }, [eventId, event.templateSet]);
  useEffect(() => setSettings(event.settings?.templates ?? {}), [event.settings?.templates]);
  useEffect(() => onDirtyChange(dirty), [dirty]);

  const change = (key: string, patch: Partial<DeskTemplateSettings>) => {
    setSettings((s) => ({ ...s, [key]: { ...(s[key] ?? {}), ...patch } }));
    setDirty(true);
  };
  const setField = (key: string, field: string, value: any) => {
    const fields = { ...(settings[key]?.fields ?? {}) };
    if (value === undefined || value === "") delete fields[field];
    else fields[field] = value;
    change(key, { fields });
  };
  const dupes = useMemo(() => Object.values(nums).filter((n, i, a) => n !== "" && a.indexOf(n) !== i), [nums]);

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
  const save = () =>
    run(async () => {
      const clean = Object.fromEntries(
        Object.entries(settings)
          .map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && !(typeof x === "object" && !Object.keys(x).length)))])
          .filter(([, v]) => Object.keys(v as object).length),
      );
      await call("event:update", eventId, { settings: { templates: clean } });
      const map = Object.fromEntries(Object.entries(nums).filter(([, n]) => n !== "").map(([k, n]) => [n, k]));
      await call("desk:saveCommands", map);
      setDirty(false);
      setNotice("Template settings saved");
      onSaved();
    });

  const exportFile = () =>
    run(async () => {
      if (dirty) throw new Error("Save your template changes first");
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
      setDirty(false);
      setNotice(`Imported ${res.applied.join(", ")}${res.requiresRestart ? " · restart Split Control to apply the output changes" : ""}`);
      onSaved();
    });

  return (
    <div className="studio-form template-settings">
      {error && <p role="alert" className="studio-error">{error}</p>}
      {notice && <p role="status">{tr(notice)}</p>}
      <p className="muted">
        {tr("Defaults fill the operator's draft in Live; they can still change any field there. Numbers pick a graphic in the command palette. Hidden graphics are left out of the Live list.")}
      </p>
      <ul className="template-list">
        {templates.map((t) => {
          const s = settings[t.key] ?? {};
          const live = t.live ? liveUpdatesDefault(t.key, settings) : undefined;
          const fields = [...(t.fields ?? []), ...(t.settingsFields ?? [])].filter((f) => t.schema?.[f]);
          const rowsPartner = t.key === "start-list" ? "Results table" : t.key === "results" ? "Start list" : "";
          return (
            <li key={t.key} className={`template-row ${s.hidden ? "is-hidden" : ""}`}>
              <div className="template-row-head">
                <input
                  className="template-num"
                  aria-label={`${tr("Number for")} ${t.label}`}
                  value={nums[t.key] ?? ""}
                  inputMode="numeric"
                  onChange={(e) => {
                    setNums((n) => ({ ...n, [t.key]: e.target.value.replace(/\D/g, "").slice(0, 2) }));
                    setDirty(true);
                  }}
                />
                <b className="template-name">{tr(t.label)}{t.available ? "" : ` · ${tr("not in this look")}`}</b>
                <label className="inline-check">
                  <input type="checkbox" checked={!s.hidden} onChange={(e) => change(t.key, { hidden: e.target.checked ? undefined : true })} />
                  {tr("Show in Live")}
                </label>
                {live !== undefined && (
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={live}
                      onChange={(e) => change(t.key, { liveUpdates: e.target.checked === (t.liveUpdates ?? true) ? undefined : e.target.checked })}
                    />
                    {tr("Live updates on air")}
                  </label>
                )}
                {fields.length > 0 && (
                  <button type="button" className="studio-button" aria-expanded={open === t.key} onClick={() => setOpen(open === t.key ? "" : t.key)}>
                    {open === t.key ? tr("Close") : tr("Defaults")}
                  </button>
                )}
              </div>
              {open === t.key && (
                <div className="field-grid template-fields">
                  {fields.map((f) => (
                    <StudioField
                      key={f}
                      schema={t.schema[f]}
                      name={f}
                      value={s.fields?.[f]}
                      disabled={f === "rowsPerPage" && !!s.linkRows}
                      onChange={(v) => setField(t.key, f, v)}
                      settingsOnly={t.settingsFields?.includes(f)}
                    />
                  ))}
                  {rowsPartner && (
                    <label className="inline-check">
                      <input type="checkbox" checked={!!s.linkRows} onChange={(e) => change(t.key, { linkRows: e.target.checked || undefined })} />
                      {tr("Same rows per page as")} {tr(rowsPartner)}
                    </label>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {dupes.length > 0 && <p className="studio-error">{tr("Each number can only be used once")} ({[...new Set(dupes)].join(", ")})</p>}
      <div className="form-actions">
        <button type="button" className="studio-button primary" disabled={busy || !dirty || dupes.length > 0} onClick={() => void save()}>
          {tr("Save template settings")}
        </button>
        <button
          type="button"
          className="studio-button"
          disabled={busy}
          onClick={() => {
            setNums(Object.fromEntries(DESK_TEMPLATES.map((t, i) => [t.key, String(i)])));
            setDirty(true);
          }}
        >
          {tr("Reset numbers")}
        </button>
      </div>

      <section className="connection-card">
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
    </div>
  );
}

function StudioField({ name, schema, value, onChange, disabled, settingsOnly }: {
  name: string;
  schema: any;
  value: any;
  onChange: (v: any) => void;
  disabled?: boolean;
  settingsOnly?: boolean;
}) {
  const title = `${tr(schema.title || name)}${settingsOnly ? ` · ${tr("Settings only")}` : ""}`;
  if (schema.type === "boolean")
    return (
      <label className="inline-check" title={schema.description ? tr(schema.description) : undefined}>
        <input type="checkbox" checked={!!(value ?? schema.default)} onChange={(e) => onChange(e.target.checked === !!schema.default ? undefined : e.target.checked)} />
        {title}
      </label>
    );
  if (Array.isArray(schema.enum)) {
    const names: string[] = schema.enumNames ?? schema.enum;
    return (
      <label>
        {title}
        <select value={value ?? schema.default ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value || undefined)}>
          {schema.enum.map((o: string, i: number) => <option key={o} value={o}>{tr(names[i] ?? o)}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label>
      {title}
      {schema.multiline ? (
        <textarea rows={3} value={value ?? ""} disabled={disabled} placeholder={schema.description ? tr(schema.description) : ""} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          type={schema.type === "number" ? "number" : "text"}
          value={value ?? ""}
          disabled={disabled}
          placeholder={schema.default !== undefined && schema.default !== "" ? String(schema.default) : schema.description ? tr(schema.description) : ""}
          onChange={(e) => onChange(schema.type === "number" ? (e.target.value === "" ? undefined : Number(e.target.value)) : e.target.value)}
        />
      )}
    </label>
  );
}

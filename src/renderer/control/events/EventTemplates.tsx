import { t as tr } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  hasBehaviour,
  DESK_TEMPLATES,
  liveUpdatesDefault,
  type DeskCommandMap,
  type DeskTemplateSettings,
  type DeskTemplateSettingsMap,
} from "../../../shared/desk";
import type { SPXProject } from "../../../shared/types/spx";
import { call } from "./api";
import { DragHandle, useSortable } from "../components/useSortable";

type TemplateInfo = (typeof DESK_TEMPLATES)[number] & {
  templateId: string | null;
  available: boolean;
  schema: Record<string, any>;
};

/** Settings → Templates: per-graphic defaults, visibility in Live, numbers, export / import */
export function EventTemplates({
  eventId,
  event,
  onSaved,
  onDirtyChange,
  onBlockedChange,
}: {
  eventId: string;
  event: SPXProject;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** Two graphics share a command number: Plan must not move on until it is fixed */
  onBlockedChange?: (blocked: boolean) => void;
}) {
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [settings, setSettings] = useState<DeskTemplateSettingsMap>(event.settings?.templates ?? {});
  const [nums, setNums] = useState<Record<string, string>>({});
  /** Template keys in the order of the Live list */
  const [order, setOrder] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([call<TemplateInfo[]>("desk:templates", eventId), call<DeskCommandMap>("desk:commands")])
      .then(([list, map]) => {
        setTemplates(list);
        // desk:templates is already in the event's saved order
        setOrder(list.map((t) => t.key));
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
  const byKey = useMemo(() => new Map(templates.map((t) => [t.key, t])), [templates]);
  const ordered = order.map((k) => byKey.get(k)).filter((t): t is TemplateInfo => !!t);
  const toggleOpen = (key: string) =>
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const sortable = useSortable({
    order,
    onChange: (next) => {
      setOrder(next);
      setDirty(true);
    },
    labelOf: (key) => tr(byKey.get(key)?.label ?? key),
    onMoved: setNotice,
  });
  const dupes = useMemo(() => Object.values(nums).filter((n, i, a) => n !== "" && a.indexOf(n) !== i), [nums]);
  const isDupe = (key: string) => !!nums[key] && dupes.includes(nums[key]);
  useEffect(() => onBlockedChange?.(dupes.length > 0), [dupes.length, onBlockedChange]);

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
      const defaultOrder = templates.map((t) => t.key);
      const templateOrder = order.join() === defaultOrder.join() ? undefined : order;
      await call("event:update", eventId, { settings: { templates: clean, templateOrder } });
      const map = Object.fromEntries(Object.entries(nums).filter(([, n]) => n !== "").map(([k, n]) => [n, k]));
      await call("desk:saveCommands", map);
      setDirty(false);
      setNotice("Template settings saved");
      onSaved();
    });

  return (
    <div className="studio-form template-settings">
      {error && <p role="alert" className="studio-error">{error}</p>}
      {notice && <p role="status">{tr(notice)}</p>}
      <p className="muted">
        {tr("Drag graphics into the order you want in the Live list. Open a graphic for its settings: defaults fill the operator's draft in Live, where any field can still be changed.")}
      </p>
      <ul className="template-list" {...sortable.listProps}>
        {ordered.map((t, index) => {
          const s = settings[t.key] ?? {};
          const live = t.live ? liveUpdatesDefault(t, settings) : undefined;
          const fields = [...(t.fields ?? []), ...(t.settingsFields ?? [])].filter((f) => t.schema?.[f]);
          const rowsPartner = templates.find(p => p.key === t.rowsPartner)?.label ?? "";
          const isOpen = open.has(t.key);
          const bodyId = `template-body-${t.key}`;
          const dupe = isDupe(t.key);
          return (
            <li
              key={t.key}
              className={`template-item${s.hidden ? " is-hidden" : ""}${isOpen ? " is-open" : ""}${dupe ? " has-dupe" : ""}${sortable.itemClass(t.key)}`}
              {...sortable.itemProps(t.key)}
            >
              <div className="template-item-head">
                <DragHandle {...sortable.handleProps(t.key, index)} />
                <button
                  type="button"
                  className="template-toggle"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => toggleOpen(t.key)}
                >
                  <span className={`template-num-badge${dupe ? " is-invalid" : ""}`} aria-label={nums[t.key] ? `${tr("Number")} ${nums[t.key]}` : tr("No number")}>
                    {nums[t.key] || "–"}
                  </span>
                  <span className="template-name">
                    {tr(t.label)}
                    {dupe && <span className="template-tag warn">{tr("Number")} {nums[t.key]} {tr("is used twice")}</span>}
                    {!t.available && <span className="template-tag warn">{tr("not in this look")}</span>}
                    {s.hidden && <span className="template-tag">{tr("Hidden in Live")}</span>}
                    {live === false && <span className="template-tag">{tr("Live updates off")}</span>}
                    {s.fields && Object.keys(s.fields).length > 0 && <span className="template-tag">{tr("Defaults set")}</span>}
                  </span>
                  <svg className="template-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              {isOpen && (
                <div className="template-item-body" id={bodyId}>
                  <div className="template-item-section">
                    <h4>{tr("In Live")}</h4>
                    <label className="inline-check">
                      <input type="checkbox" checked={!s.hidden} onChange={(e) => change(t.key, { hidden: e.target.checked ? undefined : true })} />
                      {tr("Show in Live")}
                    </label>
                    {live !== undefined && (
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={live}
                          onChange={(e) => change(t.key, { liveUpdates: e.target.checked === !hasBehaviour(t, "holdOnAir") ? undefined : e.target.checked })}
                        />
                        {tr("Live updates on air")}
                      </label>
                    )}
                    <label className="template-num-field">
                      {tr("Command number")}
                      <input
                        className={`template-num${dupe ? " is-invalid" : ""}`}
                        aria-invalid={dupe || undefined}
                        value={nums[t.key] ?? ""}
                        inputMode="numeric"
                        onChange={(e) => {
                          setNums((n) => ({ ...n, [t.key]: e.target.value.replace(/\D/g, "").slice(0, 2) }));
                          setDirty(true);
                        }}
                      />
                      <small>
                        {tr("Picks this graphic in the command palette, in every event.")}{" "}
                        <Link to="/settings?tab=controls">{tr("Order all numbers in Settings")}</Link>
                      </small>
                    </label>
                  </div>
                  <div className="template-item-section">
                    <h4>{tr("Defaults")}</h4>
                    {fields.length > 0 ? (
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
                    ) : (
                      <p className="muted">{tr("This graphic has no default fields.")}</p>
                    )}
                  </div>
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
            setOrder(templates.map((t) => t.key).filter((k) => byKey.has(k)));
            setDirty(true);
          }}
        >
          {tr("Reset order")}
        </button>
      </div>

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
      {schema.type === "array" && schema.items?.type === "string" ? (
        <textarea rows={3} value={Array.isArray(value) ? value.join("\n") : ""} disabled={disabled}
          placeholder={tr("One value per line")}
          onChange={e => onChange(e.target.value.split(/\r?\n/).filter(Boolean))} />
      ) : schema.multiline ? (
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

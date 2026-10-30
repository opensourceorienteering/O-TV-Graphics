import { t as tr } from "../i18n";
/**
 * Project graphics settings: the project's template set (one look per production) and how
 * graphics present runners (club or flag, club logos, logo box, clearing clashing graphics).
 */

import { useEffect, useRef, useState } from "react";
import type {
  SPXProject,
  ProjectPresentation,
} from "../../../shared/types/spx";
import { DEFAULT_TEMPLATE_SET } from "../../../shared/types/spx";
import type { TemplateSetInfo } from "../../../shared/types/ograf";
import { useToast } from "../contexts/ToastContext";

interface Props {
  project: SPXProject;
  sets: TemplateSetInfo[];
  onSaved: (project: SPXProject) => void;
  onDraftChange?: (draft: {
    templateSet: string;
    presentation: ProjectPresentation;
  }) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

const label: React.CSSProperties = {
  fontSize: "0.875rem",
  fontWeight: "bold",
  marginBottom: "0.25rem",
  display: "block",
};
const help: React.CSSProperties = {
  fontWeight: 400,
  fontSize: "0.8rem",
  color: "#b0b3bd",
  margin: "0.25rem 0 0",
};

export function TemplateSetPicker({
  sets,
  value,
  onChange,
}: {
  sets: TemplateSetInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const current = sets.find((s) => s.id === value);
  return (
    <div>
      <select
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", fontSize: "0.875rem" }}
      >
        {sets.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.templateCount}  {tr("graphics)")} </option>
        ))}
        {!current && <option value={value}>{value}  {tr("(not installed)")}</option>}
      </select>
      {current && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "flex-start",
            marginTop: "0.4rem",
          }}
        >
          <div style={{ display: "flex", gap: 3, paddingTop: 3 }}>
            {(current.colors || []).map((c) => (
              <span
                key={c}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: c,
                  border: "1px solid #555",
                }}
              />
            ))}
          </div>
          <p style={{ ...help, margin: 0 }}>{current.description}</p>
        </div>
      )}
    </div>
  );
}

export function ProjectGraphicsSettings({
  project,
  sets,
  onSaved,
  onDraftChange,
  onDirtyChange,
}: Props) {
  const toast = useToast();
  const [templateSet, setTemplateSet] = useState(
    project.templateSet || DEFAULT_TEMPLATE_SET,
  );
  const [p, setP] = useState<ProjectPresentation>(
    project.settings?.presentation ?? {},
  );
  const [saving, setSaving] = useState(false);
  const colorsDialog = useRef<HTMLDialogElement>(null);
  const [colorDraft, setColorDraft] = useState<string[]>([]);

  useEffect(() => {
    setTemplateSet(project.templateSet || DEFAULT_TEMPLATE_SET);
    setP(project.settings?.presentation ?? {});
  }, [project]);

  useEffect(() => {
    onDraftChange?.({ templateSet, presentation: p });
  }, [templateSet, p, onDraftChange]);

  const dirty =
    templateSet !== (project.templateSet || DEFAULT_TEMPLATE_SET) ||
    JSON.stringify(p) !== JSON.stringify(project.settings?.presentation ?? {});

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const save = async () => {
    if (
      templateSet !== (project.templateSet || DEFAULT_TEMPLATE_SET) &&
      !confirm(
        "Change the event theme? All saved graphics will switch to the matching graphics in the new theme. Graphic data and live-data settings will be preserved.",
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const result = await window.electronAPI.invoke(
        "event:update",
        project.id,
        {
          templateSet,
          settings: { ...(project.settings || {}), presentation: p },
        },
      );
      if (result?.success) {
        onSaved(result.data);
        toast.success("Event theme saved");
      } else {
        toast.error(`Failed to save: ${result?.error || "Unknown error"}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const setInfo = sets.find((set) => set.id === templateSet);
  const defaultColors = setInfo?.colors?.slice(0, 3) ?? [];
  const effectiveColors = defaultColors.map((color, index) => p.themeColors?.[index] || color);
  const openColors = () => {
    setColorDraft(effectiveColors);
    colorsDialog.current?.showModal();
  };

  return (
    <div className="preference-section">
      <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1rem" }}>{tr("Event theme")}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <div>
          <label style={label}>{tr("Theme")}</label>
          <TemplateSetPicker
            sets={sets}
            value={templateSet}
            onChange={(id) => {
              setTemplateSet(id);
              setP((current) => ({ ...current, themeColors: undefined }));
            }}
          />
          <p style={help}>{tr("All graphic pages in this event use this theme.")}</p>
          {!!defaultColors.length && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ marginTop: "0.5rem" }}
              onClick={openColors}
            >
               {tr("Customize theme colors")} </button>
          )}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.75rem",
          }}
        >
          <div>
            <label style={label}>{tr("Event type")}</label>
            <select
              className="input"
              style={{ width: "100%", fontSize: "0.875rem" }}
              value={p.international ? "international" : "national"}
              onChange={(e) =>
                setP({
                  ...p,
                  international: e.target.value === "international",
                })
              }
            >
              <option value="national">{tr("National")}</option>
              <option value="international">{tr("International")}</option>
            </select>
          </div>
          <div>
            <label style={label}>{tr("Next to names")}</label>
            <select
              className="input"
              style={{ width: "100%", fontSize: "0.875rem" }}
              value={p.identity || "auto"}
              onChange={(e) =>
                setP({
                  ...p,
                  identity: e.target.value as ProjectPresentation["identity"],
                })
              }
            >
              <option value="auto">{tr("Automatic")}</option>
              <option value="club">{tr("Club")}</option>
              <option value="flag">{tr("Flag")}</option>
              <option value="both">{tr("Club and flag")}</option>
            </select>
          </div>
        </div>
        <p style={{ ...help, marginTop: "-0.4rem" }}>
           {tr("Automatic: national events show the club; international events show the flag, and relays show club and flag.")} </p>

        <div>
          <label style={label} htmlFor="auto-page-duration">
             {tr("Automatic pagination")} </label>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <input
              id="auto-page-duration"
              className="input"
              type="number"
              min={0}
              step={1}
              value={p.autoPageDurationSeconds ?? 0}
              onChange={(e) =>
                setP({
                  ...p,
                  autoPageDurationSeconds: Math.max(0, Number(e.target.value) || 0),
                })
              }
              style={{ width: 96, fontSize: "0.875rem" }}
            />
            <span style={{ fontSize: "0.875rem" }}>{tr("seconds per page")}</span>
          </div>
          <p style={help}>
             {tr("Set to 0 for manual paging. After the final page, the graphic waits once more and then animates off air.")} </p>
        </div>

            <label
              style={{
                ...label,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
               {tr("Broadcast language")} <select
                value={p.language || "set"}
                onChange={(e) =>
                  setP({
                    ...p,
                    language: e.target.value as ProjectPresentation["language"],
                  })
                }
              >
                <option value="set">{tr("Use template-set wording")}</option>
                <option value="en">{tr("English")}</option>
                <option value="sv">Svenska</option>
                <option value="nb">Norsk bokmål</option>
                <option value="cs">Čeština</option>
              </select>
              <span style={help}>
                 {tr("Language used on air, independently of the application language.")} </span>
            </label>
        <details className="settings-disclosure">
          <summary>{tr("Branding and graphic options")}</summary>
          <div className="studio-form">

            <div>
              <label style={label}>{tr("Logo in graphics")}</label>
              <input
                className="input"
                style={{ width: "100%", fontSize: "0.875rem" }}
                value={p.logoUrl || ""}
                placeholder="/assets/event-logo.png"
                onChange={(e) =>
                  setP({ ...p, logoUrl: e.target.value || undefined })
                }
              />
              <p style={help}>
                 {tr("A file in the ASSETS folder (served at /assets/) or a full URL. Shown in the logo boxes of the set.")} </p>
            </div>

            <label
              style={{
                ...label,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
               {tr("Sponsor logos (one URL or /assets/ path per line, up to four)")} <textarea
                style={{ width: "100%", resize: "vertical" }}
                rows={4}
                value={(p.sponsorLogos || []).join("\n")}
                onChange={(e) =>
                  setP({
                    ...p,
                    sponsorLogos: e.target.value.split("\n").slice(0, 4),
                  })
                }
              />
              <span style={help}>
                 {tr("Shown on the event title card. Save, then preview the title card to check branding.")} </span>
            </label>
            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                fontSize: "0.875rem",
              }}
            >
              <input
                type="checkbox"
                checked={p.clubLogos !== false}
                onChange={(e) => setP({ ...p, clubLogos: e.target.checked })}
              />
               {tr("Show club logos (included with the app, or added in Settings → Theme)")} </label>
            <label
              style={{
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                fontSize: "0.875rem",
              }}
            >
              <input
                type="checkbox"
                checked={p.clearClashing !== false}
                onChange={(e) =>
                  setP({ ...p, clearClashing: e.target.checked })
                }
              />
               {tr("Take clashing graphics off air automatically")} </label>
            <p style={{ ...help, marginTop: "-0.4rem" }}>
               {tr("Playing a graphic removes graphics in the same screen area, e.g. a results table removes lower thirds.")} </p>
          </div>
        </details>
        <div>
          <button
            className="btn btn-primary btn-sm"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? "Saving..." : tr("Save event theme")}
          </button>
        </div>
      </div>
      <dialog
        ref={colorsDialog}
        className="controls-dialog theme-colors-dialog"
        aria-labelledby="theme-colors-title"
        onCancel={() => colorsDialog.current?.close()}
      >
        <header className="dialog-heading">
          <div>
            <h2 id="theme-colors-title">{tr("Theme colors")}</h2>
            <p className="muted">{tr("Customize")} {setInfo?.name || "this theme"}  {tr("for this event only.")}</p>
          </div>
          <button type="button" className="studio-button" onClick={() => colorsDialog.current?.close()}>{tr("Close")}</button>
        </header>
        <div className="theme-color-grid">
          {defaultColors.map((fallback, index) => (
            <label key={index}>
              <span>{["Primary", "Secondary", "Supporting"][index]}</span>
              <span className="theme-color-control">
                <input
                  type="color"
                  value={colorDraft[index] || fallback}
                  onChange={(e) => setColorDraft(colors => colors.map((color, i) => i === index ? e.target.value : color))}
                />
                <input
                  type="text"
                  value={colorDraft[index] || fallback}
                  pattern="#[0-9A-Fa-f]{6}"
                  aria-label={`${["Primary", "Secondary", "Supporting"][index]} hex color`}
                  onChange={(e) => setColorDraft(colors => colors.map((color, i) => i === index ? e.target.value : color))}
                />
              </span>
              <span className="theme-color-tints" aria-hidden="true" style={{ "--c": /^#[0-9a-f]{6}$/i.test(colorDraft[index] || "") ? colorDraft[index] : fallback } as React.CSSProperties}>
                {[75, 50, 25, 0, -30].map(m => <i key={m} style={{ "--m": `${Math.abs(m)}%`, "--to": m < 0 ? "#000" : "#fff" } as React.CSSProperties} />)}
              </span>
            </label>
          ))}
        </div>
        <p className="muted">{tr("The graphics mix their tints, gradients and dividers from these three colors, so every shade follows your choice.")}</p>
        <p className="muted">{tr("Changes appear in Preview after you apply them. Save the event theme to keep them.")}</p>
        <footer className="dialog-footer">
          <button type="button" className="studio-button" onClick={() => setColorDraft(defaultColors)}>{tr("Reset to theme defaults")}</button>
          <button
            type="button"
            className="studio-button primary"
            disabled={colorDraft.some(color => !/^#[0-9a-f]{6}$/i.test(color))}
            onClick={() => {
              const isDefault = defaultColors.every((color, index) => color.toLowerCase() === colorDraft[index]?.toLowerCase());
              setP({ ...p, themeColors: isDefault ? undefined : colorDraft });
              colorsDialog.current?.close();
            }}
          >
             {tr("Apply colors")} </button>
        </footer>
      </dialog>
    </div>
  );
}

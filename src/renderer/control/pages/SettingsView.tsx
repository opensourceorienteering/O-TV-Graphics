import { setAppLanguage, t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Database,
  HardDrive,
  Keyboard,
  RotateCcw,
  Save,
  Settings2,
  Sliders,
  Tag,
} from "lucide-react";
import { DataSourceManager } from "../components/DataSourceManager";
import { KeyboardShortcutsList } from "../components/KeyboardShortcuts";
import { ClubNameLibrary } from "../components/ClubNameLibrary";
import { CommandNumbersPanel } from "../components/CommandNumbersPanel";

interface AppConfig {
  general: {
    hostname: string;
    port: number;
    wsPort: number;
    dataroot: string;
    logfolder: string;
    loglevel: "error" | "warn" | "info" | "verbose" | "debug";
    langfile: string;
    launchBrowser: boolean;
    resolution: "HD" | "4K" | "AUTO";
  };
  output: {
    ndi: {
      enabled: boolean;
      name: string;
      fps: number;
      colorFormat: "BGRA" | "RGBA";
    };
    web: { enabled: boolean; cors: boolean };
  };
}

type TabId = "general" | "outputs" | "controls" | "sources" | "clubs" | "storage";

const tabs: Array<{
  id: TabId;
  label: string;
  detail: string;
  icon: typeof Sliders;
}> = [
  {
    id: "general",
    label: "General",
    detail: "Display and startup",
    icon: Sliders,
  },
  {
    id: "outputs",
    label: "Output defaults",
    detail: "Web and NDI",
    icon: Settings2,
  },
  {
    id: "controls",
    label: "Controls",
    detail: "Command numbers and keys",
    icon: Keyboard,
  },
  {
    id: "sources",
    label: "Data sources",
    detail: "Timing connections",
    icon: Database,
  },
  {
    id: "clubs",
    label: "Club names",
    detail: "Short names on air",
    icon: Tag,
  },
  {
    id: "storage",
    label: "Storage",
    detail: "Folders and diagnostics",
    icon: HardDrive,
  },
];

export function SettingsView() {
  // The app uses hash routing: read ?tab= (or ?section=) from the router, not window.location
  const [params] = useSearchParams();
  const requested = params.get("tab") ?? params.get("section");
  const requestedTab = requested === "output" ? "outputs" : requested;
  const [tab, setTab] = useState<TabId>(
    tabs.some(({ id }) => id === requestedTab)
      ? (requestedTab as TabId)
      : "general",
  );
  const [saved, setSaved] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [paths, setPaths] = useState<{
    configPath: string;
    dataroot: string;
    logfolder: string;
    templatesDir: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error" | "warning";
    text: string;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const [settingsResult, pathsResult] = await Promise.all([
        window.electronAPI.invoke("settings:get"),
        window.electronAPI.invoke("settings:getPaths"),
      ]);
      if (!settingsResult.success)
        throw new Error(settingsResult.error || "Unable to load settings.");
      setSaved(settingsResult.data);
      setDraft(settingsResult.data);
      if (pathsResult.success) setPaths(pathsResult.data);
    } catch (cause) {
      setMessage({
        kind: "error",
        text: `${cause instanceof Error ? cause.message : "Unable to load settings."} Restart the app and try again.`,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const changed =
    !!saved && !!draft && JSON.stringify(saved) !== JSON.stringify(draft);
  const update = (path: string, value: unknown) => {
    if (!draft) return;
    const next = structuredClone(draft) as Record<string, any>;
    const parts = path.split(".");
    let target = next;
    parts.slice(0, -1).forEach((part) => {
      target = target[part];
    });
    target[parts[parts.length - 1]] = value;
    setDraft(next as AppConfig);
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await window.electronAPI.invoke("settings:update", draft);
      if (!result.success)
        throw new Error(result.error || "Unable to save settings.");
      setSaved(draft);
      setAppLanguage(draft.general.langfile);
      setMessage({
        kind: result.data?.requiresRestart ? "warning" : "success",
        text: result.data?.requiresRestart
          ? "Settings saved. Restart Split Control to apply these changes."
          : "Settings saved.",
      });
    } catch (cause) {
      setMessage({
        kind: "error",
        text: `${cause instanceof Error ? cause.message : "Unable to save settings."} Check the values and try again.`,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading)
    return (
      <div className="screen-state" role="status">
        <p>{tr("Loading settings…")}</p>
      </div>
    );
  if (!draft)
    return (
      <div className="screen-state studio-panel">
        <h1>{tr("Settings unavailable")}</h1>
        <p>{message?.text || "Restart the app and try again."}</p>
        <button className="studio-button" onClick={() => void load()}>
           {tr("Reload settings")} </button>
      </div>
    );

  return (
    <div className="settings-screen">
      <header className="utility-heading settings-heading">
        <div>
          <p className="eyebrow">{tr("Application")}</p>
          <h1>{tr("Settings")}</h1>
          <p>{tr("Defaults that apply across every event.")}</p>
        </div>
        <div className="row wrap">
          {changed && (
            <button
              className="studio-button"
              disabled={saving}
              onClick={() => {
                setDraft(saved);
                setMessage(null);
              }}
            >
              <RotateCcw size={16} aria-hidden="true" />
               {tr("Discard changes")} </button>
          )}
          <button
            className="studio-button primary"
            disabled={!changed || saving}
            onClick={() => void save()}
          >
            <Save size={16} aria-hidden="true" />
            {saving ? tr("Saving…") : tr("Save settings")}
          </button>
        </div>
      </header>

      {message && (
        <div
          className={`settings-message ${message.kind}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {tr(message.text)}
        </div>
      )}

      <div className="settings-layout">
        <nav className="settings-nav" aria-label={tr("Settings sections")}>
          {tabs.map(({ id, label, detail, icon: Icon }) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>
                {tr(label)}
                <small>{tr(detail)}</small>
              </span>
            </button>
          ))}
        </nav>

        <section className="studio-panel settings-content">
          {tab === "general" && (
            <SettingsSection
              title={tr("General")}
              intro={tr("Choose how Split Control starts and renders graphics.")}
            >
              <div className="field-grid">
                <Field label={tr("Application language")}>
                  <select value={draft.general.langfile.startsWith('sv') ? 'sv.json' : /^(nb|no)/.test(draft.general.langfile) ? 'nb.json' : 'en.json'}
                    onChange={event => update('general.langfile', event.target.value)}>
                    <option value="en.json">{tr("English")}</option>
                    <option value="sv.json">Svenska</option>
                    <option value="nb.json">Norsk bokmål</option>
                  </select>
                </Field>
                <Field
                  label={tr("Application name")}
                  hint={tr("Shown to other devices on the network.")}
                >
                  <input
                    value={draft.general.hostname}
                    onChange={(event) =>
                      update("general.hostname", event.target.value)
                    }
                  />
                </Field>
                <Field
                  label={tr("Graphics resolution")}
                  hint={tr("Requires an app restart.")}
                >
                  <select
                    value={draft.general.resolution}
                    onChange={(event) =>
                      update("general.resolution", event.target.value)
                    }
                  >
                    <option value="HD">HD · 1920 × 1080</option>
                    <option value="4K">4K · 3840 × 2160</option>
                    <option value="AUTO">{tr("Match graphics display")}</option>
                  </select>
                </Field>
                <Field
                  label={tr("Log detail")}
                  hint={tr("Use Debug only while investigating a problem.")}
                >
                  <select
                    value={draft.general.loglevel}
                    onChange={(event) =>
                      update("general.loglevel", event.target.value)
                    }
                  >
                    <option value="error">{tr("Errors only")}</option>
                    <option value="warn">{tr("Warnings")}</option>
                    <option value="info">Standard</option>
                    <option value="verbose">{tr("Verbose")}</option>
                    <option value="debug">Debug</option>
                  </select>
                </Field>
              </div>
              <label className="inline-label">
                <input
                  type="checkbox"
                  checked={draft.general.launchBrowser}
                  onChange={(event) =>
                    update("general.launchBrowser", event.target.checked)
                  }
                />
                 {tr("Open the web interface when Split Control starts")} </label>
              <details className="settings-disclosure">
                <summary>{tr("Network ports")}</summary>
                <div className="field-grid">
                  <Field
                    label={tr("Web server port")}
                    hint={tr("1024–65535 · requires restart")}
                  >
                    <input
                      type="number"
                      min="1024"
                      max="65535"
                      value={draft.general.port}
                      onChange={(event) =>
                        update("general.port", Number(event.target.value))
                      }
                    />
                  </Field>
                  <Field
                    label={tr("WebSocket port")}
                    hint={tr("1024–65535 · requires restart")}
                  >
                    <input
                      type="number"
                      min="1024"
                      max="65535"
                      value={draft.general.wsPort}
                      onChange={(event) =>
                        update("general.wsPort", Number(event.target.value))
                      }
                    />
                  </Field>
                </div>
              </details>
            </SettingsSection>
          )}

          {tab === "outputs" && (
            <SettingsSection
              title={tr("Output defaults")}
              intro={tr("These defaults are available in each event’s Output step.")}
            >
              <div className="settings-subsection">
                <h3>{tr("Web output")}</h3>
                <label className="inline-label">
                  <input
                    type="checkbox"
                    checked={draft.output.web.enabled}
                    onChange={(event) =>
                      update("output.web.enabled", event.target.checked)
                    }
                  />
                   {tr("Enable browser output")} </label>
                <label className="inline-label">
                  <input
                    type="checkbox"
                    checked={draft.output.web.cors}
                    onChange={(event) =>
                      update("output.web.cors", event.target.checked)
                    }
                  />
                   {tr("Allow browser sources from other origins")} </label>
              </div>
              <div className="settings-subsection">
                <h3>{tr("NDI output")}</h3>
                <label className="inline-label">
                  <input
                    type="checkbox"
                    checked={draft.output.ndi.enabled}
                    onChange={(event) =>
                      update("output.ndi.enabled", event.target.checked)
                    }
                  />
                   {tr("Enable NDI when available")} </label>
                <div className="field-grid">
                  <Field label={tr("Source name")}>
                    <input
                      value={draft.output.ndi.name}
                      onChange={(event) =>
                        update("output.ndi.name", event.target.value)
                      }
                    />
                  </Field>
                  <Field label={tr("Frame rate")}>
                    <select
                      value={draft.output.ndi.fps}
                      onChange={(event) =>
                        update("output.ndi.fps", Number(event.target.value))
                      }
                    >
                      {[25, 30, 50, 60].map((fps) => (
                        <option key={fps} value={fps}>
                          {fps} fps
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={tr("Color format")}>
                    <select
                      value={draft.output.ndi.colorFormat}
                      onChange={(event) =>
                        update("output.ndi.colorFormat", event.target.value)
                      }
                    >
                      <option value="BGRA">BGRA</option>
                      <option value="RGBA">RGBA</option>
                    </select>
                  </Field>
                </div>
              </div>
            </SettingsSection>
          )}

          {tab === "sources" && (
            <SettingsSection
              title={tr("Data sources")}
              intro={tr("Manage timing systems that can be connected from an event.")}
            >
              <DataSourceManager />
            </SettingsSection>
          )}

          {tab === "clubs" && (
            <SettingsSection
              title={tr("Club names")}
              intro={tr("Names graphics use instead of the club name the data source sends, in every event. Clubs without a name here use the short name from the downloaded club lists, or the name as sent.")}
            >
              <ClubNameLibrary />
            </SettingsSection>
          )}

          {tab === "controls" && (
            <>
              <SettingsSection
                title={tr("Command numbers")}
                intro={tr("The first number of a palette command picks a graphic, in every event. Drag the graphics into order: the first is 0, the next 1, and so on. Each event orders its own Live list in Plan → Templates.")}
              >
                <CommandNumbersPanel />
              </SettingsSection>
              <SettingsSection
                title={tr("Keyboard shortcuts")}
                intro={tr("Keys for the Live desk. You can also open this list from Plan or Live.")}
              >
                <KeyboardShortcutsList />
              </SettingsSection>
            </>
          )}

          {tab === "storage" && (
            <SettingsSection
              title={tr("Storage")}
              intro={tr("Choose where Split Control keeps projects and logs.")}
            >
              <Field
                label={tr("Event data folder")}
                hint={`Current: ${paths?.dataroot || "Unavailable"} · requires restart`}
              >
                <input
                  value={draft.general.dataroot}
                  onChange={(event) =>
                    update("general.dataroot", event.target.value)
                  }
                />
              </Field>
              <Field
                label={tr("Log folder")}
                hint={`Current: ${paths?.logfolder || "Unavailable"} · requires restart`}
              >
                <input
                  value={draft.general.logfolder}
                  onChange={(event) =>
                    update("general.logfolder", event.target.value)
                  }
                />
              </Field>
              <details className="settings-disclosure">
                <summary>{tr("Advanced files")}</summary>
                <div className="studio-form">

                  <Field label={tr("Graphics library")}>
                    <input readOnly value={paths?.templatesDir || ""} />
                  </Field>
                  <Field label={tr("Configuration file")}>
                    <input readOnly value={paths?.configPath || ""} />
                  </Field>
                </div>
              </details>
            </SettingsSection>
          )}
        </section>
      </div>
    </div>
  );
}

function SettingsSection({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-section">
      <div className="settings-section-heading">
        <h2>{tr(title)}</h2>
        <p>{intro}</p>
      </div>
      <div className="studio-form">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      {tr(label)}
      {children}
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

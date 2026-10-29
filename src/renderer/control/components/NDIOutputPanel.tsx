import { t as tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Radio, Settings, Square, TestTube, X } from "lucide-react";
import { useToast } from "../contexts/ToastContext";

interface NDIOutputInfo {
  available: boolean;
  version?: string;
  error?: string;
  active: boolean;
  name: string;
  fps: number;
  colorFormat?: "BGRA" | "RGBA";
  frameCount: number;
  capturing: boolean;
  captureFrameCount: number;
  captureErrors: number;
  captureSkippedFrames?: number;
  measuredFps?: number;
  captureDurationMs?: number;
}

interface NDITestResults {
  error: string | null;
  details: string[];
}

export function NDIOutputPanel() {
  const toast = useToast();
  const [info, setInfo] = useState<NDIOutputInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [results, setResults] = useState<NDITestResults | null>(null);
  const diagnostics = useRef<HTMLDialogElement>(null);
  // A modal dialog: centred, focus-trapped, Esc closes it
  useEffect(() => {
    if (results && diagnostics.current && !diagnostics.current.open) diagnostics.current.showModal();
  }, [results]);
  const [config, setConfig] = useState({
    name: "Split Control Graphics Output",
    fps: 30,
    colorFormat: "BGRA" as "BGRA" | "RGBA",
  });

  const load = async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.invoke("output:getNDIInfo");
      if (!result.success)
        throw new Error(result.error || "Unable to read NDI status.");
      setInfo(result.data);
      setConfig({
        name: result.data.name,
        fps: result.data.fps,
        colorFormat: result.data.colorFormat || "BGRA",
      });
    } catch (cause) {
      toast.error(
        `${cause instanceof Error ? cause.message : "Unable to read NDI status."} Check the NDI runtime and try again.`,
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const run = async (name: string, channel: string) => {
    setWorking(name);
    try {
      const result = await window.electronAPI.invoke(channel);
      if (!result.success)
        throw new Error(result.error || `Unable to ${name} NDI output.`);
      await load();
      toast.success(`NDI output ${name === "start" ? "started" : "stopped"}.`);
    } catch (cause) {
      toast.error(
        `${cause instanceof Error ? cause.message : `Unable to ${name} NDI output.`} Check the output and try again.`,
      );
    } finally {
      setWorking("");
    }
  };

  const test = async () => {
    setWorking("test");
    try {
      const result = await window.electronAPI.invoke("output:testNDI");
      if (!result.success)
        throw new Error(result.error || "Unable to test NDI.");
      setResults(result.data);
    } catch (cause) {
      toast.error(
        `${cause instanceof Error ? cause.message : "Unable to test NDI."} Check the runtime installation and try again.`,
      );
    } finally {
      setWorking("");
    }
  };

  const saveConfig = async () => {
    setWorking("save");
    try {
      const result = await window.electronAPI.invoke(
        "output:updateNDIConfig",
        config,
      );
      if (!result.success)
        throw new Error(
          result.error || "Unable to save the NDI configuration.",
        );
      const current = await window.electronAPI.invoke("settings:get");
      if (current.success)
        await window.electronAPI.invoke("settings:update", {
          ...current.data,
          output: {
            ...current.data.output,
            ndi: { ...current.data.output.ndi, ...config },
          },
        });
      setSettingsOpen(false);
      await load();
      toast.success("NDI settings saved.");
    } catch (cause) {
      toast.error(
        `${cause instanceof Error ? cause.message : "Unable to save the NDI configuration."} Check the values and try again.`,
      );
    } finally {
      setWorking("");
    }
  };

  if (loading)
    return (
      <section className="connection-card screen-state" role="status">
        <RefreshCw className="icon-spin" aria-hidden="true" />
        <p>{tr("Checking NDI output…")}</p>
      </section>
    );
  if (!info)
    return (
      <section className="connection-card">
        <h3>{tr("NDI output")}</h3>
        <p>{tr("NDI status is unavailable.")}</p>
        <button className="studio-button" onClick={() => void load()}>
           {tr("Check again")} </button>
      </section>
    );

  return (
    <section className="connection-card">
      <div className="connection-card-heading">
        <div>
          <h3>{tr("NDI output")}</h3>
          <p>
            {info.available
              ? tr("Send graphics as a network video source.")
              : tr("Optional network video output.")}
          </p>
        </div>
        <span className={`connection-status ${info.active ? tr("ready") : "off"}`}>
          {info.active
            ? tr("● On air")
            : info.available
              ? "○ Stopped"
              : "Unavailable"}
        </span>
      </div>

      {!info.available ? (
        <div className="connection-empty">
          <Radio size={26} aria-hidden="true" />
          <div>
            <h4>{tr("NDI Runtime is not installed")}</h4>
            <p>
               {tr("Web output remains available. Install the NDI Runtime and restart Split Control if your production needs NDI.")} </p>
          </div>
          <button
            className="studio-button"
            disabled={working === "test"}
            onClick={() => void test()}
          >
            <TestTube size={15} aria-hidden="true" />
            {working === "test" ? "Testing…" : tr("Run diagnostics")}
          </button>
          {info.error && (
            <details className="settings-disclosure">
              <summary>{tr("Technical details")}</summary>
              <p className="muted">{info.error}</p>
            </details>
          )}
        </div>
      ) : (
        <>
          <dl className="output-stats">
            <div>
              <dt>{tr("Source")}</dt>
              <dd>{info.name}</dd>
            </div>
            <div>
              <dt>{tr("Target")}</dt>
              <dd>{info.fps} fps</dd>
            </div>
            {info.active && (
              <>
                <div>
                  <dt>{tr("Measured")}</dt>
                  <dd>{(info.measuredFps || 0).toFixed(1)} fps</dd>
                </div>
                <div>
                  <dt>{tr("Frames sent")}</dt>
                  <dd>{info.frameCount.toLocaleString()}</dd>
                </div>
              </>
            )}
          </dl>
          {info.active && !info.capturing && info.captureErrors > 0 && (
            <p className="studio-error" role="alert">
               {tr("Capture stopped after")} {info.captureErrors}  {tr("errors. Check the graphics window, then stop and restart NDI.")} </p>
          )}
          <div className="row wrap output-actions">
            {info.active ? (
              <button
                className="studio-button danger"
                disabled={!!working}
                onClick={() => void run("stop", "output:stopNDI")}
              >
                <Square size={15} aria-hidden="true" />
                {working === "stop" ? "Stopping…" : tr("Stop NDI")}
              </button>
            ) : (
              <button
                className="studio-button primary"
                disabled={!!working}
                onClick={() => void run("start", "output:startNDI")}
              >
                <Radio size={15} aria-hidden="true" />
                {working === "start" ? "Starting…" : tr("Start NDI")}
              </button>
            )}
            <button
              className="studio-button"
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              <Settings size={15} aria-hidden="true" />
               {tr("Configure")} </button>
            <button
              className="studio-button"
              disabled={working === "test"}
              onClick={() => void test()}
            >
              <TestTube size={15} aria-hidden="true" />
               {tr("Test")} </button>
          </div>
          {settingsOpen && (
            <div className="inline-settings">
              <h4>{tr("NDI settings")}</h4>
              <div className="field-grid">
                <label>
                   {tr("Source name")} <input
                    value={config.name}
                    onChange={(event) =>
                      setConfig({ ...config, name: event.target.value })
                    }
                  />
                </label>
                <label>
                   {tr("Frame rate")} <select
                    value={config.fps}
                    onChange={(event) =>
                      setConfig({ ...config, fps: Number(event.target.value) })
                    }
                  >
                    {[25, 30, 50, 60].map((fps) => (
                      <option key={fps} value={fps}>
                        {fps} fps
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                   {tr("Color format")} <select
                    value={config.colorFormat}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        colorFormat: event.target.value as "BGRA" | "RGBA",
                      })
                    }
                  >
                    <option value="BGRA">BGRA</option>
                    <option value="RGBA">RGBA</option>
                  </select>
                  <small className="field-hint">
                     {tr("Try RGBA if red and blue appear swapped.")} </small>
                </label>
              </div>
              <div className="row wrap">
                <button
                  className="studio-button primary"
                  disabled={working === "save"}
                  onClick={() => void saveConfig()}
                >
                  {working === "save" ? tr("Saving…") : tr("Save NDI settings")}
                </button>
                <button
                  className="studio-button"
                  onClick={() => setSettingsOpen(false)}
                >
                   {tr("Cancel")} </button>
              </div>
            </div>
          )}
          <details className="settings-disclosure">
            <summary>{tr("Transmission details")}</summary>
            <dl className="detail-list">
              <div>
                <dt>{tr("NDI version")}</dt>
                <dd>{info.version || "Unknown"}</dd>
              </div>
              <div>
                <dt>{tr("Capture active")}</dt>
                <dd>{info.capturing ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>{tr("Captured frames")}</dt>
                <dd>{info.captureFrameCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{tr("Skipped capture ticks")}</dt>
                <dd>{info.captureSkippedFrames || 0}</dd>
              </div>
              <div>
                <dt>{tr("Last capture and send")}</dt>
                <dd>{info.captureDurationMs || 0} ms</dd>
              </div>
              <div>
                <dt>{tr("Capture errors")}</dt>
                <dd>{info.captureErrors}</dd>
              </div>
            </dl>
          </details>
        </>
      )}

      {results && (
        <dialog
          ref={diagnostics}
          className="studio-dialog diagnostics-dialog"
          aria-labelledby="ndi-test-title"
          onClose={() => setResults(null)}
        >
          <div className="panel-heading">
            <h2 id="ndi-test-title">{tr("NDI diagnostics")}</h2>
            <button
              className="icon-button"
              aria-label={tr("Close NDI diagnostics")}
              onClick={() => setResults(null)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="diagnostic-results">
            {results.details.map((detail, index) => (
              <p key={index}>{tr(detail)}</p>
            ))}
          </div>
          {results.error && (
            <p className="studio-error" role="alert">
              {results.error}
            </p>
          )}
          <button className="studio-button" onClick={() => setResults(null)}>
             {tr("Close diagnostics")} </button>
        </dialog>
      )}
    </section>
  );
}

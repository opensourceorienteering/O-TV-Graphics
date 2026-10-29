import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WebOutputPanel } from "../components/WebOutputPanel";
import { NDIOutputPanel } from "../components/NDIOutputPanel";
import { Monitor } from "./Monitor";
import { call } from "./api";

export function EventOutput({ eventId }: { eventId: string }) {
  const [resolution, setResolution] = useState("HD");
  const [webEnabled, setWebEnabled] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call("settings:get")
      .then((config) => {
        setResolution(config.general.resolution);
        setWebEnabled(config.output.web.enabled);
      })
      .catch((e) => setError(e.message));
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="studio-form">
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{tr(notice)}</p>}
      <section className="connection-card output-basics">
        <div className="connection-card-heading">
          <div>
            <h3>{tr("Output format")}</h3>
            <p>
               {tr("These app-wide settings are shared by every event. Changing the resolution or web server requires a restart.")} </p>
          </div>
        </div>
        <div className="field-grid">
          <label>
             {tr("Resolution")} <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            >
              <option value="HD">HD · 1920 × 1080</option>
              <option value="4K">4K · 3840 × 2160</option>
              <option value="AUTO">{tr("Match graphics display")}</option>
            </select>
          </label>
          <label className="inline-label">
            <input
              type="checkbox"
              checked={webEnabled}
              onChange={(e) => setWebEnabled(e.target.checked)}
            />
             {tr("Enable web output")} </label>
        </div>
        <button
          className="studio-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await call("settings:update", {
                general: { resolution },
                output: { web: { enabled: webEnabled } },
              });
              setNotice(
                "Output settings saved. Restart Split Control to apply server or resolution changes.",
              );
            })
          }
        >
           {tr("Save output format")} </button>
        <p className="muted output-settings-link">
           {tr("Need server ports or advanced defaults?")} <Link to="/settings?section=output">{tr("Open output settings")}</Link>.
        </p>
      </section>
      <WebOutputPanel />
      <NDIOutputPanel />
      <section className="connection-card">
        <div className="connection-card-heading">
          <div>
            <h3>{tr("Signal check")}</h3>
            <p>
               {tr("Send color bars and safe-area guides through the real output path. This replaces graphics currently on air.")} </p>
          </div>
        </div>
        <div className="row wrap">
          <button
            className="studio-button danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await call("output:pattern", eventId, true);
                setNotice("Test pattern is on air.");
              })
            }
          >
             {tr("Put test pattern on air")} </button>
          <button
            className="studio-button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await call("output:pattern", eventId, false);
                setNotice("Test pattern cleared.");
              })
            }
          >
             {tr("Clear test pattern")} </button>
        </div>
        <Monitor kind="program" />
      </section>
    </div>
  );
}

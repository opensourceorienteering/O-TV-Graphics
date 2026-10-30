import { t as tr } from "../i18n";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { WebOutputPanel } from "../components/WebOutputPanel";
import { NDIOutputPanel } from "../components/NDIOutputPanel";
import { Monitor } from "./Monitor";
import { call } from "./api";
import type { EventLiveOutputs, EventSummary } from "../../../shared/types/event";

export function EventOutput({ eventId, onChange }: { eventId: string; onChange?: () => void }) {
  const [liveOutputs, setLiveOutputs] = useState<EventLiveOutputs>();
  const [resolution, setResolution] = useState("HD");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    call<{ summary: EventSummary }>("event:get", eventId)
      .then((state) => setLiveOutputs(state.summary.liveOutputs))
      .catch((e) => setError(e.message));
  }, [eventId]);
  const chooseOutput = (key: keyof EventLiveOutputs, on: boolean) => {
    if (!liveOutputs) return;
    const next = { ...liveOutputs, [key]: on };
    setLiveOutputs(next);
    void run(async () => {
      await call("event:update", eventId, { liveOutputs: next });
      onChange?.();
    });
  };
  useEffect(() => {
    call("settings:get")
      .then((config) => {
        setResolution(config.general.resolution);
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
      <section className="connection-card">
        <div className="connection-card-heading">
          <div>
            <h3>{tr("Outputs in Live")}</h3>
            <p>
               {tr("The outputs chosen here turn on automatically when this event opens in Live. NDI turns off again when Live ends.")} </p>
          </div>
        </div>
        <div className="field-grid">
          <label className="inline-label">
            <input
              type="checkbox"
              disabled={!liveOutputs || busy}
              checked={!!liveOutputs?.web}
              onChange={(e) => chooseOutput("web", e.target.checked)}
            />
             {tr("Web output (browser source)")} </label>
          <label className="inline-label">
            <input
              type="checkbox"
              disabled={!liveOutputs || busy}
              checked={!!liveOutputs?.ndi}
              onChange={(e) => chooseOutput("ndi", e.target.checked)}
            />
             {tr("NDI output")} </label>
        </div>
        {liveOutputs && !liveOutputs.web && !liveOutputs.ndi && (
          <p className="muted">{tr("Choose at least one output to go live.")}</p>
        )}
      </section>
      <section className="connection-card output-basics">
        <div className="connection-card-heading">
          <div>
            <h3>{tr("Output format")}</h3>
            <p>
               {tr("The resolution is shared by every event. Changing it requires a restart.")}{" "}
              {tr("Server ports, the NDI name and other app-wide defaults are in")}{" "}
              <Link to="/settings?tab=outputs">{tr("Output settings")}</Link>.
            </p>
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
        </div>
        <button
          className="studio-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await call("settings:update", { general: { resolution } });
              setNotice("Resolution saved. Restart Split Control to apply it.");
            })
          }
        >
           {tr("Save output format")} </button>
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

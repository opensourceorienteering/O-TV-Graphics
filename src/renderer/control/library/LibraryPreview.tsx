/**
 * Plays one library graphic on the simulated race, in the control window only.
 * It never touches the real output: it has its own renderer, like the Preview monitor.
 */
import { t as tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, SkipForward } from "lucide-react";
import { OGrafRenderer } from "../../graphics/ograf-renderer";
import { call } from "../events/api";
import { createRace } from "../../../../site/preview/sim.js";
import { changeClockSpeed, clockTime, sampleGraphicData, startClock } from "./sampleData";
import { PreviewSession } from "./previewSession";
import { graphicDetails } from "./libraryModel";
import type { PreviewClock } from "./sampleData";
import type { OGrafTemplateInfo } from "../../../shared/types/ograf";

export function LibraryPreview({ template }: { template: OGrafTemplateInfo }) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef<PreviewSession | null>(null);
  const race = useRef(createRace());
  const clock = useRef<PreviewClock | null>(null);
  const [origin, setOrigin] = useState("");
  const [speed, setSpeed] = useState(20);
  const [shown, setShown] = useState(false);
  const [error, setError] = useState("");

  const data = () => {
    clock.current ??= startClock(20);
    return sampleGraphicData(template, race.current, clockTime(race.current, clock.current));
  };

  useEffect(() => {
    call<{ localhostUrl: string }>("output:getWebInfo")
      .then((info) => setOrigin(new URL(info.localhostUrl).origin))
      .catch((e) => setError((e as Error).message));
  }, []);

  // Same 1920×1080 scaling as the Preview monitor
  useEffect(() => {
    if (!frame.current || !stage.current) return;
    const resize = new ResizeObserver((entries) => {
      if (!stage.current) return;
      const { width, height } = entries[0].contentRect;
      const scale = Math.min(width / 1920, height / 1080);
      stage.current.style.transform = `scale(${scale})`;
      stage.current.style.left = `${(width - 1920 * scale) / 2}px`;
      stage.current.style.top = `${(height - 1080 * scale) / 2}px`;
    });
    resize.observe(frame.current);
    return () => resize.disconnect();
  }, []);

  // A new renderer for each graphic; shown straight away
  // A new session for each graphic; it shows the graphic once loaded
  useEffect(() => {
    if (!origin || !stage.current) return;
    const host = document.createElement("div");
    host.className = "monitor-graphics";
    stage.current.appendChild(host);
    const renderer = new OGrafRenderer(host, origin);
    const s = new PreviewSession(renderer, template, data);
    session.current = s;
    let alive = true;
    const sync = () => alive && setShown(s.shown);
    s.open()
      .then(() => {
        if (!alive) return;
        sync();
        setError("");
      })
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
      session.current = null;
      s.close();
      // clearAll runs inside close(); remove the element once it has had a moment to finish
      setTimeout(() => host.remove(), 0);
    };
    // data() reads refs; the graphic changes only with the template
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, template]);

  // While shown, follow the race once a second
  useEffect(() => {
    if (!shown) return;
    const timer = setInterval(() => {
      void session.current?.tick().catch((e) => setError((e as Error).message));
    }, 1000);
    return () => clearInterval(timer);
  }, [shown]);

  const act = async (what: "show" | "next" | "hide") => {
    const s = session.current;
    if (!s) return;
    setError("");
    try {
      await s[what]();
      setShown(s.shown);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const changeSpeed = (next: number) => {
    clock.current = clock.current ? changeClockSpeed(race.current, clock.current, next) : startClock(next);
    setSpeed(next);
  };

  const feeds = template.desk?.feeds?.length ? template.desk.feeds.join(", ") : tr("typed fields only");

  return (
    <aside className="library-preview studio-panel" aria-label={tr("Preview")}>
      <h3>{template.desk?.label ?? template.manifest.name}</h3>
      <div className="monitor-frame" ref={frame}>
        <div className="monitor-stage" ref={stage} />
      </div>
      <div className="row wrap library-preview-controls">
        <button className="studio-button" onClick={() => void act("show")}>
          <Eye size={15} aria-hidden="true" /> {tr("Show")}
        </button>
        <button className="studio-button" onClick={() => void act("next")}>
          <SkipForward size={15} aria-hidden="true" /> {tr("Next")}
        </button>
        <button className="studio-button" onClick={() => void act("hide")}>
          <EyeOff size={15} aria-hidden="true" /> {tr("Hide")}
        </button>
        <span className="library-preview-speed" role="group" aria-label={tr("Sample race speed")}>
          {[1, 20].map((s) => (
            <button
              key={s}
              className={`studio-button${speed === s ? " primary" : ""}`}
              aria-pressed={speed === s}
              onClick={() => changeSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </span>
      </div>
      <p className="muted">
        {tr("Sample race")} · {tr("Data used")}: {feeds}
      </p>
      {(template.description || template.manifest.description) && (
        <p>{template.description || template.manifest.description}</p>
      )}
      <details>
        <summary>{tr("Technical details")}</summary>
        <dl>
          {graphicDetails(template).map(([label, value]) => (
            <div key={label}>
              <dt>{tr(label)}</dt>
              <dd>{label === "ID" ? <code>{value}</code> : value}</dd>
            </div>
          ))}
        </dl>
      </details>
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}

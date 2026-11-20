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
import type { PreviewClock } from "./sampleData";
import type { OGrafTemplateInfo } from "../../../shared/types/ograf";

const ID = "library-preview";

export function LibraryPreview({ template }: { template: OGrafTemplateInfo }) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const renderer = useRef<OGrafRenderer | null>(null);
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
  useEffect(() => {
    if (!origin || !stage.current) return;
    const host = document.createElement("div");
    host.className = "monitor-graphics";
    stage.current.appendChild(host);
    const r = new OGrafRenderer(host, origin);
    renderer.current = r;
    let alive = true;
    setShown(false);
    setError("");
    (async () => {
      try {
        await r.loadGraphic(ID, template.manifest, template.directoryName, data());
        if (!alive) return;
        await r.playGraphic(ID, {});
        if (alive) setShown(true);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
      renderer.current = null;
      void r.clearAll().finally(() => host.remove());
    };
    // data() reads refs; the graphic changes only with the template
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, template]);

  // While shown, follow the race once a second
  useEffect(() => {
    if (!shown) return;
    const timer = setInterval(() => {
      const r = renderer.current;
      if (r?.isLoaded(ID)) void r.updateGraphic(ID, data()).catch((e) => setError((e as Error).message));
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, template]);

  const act = async (what: "show" | "next" | "hide") => {
    const r = renderer.current;
    if (!r) return;
    setError("");
    try {
      if (!r.isLoaded(ID)) await r.loadGraphic(ID, template.manifest, template.directoryName, data());
      if (what === "hide") {
        await r.stopGraphic(ID);
        setShown(false);
      } else {
        await r.playGraphic(ID, what === "next" ? { delta: 1 } : {});
        setShown(true);
      }
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
      <h3>{template.manifest.name}</h3>
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
      {error && (
        <p className="studio-error" role="alert">
          {error}
        </p>
      )}
    </aside>
  );
}

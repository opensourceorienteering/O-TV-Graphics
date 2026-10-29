import { t as tr } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { OGrafRenderer } from "../../graphics/ograf-renderer";
import { call } from "./api";

export function Monitor({
  kind,
  detached = false,
}: {
  kind: "program" | "preview";
  detached?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [label, setLabel] = useState("Select a graphic to preview");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    if (detached)
      document.title = `Split Control · ${kind === "program" ? "Program" : "Preview"}`;
    call("output:getWebInfo")
      .then((info) => {
        if (alive)
          setUrl(
            `${info.localhostUrl}?wsPort=${info.wsPort}&webPort=${info.port}`,
          );
      })
      .catch((e) => setError(e.message));
    const timer = setInterval(
      () =>
        call<string[]>("window:monitors")
          .then((list) => {
            if (alive) setOpen(list.includes(kind));
          })
          .catch(() => {}),
      750,
    );
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [kind]);
  useEffect(() => {
    if (!frame.current || !stage.current) return;
    const resize = new ResizeObserver((entries) => {
      if (stage.current) {
        const { width, height } = entries[0].contentRect;
        const scale = Math.min(width / 1920, height / 1080);
        stage.current.style.transform = `scale(${scale})`;
        stage.current.style.left = `${(width - 1920 * scale) / 2}px`;
        stage.current.style.top = `${(height - 1080 * scale) / 2}px`;
      }
    });
    resize.observe(frame.current);
    return () => resize.disconnect();
  }, [url, open]);
  useEffect(() => {
    if (kind !== "preview" || !url || (!detached && open) || !stage.current)
      return;
    const host = document.createElement("div");
    host.className = "monitor-graphics";
    stage.current.appendChild(host);
    const renderer = new OGrafRenderer(host, new URL(url).origin);
    let alive = true,
      busy = false,
      version = -1,
      retryAfter = 0;
    const update = async () => {
      if (busy || Date.now() < retryAfter) return;
      busy = true;
      try {
        const snapshot = await call("preview:get");
        if (!alive || snapshot.version === version) return;
        await renderer.clearAll();
        if (snapshot.payload) {
          const { template, data, name } = snapshot.payload;
          const result = await renderer.loadGraphic(
            "preview",
            template.manifest,
            template.directoryName,
            data,
          );
          if (
            result &&
            "statusCode" in result &&
            Number(result.statusCode) >= 400
          )
            throw new Error("Graphic could not load");
          if (!alive) {
            await renderer.clearAll();
            return;
          }
          await renderer.playGraphic("preview", { skipAnimation: true });
          if (alive) {
            setLabel(name);
            setError("");
          }
        } else if (alive) {
          setLabel("Select a graphic to preview");
          setError("");
        }
        version = snapshot.version;
      } catch (e) {
        retryAfter = Date.now() + 2000;
        if (alive) setError((e as Error).message);
      } finally {
        busy = false;
      }
    };
    void update();
    const timer = setInterval(update, 400);
    return () => {
      alive = false;
      clearInterval(timer);
      void renderer.clearAll();
      host.remove();
    };
  }, [kind, url, open, detached]);
  const toggle = async () => {
    try {
      if (detached) await call("window:closeMonitor", kind);
      else if (open) {
        await call("window:closeMonitor", kind);
        setOpen(false);
      } else {
        await call("window:openMonitor", kind);
        setOpen(true);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const programUrl = (() => {
    if (!url) return "";
    const parsed = new URL(url);
    parsed.searchParams.set("alphaPreview", "1");
    return parsed.toString();
  })();
  return (
    <section
      className={`studio-panel monitor-panel ${detached ? "monitor-detached" : ""}`}
    >
      <div className="panel-heading">
        <h2>{kind === "program" ? tr("Program") : tr("Preview")}</h2>
        <button className="studio-button" onClick={toggle}>
          <ExternalLink size={15} />
          {detached || open ? "Dock" : tr("Pop out")}
        </button>
      </div>
      {!detached && open ? (
        <div className="monitor-placeholder">
          <p>
            {kind === "program" ? tr("Program") : tr("Preview")}  {tr("is in its own window.")} </p>
          <button
            className="studio-button"
            onClick={() =>
              call("window:openMonitor", kind).catch((e) => setError(e.message))
            }
          >
             {tr("Show window")} </button>
          <button className="studio-button" onClick={toggle}>
             {tr("Dock here")} </button>
        </div>
      ) : (
        <div className="monitor-frame" ref={frame}>
          <div className="monitor-stage" ref={stage}>
            {kind === "program" && programUrl && (
              <iframe title={tr("Program output")} src={programUrl} />
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="studio-error">
          {error}
        </p>
      )}
      <p className="monitor-caption">
        {kind === "program" ? tr("On air · matches the web output") : label}
      </p>
    </section>
  );
}

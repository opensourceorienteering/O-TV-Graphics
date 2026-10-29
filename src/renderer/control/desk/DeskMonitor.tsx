import { t as tr } from "../i18n";
/**
 * Program and Preview monitors for the live desk.
 *  - Program shows the real web output (what OBS / vMix receive).
 *  - Preview renders the prepared draft in its own renderer; it never sends playback commands.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { OGrafRenderer } from '../../graphics/ograf-renderer';
import { call } from '../events/api';

/** Scale a 1920x1080 stage into its box */
function useStageScale(box: React.RefObject<HTMLDivElement | null>, stage: React.RefObject<HTMLDivElement | null>, deps: unknown[]) {
  useEffect(() => {
    if (!box.current || !stage.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!stage.current) return;
      const { width, height } = entry.contentRect;
      const s = Math.min(width / 1920, height / 1080);
      stage.current.style.transform = `scale(${s})`;
      stage.current.style.left = `${(width - 1920 * s) / 2}px`;
      stage.current.style.top = `${(height - 1080 * s) / 2}px`;
    });
    ro.observe(box.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useOutputUrl(): string {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    call('output:getWebInfo')
      .then(info => alive && setUrl(`${info.localhostUrl}?wsPort=${info.wsPort}&webPort=${info.port}`))
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return url;
}

/** Monitor-only output URL. The real web/NDI output remains transparent. */
function alphaPreviewUrl(url: string): string {
  if (!url) return '';
  const parsed = new URL(url);
  parsed.searchParams.set('alphaPreview', '1');
  return parsed.toString();
}

export function ProgramVideo() {
  const url = useOutputUrl();
  const monitorUrl = alphaPreviewUrl(url);
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useStageScale(box, stage, [monitorUrl]);
  return (
    <div className="mon-video" ref={box}>
      <div className="stage" ref={stage}>{monitorUrl && <iframe title={tr("Program output")} src={monitorUrl} />}</div>
      {!url && <div className="msg">{tr("Connecting to the output…")}</div>}
    </div>
  );
}

/** Renders whatever the main process holds as the preview draft (preview:get) */
export function PreviewVideo({ onStatus }: { onStatus?: (s: { name?: string; error?: string; version: number }) => void }) {
  const url = useOutputUrl();
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState('Choose a graphic and prepare it');
  useStageScale(box, stage, [url]);
  useEffect(() => {
    if (!url || !stage.current) return;
    const root = stage.current;
    const origin = new URL(url).origin;
    // One host + renderer per prepared draft. A new draft hides the old one at once and
    // disposes it in the background, so Preview never shows the previous graphic while
    // its exit animation runs.
    let current: { host: HTMLDivElement; renderer: OGrafRenderer } | null = null;
    const retire = () => {
      const old = current;
      current = null;
      if (!old) return;
      old.host.style.visibility = 'hidden';
      void old.renderer.clearAll().finally(() => old.host.remove());
    };
    let alive = true, busy = false, version = -1, failures = 0;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const snap = await call('preview:get');
        if (!alive || snap.version === version) return;
        retire();
        if (snap.payload) {
          setMessage('Loading preview…');
          const { template, data, name, page } = snap.payload;
          const host = document.createElement('div');
          root.appendChild(host);
          const renderer = new OGrafRenderer(host, origin);
          current = { host, renderer };
          await renderer.loadGraphic('preview', template.manifest, template.directoryName, data);
          await renderer.playGraphic('preview', { skipAnimation: true });
          for (let p = 1; p < (page || 1); p++) await renderer.playGraphic('preview', { delta: 1, skipAnimation: true });
          if (!alive) return;
          setMessage('');
          onStatus?.({ name, version: snap.version });
        } else {
          setMessage('Nothing prepared');
          onStatus?.({ version: snap.version });
        }
        version = snap.version;
        failures = 0;
      } catch (e) {
        // Try the same draft again on the next tick (a few times), then report it
        retire();
        if (++failures >= 3) {
          setMessage('Preview unavailable');
          onStatus?.({ error: (e as Error).message, version });
          failures = 0;
          version = (await call('preview:get').catch(() => ({ version }))).version;
        }
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(tick, 300);
    return () => {
      alive = false;
      clearInterval(timer);
      retire();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return (
    <div className="mon-video" ref={box}>
      <div className="stage" ref={stage} />
      {message && <div className="msg">{message}</div>}
    </div>
  );
}

export function onAirFor(since?: number, now = Date.now()): string {
  if (!since) return '00:00:00';
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
}

export function MonitorHead({ title, onAir, since, tools }: { title: string; onAir: boolean; since?: number; tools?: ReactNode }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!onAir) return;
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, [onAir]);
  return (
    <div className="mon-head">
      <span>{tr(title)}</span>
      <span className="tools">
        <span className="tx" aria-live="polite">
          {onAir ? (<><span className="on">{tr("● ON AIR")}</span><span>{tr("FOR")}</span><b>{onAirFor(since)}</b></>) : <span>{tr("○ NOT ON AIR")}</span>}
        </span>
        {tools}
      </span>
    </div>
  );
}

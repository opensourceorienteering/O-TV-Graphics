/**
 * Renders graphics in a sealed frame instead of in the operator window. The frame is a page on
 * the web server's address (127.0.0.1, a different origin from the operator UI) and has no
 * preload bridge, so graphic code in it can't reach the app's functions. This class offers the
 * renderer methods the previews use and turns them into messages to the frame.
 */
import type { OGrafManifest, PlayActionOptions } from "../../../shared/types/ograf";
import type { PreviewRenderer } from "../library/previewSession";
import type { FrameReply, FrameRequest } from "../../preview-frame/frameProtocol";

/** The frame's address; 127.0.0.1 keeps it a different origin from the operator UI in every mode */
export function previewFrameUrl(webPort: number): string {
  return `http://127.0.0.1:${webPort}/preview-frame?webPort=${webPort}`;
}

/**
 * The web output as the Program monitor embeds it: on 127.0.0.1, so it is never the operator
 * UI's own origin (in development both would otherwise be localhost:5175 after the redirect)
 */
export function sealedOutputUrl(url: string): string {
  const u = new URL(url);
  if (u.hostname === "localhost") u.hostname = "127.0.0.1";
  return u.toString();
}

interface Env {
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  doc: Pick<Document, "createElement">;
  /** Where blocked-address reports from the frame go (Settings → Internet access) */
  reportBlocked?: (report: { origin: string; graphics: string[] }) => void;
}

const reportThroughApp = (report: { origin: string; graphics: string[] }) =>
  void window.electronAPI?.invoke("graphicsAccess:reportBlocked", report).catch(() => undefined);

const REQUEST_TIMEOUT_MS = 10_000;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Request = FrameRequest extends infer R ? (R extends unknown ? Omit<R, "requestId"> : never) : never;

export class SealedRenderer implements PreviewRenderer {
  /** Bumped when the internet allowlist changes: frames loaded before it reload first */
  private static rulesVersion = 0;

  static rulesChanged(): void {
    SealedRenderer.rulesVersion++;
  }

  private iframe: HTMLIFrameElement;
  private frameRules = 0;
  /** Where the frame actually lives (development redirects it to the Vite server) */
  private frameOrigin = "";
  private ready!: Promise<void>;
  private markReady!: () => void;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private loaded = new Set<string>();
  private directory: string | null = null;
  private disposed = false;
  /** Page load number, echoed by the frame's ready message, so a late ready from the page before is ignored */
  private gen = 0;
  private markClosed!: (e: Error) => void;
  private closed = new Promise<never>((_, reject) => (this.markClosed = reject));

  constructor(
    host: HTMLElement,
    private frameUrl: string,
    private env: Env = { win: window, doc: document, reportBlocked: reportThroughApp },
  ) {
    this.iframe = env.doc.createElement("iframe") as HTMLIFrameElement;
    this.iframe.setAttribute("title", "Graphics preview");
    Object.assign(this.iframe.style, {
      position: "absolute",
      inset: "0",
      width: "1920px",
      height: "1080px",
      border: "0",
      background: "transparent",
    });
    this.iframe.setAttribute("allowtransparency", "true");
    // Nobody may be waiting when the preview closes: don't report that as an unhandled rejection
    this.closed.catch(() => undefined);
    env.win.addEventListener("message", this.onMessage);
    this.reload();
    host.appendChild(this.iframe);
  }

  private reload() {
    this.frameRules = SealedRenderer.rulesVersion;
    this.ready = new Promise((resolve) => (this.markReady = resolve));
    this.loaded.clear();
    this.rejectPending("Preview reloaded");
    const url = new URL(this.frameUrl);
    url.searchParams.set("gen", String(++this.gen));
    this.iframe.src = url.toString();
  }

  private rejectPending(message: string) {
    for (const waiting of this.pending.values()) waiting.reject(new Error(message));
    this.pending.clear();
  }

  private onMessage = (event: MessageEvent) => {
    // Only the frame we created may answer (origin strings don't work for file:// pages)
    if (event.source !== this.iframe.contentWindow) return;
    const blocked = (event.data as { blocked?: { origin: string; graphics: string[] } })?.blocked;
    if (blocked) {
      this.env.reportBlocked?.({ origin: String(blocked.origin), graphics: Array.isArray(blocked.graphics) ? blocked.graphics.map(String) : [] });
      return;
    }
    const data = event.data as FrameReply | { ready?: boolean; gen?: number };
    if ((data as { ready?: boolean })?.ready) {
      if ((data as { gen?: number }).gen !== this.gen) return; // from the page before a reload
      this.frameOrigin = event.origin;
      this.markReady();
      return;
    }
    const reply = data as FrameReply;
    const waiting = this.pending.get(reply?.requestId);
    if (!waiting) return;
    this.pending.delete(reply.requestId);
    if (reply.ok) waiting.resolve(reply.result);
    else waiting.reject(new Error(reply.error));
  };

  private async send(request: Request): Promise<unknown> {
    if (this.disposed) throw new Error("Preview closed");
    await Promise.race([this.ready, this.closed]);
    if (this.disposed) throw new Error("Preview closed");
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      // A frame that stops answering must not hold the preview for ever
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new Error("The preview did not answer"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.iframe.contentWindow?.postMessage({ ...request, requestId }, this.frameOrigin || new URL(this.frameUrl).origin);
    });
  }

  async loadGraphic(id: string, manifest: OGrafManifest, directory: string, data: unknown): Promise<unknown> {
    // A different graphic gets a fresh page: everything the previous one loaded is freed
    // ...and so does a frame loaded before the internet allowlist last changed
    if ((this.directory !== null && this.directory !== directory) || this.frameRules !== SealedRenderer.rulesVersion) this.reload();
    this.directory = directory;
    const result = await this.send({ op: "load", id, manifest, directory, data });
    this.loaded.add(id);
    return result;
  }

  playGraphic(id: string, options: PlayActionOptions = {}): Promise<unknown> {
    return this.send({ op: "play", id, options });
  }

  stopGraphic(id: string): Promise<unknown> {
    return this.send({ op: "stop", id });
  }

  updateGraphic(id: string, data: unknown): Promise<unknown> {
    return this.send({ op: "update", id, data });
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  async clearAll(): Promise<void> {
    this.loaded.clear();
    if (this.disposed) return;
    await this.send({ op: "clear" });
  }

  dispose(): void {
    this.disposed = true;
    this.env.win.removeEventListener("message", this.onMessage);
    this.rejectPending("Preview closed");
    this.markClosed(new Error("Preview closed"));
    this.iframe.remove();
  }
}

// The main process announces allowlist changes to the operator UI
if (typeof window !== "undefined") {
  window.electronAPI?.receive?.("fromMain", (message: { type?: string }) => {
    if (message?.type === "graphicsAccessChanged") SealedRenderer.rulesChanged();
  });
}

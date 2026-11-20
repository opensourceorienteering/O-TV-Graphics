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

interface Env {
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  doc: Pick<Document, "createElement">;
}

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
  private ready!: Promise<void>;
  private markReady!: () => void;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private loaded = new Set<string>();
  private directory: string | null = null;
  private disposed = false;

  constructor(
    host: HTMLElement,
    private frameUrl: string,
    private env: Env = { win: window, doc: document },
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
    env.win.addEventListener("message", this.onMessage);
    this.reload();
    host.appendChild(this.iframe);
  }

  private reload() {
    this.frameRules = SealedRenderer.rulesVersion;
    this.ready = new Promise((resolve) => (this.markReady = resolve));
    this.loaded.clear();
    this.iframe.src = this.frameUrl;
  }

  private onMessage = (event: MessageEvent) => {
    // Only the frame we created may answer (origin strings don't work for file:// pages)
    if (event.source !== this.iframe.contentWindow) return;
    const data = event.data as FrameReply | { ready?: boolean };
    if ((data as { ready?: boolean })?.ready) {
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
    await this.ready;
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.iframe.contentWindow?.postMessage({ ...request, requestId }, new URL(this.frameUrl).origin);
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
    for (const waiting of this.pending.values()) waiting.reject(new Error("Preview closed"));
    this.pending.clear();
    this.iframe.remove();
  }
}

// The main process announces allowlist changes to the operator UI
if (typeof window !== "undefined") {
  window.electronAPI?.receive?.("fromMain", (message: { type?: string }) => {
    if (message?.type === "graphicsAccessChanged") SealedRenderer.rulesChanged();
  });
}

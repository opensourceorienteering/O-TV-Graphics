/**
 * Messages between the operator window and the sealed preview frame. The frame runs graphic
 * code on the web server's address, without the app's preload bridge; the operator window
 * drives it with these requests and the frame answers each one.
 */
import type { OGrafManifest, PlayActionOptions } from "../../shared/types/ograf";
import type { OGrafRenderer } from "../graphics/ograf-renderer";

export type FrameRequest = { requestId: number } & (
  | { op: "load"; id: string; manifest: OGrafManifest; directory: string; data: unknown }
  | { op: "play"; id: string; options?: PlayActionOptions }
  | { op: "stop"; id: string }
  | { op: "update"; id: string; data: unknown }
  | { op: "clear" }
);

export type FrameReply =
  | { requestId: number; ok: true; result?: unknown }
  | { requestId: number; ok: false; error: string };

/** Sent by the frame once it can take requests (again after each reload) */
export interface FrameReady {
  ready: true;
}

type FrameRenderer = Pick<OGrafRenderer, "loadGraphic" | "playGraphic" | "stopGraphic" | "updateGraphic" | "clearAll">;

export async function handleFrameRequest(renderer: FrameRenderer, req: FrameRequest): Promise<FrameReply> {
  const requestId = Number(req?.requestId);
  try {
    let result: unknown;
    switch (req.op) {
      case "load":
        result = await renderer.loadGraphic(req.id, req.manifest, req.directory, req.data);
        break;
      case "play":
        result = await renderer.playGraphic(req.id, req.options ?? {});
        break;
      case "stop":
        result = await renderer.stopGraphic(req.id);
        break;
      case "update":
        result = await renderer.updateGraphic(req.id, req.data);
        break;
      case "clear":
        await renderer.clearAll();
        break;
      default:
        throw new Error("Unknown preview request");
    }
    return { requestId, ok: true, result };
  } catch (error) {
    return { requestId, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Handles requests one at a time, in the order they arrived (a clear must finish before the next load) */
export function createFrameHandler(renderer: FrameRenderer): (req: FrameRequest) => Promise<FrameReply> {
  let chain: Promise<unknown> = Promise.resolve();
  return (req) => {
    const reply = chain.then(() => handleFrameRequest(renderer, req));
    chain = reply;
    return reply;
  };
}

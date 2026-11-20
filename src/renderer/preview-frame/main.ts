/**
 * Sealed preview frame. Runs graphic code for the operator window's previews (Live desk, Plan,
 * Graphics library) on the web server's address, with no preload bridge. It takes requests only
 * from the window that embeds it and answers each one.
 */
import { OGrafRenderer } from "../graphics/ograf-renderer";
import { createFrameHandler, type FrameRequest } from "./frameProtocol";

const params = new URLSearchParams(window.location.search);
const webPort = params.get("webPort") || window.location.port || "5657";
// Templates come from the app's web server (in development this page itself is served by Vite)
const templatesBase = `${window.location.protocol}//${window.location.hostname}:${webPort}`;

const renderer = new OGrafRenderer(document.getElementById("graphics-container")!, templatesBase);
const handle = createFrameHandler(renderer);

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  void handle(event.data as FrameRequest).then((reply) => {
    // The parent may be a file:// page (origin "null"), so the reply can't name it; it goes only to window.parent
    window.parent.postMessage(reply, "*");
  });
});

window.parent.postMessage({ ready: true }, "*");

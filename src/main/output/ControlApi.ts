/**
 * Control API for Companion / Stream Deck and other hardware: the same actions as the Live
 * desk, on the event that is open in Live mode. Control surfaces prepare a draft in Preview
 * (a favourite or a runner), then Show / Update / Hide it. Every action accepts GET and POST,
 * so Companion's "Generic HTTP" buttons work without a dedicated module.
 *
 *   GET  /api/control/state                          on air, prepared draft, data and output
 *   GET  /api/control/favorites                      favourites of the live event (button list)
 *   GET  /api/control/tally/:key                     { onAir, name } for a desk graphic
 *   ANY  /api/control/show | update                  the draft in Preview
 *   ANY  /api/control/hide                           the most recent graphic on air
 *   ANY  /api/control/hide/:key                      one graphic (e.g. runner-identity)
 *   ANY  /api/control/hide-all
 *   ANY  /api/control/page/next|previous             page the paged graphic on air
 *   ANY  /api/control/favorite/:id/prepare|show      load a favourite (and put it on air)
 *   ANY  /api/control/runner/:bib/:key               load a runner graphic by bib or virtual bib
 */

import express from "express";
import * as live from "../events/LiveControl";
import { getLogger } from "../utils/logger";

const logger = getLogger();

export function createControlApiRouter(): express.Router {
  const router = express.Router();
  // Reading state is open to any origin (dashboards, tally lights). Actions are not: a web page
  // in a browser on this computer must not be able to take or clear graphics (e.g. with an
  // <img src=".../clear-all">). Companion, Stream Deck tools and curl send no browser headers.
  router.use((req, res, next) => {
    if (req.method === "GET" && /^\/(state|tally|favorites)/.test(req.path))
      res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  });
  const fromOtherSite = (req: express.Request): boolean => {
    const site = req.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") return true;
    const origin = req.get("origin");
    if (origin) {
      try {
        return new URL(origin).host !== req.get("host");
      } catch {
        return true;
      }
    }
    return false;
  };

  const action =
    (fn: (req: express.Request) => Promise<unknown>) =>
    async (req: express.Request, res: express.Response) => {
      if (fromOtherSite(req)) {
        res.status(403).json({
          ok: false,
          error: "Control actions are not accepted from web pages on other sites",
        });
        return;
      }
      try {
        const state: any = await fn(req);
        res.json({ ok: true, onAir: state?.onAir?.length ?? undefined, prepared: state?.prepared?.name ?? null });
      } catch (error: any) {
        logger.warn("Control API action failed", {
          path: req.path,
          error: error?.message,
        });
        res
          .status(error?.status || 400)
          .json({ ok: false, error: error?.message || String(error) });
      }
    };
  const any = (
    route: string,
    fn: (req: express.Request) => Promise<unknown>,
  ) => {
    router.get(route, action(fn));
    router.post(route, action(fn));
  };

  const read =
    (fn: (req: express.Request) => unknown) =>
    async (req: express.Request, res: express.Response) => {
      try {
        res.json(await fn(req));
      } catch (error: any) {
        res.status(500).json({ error: error?.message || String(error) });
      }
    };

  router.get("/graphics", read(async () => (await live.controlState()).graphics ?? []));
  router.get("/state", read(() => live.controlState()));
  router.get(
    "/favorites",
    read(async () =>
      (await live.favorites()).map((f) => ({
        id: f.id,
        /** F-number within the graphic: "<graphic number> F<n>" in the palette */
        n: f.n,
        label: f.label,
        key: f.key,
        graphic: f.graphic,
        prepare: `/api/control/favorite/${encodeURIComponent(f.id)}/prepare`,
        show: `/api/control/favorite/${encodeURIComponent(f.id)}/show`,
      })),
    ),
  );
  router.get(
    "/tally/:key",
    read(async (req) => {
      const state = await live.controlState();
      const on = state.onAir.find((o) => o.key === req.params.key);
      return { onAir: !!on, name: on?.name ?? "", step: on?.step ?? 0 };
    }),
  );

  any("/show", () => live.show());
  any("/update", () => live.update());
  any("/hide", () => live.hide());
  any("/hide-all", () => live.hideAll());
  any("/hide/:key", (req) => live.hide(String(req.params.key)));
  any("/page/next", () => live.page(1));
  any("/page/previous", () => live.page(-1));
  any("/favorite/:id/prepare", (req) => live.prepareFavorite(String(req.params.id)));
  any("/favorite/:id/show", (req) => live.prepareFavorite(String(req.params.id), true));
  any("/runner/:bib/:key", (req) =>
    live.prepareRunner(String(req.params.bib), String(req.params.key)),
  );

  return router;
}

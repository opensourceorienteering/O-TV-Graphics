/**
 * Director start alerts: a page for the director (any device on the network) that lists the
 * upcoming starters of chosen classes and beeps before favourites start, so the camera can be
 * on them. Data comes from the same data sources as the graphics, through their caches.
 *
 *   GET /director                                   the page (public/director.html)
 *   GET /api/director/rundowns                      rundowns with a data source + competition
 *   GET /api/director/classes?source=&comp=         class names
 *   GET /api/director/starts?source=&comp=&class=   start times (epoch ms) + server clock offset
 */

import express from 'express';
import os from 'os';
import { ipcMain } from 'electron';
import { getDataSourceRegistry } from '../data/DataSourceRegistry';
import { competitionClock, startTimeEpochMs } from '../data/liveTime';
import { getProjectManager } from '../projects/ProjectManager';
import { entryKey, loadEvent, loadStartList, updateOrAddStartListEntry as updateOrAdd } from '../events/EventService';
import { getConfig } from '../utils/config';
import { getLogger } from '../utils/logger';

const logger = getLogger();

function clientFor(sourceId: string): any {
  const ds: any = getDataSourceRegistry().get(sourceId);
  if (!ds) throw Object.assign(new Error(`Data source not found: ${sourceId}`), { status: 404 });
  const client = typeof ds.getClient === 'function' ? ds.getClient() : undefined;
  if (!client) throw Object.assign(new Error(`Data source ${sourceId} has no live results`), { status: 400 });
  return client;
}

export function createDirectorApiRouter(): express.Router {
  const router = express.Router();

  // Events with a data source and competition (the page also accepts ?source=&comp= links)
  router.get('/rundowns', async (_req, res) => {
    try {
      const out: any[] = [];
      for (const item of await getProjectManager().listProjects()) {
        const event = await loadEvent(item.id);
        const ds = event.dataSource;
        if (!ds?.sourceId || !ds.competitionId) continue;
        out.push({ event: event.id, projectName: event.name, rundownName: event.info?.date || '', source: ds.sourceId, comp: ds.competitionId, competitionName: ds.competitionName || '' });
      }
      res.json(out);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Favourites are shared with Settings → Start lists and the Live runner finder
  router.post('/favourite', express.json(), (req, res) => {
    try {
      const { event, className, name, club, favourite } = req.body ?? {};
      if (!event || !className || !name) throw new Error('event, className and name are required');
      updateOrAdd(String(event), entryKey(String(className), String(name), String(club ?? '')),
        { className: String(className), name: String(name), club: String(club ?? ''), favourite: !!favourite });
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/classes', async (req, res) => {
    try {
      const client = clientFor(String(req.query.source));
      const comp = Number(req.query.comp);
      const result = await client.getClasses(comp);
      res.json((result.data ?? []).map((c: any) => c.className ?? c));
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/starts', async (req, res) => {
    try {
      const client = clientFor(String(req.query.source));
      const comp = Number(req.query.comp);
      const className = String(req.query.class ?? '');
      let info: any;
      try { info = await client.getCompetitionInfo(comp); } catch { info = (await client.getCompetitions()).data.find((c: any) => c.id === comp); }
      const clock = info ? competitionClock(info) : null;
      // Start lists change rarely: reuse anything fetched in the last 30 s
      const result = await client.getClassResults(comp, className, { maxAgeMs: 30_000 });
      const eventId = typeof req.query.event === 'string' ? req.query.event : '';
      const favs = eventId ? new Set(loadStartList(eventId).entries.filter(e => e.favourite).map(e => e.key)) : new Set<string>();
      const runners = (result.data.results ?? []).map((r: any) => ({
        name: r.name, club: r.club, bib: r.bib ?? '', status: Number(r.status),
        favourite: favs.has(entryKey(className, r.name, r.club)),
        startTimeMs: clock && r.start ? startTimeEpochMs(clock, Number(r.start)) : null
      }));
      res.json({
        className,
        competitionName: info?.name ?? '',
        timeZone: clock?.timeZone,
        clockOffsetMs: await client.getServerClockOffsetMs(),
        runners
      });
    } catch (error: any) {
      res.status(error?.status || 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}

/** A LAN address for links other devices can open */
function lanAddress(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
}

export function registerDirectorHandlers(): void {
  ipcMain.handle('director:getUrl', async (_event, sourceId?: string, competitionId?: number) => {
    try {
      const port = getConfig().general.port || 5657;
      const q = sourceId && competitionId ? `?source=${encodeURIComponent(sourceId)}&comp=${competitionId}` : '';
      return { success: true, data: { local: `http://localhost:${port}/director${q}`, lan: `http://${lanAddress()}:${port}/director${q}` } };
    } catch (error) {
      logger.warn('director:getUrl failed', { error: String(error) });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

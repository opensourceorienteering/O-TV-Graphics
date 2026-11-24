/**
 * A stand-in for a Trace / Track server's data API, for tests. It follows the real server
 * (apps/server/src/index.ts and data-api.ts in the Trace / Track repository): the routes, the
 * read key check (401 without a known key, 403 for another event's key, 404 for an unknown
 * event or class), the response shapes, and the stream's Server-Sent Events framing.
 */

import http from 'http';
import type { AddressInfo } from 'net';
import type { TtRunner, TtStandingRow } from '../TraceTrackSource';

export interface FakeTraceTrack {
  url: string;
  /** Requests so far: path and query */
  requests: { path: string; query: URLSearchParams; auth?: string }[];
  /** The runners every answer and stream message carries; change them at will */
  runners: TtRunner[];
  standings: Record<string, TtStandingRow[]>;
  /** leader-progress answers by class (null: no leader) */
  leaders: Record<string, Record<string, unknown> | null>;
  /** Make virtual standings answer HTTP 500 */
  failStandings: boolean;
  /** Send a runners message to every open stream now */
  push(): void;
  /** Drop every open stream (the client should reconnect) */
  dropStreams(): void;
  /** Revoke the key: streams get "end" and requests 401 */
  revoke(): void;
  openStreams(): number;
  close(): Promise<void>;
}

export async function fakeTraceTrack(opts: { eventId: string; key: string; runners: TtRunner[]; standings?: Record<string, TtStandingRow[]>; otherEvents?: Record<string, string> }): Promise<FakeTraceTrack> {
  const streams = new Set<http.ServerResponse>();
  let revoked = false;
  const state = {
    requests: [] as FakeTraceTrack['requests'],
    runners: opts.runners,
    standings: opts.standings ?? {},
    leaders: {},
    failStandings: false
  };
  const runnersBody = (timeline: string) => ({ version: 1, eventId: opts.eventId, serverTime: Date.now(), timeline, runners: state.runners });
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  };
  const keyOf = (req: http.IncomingMessage, url: URL) => {
    const header = req.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('key') ?? undefined;
  };
  /** As dataApiAccess: ok, unauthorized (401) or forbidden (403, another event's key) */
  const access = (key: string | undefined, eventId: string) => {
    if (revoked || !key) return 'unauthorized';
    if (key === opts.key) return eventId === opts.eventId ? 'ok' : 'forbidden';
    if (opts.otherEvents?.[key]) return opts.otherEvents[key] === eventId ? 'ok' : 'forbidden';
    return 'unauthorized';
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, 'http://x');
    state.requests.push({ path: url.pathname, query: url.searchParams, auth: req.headers.authorization });
    const tracking = url.pathname.match(/^\/api\/v1\/events\/([^/]+)\/classes\/([^/]+)\/(virtual-standings|leader-progress)$/);
    const main = url.pathname.match(/^\/api\/v1\/events\/([^/]+)\/(program|runners|board|stream)(?:\/([^/]+))?$/);
    const eventId = decodeURIComponent((tracking ?? main)?.[1] ?? '');
    if (!tracking && !main) return json(res, 404, { error: 'Endpoint not found' });
    const a = access(keyOf(req, url), eventId);
    if (a !== 'ok') return json(res, a === 'unauthorized' ? 401 : 403, { error: a === 'unauthorized' ? 'Send the event’s read key.' : 'This key is for another event.' });
    if (eventId !== opts.eventId) return json(res, 404, { error: 'Event not found' });
    const timeline = url.searchParams.get('timeline') === 'live' ? 'live' : 'program';
    if (tracking) {
      const classId = decodeURIComponent(tracking[2]);
      if (!state.runners.some(r => r.classId === classId)) return json(res, 404, { error: 'Class not found' });
      if (state.failStandings) return json(res, 500, { error: 'boom' });
      const envelope = { version: 1, eventId, classId, className: classId, serverTime: Date.now(), timeline, revision: 1, estimated: true, model: {} };
      if (tracking[3] === 'leader-progress') {
        const leader = state.leaders[classId] ?? null;
        return json(res, 200, { ...envelope, by: 'standings', leaderBasis: leader ? 'standings' : null, reason: leader ? null : 'no-progress', leader });
      }
      return json(res, 200, { ...envelope, rows: state.standings[classId] ?? [] });
    }
    if (main![2] === 'runners') return json(res, 200, runnersBody(timeline));
    if (main![2] === 'program') return json(res, 200, { version: 1, eventId, revision: 1, takenAt: 0, serverTime: Date.now(), classId: '', className: '', source: 'live', reference: 'realtime', delay: 0, time: Date.now(), caption: '', runnerIds: [], lowerThird: null, graphic: null, board: false, follow: null });
    if (main![2] === 'stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: program\ndata: ${JSON.stringify({ version: 1, eventId, revision: 1 })}\n\n`);
      (res as any).timeline = timeline;
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    return json(res, 404, { error: 'Endpoint not found' });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return Object.assign(state, {
    url,
    push() {
      for (const s of streams) s.write(`event: runners\ndata: ${JSON.stringify(runnersBody((s as any).timeline))}\n\nevent: board\ndata: {"rows":[]}\n\n`);
    },
    dropStreams() {
      for (const s of streams) s.destroy();
      streams.clear();
    },
    revoke() {
      revoked = true;
      for (const s of streams) { s.write('event: end\ndata: {}\n\n'); s.end(); }
      streams.clear();
    },
    openStreams: () => streams.size,
    close: () => new Promise<void>(r => { for (const s of streams) s.destroy(); server.close(() => r()); })
  });
}

/** Runners as in Trace / Track's documentation example, plus a relay runner and one without data */
export const sampleRunners = (): TtRunner[] => [
  {
    id: 'r-12', name: 'Anna Lind', shortName: 'A. Lind', club: 'OK Linné', bib: '101', classId: 'w21', className: 'W21', color: '#e5484d',
    startTime: 1793528800000, team: null, onProgram: true, lowerThird: true, time: 1793529990000,
    position: { lat: 59.3011, lon: 18.0402, time: 1793529989000 }, signal: 'live', age: 1,
    heartRate: 172, maxHeartRate: 188, averageHeartRate: 165, speed: 3.92, pace: 255, heading: 41, battery: 71, accuracy: 4
  },
  {
    id: 'r-13', name: 'Bo Ek', shortName: 'B. Ek', club: 'IFK Göteborg', bib: null, classId: 'w21', className: 'W21', color: '#3e63dd',
    startTime: 1793528860000, team: null, onProgram: false, lowerThird: false, time: 1793529990000,
    position: null, signal: 'none', age: null,
    heartRate: null, maxHeartRate: null, averageHeartRate: null, speed: null, pace: null, heading: null, battery: null, accuracy: null
  },
  {
    id: 'r-40', name: 'Cia Berg', shortName: 'C. Berg', club: 'OK Ravinen', bib: null, classId: 'relay', className: 'Relay', color: '#30a46c',
    startTime: 1793528900000, team: { name: 'OK Ravinen 1', bib: '7', leg: 2 }, onProgram: false, lowerThird: false, time: 1793529990000,
    position: { lat: 59.31, lon: 18.05, time: 1793529980000 }, signal: 'lost', age: 10,
    heartRate: 160, maxHeartRate: 181, averageHeartRate: 158, speed: 0, pace: null, heading: null, battery: 15, accuracy: 9
  }
];

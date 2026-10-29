/**
 * Maintainer tool: fetch club logos from Eventor into club-logos/ so they ship with the app.
 * (Cleared with SOFT. Users never fetch logos themselves; logos only change with a new build.)
 *
 *   EVENTOR_API_KEY=... npm run logos:fetch -- [--country se|no|au] [--eventor URL] [--size LargeIcon|SmallIcon] [--limit N] [--force]
 *
 * The API key may also come from config.json (eventor.apiKey).
 *
 *  1. The club list comes from the Eventor API (/api/organisations/iofxml, header ApiKey).
 *  2. Logo images are only served to browsers (Cloudflare browser check), so a normal, visible
 *     Chromium window (Electron) opens Eventor. If Eventor shows a check, complete it in that
 *     window once. The logos are then fetched through that window, one at a time, politely.
 *  3. Output: club-logos/<eventor host>/logos/<id>.<ext> and index.json. Re-running only
 *     fetches logos that are missing (use --force to fetch all again).
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const EVENTOR = {
  se: 'https://eventor.orientering.se',
  no: 'https://eventor.orientering.no',
  au: 'https://eventor.orienteering.asn.au'
};
const country = String(arg('country', 'se')).toLowerCase();
if (!EVENTOR[country] && !argv.includes('--eventor')) throw new Error(`Unknown Eventor country: ${country} (use se, no or au)`);
const base = String(arg('eventor', EVENTOR[country] || EVENTOR.se)).replace(/\/+$/, '');
// SmallIcon (13 px) | LargeIcon (48 px, the largest Eventor serves). Not --type: Chromium reserves it.
const logoType = arg('size', 'LargeIcon');
const limit = Number(arg('limit', '0')) || Infinity;
const force = argv.includes('--force');
const delayMs = Number(arg('delay', '250'));

function apiKey() {
  const envName = { se: 'EVENTOR_API_KEY', no: 'EVENTOR_NO_API_KEY', au: 'EVENTOR_AU_API_KEY' }[country] || 'EVENTOR_API_KEY';
  if (process.env[envName]) return process.env[envName];
  // EVENTOR_API_KEY remains a convenient fallback for an explicit --eventor URL.
  if (argv.includes('--eventor') && process.env.EVENTOR_API_KEY) return process.env.EVENTOR_API_KEY;
  try {
    const eventor = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).eventor;
    return eventor?.apiKeys?.[country] || (country === 'se' ? eventor?.apiKey : undefined);
  } catch { return undefined; }
}

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/webp': '.webp' };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Minimal IOF XML OrganisationList reader (Id, Name, ShortName, MediaName, Country, type) */
function parseOrganisations(xml) {
  const out = [];
  const tag = (body, name) => {
    const m = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(body);
    return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim() : '';
  };
  for (const m of xml.matchAll(/<Organisation\b([^>]*)>([\s\S]*?)<\/Organisation>/g)) {
    const attrs = m[1], body = m[2].replace(/<Address[\s\S]*?<\/Address>/g, '');
    const type = /type="([^"]*)"/.exec(attrs)?.[1];
    const country = /<Country code="([^"]*)"/.exec(body)?.[1];
    out.push({ id: tag(body, 'Id'), name: tag(body, 'Name'), shortName: tag(body, 'ShortName') || undefined,
      mediaName: tag(body, 'MediaName') || undefined, country, type });
  }
  return out.filter(o => o.id && o.name);
}

async function main() {
  const key = apiKey();
  if (!key) {
    const envName = { se: 'EVENTOR_API_KEY', no: 'EVENTOR_NO_API_KEY', au: 'EVENTOR_AU_API_KEY' }[country] || 'EVENTOR_API_KEY';
    throw new Error(`Set ${envName} (or eventor.apiKeys.${country} in config.json)`);
  }
  const outDir = path.join(ROOT, 'club-logos', new URL(base).host);
  const logosDir = path.join(outDir, 'logos');
  fs.mkdirSync(logosDir, { recursive: true });

  console.log(`Club list from ${base} ...`);
  const res = await fetch(`${base}/api/organisations/iofxml`, { headers: { ApiKey: key } });
  if (!res.ok) throw new Error(`Eventor API: HTTP ${res.status}`);
  const all = parseOrganisations(await res.text());
  const clubs = all.filter(o => (o.type || '').toLowerCase() === 'club');
  console.log(`${all.length} organisations, ${clubs.length} clubs`);

  const indexPath = path.join(outDir, 'index.json');
  const previous = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')) : null;
  const known = new Map((previous?.organisations ?? []).map(o => [o.id, o]));

  // A normal browser window; Eventor's browser check (if any) is completed here
  const win = new BrowserWindow({ width: 1000, height: 760, show: true, title: 'Eventor – club logos' });
  await win.loadURL(`${base}/`);
  const started = Date.now();
  while (/just a moment|checking your browser/i.test(win.webContents.getTitle())) {
    if (Date.now() - started > 5 * 60_000) throw new Error('Eventor browser check not completed within 5 minutes');
    if ((Date.now() - started) % 10_000 < 500) console.log('Waiting for the Eventor browser check (complete it in the window if asked) ...');
    await sleep(500);
  }
  console.log('Eventor open in the browser window; fetching logos ...');
  // The window only carries Eventor's browser session; show what it is doing on top of the page
  const showProgress = (text) => win.webContents.executeJavaScript(`(() => {
    let el = document.getElementById('olg-progress');
    if (!el) {
      el = document.createElement('div');
      el.id = 'olg-progress';
      el.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;padding:14px 18px;' +
        'border-radius:8px;background:#111e;color:#fff;font:600 16px/1.4 system-ui,sans-serif;box-shadow:0 4px 20px #0006';
      document.body.appendChild(el);
    }
    el.textContent = ${JSON.stringify('OL-Grafik: ' + text)};
  })()`).catch(() => undefined);
  await showProgress(`Downloading club logos for ${clubs.length} clubs. Leave this window open; it closes when done.`);

  let done = 0, downloaded = 0, missing = 0, failed = 0, consecutiveFailures = 0;
  for (const club of clubs) {
    if (done >= limit) break;
    done++;
    const old = known.get(club.id);
    if (!force && old?.file && fs.existsSync(path.join(logosDir, old.file))) { club.file = old.file; continue; }
    const url = `${base}/Organisation/Logotype/${encodeURIComponent(club.id)}?type=${encodeURIComponent(logoType)}`;
    // Fetched by the page itself: same browser, same session as a person browsing Eventor
    const r = await win.webContents.executeJavaScript(`(async () => {
      const res = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !type.startsWith('image/')) return { status: res.status, type };
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return { status: res.status, type, data: btoa(bin) };
    })()`).catch(e => ({ status: 0, error: String(e) }));

    if (r.data && EXT[r.type]) {
      const file = `${club.id}${EXT[r.type]}`;
      fs.writeFileSync(path.join(logosDir, file), Buffer.from(r.data, 'base64'));
      club.file = file;
      downloaded++;
      consecutiveFailures = 0;
    } else if (r.status === 404 || (r.status === 200 && !EXT[r.type])) {
      missing++;
      consecutiveFailures = 0;
    } else {
      failed++;
      if (++consecutiveFailures >= 5) {
        console.error(`Stopping: Eventor refused ${consecutiveFailures} logo requests in a row (last HTTP ${r.status}).`);
        break;
      }
    }
    if (done % 50 === 0) console.log(`${done}/${clubs.length} clubs · ${downloaded} new · ${missing} without logo · ${failed} failed`);
    if (done % 10 === 0) await showProgress(`Club logos ${done}/${clubs.length} · ${downloaded} new · ${missing} without logo · ${failed} failed. Leave this window open.`);
    await sleep(delayMs);
  }

  // Keep logos fetched in earlier runs for clubs not reached this time
  for (const c of clubs) if (!c.file && known.get(c.id)?.file && fs.existsSync(path.join(logosDir, known.get(c.id).file))) c.file = known.get(c.id).file;
  const index = { source: base, downloadedAt: Date.now(), logoType, organisations: clubs };
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 1));
  console.log(`Done: ${clubs.filter(c => c.file).length} logos for ${clubs.length} clubs in ${path.relative(ROOT, outDir)} (${downloaded} new, ${missing} without logo, ${failed} failed)`);
}

app.whenReady().then(main).then(() => app.quit(), (error) => { console.error(error.message || error); app.exit(1); });

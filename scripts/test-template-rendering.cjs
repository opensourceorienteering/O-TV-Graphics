/** Real Chromium smoke test of every OGraf package. Run through npm run test:templates.
 * Uses an isolated hidden Electron window, synthetic timing data and loopback HTTP only.
 * It does not launch the application or touch event data. */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.TEMPLATE_TEST_OUTPUT || path.join(os.tmpdir(), 'split-control-template-tests'));
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'split-control-renderer-')));
app.disableHardwareAcceleration();
const catalogue = [];
function discover(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) discover(file);
    else if (entry.name.endsWith('.ograf.json')) {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      catalogue.push({ manifest, folder: '/' + path.relative(root, dir).split(path.sep).join('/') });
    }
  }
}
discover(path.join(root, 'templates'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
let window;
const assetFailures = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/catalogue.json') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify(catalogue)); }
  if (url.pathname === '/capture' && req.method === 'POST') {
    const name = String(url.searchParams.get('name') || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const screenshot = await window.webContents.capturePage();
    fs.writeFileSync(path.join(output, `${name}.png`), screenshot.toPNG());
    return res.end('ok');
  }
  if (url.pathname === '/result' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const report = JSON.parse(body);
    report.testedAt = new Date().toISOString();
    report.assetFailures = assetFailures;
    report.failed += assetFailures.length;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const cards = report.results.map(r => `<article><h2>${escape(r.id)} · ${r.ok ? 'PASS' : 'FAIL'}</h2>${r.error ? `<pre>${escape(r.error)}</pre>` : ''}<a href="${encodeURIComponent(r.id)}.png"><img loading="lazy" src="${encodeURIComponent(r.id)}.png" alt="${escape(r.id)}"></a></article>`).join('');
    fs.writeFileSync(path.join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Template rendering report</title><style>body{font:14px system-ui;background:#20242b;color:white;margin:24px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}h2{font-size:14px}img{width:100%}pre{white-space:pre-wrap}</style><h1>${report.total} templates · ${report.failed} failures</h1><p><a href="report.json">JSON report</a>. Baseline screenshots; additional step and custom-logo PNGs are in this folder.</p><main>${cards}</main>`);
    console.log(JSON.stringify({ total: report.total, passed: report.total - report.results.filter(r => !r.ok).length, failed: report.failed, output }, null, 2));
    for (const result of report.results.filter(r => !r.ok)) console.error(`${result.id}: ${result.error}`);
    for (const failure of assetFailures) console.error(`Asset failure: ${failure}`);
    res.end('ok');
    setTimeout(() => { server.close(); app.exit(report.failed ? 1 : 0); }, 100);
    return;
  }
  if (url.pathname !== '/' && !['/templates/', '/site/preview/', '/scripts/template-tests/'].some(prefix => url.pathname.startsWith(prefix))) { res.writeHead(403); return res.end(); }
  const relative = url.pathname === '/' ? 'scripts/template-tests/index.html' : decodeURIComponent(url.pathname).slice(1);
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  try {
    const bytes = fs.readFileSync(file);
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch {
    if (!url.pathname.includes('favicon')) assetFailures.push(url.pathname);
    res.writeHead(404); res.end();
  }
});
app.whenReady().then(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  window = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.on('render-process-gone', (_event, details) => { console.error(details); app.exit(1); });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
}).catch(error => { console.error(error); app.exit(1); });
setTimeout(() => { console.error('Template rendering timed out'); app.exit(1); }, 180000).unref();

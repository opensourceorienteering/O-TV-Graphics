#!/usr/bin/env node
/**
 * Record a finished Liveresultat competition (REST API responses) as a test fixture:
 *
 *   node scripts/record-liveresultat.js --competition 33124
 *
 * Writes test-data/liveresultat/<id>.json: { info, classes, results: { <class>: body },
 * lastpassings }. The timing snapshot tests serve it back through a local REST server.
 */
const fs = require('fs');
const path = require('path');

const id = Number((process.argv.join(' ').match(/--competition\s+(\d+)/) || [])[1]);
if (!id) { console.error('Usage: node scripts/record-liveresultat.js --competition <id>'); process.exit(1); }
const base = `https://api.orienteering.services/competitions/${id}`;

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

(async () => {
  const info = await get(base);
  delete info.serverTime;
  const { classes } = await get(`${base}/classes`);
  const results = {};
  for (const name of classes) {
    results[name] = await get(`${base}/classresults?class=${encodeURIComponent(name)}`);
    await new Promise(r => setTimeout(r, 250)); // be gentle with the real API
  }
  let lastpassings = null;
  try { lastpassings = await get(`${base}/passings`); } catch { /* not offered */ }
  const out = path.join(__dirname, '..', 'test-data', 'liveresultat', `${id}.json`);
  fs.writeFileSync(out, JSON.stringify({ info, classes, results, lastpassings }));
  console.log(`Wrote ${out} (${classes.length} classes)`);
})().catch(e => { console.error(e.message); process.exit(1); });

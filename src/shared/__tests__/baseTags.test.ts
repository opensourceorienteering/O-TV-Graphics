/**
 * The base tag library against what every built-in source really gives graphics (the golden
 * timing snapshots), and the documentation generated from it.
 *
 *   UPDATE_BASE_TAGS=1 npx vitest run src/shared/__tests__/baseTags.test.ts   (regenerate the docs)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { BASE_TAGS, baseTagProblems, renderBaseTagsHtml, renderBaseTagsMarkdown } from '../baseTags';

const ROOT = path.resolve(__dirname, '../../..');
const GOLDEN = path.join(ROOT, 'test-data/timing-snapshots');
const UPDATE = process.env.UPDATE_BASE_TAGS === '1';

/** Every graphic payload in the golden snapshots, by source */
function payloads(): { source: string; data: Record<string, unknown> }[] {
  const out: { source: string; data: Record<string, unknown> }[] = [];
  for (const file of fs.readdirSync(GOLDEN).filter(f => f.endsWith('.json.gz'))) {
    const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(GOLDEN, file))).toString('utf8'));
    for (const key of Object.keys(snap).filter(k => k.startsWith('competition '))) {
      for (const k of Object.values<any>(snap[key].byClass)) {
        for (const data of [k.mapped, k.start, k.finish, ...Object.values(k.atControl), ...(k.relay ?? [])]) out.push({ source: file, data });
      }
      if (!snap[key].allClasses.error) out.push({ source: file, data: snap[key].allClasses });
    }
  }
  return out;
}

/** Paths present in a payload (array items as []) */
function paths(v: unknown, at = '', out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) { if (x && typeof x === 'object') for (const [k, y] of Object.entries(x)) { out.add(`${at}[].${k}`); paths(y, `${at}[].${k}`, out); } }
  else if (v && typeof v === 'object') for (const [k, y] of Object.entries(v)) { const p = at ? `${at}.${k}` : k; out.add(p); paths(y, p, out); }
  return out;
}

describe('base tags', () => {
  const all = payloads();

  it('describes every field every built-in source gives graphics, with its type', () => {
    expect(all.length).toBeGreaterThan(300);
    const problems = new Map<string, Set<string>>();
    for (const { source, data } of all) {
      for (const p of baseTagProblems(data)) {
        if (!problems.has(p)) problems.set(p, new Set());
        problems.get(p)!.add(source);
      }
    }
    expect([...problems].map(([p, s]) => `${p} (${[...s].join(', ')})`)).toEqual([]);
  });

  it('has the fields marked "always" in every payload', () => {
    const always = BASE_TAGS.filter(t => !t.when && (t.group === 'timing' || t.group === 'runner') && t.path !== 'clockOffsetMs' && t.path !== 'dataTimestamp');
    for (const { source, data } of all) {
      const seen = paths(data);
      for (const t of always) {
        // a list's item fields are required only when the list has items
        const list = t.path.includes('[]') ? (data as any)[t.path.slice(0, t.path.indexOf('[]'))] : undefined;
        if (t.path.includes('[]') && !(Array.isArray(list) && list.length)) continue;
        expect(seen.has(t.path), `${t.path} missing in ${source}`).toBe(true);
      }
    }
  });

  it('only lists fields some source really gives', () => {
    const seen = new Set<string>();
    for (const { data } of all) for (const p of paths(data)) seen.add(p);
    // Not in the recorded sources' timing data: added later (start list, theme, event), by
    // other feeds, by plugins, by operator choices, or only at run time
    const elsewhere = /^(event|presentation|title|length|climb|controls|condition|temperature|wind|humidity|runnerBib|raceLocation|x|clockOffsetMs|dataTimestamp)(\.|$)|^results\[\]\.(bib|favourite|note|x|clubLogo)$/;
    const unused = BASE_TAGS.map(t => t.path).filter(p => !seen.has(p) && !elsewhere.test(p));
    expect(unused).toEqual([]);
  });

  it('reports unknown fields and wrong types', () => {
    expect(baseTagProblems({ className: 'H21', results: [{ name: 'A', position: 1, x: { gps: { speed: 3 } } }], x: { gps: {} } })).toEqual([]);
    expect(baseTagProblems({ className: 3, results: [{ nme: 'A' }] })).toEqual(['className: number, expected string', 'results[].nme: not a base tag']);
    expect(baseTagProblems({ title: 'x', myField: 'y' }, ['myField'])).toEqual([]);
  });

  it('keeps docs/BASE-TAGS.md and the developer site in step with the library', () => {
    const md = path.join(ROOT, 'docs/BASE-TAGS.md');
    const site = path.join(ROOT, 'site/developers.html');
    const START = '<!-- base-tags:start (generated from src/shared/baseTags.ts) -->';
    const END = '<!-- base-tags:end -->';
    const html = fs.readFileSync(site, 'utf8');
    const i = html.indexOf(START), j = html.indexOf(END);
    expect(i, 'markers in site/developers.html').toBeGreaterThan(0);
    const table = html.slice(i + START.length, j).replace(/^\n|\n\s*$/g, '');
    if (UPDATE) {
      fs.writeFileSync(md, renderBaseTagsMarkdown());
      fs.writeFileSync(site, html.slice(0, i + START.length) + '\n' + renderBaseTagsHtml() + '\n      ' + html.slice(j));
      return;
    }
    expect(fs.readFileSync(md, 'utf8'), 'docs/BASE-TAGS.md is out of date: run with UPDATE_BASE_TAGS=1').toBe(renderBaseTagsMarkdown());
    expect(table, 'site/developers.html base tags are out of date: run with UPDATE_BASE_TAGS=1').toBe(renderBaseTagsHtml());
  });
});

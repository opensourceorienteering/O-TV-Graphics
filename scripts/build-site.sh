#!/usr/bin/env bash
# Build the website into <out>: the pages in site/, every look zipped for download (looks/),
# and every look's files for the preview page (preview/templates/sets/ + preview/looks.json).
# Used by .github/workflows/pages.yml. To try the site locally:
#
#   scripts/build-site.sh _site && npx serve _site
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:?usage: build-site.sh <output folder>}"
rm -rf "$out"
mkdir -p "$out"
out="$(cd "$out" && pwd)"

cp -R "$root/site/." "$out/"
"$root/scripts/zip-looks.sh" "$out/looks" > /dev/null

# The preview loads graphics straight from the look folders, as the app serves them
mkdir -p "$out/preview/templates"
cp -R "$root/templates/sets" "$out/preview/templates/sets"
node - "$root/templates/sets" "$out/preview/looks.json" <<'NODE'
const fs = require('fs');
const path = require('path');
const [dir, target] = process.argv.slice(2);
const looks = fs.readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(dir, d.name, 'set.json')))
  .map((d) => {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, d.name, 'set.json'), 'utf-8'));
    const graphics = fs.readdirSync(path.join(dir, d.name))
      .filter((g) => fs.existsSync(path.join(dir, d.name, g, `${g}.ograf.json`)))
      .map((g) => {
        const m = JSON.parse(fs.readFileSync(path.join(dir, d.name, g, `${g}.ograf.json`), 'utf-8'));
        return { folder: g, kind: m.v_olgrafik_kind || '', name: m.name || g, main: m.main || 'graphic.js' };
      });
    return { id: d.name, name: meta.name || d.name, description: meta.description || '', colors: meta.colors || [], graphics };
  })
  .sort((a, b) => (b.id === 'standard') - (a.id === 'standard') || a.name.localeCompare(b.name));
fs.writeFileSync(target, JSON.stringify({ looks }, null, 2) + '\n');
console.log(`preview: ${looks.length} looks`);
NODE
echo "site built in $out"

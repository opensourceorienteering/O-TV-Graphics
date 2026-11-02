#!/usr/bin/env bash
# Zip every look in templates/sets/ for download: <out>/<set>.zip (the set folder, as the app's
# Graphics library → Import look… expects) and <out>/looks.json (name, description, colours,
# size of each). Used by the website and by releases.
#
#   scripts/zip-looks.sh site/looks
set -euo pipefail
out="$(mkdir -p "${1:?usage: zip-looks.sh <output folder>}" && cd "$1" && pwd)"
cd "$(dirname "$0")/../templates/sets"

for dir in */; do
  id="${dir%/}"
  [[ "$id" == _* || ! -f "$id/set.json" ]] && continue
  rm -f "$out/$id.zip"
  zip -qrX "$out/$id.zip" "$id" -x '*/.*'
  echo "$id.zip"
done

node - "$out" <<'NODE'
const fs = require('fs');
const path = require('path');
const out = process.argv[2];
const looks = fs.readdirSync('.', { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && fs.existsSync(path.join(d.name, 'set.json')))
  .map((d) => {
    const meta = JSON.parse(fs.readFileSync(path.join(d.name, 'set.json'), 'utf-8'));
    const graphics = fs.readdirSync(d.name).filter((g) => fs.existsSync(path.join(d.name, g, `${g}.ograf.json`))).length;
    return {
      id: d.name,
      name: meta.name || d.name,
      description: meta.description || '',
      author: meta.author || '',
      colors: meta.colors || [],
      fonts: meta.fonts || '',
      approvedEventsOnly: meta.approvedEventsOnly === true,
      graphics,
      builtIn: d.name === 'standard',
      file: `${d.name}.zip`,
      size: fs.statSync(path.join(out, `${d.name}.zip`)).size,
    };
  })
  .sort((a, b) => (b.builtIn - a.builtIn) || a.name.localeCompare(b.name));
fs.writeFileSync(path.join(out, 'looks.json'), JSON.stringify({ looks }, null, 2) + '\n');
console.log(`looks.json: ${looks.length} looks`);
NODE

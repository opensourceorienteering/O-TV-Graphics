/** The shared graphic's paged kinds must be exactly the kinds whose manifests say stepCount -1 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const TEMPLATES = path.resolve(__dirname, '../../../templates/sets');

describe('OGraf steps in the shared graphic', () => {
  it('treats as paged exactly the kinds with stepCount -1, and every other kind has one step', () => {
    const source = fs.readFileSync(path.join(TEMPLATES, '_core', 'graphic.js'), 'utf8');
    const paged = new Set(JSON.parse(/PAGED_KINDS = new Set\((\[[^\]]*\])\)/.exec(source)![1].replace(/'/g, '"')) as string[]);
    for (const look of fs.readdirSync(TEMPLATES).filter((d) => !d.startsWith('_') && fs.statSync(path.join(TEMPLATES, d)).isDirectory())) {
      for (const folder of fs.readdirSync(path.join(TEMPLATES, look))) {
        const file = path.join(TEMPLATES, look, folder, `${folder}.ograf.json`);
        if (!fs.existsSync(file)) continue;
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        const expected = paged.has(manifest.v_olgrafik_kind) ? -1 : 1;
        expect([manifest.id, manifest.stepCount ?? 1]).toEqual([manifest.id, expected]);
      }
    }
  });
});

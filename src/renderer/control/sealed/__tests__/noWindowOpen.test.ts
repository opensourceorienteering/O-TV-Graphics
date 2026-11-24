import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

/** Every window opens with a deny handler (no popups can escape the seal), so window.open does nothing */
describe('the operator UI', () => {
  it('opens web pages through window:openExternal, never window.open', () => {
    const root = path.resolve(__dirname, '../../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
        else if (/\.(tsx?|jsx?)$/.test(e.name) && /\bwindow\.open\(/.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(root, p));
      }
    };
    walk(path.join(root, 'control'));
    expect(offenders).toEqual([]);
  });
});

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { additionFallbackPath } from '../additionPaths';

const user = fs.mkdtempSync(path.join(os.tmpdir(), 'addpaths-'));
fs.mkdirSync(path.join(user, 'additions', 'standard', 'guest-strap'), { recursive: true });
fs.writeFileSync(path.join(user, 'additions', 'standard', 'guest-strap', 'graphic.js'), '');
afterAll(() => fs.rmSync(user, { recursive: true, force: true }));

describe('files an added graphic shares with its look', () => {
  it("serves the addition's own files from the additions folder", () => {
    expect(additionFallbackPath('/additions/standard/guest-strap/graphic.js', user)).toBeNull();
  });
  it("serves the look's files (set.js, theme.css, fonts) from the look", () => {
    expect(additionFallbackPath('/additions/standard/set.js', user)).toBe('/sets/standard/set.js');
    expect(additionFallbackPath('/additions/standard/fonts/a.woff2', user)).toBe('/sets/standard/fonts/a.woff2');
  });
  it('serves the shared code from sets/_core', () => {
    expect(additionFallbackPath('/additions/_core/graphic.js', user)).toBe('/sets/_core/graphic.js');
  });
  it('leaves other paths and odd names alone', () => {
    expect(additionFallbackPath('/sets/standard/set.js', user)).toBeNull();
    expect(additionFallbackPath('/additions/standard', user)).toBeNull();
    expect(additionFallbackPath('/additions/..%2F..%2Fetc/passwd', user)).toBeNull();
    expect(additionFallbackPath('/additions/standard/x.js', null)).toBe('/sets/standard/x.js');
  });
});

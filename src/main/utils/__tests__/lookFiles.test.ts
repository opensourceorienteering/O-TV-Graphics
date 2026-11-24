import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { lookFileFromArgv, setPendingLookFile, takePendingLookFile } from '../lookFiles';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lookfile-'));
afterEach(() => void takePendingLookFile());

describe('.splitlook files opened from the system', () => {
  it('finds the last .splitlook argument that exists', () => {
    const a = path.join(tmp, 'A.splitlook');
    const b = path.join(tmp, 'B Look.SPLITLOOK');
    fs.writeFileSync(a, '');
    fs.writeFileSync(b, '');
    expect(lookFileFromArgv(['Split Control.exe', '--flag', a, b])).toBe(b);
    expect(lookFileFromArgv(['app', a, path.join(tmp, 'missing.splitlook')])).toBe(a);
    expect(lookFileFromArgv(['app', pathToFileURL(b).href])).toBe(b);
  });
  it('ignores missing files, other files and plain starts', () => {
    expect(lookFileFromArgv(['app', path.join(tmp, 'missing.splitlook')])).toBeNull();
    expect(lookFileFromArgv(['app', __filename])).toBeNull();
    expect(lookFileFromArgv(['app'])).toBeNull();
  });
  it('keeps the newest file until the library takes it, once', () => {
    setPendingLookFile('/a.splitlook');
    setPendingLookFile('/b.splitlook');
    expect(takePendingLookFile()).toBe('/b.splitlook');
    expect(takePendingLookFile()).toBeNull();
  });
});

/**
 * Graphics added to a look live in <user templates>/additions/<look>/<graphic>/, one folder
 * further from the shared files than the look's own graphics in sets/<look>/<graphic>/ — but
 * their relative imports are the same (../set.js, ../theme.css, ../../_core/graphic.js). So a
 * request under /templates/additions/<look>/ for a file the additions folder doesn't have is
 * served from the look itself (sets/<look>/, sets/_core/).
 */
import fs from 'fs';
import path from 'path';

const LOOK = /^[a-z0-9_][a-z0-9_-]{0,63}$/i;

/** The path to serve instead (under /templates), or null to serve the request as it is */
export function additionFallbackPath(pathname: string, userDir: string | null): string | null {
  const m = /^\/additions\/([^/]+)\/(.+)$/.exec(pathname);
  if (!m) return null;
  let look: string;
  let rest: string;
  try {
    look = decodeURIComponent(m[1]);
    rest = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  if (!LOOK.test(look) || rest.split('/').some((p) => p === '..' || p === '' || p.includes('\\'))) return null;
  if (userDir) {
    const own = path.join(userDir, 'additions', look, ...rest.split('/'));
    if (fs.existsSync(own)) return null;
  }
  return `/sets/${m[1]}/${m[2]}`;
}

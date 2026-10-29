const path = require('path');

// Join `parts` onto `baseDir` and return the absolute result, or null if it
// would land outside `baseDir` (path traversal, e.g. a slug of
// "../questions-evil/x"). A plain `resolved.startsWith(baseDir)` check isn't
// enough: "/repo/questions-evil" starts with "/repo/questions". Asking
// path.relative() how to get from baseDir to the result is: anything outside
// needs a leading ".." step (or, on Windows, a different drive, which comes
// back absolute). baseDir itself is rejected too, since callers want a file in it.
function resolveInside(baseDir, ...parts) {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, ...parts);
  const rel = path.relative(base, resolved);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

module.exports = { resolveInside };

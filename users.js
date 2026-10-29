const fs = require('fs');
const path = require('path');

const { resolveInside } = require('./paths');

const USERS_DIR = path.join(__dirname, 'users');
const DEFAULT_USER = 'daniel.pflager@gmail.com';

// Strict on purpose: the address becomes a directory name, and RFC 5322
// allows characters in addresses (such as "/") that mustn't reach a path.
const EMAIL_PATTERN = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

// There's no login yet, so the user comes from server configuration, never
// from the browser. Checked once at startup: a bad value stops the server
// immediately rather than failing on the first Submit.
function configuredUser() {
  const user = (process.env.MAXRECALL_USER || DEFAULT_USER).trim().toLowerCase();
  if (!EMAIL_PATTERN.test(user)) {
    throw new Error(`MAXRECALL_USER must be a plain email address, got ${JSON.stringify(user)}`);
  }
  return user;
}

const CURRENT_USER = configuredUser();

// Save one Submit as users/<email>/submissions/<question>/<timestamp>.json.
// The timestamp is record.submittedAt with ":" replaced by "-" (Windows
// doesn't allow ":" in file names); it doubles as the submission's id.
//
// Written to a temporary file first and then renamed into place: rename()
// is atomic, so a crash mid-write leaves a stray temp file, never a
// half-written record. Two Submits in the same millisecond would collide,
// which the page prevents by disabling Submit while one is running.
async function saveSubmission(record) {
  const id = record.submittedAt.replace(/:/g, '-');
  const file = resolveInside(USERS_DIR, CURRENT_USER, 'submissions', record.question, `${id}.json`);
  if (!file) throw new Error('Refusing to save outside users/');

  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`);
  await fs.promises.rename(tmp, file);
  return id;
}

module.exports = { CURRENT_USER, saveSubmission };

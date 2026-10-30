const fs = require('fs');
const path = require('path');

const { resolveInside } = require('./paths');

// Where user data lives. Defaults to users/ in the repo (committed by hand).
// MAXRECALL_USERS_DIR moves it elsewhere, e.g. outside the checkout on the
// VPS, so records written there never collide with a later git pull.
const USERS_DIR = process.env.MAXRECALL_USERS_DIR
  ? path.resolve(process.env.MAXRECALL_USERS_DIR)
  : path.join(__dirname, 'users');
const DEFAULT_USER = 'daniel.pflager@gmail.com';

// Strict on purpose: the address becomes a directory name, and RFC 5322
// allows characters in addresses (such as "/") that mustn't reach a path.
const EMAIL_PATTERN = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

// MAXRECALL_USER: the owner, the only email allowed to register (auth.js)
// and who you are on the trusted port. Checked once at startup: a bad value
// stops the server immediately.
function configuredOwner() {
  const user = (process.env.MAXRECALL_USER || DEFAULT_USER).trim().toLowerCase();
  if (!EMAIL_PATTERN.test(user)) {
    throw new Error(`MAXRECALL_USER must be a plain email address, got ${JSON.stringify(user)}`);
  }
  return user;
}

const OWNER_EMAIL = configuredOwner();

// Save one Submit as users/<email>/submissions/<timestamp>.json. All
// questions share the folder; the record's "question" field says which one.
// The timestamp is record.submittedAt with ":" replaced by "-" (Windows
// doesn't allow ":" in file names); it doubles as the submission's id.
//
// Written to a temporary file first, then linked into place and the temp
// file removed. link() is atomic like rename(), so a crash leaves at most a
// stray temp file, never a half-written record; but unlike rename() it
// fails with EEXIST instead of overwriting. So two Submits in the same
// millisecond (e.g. from two tabs) give a "not saved" warning rather than
// one silently replacing the other.
async function saveSubmission(email, record) {
  const id = record.submittedAt.replace(/:/g, '-');
  const file = resolveInside(submissionsDir(email), `${id}.json`);
  if (!file) throw new Error('Refusing to save outside users/');

  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`);
  try {
    await fs.promises.link(tmp, file);
  } finally {
    await fs.promises.unlink(tmp);
  }
  return id;
}

// A submission id is the timestamp part of its file name. Checked exactly
// before it's used in a path, so a crafted id can't reach other files.
const SUBMISSION_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/;

// email is whoever the request is from (server.js, req.userEmail). Checked
// again here before it becomes part of a path, whatever the caller did.
function submissionsDir(email) {
  const dir = typeof email === 'string' && EMAIL_PATTERN.test(email) && resolveInside(USERS_DIR, email, 'submissions');
  if (!dir) throw new Error('Invalid user');
  return dir;
}

async function readSubmission(email, id) {
  const record = JSON.parse(await fs.promises.readFile(path.join(submissionsDir(email), `${id}.json`), 'utf8'));
  return { id, ...record };
}

// Every saved Submit for the current user, newest first (ids sort by time).
// No folder yet means no submissions. A file that can't be read or parsed is
// skipped with a warning rather than breaking the whole list.
async function listSubmissions(email) {
  let names;
  try {
    names = await fs.promises.readdir(submissionsDir(email));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const ids = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((id) => SUBMISSION_ID_PATTERN.test(id))
    .sort()
    .reverse();

  const records = [];
  for (const id of ids) {
    try {
      records.push(await readSubmission(email, id));
    } catch (err) {
      console.warn(`Skipping unreadable submission ${id}: ${err.message}`);
    }
  }
  return records;
}

// One saved Submit, or null if the id is malformed or there's no such file.
async function loadSubmission(email, id) {
  if (!SUBMISSION_ID_PATTERN.test(id)) return null;
  try {
    return await readSubmission(email, id);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

module.exports = { USERS_DIR, OWNER_EMAIL, EMAIL_PATTERN, saveSubmission, listSubmissions, loadSubmission };

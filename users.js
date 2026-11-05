const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { resolveInside } = require('./paths');

/**
 * One saved Submit, as written to users/<email>/submissions/<id>.json
 * (readme.html, "Where data lives").
 *
 * @typedef {object} SubmissionRecord
 * @property {number} schemaVersion - 3 since skipped was added (spaced-
 *   repetition plan, step 8); 2 since elapsedMs was (2026-11-03); 1 before.
 * @property {string} submittedAt - When the Submit arrived, as UTC ISO 8601.
 * @property {string} question - The question's slug (its file name without .json).
 * @property {string} questionSha256 - SHA-256 of the question's file at the time, in hex.
 * @property {string} language - One of javascript, python, cpp, java, d.
 * @property {string} judgeMode - "function" or "program".
 * @property {string} code - What was submitted, or what the editor held
 *   when skipped (may be empty then).
 * @property {'yes'} [skipped] - "yes" for a Skip (D8), which isn't judged;
 *   absent for a Submit, and from every record before version 3.
 * @property {string | null} status - The judge's verdict, e.g. "Accepted"
 *   or "Wrong Answer"; null for a Skip.
 * @property {number | null} passed - How many test cases passed; null for a Skip.
 * @property {number | null} total - How many test cases there were; null for a Skip.
 * @property {number | null} runtimeMs - How long judging took, in
 *   milliseconds; null for a Skip.
 * @property {number | null} [elapsedMs] - The page's timer at Submit, or null
 *   if the page didn't send it. Missing from schemaVersion 1 records.
 * @property {boolean[]} results - Pass or fail for each test case, in file
 *   order; empty for a Skip.
 * @property {string | null} stdout - The program's standard output; null for a Skip.
 * @property {string | null} stderr - The program's standard error; null for a Skip.
 */

/**
 * A saved Submit as read back: the record plus its id.
 *
 * @typedef {SubmissionRecord & { id: string }} SavedSubmission
 */

// Where user data lives. Defaults to users/ in the repo, which is gitignored:
// the owner manages it by hand (2026-10-30).
// MAXRECALL_USERS_DIR moves it elsewhere, e.g. outside the checkout on the
// VPS, so records written there never collide with a later git pull.
const USERS_DIR = process.env.MAXRECALL_USERS_DIR
  ? path.resolve(process.env.MAXRECALL_USERS_DIR)
  : path.join(__dirname, 'users');
const DEFAULT_USER = 'daniel.pflager@gmail.com';

// Strict on purpose: the address becomes a directory name, and RFC 5322
// allows characters in addresses (such as "/") that mustn't reach a path.
const EMAIL_PATTERN = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

/**
 * MAXRECALL_USER: the owner, who every request on the trusted port is,
 * and the only one who may Test a question (server.js,
 * canTestQuestions). Registering doesn't use it: since 2026-11-04 it needs an
 * invite (auth.js). Checked once at startup: a bad value stops the server
 * immediately.
 *
 * @returns {string} MAXRECALL_USER (or daniel.pflager@gmail.com if it's
 *   unset), trimmed and lower-cased.
 * @throws {Error} If that isn't a plain email address (EMAIL_PATTERN).
 */
function configuredOwner() {
  const user = (process.env.MAXRECALL_USER || DEFAULT_USER).trim().toLowerCase();
  if (!EMAIL_PATTERN.test(user)) {
    throw new Error(`MAXRECALL_USER must be a plain email address, got ${JSON.stringify(user)}`);
  }
  return user;
}

const OWNER_EMAIL = configuredOwner();

/**
 * Saves one Submit as users/<email>/submissions/<timestamp>.json. All
 * questions share the folder; the record's "question" field says which one.
 * The timestamp is record.submittedAt with ":" replaced by "-" (Windows
 * doesn't allow ":" in file names); it doubles as the submission's id.
 *
 * Written to a temporary file first, then linked into place and the temp
 * file removed. link() is atomic like rename(), so a crash leaves at most a
 * stray temp file, never a half-written record; but unlike rename() it
 * fails with EEXIST instead of overwriting. So two Submits in the same
 * millisecond (e.g. from two tabs) give a "not saved" warning rather than
 * one silently replacing the other.
 *
 * @param {string} email - Whose submission it is (the signed-in user).
 * @param {SubmissionRecord} record - What to save.
 * @returns {Promise<string>} The submission's id, e.g. "2026-10-29T04-05-29.199Z".
 * @throws {Error} If email isn't valid, or the file can't be written,
 *   including EEXIST when a record with that id already exists.
 */
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

/**
 * The folder holding one user's saved submissions. email is whoever the
 * request is from (server.js, req.userEmail). Checked again here before it
 * becomes part of a path, whatever the caller did.
 *
 * @param {string} email - The user's email. Checked here all the same: a
 *   value that isn't a string, or doesn't match EMAIL_PATTERN, throws.
 * @returns {string} The absolute path of users/<email>/submissions (it may
 *   not exist yet).
 * @throws {Error} "Invalid user" if email isn't a string matching EMAIL_PATTERN.
 */
function submissionsDir(email) {
  const dir = typeof email === 'string' && EMAIL_PATTERN.test(email) && resolveInside(USERS_DIR, email, 'submissions');
  if (!dir) throw new Error('Invalid user');
  return dir;
}

/**
 * Reads and parses one submission file. The id isn't checked here; callers
 * check it first or take it from a directory listing.
 *
 * @param {string} email - Whose submission it is.
 * @param {string} id - The submission's id (its file name without .json).
 * @returns {Promise<SavedSubmission>} The record, with id added.
 * @throws {Error} If the file can't be read (e.g. ENOENT) or isn't valid JSON.
 */
async function readSubmission(email, id) {
  const record = JSON.parse(await fs.promises.readFile(path.join(submissionsDir(email), `${id}.json`), 'utf8'));
  return { id, ...record };
}

/**
 * Every record in a user's submissions/, newest first (ids sort by time),
 * and the files that couldn't be read or parsed, which are left out. No
 * folder yet means no records. Used by listSubmissions() and the
 * consistency check (step 10), which reports the unreadable ones.
 *
 * @param {string} email - Whose records to read.
 * @returns {Promise<{ records: SavedSubmission[], unreadable: { id: string, message: string }[] }>}
 *   The records, newest first, and each unreadable file's id and why.
 * @throws {Error} If email isn't valid, or the folder exists but can't be read.
 */
async function readAllRecords(email) {
  let names;
  try {
    names = await fs.promises.readdir(submissionsDir(email));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return { records: [], unreadable: [] };
    throw err;
  }
  const ids = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((id) => SUBMISSION_ID_PATTERN.test(id))
    .sort()
    .reverse();

  const records = [];
  const unreadable = [];
  for (const id of ids) {
    try {
      records.push(await readSubmission(email, id));
    } catch (err) {
      unreadable.push({ id, message: /** @type {Error} */ (err).message });
    }
  }
  return { records, unreadable };
}

/**
 * Every saved Submit for the current user, newest first. A file that can't
 * be read or parsed is skipped with a warning rather than breaking the
 * whole list.
 *
 * @param {string} email - Whose submissions to list.
 * @returns {Promise<SavedSubmission[]>} The records, newest first; empty if
 *   there are none.
 * @throws {Error} If email isn't valid, or the folder exists but can't be read.
 */
async function listSubmissions(email) {
  const { records, unreadable } = await readAllRecords(email);
  for (const { id, message } of unreadable) console.warn(`Skipping unreadable submission ${id}: ${message}`);
  return records;
}

/**
 * One saved Submit, or null if the id is malformed or there's no such file.
 *
 * @param {string} email - Whose submission it is.
 * @param {string} id - The submission's id, from the request; checked
 *   against SUBMISSION_ID_PATTERN before it's used in a path.
 * @returns {Promise<SavedSubmission | null>} The record, or null.
 * @throws {Error} If email isn't valid, or the file exists but can't be read
 *   or parsed.
 */
async function loadSubmission(email, id) {
  if (!SUBMISSION_ID_PATTERN.test(id)) return null;
  try {
    return await readSubmission(email, id);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
}

// The files a user's folder holds besides submissions/ (the spaced-
// repetition plan, D1, D2 and D6). Only these names reach a path.
const USER_FILES = ['profile.json', 'order.json', 'backlog.json'];

/**
 * Where one of a user's files is: users/<email>/<name>. The email and the
 * name are checked here, whatever the caller did, before they become part
 * of a path.
 *
 * @param {string} email - The user's email.
 * @param {string} name - One of USER_FILES.
 * @returns {string} The file's absolute path (it may not exist).
 * @throws {Error} "Invalid user" if email doesn't match EMAIL_PATTERN;
 *   "Unknown user file" if name isn't one of USER_FILES.
 */
function userFile(email, name) {
  if (!USER_FILES.includes(name)) throw new Error(`Unknown user file ${JSON.stringify(name)}`);
  const file = typeof email === 'string' && EMAIL_PATTERN.test(email) && resolveInside(USERS_DIR, email, name);
  if (!file) throw new Error('Invalid user');
  return file;
}

/**
 * One of a user's files, as text. Synchronous on purpose, like
 * writeUserFile: a change reads, changes and writes the file with no await
 * in between, so two changes at once can't overwrite each other's (a lost
 * update; spaced-repetition plan, D1).
 *
 * @param {string} email - The user's email.
 * @param {string} name - One of USER_FILES.
 * @returns {string | undefined} The file's contents, or undefined if
 *   there's no file.
 * @throws {Error} If email or name isn't valid, or the file exists but
 *   can't be read.
 */
function readUserFile(email, name) {
  try {
    return fs.readFileSync(userFile(email, name), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * Writes one of a user's files safely: to a temporary file, then rename()d
 * over the old one, so a crash never leaves half a file. rename() replaces
 * the file, which is the point here (unlike saveSubmission's link(), which
 * mustn't). Synchronous, as readUserFile explains.
 *
 * @param {string} email - The user's email.
 * @param {string} name - One of USER_FILES.
 * @param {object} contents - The whole new file, as an object.
 * @returns {void}
 * @throws {Error} If email or name isn't valid, or the file can't be written.
 */
function writeUserFile(email, name, contents) {
  const file = userFile(email, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(contents, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/**
 * Why createUser() didn't create a user: their folder is already there.
 */
class UserExistsError extends Error {
  /** @param {string} email - The user. */
  constructor(email) {
    super(`${email} already has a folder in ${USERS_DIR}`);
    this.code = 'USER_EXISTS';
  }
}

/**
 * Creates a new user's folder holding these files (spaced-repetition plan,
 * step 14, details 5 and 6; make learner-create), all at once: they're
 * written into users/.new-user-<random> (no "@", so listUsers() never
 * counts it), then the folder is rename()d into place, so the server never
 * sees a user with only some of their files. Never replaces anyone: it
 * refuses if the folder exists. That's checked just before the rename, not
 * by it (Node has no rename that refuses to replace an empty folder), so a
 * folder appearing in those microseconds would be replaced if empty; it's
 * meant for someone with no account yet, whose folder nothing else creates.
 *
 * @param {string} email - The new user's email, as a folder name (lower case).
 * @param {Partial<Record<'profile.json' | 'order.json' | 'backlog.json', object>>} files -
 *   The files, by name (USER_FILES only), as objects; each is written as
 *   writeUserFile() writes it.
 * @returns {string} The new folder's path.
 * @throws {UserExistsError} If the user's folder already exists.
 * @throws {Error} "Invalid user" if email doesn't match EMAIL_PATTERN;
 *   "Unknown user file" for another name; another Error if a file can't be
 *   written (the temporary folder is removed then).
 */
function createUser(email, files) {
  const dir = typeof email === 'string' && EMAIL_PATTERN.test(email) && resolveInside(USERS_DIR, email);
  if (!dir) throw new Error('Invalid user');
  for (const name of Object.keys(files)) {
    if (!USER_FILES.includes(name)) throw new Error(`Unknown user file ${JSON.stringify(name)}`);
  }
  if (fs.existsSync(dir)) throw new UserExistsError(email);
  fs.mkdirSync(USERS_DIR, { recursive: true });
  // mkdirSync, not mkdtempSync: mkdtemp makes the folder readable by its
  // owner only (0700), unlike every other user's folder (umask's default).
  const tmp = path.join(USERS_DIR, `.new-user-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(tmp);
  try {
    for (const [name, contents] of Object.entries(files)) {
      fs.writeFileSync(path.join(tmp, name), `${JSON.stringify(contents, null, 2)}\n`);
    }
    if (fs.existsSync(dir)) throw new UserExistsError(email);
    fs.renameSync(tmp, dir);
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  return dir;
}

/**
 * Keeps a copy of one of a user's files beside it, before a command that
 * rewrites it all (make recalculate-queue, spaced-repetition plan, step 12,
 * detail 4): users/<email>/<name>.before-<label>. Nothing reads the copy;
 * it's there to go back to.
 *
 * @param {string} email - The user's email.
 * @param {string} name - One of USER_FILES.
 * @param {string} label - What it's from and when, e.g.
 *   "recalculate-20261104T042400Z": letters, digits and hyphens only.
 * @returns {string | null} The copy's path, or null if there's no file to copy.
 * @throws {Error} If email, name or label isn't valid, or the copy can't be made.
 */
function backupUserFile(email, name, label) {
  if (!/^[A-Za-z0-9-]+$/.test(label)) throw new Error(`Invalid backup label ${JSON.stringify(label)}`);
  const file = userFile(email, name);
  if (!fs.existsSync(file)) return null;
  const copy = `${file}.before-${label}`;
  fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
  return copy;
}

/**
 * A user's profile.json, as text (profile.js; spaced-repetition plan, D2).
 *
 * @param {string} email - The user's email.
 * @returns {string | undefined} The file's contents, or undefined if
 *   there's no file (which means everything is allowed).
 * @throws {Error} If email isn't valid, or the file exists but can't be read.
 */
function readProfileFile(email) {
  return readUserFile(email, 'profile.json');
}

/**
 * Writes a user's profile.json safely (writeUserFile).
 *
 * @param {string} email - The user's email.
 * @param {object} contents - The whole new file, as an object.
 * @returns {void}
 * @throws {Error} If email isn't valid, or the file can't be written.
 */
function writeProfileFile(email, contents) {
  writeUserFile(email, 'profile.json', contents);
}

/**
 * Every user with a folder in USERS_DIR: a folder whose name is a valid
 * email and that holds submissions/ or profile.json (step 5, decision 5).
 * Anything else there, such as a stray file or a folder named otherwise,
 * is left out.
 *
 * @returns {string[]} The emails, sorted; empty if USERS_DIR doesn't exist.
 * @throws {Error} If USERS_DIR exists but can't be read.
 */
function listUsers() {
  let entries;
  try {
    entries = fs.readdirSync(USERS_DIR, { withFileTypes: true });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((e) => e.isDirectory() && EMAIL_PATTERN.test(e.name))
    .map((e) => e.name)
    .filter((email) => fs.existsSync(path.join(USERS_DIR, email, 'submissions')) || fs.existsSync(path.join(USERS_DIR, email, 'profile.json')))
    .sort();
}

module.exports = { USERS_DIR, OWNER_EMAIL, EMAIL_PATTERN, saveSubmission, listSubmissions, readAllRecords, loadSubmission, readProfileFile, writeProfileFile, readUserFile, writeUserFile, backupUserFile, createUser, UserExistsError, listUsers };

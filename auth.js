const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const { OWNER_EMAIL, EMAIL_PATTERN } = require('./users');

// The cast picks crypto.scrypt's four-argument form (with options):
// promisify() alone gives the type of its shortest form.
const scrypt = /** @type {(password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>} */ (
  promisify(crypto.scrypt)
);

/**
 * An account, as stored in auth/accounts/<email>.json.
 *
 * @typedef {object} Account
 * @property {number} schemaVersion - 1.
 * @property {string} email - Lower-cased.
 * @property {string} createdAt - When it was registered, as UTC ISO 8601.
 * @property {{ N: number, r: number, p: number, keyLength: number }} scrypt -
 *   The parameters the hash was made with.
 * @property {string} salt - Random, base64.
 * @property {string} hash - The scrypt hash of the password, base64.
 */

/**
 * A session, as stored in auth/sessions/<sha256 of token>.json.
 *
 * @typedef {object} Session
 * @property {string} email - Whose session it is.
 * @property {string} createdAt - When it started, as UTC ISO 8601.
 * @property {string} expiresAt - When it ends, as UTC ISO 8601.
 */

/**
 * What register() and login() return: a new session, or why not.
 *
 * @typedef {{ ok: true, email: string, token: string, expiresAt: string }
 *   | { ok: false, error: string, retryAfterMs?: number }} AuthResult
 */

// Accounts and sessions live here, never in users/: that folder is committed
// to a public repo, and published password hashes invite offline guessing.
// Gitignored. MAXRECALL_AUTH_DIR moves it (the VPS keeps it outside the
// checkout, like its users/).
const AUTH_DIR = process.env.MAXRECALL_AUTH_DIR
  ? path.resolve(process.env.MAXRECALL_AUTH_DIR)
  : path.join(__dirname, 'auth');
const ACCOUNTS_DIR = path.join(AUTH_DIR, 'accounts');
const SESSIONS_DIR = path.join(AUTH_DIR, 'sessions');
const INVITES_DIR = path.join(AUTH_DIR, 'invites');

const SESSION_LIFETIME_MS = 360 * 24 * 60 * 60 * 1000;

// How long an invite code can be used for (docs/plans/limited-live.md,
// step 1, detail 3).
const INVITE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

// For new passwords: NIST SP 800-63B rev. 4 requires 15 for a password used
// as the only factor (8 only as part of multi-factor login), with no
// composition rules. The owner chose 10 for their own account (2026-10-30);
// with other people's accounts it's 15 (docs/plans/limited-live.md, step 1,
// detail 7). Only registering checks it, so existing passwords still work.
const MIN_PASSWORD_LENGTH = 15;

// OWASP Password Storage Cheat Sheet's scrypt minimum (Node 22 has no
// built-in Argon2id). N=2^17 needs 128 MiB, above Node's 32 MiB default
// maxmem, hence the raised limit.
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const KEY_LENGTH = 64;

// Registering needs an invite code from `make invite` (docs/plans/
// limited-live.md, D2). Until 2026-11-04 it needed a fixed password,
// MAXRECALL_PASSWORD, and only the owner could register; that variable is
// now ignored (server.js says so at startup if it's still set).

fs.mkdirSync(ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(INVITES_DIR, { recursive: true, mode: 0o700 });

/**
 * An email as typed, made comparable: trimmed and lower-cased.
 *
 * @param {string} email - The email as typed. (Checked all the same: a
 *   value that isn't a string gives "".)
 * @returns {string} The normalized email, or "" if it wasn't a string.
 */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Compares two strings in time that doesn't depend on where they differ.
 * Hashing first gives timingSafeEqual the equal-length inputs it requires.
 *
 * @param {string} a - One secret. (Passed through String() all the same.)
 * @param {string} b - The other.
 * @returns {boolean} Whether they're equal.
 */
function sameSecret(a, b) {
  const digest = (/** @type {string} */ s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * Hashes a password with scrypt, as stored in an account.
 *
 * @param {string} password - The password. (Passed through String() all
 *   the same.)
 * @param {Buffer} salt - The account's salt, or a random one.
 * @param {{ N: number, r: number, p: number }} [params=SCRYPT_PARAMS] - scrypt's
 *   cost parameters: an account's own, or the current defaults.
 * @returns {Promise<Buffer>} The KEY_LENGTH-byte hash.
 */
function hashPassword(password, salt, params = SCRYPT_PARAMS) {
  return scrypt(String(password), salt, KEY_LENGTH, { ...params, maxmem: SCRYPT_MAXMEM });
}

// --- Throttling ---------------------------------------------------------------
// After FREE_ATTEMPTS consecutive failures for one email, each further
// attempt has to wait, the wait doubling up to MAX_DELAY_MS. Keyed by the
// email typed, whether or not an account exists, so it reveals nothing.
// Per email rather than per IP: through the SSH tunnel every request comes
// from 127.0.0.1. Kept in memory, so a restart clears it.
const FREE_ATTEMPTS = 5;
const MAX_DELAY_MS = 15 * 60 * 1000;
/** Failed attempts so far, by key (e.g. "login:<email>"). @type {Map<string, { count: number, waitUntil: number }>} */
const failures = new Map();

/**
 * How long a key must still wait before its next attempt is considered.
 *
 * @param {string} key - "register:<email>" or "login:<email>".
 * @returns {number} Milliseconds, 0 if it needn't wait.
 */
function waitRemainingMs(key) {
  const entry = failures.get(key);
  return entry ? Math.max(0, entry.waitUntil - Date.now()) : 0;
}

/**
 * Counts one more failure for a key, and sets how long its next attempt must
 * wait: nothing for the first FREE_ATTEMPTS - 1, then 1 s, doubling each
 * time, up to MAX_DELAY_MS.
 *
 * @param {string} key - "register:<email>" or "login:<email>".
 * @returns {void}
 */
function recordFailure(key) {
  const count = (failures.get(key)?.count || 0) + 1;
  const delay = count < FREE_ATTEMPTS ? 0 : Math.min(1000 * 2 ** (count - FREE_ATTEMPTS), MAX_DELAY_MS);
  failures.set(key, { count, waitUntil: Date.now() + delay });
}

// --- Accounts -----------------------------------------------------------------

/**
 * Where an account is stored. The email isn't checked here: readAccount()
 * checks it, and register() only gets this far with OWNER_EMAIL.
 *
 * @param {string} email - Normalized.
 * @returns {string} The path of auth/accounts/<email>.json.
 */
function accountFile(email) {
  return path.join(ACCOUNTS_DIR, `${email}.json`);
}

/**
 * Reads an account.
 *
 * @param {string} email - Normalized.
 * @returns {Promise<Account | null>} The account, or null if the email
 *   doesn't match EMAIL_PATTERN or there's no such account.
 * @throws {Error} If the file exists but can't be read or parsed.
 */
async function readAccount(email) {
  if (!EMAIL_PATTERN.test(email)) return null;
  try {
    return JSON.parse(await fs.promises.readFile(accountFile(email), 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Whether anyone may register: only when MAXRECALL_PASSWORD is set.
 *
 * @returns {boolean} True if registration is open.
 */
function registrationOpen() {
  return REGISTRATION_PASSWORD !== null;
}

// Every refusal gets the same message, whatever the reason: wrong email,
// wrong password, registration closed, or already registered.
const REGISTER_REFUSED = "Registration isn't open for that email and password.";
const LOGIN_REFUSED = 'Invalid email or password.';

/**
 * The refusal to give if a key must still wait, or null if it needn't.
 *
 * @param {string} key - "register:<email>" or "login:<email>".
 * @returns {{ ok: false, retryAfterMs: number, error: string } | null} The
 *   refusal, with how long to wait, or null.
 */
function throttled(key) {
  const wait = waitRemainingMs(key);
  return wait > 0 ? { ok: false, retryAfterMs: wait, error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} s.` } : null;
}

/**
 * Registers the owner's account and starts a session, if registration is
 * open, the email is OWNER_EMAIL, the password is MAXRECALL_PASSWORD, and
 * there's no account yet. Every refusal gives the same message.
 *
 * @param {string} rawEmail - The email as typed (server.js refuses a
 *   request without string email and password before calling this).
 * @param {string} password - The password as typed.
 * @returns {Promise<AuthResult>} The new session, or why not (with
 *   retryAfterMs when throttled).
 * @throws {Error} If an account file can't be read or written for a reason
 *   other than already existing.
 */
async function register(rawEmail, password) {
  const email = normalizeEmail(rawEmail);
  const key = `register:${email}`;
  const wait = throttled(key);
  if (wait) return wait;

  const allowed = registrationOpen()
    && email === OWNER_EMAIL
    // registrationOpen() above means REGISTRATION_PASSWORD is set.
    && sameSecret(password, /** @type {string} */ (REGISTRATION_PASSWORD))
    && !(await readAccount(email));
  if (!allowed) {
    recordFailure(key);
    return { ok: false, error: REGISTER_REFUSED };
  }

  const salt = crypto.randomBytes(16);
  const hash = await hashPassword(password, salt);
  const account = {
    schemaVersion: 1,
    email,
    createdAt: new Date().toISOString(),
    scrypt: { ...SCRYPT_PARAMS, keyLength: KEY_LENGTH },
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
  };
  try {
    // 'wx' fails if the file exists, so two simultaneous registrations
    // can't both succeed.
    await fs.promises.writeFile(accountFile(email), `${JSON.stringify(account, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EEXIST') return { ok: false, error: REGISTER_REFUSED };
    throw err;
  }
  failures.delete(key);
  return { ok: true, email, ...(await createSession(email)) };
}

/**
 * Checks an email and password against the stored account and starts a
 * session. Takes about as long whether or not the account exists.
 *
 * @param {string} rawEmail - The email as typed (server.js refuses a
 *   request without string email and password before calling this).
 * @param {string} password - The password as typed.
 * @returns {Promise<AuthResult>} The new session, or why not (with
 *   retryAfterMs when throttled).
 * @throws {Error} If the account file exists but can't be read or parsed.
 */
async function login(rawEmail, password) {
  const email = normalizeEmail(rawEmail);
  const key = `login:${email}`;
  const wait = throttled(key);
  if (wait) return wait;

  const account = await readAccount(email);
  // Hash even when there's no such account, so the response takes as long
  // either way and timing doesn't reveal which emails are registered.
  const salt = account ? Buffer.from(account.salt, 'base64') : crypto.randomBytes(16);
  const params = account ? { N: account.scrypt.N, r: account.scrypt.r, p: account.scrypt.p } : SCRYPT_PARAMS;
  const hash = await hashPassword(password, salt, params);
  const ok = account !== null && crypto.timingSafeEqual(hash, Buffer.from(account.hash, 'base64'));
  if (!ok) {
    recordFailure(key);
    return { ok: false, error: LOGIN_REFUSED };
  }
  failures.delete(key);
  return { ok: true, email, ...(await createSession(email)) };
}

// --- Sessions -----------------------------------------------------------------
// The browser holds a random 256-bit token. The server stores only its
// SHA-256, as the session file's name, so reading this folder doesn't give
// anyone a usable token.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url

/**
 * Where a session is stored: named by the token's SHA-256, not the token.
 *
 * @param {string} token - The session token.
 * @returns {string} The path of auth/sessions/<sha256 hex>.json.
 */
function sessionFile(token) {
  return path.join(SESSIONS_DIR, `${crypto.createHash('sha256').update(token).digest('hex')}.json`);
}

/**
 * Starts a session: a random 256-bit token, stored by its hash.
 *
 * @param {string} email - Whose session it is.
 * @returns {Promise<{ token: string, expiresAt: string }>} The token
 *   (base64url, for the cookie) and when it expires (UTC ISO 8601).
 * @throws {Error} If the session file can't be written.
 */
async function createSession(email) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  const session = { email, createdAt: new Date().toISOString(), expiresAt };
  await fs.promises.writeFile(sessionFile(token), `${JSON.stringify(session)}\n`, { flag: 'wx', mode: 0o600 });
  return { token, expiresAt };
}

/**
 * The email a session token belongs to, or null if it's missing, malformed,
 * unknown or expired (expired sessions are deleted when found).
 *
 * @param {string | null} token - From the session cookie; null if there
 *   was none. (Checked all the same: anything that isn't a well-formed
 *   token gives null.)
 * @returns {Promise<string | null>} The session's email, or null.
 * @throws {Error} If the session file exists but can't be read or parsed.
 */
async function sessionEmail(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  /** @type {Session} */
  let session;
  try {
    session = JSON.parse(await fs.promises.readFile(sessionFile(token), 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await endSession(token);
    return null;
  }
  return session.email;
}

/**
 * Ends a session by deleting its file. Does nothing for a missing or
 * malformed token, or one with no session.
 *
 * @param {string | null} token - From the session cookie; null if there
 *   was none. (Checked all the same: anything that isn't a well-formed
 *   token is ignored.)
 * @returns {Promise<void>}
 * @throws {Error} If the session file exists but can't be deleted.
 */
async function endSession(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return;
  await fs.promises.unlink(sessionFile(token)).catch(
    /**
     * Ignores a session file that's already gone; anything else is passed on.
     *
     * @param {NodeJS.ErrnoException} err - Why unlink() failed.
     * @returns {void}
     * @throws {NodeJS.ErrnoException} err itself, unless it's ENOENT.
     */
    (err) => {
      if (err.code !== 'ENOENT') throw err;
    },
  );
}

module.exports = {
  AUTH_DIR,
  MIN_PASSWORD_LENGTH,
  SESSION_LIFETIME_MS,
  registrationOpen,
  register,
  login,
  sessionEmail,
  endSession,
};

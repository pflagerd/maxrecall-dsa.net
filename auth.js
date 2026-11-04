const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const { EMAIL_PATTERN } = require('./users');

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

// For new passwords. The owner chose 12 (2026-11-04, docs/plans/
// limited-live.md, step 1, detail 7), up from 10 (2026-10-30). That's
// below NIST SP 800-63B rev. 4, which requires 15 for a password used as
// the only factor (8 only as part of multi-factor login); throttling and
// the slow scrypt hash still make guessing expensive. No composition
// rules, as NIST also says. Only registering checks it, so existing
// passwords still work.
const MIN_PASSWORD_LENGTH = 12;

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
 * checks it, and register() only gets this far with an invited email.
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

// --- Invites ------------------------------------------------------------------
// `make invite EMAIL=…` (scripts/invite.js) makes a random code for one
// email; registering with that email needs it (docs/plans/limited-live.md,
// D2 and step 1). Only the code's SHA-256 is stored. A fast hash is enough
// because the code is 128 random bits, too many to guess, unlike a
// password a person chooses: the same reasoning as session tokens below.

/**
 * An invite, as stored in auth/invites/<email>.json.
 *
 * @typedef {object} Invite
 * @property {number} schemaVersion - 1.
 * @property {string} email - Lower-cased.
 * @property {string} createdAt - When it was made, as UTC ISO 8601.
 * @property {string} expiresAt - When it stops working, as UTC ISO 8601.
 * @property {string} codeSha256 - The code's SHA-256, hex.
 */

/**
 * Where an invite is stored. The email isn't checked here: createInvite()
 * and readInvite() check it.
 *
 * @param {string} email - Normalized.
 * @returns {string} The path of auth/invites/<email>.json.
 */
function inviteFile(email) {
  return path.join(INVITES_DIR, `${email}.json`);
}

/**
 * A code's SHA-256, as stored in an invite.
 *
 * @param {string} code - The code. (Passed through String() all the same.)
 * @returns {string} The hash, hex.
 */
function codeHash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/**
 * Makes an invite for one email, replacing any earlier one for it (whose
 * code then stops working). Written to a temporary file and renamed, so
 * the server never reads half of it.
 *
 * @param {string} rawEmail - The email to invite, as typed. Normalized
 *   first; anything that doesn't match EMAIL_PATTERN then is refused.
 * @param {number} [now=Date.now()] - The time to count the lifetime from,
 *   in milliseconds since 1970 (for tests).
 * @returns {Promise<{ email: string, code: string, expiresAt: string }>}
 *   The normalized email, the code (shown once, never stored) and when it
 *   expires (UTC ISO 8601).
 * @throws {Error} If the email isn't valid, or the file can't be written.
 */
async function createInvite(rawEmail, now = Date.now()) {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL_PATTERN.test(email)) throw new Error(`Not an email address the server accepts: ${JSON.stringify(rawEmail)}`);
  const code = crypto.randomBytes(16).toString('base64url');
  const expiresAt = new Date(now + INVITE_LIFETIME_MS).toISOString();
  /** @type {Invite} */
  const invite = { schemaVersion: 1, email, createdAt: new Date(now).toISOString(), expiresAt, codeSha256: codeHash(code) };
  const file = inviteFile(email);
  const tmp = `${file}.tmp-${process.pid}`;
  await fs.promises.writeFile(tmp, `${JSON.stringify(invite, null, 2)}\n`, { mode: 0o600 });
  await fs.promises.rename(tmp, file);
  return { email, code, expiresAt };
}

/**
 * Reads an invite.
 *
 * @param {string} email - Normalized.
 * @returns {Promise<Invite | null>} The invite, or null if the email
 *   doesn't match EMAIL_PATTERN or there's no invite for it.
 * @throws {Error} If the file exists but can't be read or parsed.
 */
async function readInvite(email) {
  if (!EMAIL_PATTERN.test(email)) return null;
  try {
    return JSON.parse(await fs.promises.readFile(inviteFile(email), 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Whether a code is the one an invite was made with and the invite hasn't
 * expired. Compares hashes in constant time (sameSecret).
 *
 * @param {Invite | null} invite - From readInvite(); null fails.
 * @param {string} code - The code as typed.
 * @returns {boolean} True if the code may be used.
 */
function inviteAccepts(invite, code) {
  if (!invite) return false;
  return Date.parse(invite.expiresAt) > Date.now() && sameSecret(codeHash(code), invite.codeSha256);
}

// --- Registering ----------------------------------------------------------------

// Every refusal gets the same message, whatever the reason: no invite,
// wrong or expired code, or already registered. A too-short password is
// the one exception: it says nothing about the email or the code.
const REGISTER_REFUSED = "Registration isn't open for that email and invite code.";
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
 * Registers an account and starts a session, if the email has an invite,
 * the code is that invite's and it hasn't expired, the password is at
 * least MIN_PASSWORD_LENGTH characters, and there's no account yet. The
 * invite is then deleted, so a code works once. Every refusal but a short
 * password gives the same message.
 *
 * @param {string} rawEmail - The email as typed (server.js refuses a
 *   request without string email, invite and password before calling this).
 * @param {string} code - The invite code as typed.
 * @param {string} password - The new password as typed.
 * @returns {Promise<AuthResult>} The new session, or why not (with
 *   retryAfterMs when throttled).
 * @throws {Error} If an account or invite file can't be read, written or
 *   deleted for a reason other than already existing or already gone.
 */
async function register(rawEmail, code, password) {
  const email = normalizeEmail(rawEmail);
  const key = `register:${email}`;
  const wait = throttled(key);
  if (wait) return wait;

  // Counted in characters (code points), not UTF-16 units or bytes.
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  const allowed = inviteAccepts(await readInvite(email), code) && !(await readAccount(email));
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
    // with the same code can't both succeed.
    await fs.promises.writeFile(accountFile(email), `${JSON.stringify(account, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'EEXIST') return { ok: false, error: REGISTER_REFUSED };
    throw err;
  }
  // Used up. If this fails the code still can't be reused: the account
  // now exists, which refuses a second registration.
  await fs.promises.unlink(inviteFile(email)).catch(
    /**
     * Ignores an invite file that's already gone; anything else is passed on.
     *
     * @param {NodeJS.ErrnoException} err - Why unlink() failed.
     * @returns {void}
     * @throws {NodeJS.ErrnoException} err itself, unless it's ENOENT.
     */
    (err) => {
      if (err.code !== 'ENOENT') throw err;
    },
  );
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
  INVITES_DIR,
  MIN_PASSWORD_LENGTH,
  INVITE_LIFETIME_MS,
  SESSION_LIFETIME_MS,
  createInvite,
  register,
  login,
  sessionEmail,
  endSession,
};

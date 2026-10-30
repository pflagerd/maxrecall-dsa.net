const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const { CURRENT_USER, EMAIL_PATTERN } = require('./users');

const scrypt = promisify(crypto.scrypt);

// Accounts and sessions live here, never in users/: that folder is committed
// to a public repo, and published password hashes invite offline guessing.
// Gitignored. MAXRECALL_AUTH_DIR moves it (the VPS keeps it outside the
// checkout, like its users/).
const AUTH_DIR = process.env.MAXRECALL_AUTH_DIR
  ? path.resolve(process.env.MAXRECALL_AUTH_DIR)
  : path.join(__dirname, 'auth');
const ACCOUNTS_DIR = path.join(AUTH_DIR, 'accounts');
const SESSIONS_DIR = path.join(AUTH_DIR, 'sessions');

const SESSION_LIFETIME_MS = 360 * 24 * 60 * 60 * 1000;

// NIST SP 800-63B rev. 4: passwords used as the only factor SHALL be at
// least 15 characters, with no other composition rules.
const MIN_PASSWORD_LENGTH = 15;

// OWASP Password Storage Cheat Sheet's scrypt minimum (Node 22 has no
// built-in Argon2id). N=2^17 needs 128 MiB, above Node's 32 MiB default
// maxmem, hence the raised limit.
const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
const KEY_LENGTH = 64;

// The fixed password that registering requires (the owner's decision,
// 2026-10-29). Unset or empty means registration is closed. Checked at
// startup so a too-short one stops the server rather than surprising later.
const REGISTRATION_PASSWORD = process.env.MAXRECALL_PASSWORD || null;
if (REGISTRATION_PASSWORD !== null && [...REGISTRATION_PASSWORD].length < MIN_PASSWORD_LENGTH) {
  throw new Error(`MAXRECALL_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
}

fs.mkdirSync(ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// Compares two strings in time that doesn't depend on where they differ.
// Hashing first gives timingSafeEqual the equal-length inputs it requires.
function sameSecret(a, b) {
  const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

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
const failures = new Map(); // key -> { count, waitUntil }

function waitRemainingMs(key) {
  const entry = failures.get(key);
  return entry ? Math.max(0, entry.waitUntil - Date.now()) : 0;
}

function recordFailure(key) {
  const count = (failures.get(key)?.count || 0) + 1;
  const delay = count < FREE_ATTEMPTS ? 0 : Math.min(1000 * 2 ** (count - FREE_ATTEMPTS), MAX_DELAY_MS);
  failures.set(key, { count, waitUntil: Date.now() + delay });
}

// --- Accounts -----------------------------------------------------------------

function accountFile(email) {
  return path.join(ACCOUNTS_DIR, `${email}.json`);
}

async function readAccount(email) {
  if (!EMAIL_PATTERN.test(email)) return null;
  try {
    return JSON.parse(await fs.promises.readFile(accountFile(email), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function registrationOpen() {
  return REGISTRATION_PASSWORD !== null;
}

// Every refusal gets the same message, whatever the reason: wrong email,
// wrong password, registration closed, or already registered.
const REGISTER_REFUSED = "Registration isn't open for that email and password.";
const LOGIN_REFUSED = 'Invalid email or password.';

function throttled(key) {
  const wait = waitRemainingMs(key);
  return wait > 0 ? { ok: false, retryAfterMs: wait, error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} s.` } : null;
}

// Returns { ok: true, email, token, expiresAt } or { ok: false, error, retryAfterMs? }.
async function register(rawEmail, password) {
  const email = normalizeEmail(rawEmail);
  const key = `register:${email}`;
  const wait = throttled(key);
  if (wait) return wait;

  const allowed = registrationOpen()
    && email === CURRENT_USER
    && sameSecret(password, REGISTRATION_PASSWORD)
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
    if (err.code === 'EEXIST') return { ok: false, error: REGISTER_REFUSED };
    throw err;
  }
  failures.delete(key);
  return { ok: true, email, ...(await createSession(email)) };
}

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

function sessionFile(token) {
  return path.join(SESSIONS_DIR, `${crypto.createHash('sha256').update(token).digest('hex')}.json`);
}

async function createSession(email) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  const session = { email, createdAt: new Date().toISOString(), expiresAt };
  await fs.promises.writeFile(sessionFile(token), `${JSON.stringify(session)}\n`, { flag: 'wx', mode: 0o600 });
  return { token, expiresAt };
}

// The email a session token belongs to, or null if it's missing, malformed,
// unknown or expired (expired sessions are deleted when found).
async function sessionEmail(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return null;
  let session;
  try {
    session = JSON.parse(await fs.promises.readFile(sessionFile(token), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  if (Date.parse(session.expiresAt) <= Date.now()) {
    await endSession(token);
    return null;
  }
  return session.email;
}

async function endSession(token) {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return;
  await fs.promises.unlink(sessionFile(token)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
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

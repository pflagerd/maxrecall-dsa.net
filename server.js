const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const http = require('http');
const path = require('path');

// Settings may come from a gitignored .env file (see .env.example). Loaded
// before any module below reads process.env. Variables already set in the
// environment win over the file; no file is fine.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
}

// The feature routes, users' (docs/plans/server-split.md): mounted below,
// after the gate. Required first, so the modules load in the order they did
// when the routes were in this file.
const { router, start } = require('./routes');
const { describeSandbox } = require('./judge/sandbox');
const { MAX_RUNNING, MAX_WAITING } = require('./judge/queue');
const { USERS_DIR, OWNER_EMAIL } = require('./users');
const { AUTH_DIR, SESSION_LIFETIME_MS, register, login, sessionEmail, endSession } = require('./auth');

/**
 * Express's request, plus what this server adds to it: who the request is
 * from (set by the first middleware below), and whether it came in on the
 * trusted listener.
 *
 * @typedef {import('express').Request & { userEmail?: string | null, viaTrustedPort?: boolean }} AppRequest
 */

/** @typedef {import('express').Response} Response */
/** @typedef {import('./auth').AuthResult} AuthResult */

const app = express();
// Behind a reverse proxy on this machine (nginx, docs/plans/limited-live.md,
// step 3), believe its X-Forwarded-Proto and X-Forwarded-For, so req.secure
// (and so the session cookie's Secure flag) and req.ip describe the
// visitor, not nginx. Only from a loopback address (127.0.0.1, ::1): from
// anywhere else the headers are ignored, so a visitor can't fake them by
// connecting directly. req.ip is the nearest address that isn't loopback,
// read from the right of X-Forwarded-For (proxy-addr's alladdrs(), with
// forwarded's parse() reading the header backwards), so a fake address a
// visitor puts in the header is never reached: nginx's own entry for the
// visitor is to its right. The trusted listener (TRUSTED_PORT)
// shares this app, but nothing proxies to it, and it ignores the cookie.
// https://expressjs.com/en/guide/behind-proxies.html
app.set('trust proxy', 'loopback');
const PORT = process.env.PORT || 3000;
// Which network address to listen on. Unset means every interface (the
// Node default), so other devices on a home network can connect.
// HOST=127.0.0.1 accepts only connections from this machine, e.g. on a
// server reached through an SSH tunnel.
const HOST = process.env.HOST || undefined;

// An optional second listener, always on 127.0.0.1, where every request is
// the owner (MAXRECALL_USER) with no sign-in. On the VPS it's what the SSH
// tunnel connects to; nothing else (e.g. a future reverse proxy) should
// ever point at it. Its own port rather than "trust requests from
// 127.0.0.1", because a proxy on the same machine would make every visitor
// look like 127.0.0.1. Unset (as on Kubuntu) means no trusted listener.
const TRUSTED_PORT = process.env.TRUSTED_PORT ? Number(process.env.TRUSTED_PORT) : null;
if (TRUSTED_PORT !== null && !(Number.isInteger(TRUSTED_PORT) && TRUSTED_PORT > 0 && TRUSTED_PORT < 65536 && TRUSTED_PORT !== Number(PORT))) {
  throw new Error(`TRUSTED_PORT must be a port number different from PORT, got ${JSON.stringify(process.env.TRUSTED_PORT)}`);
}

app.use(express.json());

// --- Signing in ---------------------------------------------------------------
// Every request first works out who it's from (req.userEmail) using the
// session cookie. The gate further down then lets through only signed-in
// requests, plus what the login page itself needs.

const SESSION_COOKIE = 'maxrecall_session';

/**
 * One cookie's value from the request's Cookie header. Written here rather
 * than taken from a library, as only the session cookie is needed.
 *
 * @param {import('express').Request} req - The request.
 * @param {string} name - The cookie's name.
 * @returns {string | null} Its value, URL-decoded, or null if it isn't there
 *   or can't be decoded.
 */
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Sets the session cookie. HttpOnly: page scripts can't read it.
 * SameSite=Lax: sent when following a link to the app from elsewhere, but
 * not with cross-site POSTs. Secure whenever the request came over HTTPS.
 *
 * @param {import('express').Request} req - The request (for req.secure).
 * @param {Response} res - The response to set it on.
 * @param {string} token - The session token.
 * @returns {void}
 */
function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_LIFETIME_MS, secure: req.secure });
}

app.use(
  /**
   * Works out who each request is from, for everything after it:
   * req.userEmail is the owner on the trusted listener, otherwise the session
   * cookie's email, or null if there's no valid session.
   *
   * @param {AppRequest} req - The request; userEmail is set on it.
   * @param {Response} res - The response (not used here).
   * @param {import('express').NextFunction} next - Called once userEmail is
   *   set, or with the error if the session can't be read.
   * @returns {Promise<void>}
   */
  async (req, res, next) => {
    if (req.viaTrustedPort) {
      req.userEmail = OWNER_EMAIL;
      return next();
    }
    try {
      req.userEmail = await sessionEmail(readCookie(req, SESSION_COOKIE));
      next();
    } catch (err) {
      next(err);
    }
  },
);

// Every POST (and PATCH) to the API must be JSON. A form on another site
// can't send JSON here without a CORS preflight, which this server never
// approves, so this (with SameSite=Lax) stops cross-site request forgery,
// logout included. A form can't send PATCH at all, and a cross-site fetch
// with it needs a preflight too; the same rule covers it for simplicity.
app.use(
  '/api',
  /**
   * Refuses a POST or PATCH that isn't JSON (415).
   *
   * @param {import('express').Request} req - Any /api/ request.
   * @param {Response} res - Answered with 415 if refused.
   * @param {import('express').NextFunction} next - Called if it's allowed through.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res, next) => {
    if ((req.method === 'POST' || req.method === 'PATCH') && !req.is('application/json')) {
      return res.status(415).json({ error: 'Send JSON (Content-Type: application/json)' });
    }
    next();
  },
);

/**
 * Answers a register or login attempt: the refusal (429 with Retry-After
 * when throttled), or the session cookie and the email.
 *
 * @param {import('express').Request} req - The request.
 * @param {Response} res - The response.
 * @param {AuthResult} result - What register() or login() returned.
 * @param {number} refusedStatus - The status for a refusal: 400 for
 *   register, 401 for login.
 * @returns {Response | void} Nothing that's used: the `return res...` lines
 *   only stop early.
 */
function sendAuthResult(req, res, result, refusedStatus) {
  if (!result.ok) {
    if (result.retryAfterMs) {
      res.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
      return res.status(429).json({ error: result.error });
    }
    return res.status(refusedStatus).json({ error: result.error });
  }
  setSessionCookie(req, res, result.token);
  res.json({ email: result.email });
}

/**
 * Handles POST /api/auth/register and /api/auth/login. Both start a new
 * session, ending any the browser already had (a fresh token after every
 * sign-in).
 *
 * @param {import('express').Request} req - The request; its body should be
 *   { email, password }.
 * @param {Response} res - The response.
 * @param {(email: string, password: string) => Promise<AuthResult>} attempt -
 *   register or login (auth.js).
 * @param {number} refusedStatus - The status for a refusal: 400 for
 *   register, 401 for login.
 * @returns {Promise<Response | void>} Nothing that's used: the
 *   `return res...` line only stops early.
 */
async function signIn(req, res, attempt, refusedStatus) {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const result = await attempt(email, password);
    if (result.ok) await endSession(readCookie(req, SESSION_COOKIE));
    sendAuthResult(req, res, result, refusedStatus);
  } catch (err) {
    res.status(500).json({ error: /** @type {Error} */ (err).message || 'Sign-in failed' });
  }
}

app.post(
  '/api/auth/register',
  /**
   * POST /api/auth/register: signIn() with register and the invite code
   * (400 for a refusal, or if invite isn't a string).
   *
   * @param {import('express').Request} req - Body { email, invite, password }.
   * @param {Response} res - Answered by signIn(), or 400 here.
   * @returns {Promise<Response | void> | Response} Nothing that's used.
   */
  (req, res) => {
    const { invite } = req.body || {};
    if (typeof invite !== 'string') return res.status(400).json({ error: 'email, invite and password are required' });
    return signIn(req, res, (email, password) => register(email, invite, password), 400);
  },
);
app.post(
  '/api/auth/login',
  /**
   * POST /api/auth/login: signIn() with login (401 for a refusal).
   *
   * @param {import('express').Request} req - Body { email, password }.
   * @param {Response} res - Answered by signIn().
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  (req, res) => signIn(req, res, login, 401),
);

app.post(
  '/api/auth/logout',
  /**
   * POST /api/auth/logout: ends the session and clears its cookie.
   *
   * @param {import('express').Request} req - Its session cookie, if any.
   * @param {Response} res - { ok: true }, or 500 if the session can't be ended.
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  async (req, res) => {
    try {
      await endSession(readCookie(req, SESSION_COOKIE));
    } catch (err) {
      return res.status(500).json({ error: /** @type {Error} */ (err).message || 'Logout failed' });
    }
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  },
);

app.get(
  '/api/auth/me',
  /**
   * GET /api/auth/me: who's signed in.
   *
   * @param {AppRequest} req - The request.
   * @param {Response} res - { email, trusted }, or 401 if not signed in.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res) => {
    if (!req.userEmail) return res.status(401).json({ error: 'Not signed in' });
    res.json({ email: req.userEmail, trusted: Boolean(req.viaTrustedPort) });
  },
);

// The gate. Not signed in: pages redirect to the login page (which comes
// back here afterwards via ?next=), API calls get 401.
const PUBLIC_PATHS = new Set(['/login.html', '/login-page.js', '/style.css']);
app.use(
  /**
   * The gate: lets through signed-in requests and PUBLIC_PATHS; otherwise
   * pages redirect to the login page and everything else gets 401.
   *
   * @param {AppRequest} req - The request, with userEmail set.
   * @param {Response} res - The redirect or the 401, if refused.
   * @param {import('express').NextFunction} next - Called if it's let through.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res, next) => {
    if (req.userEmail || PUBLIC_PATHS.has(req.path)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
    if (req.method === 'GET' || req.method === 'HEAD') {
      return res.redirect(302, `/login.html?next=${encodeURIComponent(req.originalUrl)}`);
    }
    res.status(401).end();
  },
);

// The feature routes (routes.js), here: after the gate, so every request they
// see is signed in (req.userEmail set), and before the /api/ 404, the
// STATIC_FILES and the fallback, which would otherwise answer first
// (Express runs middleware and routes in the order they're added).
app.use(router);

// Any other /api/ URL is an error, not a page: without this, GET requests
// would fall through to the index.html fallback below and get a 200 with
// HTML (e.g. the old /api/problems URLs, renamed to /api/questions).
app.all(
  '/api/*',
  /**
   * Any other /api/ URL: 404 with JSON.
   *
   * @param {import('express').Request} req - The request.
   * @param {Response} res - 404 { error }.
   * @returns {void}
   */
  (req, res) => {
    res.status(404).json({ error: `No such API endpoint: ${req.method} ${req.path}` });
  },
);

// --- Static front end -----------------------------------------------------

// Explicitly serve only the front-end assets (project root also holds server
// source and config, so we avoid a blanket express.static(__dirname)).
const STATIC_FILES = ['index.html', 'style.css', 'problem.html', 'problems-list.js', 'problem-page.js', 'labels.json', 'bubbles.js', 'timer.js', 'login.html', 'login-page.js', 'account.js'];
for (const file of STATIC_FILES) {
  app.get(
    `/${file}`,
    /**
     * One of STATIC_FILES.
     *
     * @param {import('express').Request} req - The request.
     * @param {Response} res - The file.
     * @returns {void}
     */
    (req, res) => res.sendFile(path.join(__dirname, file)),
  );
}

// Fallback to index.html for any unmatched route (simple SPA-style fallback)
app.get(
  '*',
  /**
   * Anything else: index.html (the problem list).
   *
   * @param {import('express').Request} req - The request.
   * @param {Response} res - index.html.
   * @returns {void}
   */
  (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  },
);

// The routes' start-up work (routes.js): every user's queue files, then the
// consistency check's log. Before listening, as when it was in this file.
start();

// PORT may be a string from the environment, and HOST undefined (every
// interface). Node's listen() accepts both, but Express's types allow only a
// number and a string, hence the casts.
app.listen(
  /** @type {number} */ (/** @type {unknown} */ (PORT)),
  /** @type {string} */ (HOST),
  /**
   * Logs where the server is listening, and its setup, once it is.
   *
   * @returns {void}
   */
  () => {
    const where = HOST ? `${HOST}:${PORT} only` : `port ${PORT} on every interface`;
    console.log(`Server listening on ${where}, http://localhost:${PORT} (submissions in ${USERS_DIR})`);
    console.log(`Sign-in data in ${AUTH_DIR}; registration by invite only (make invite EMAIL=...)`);
    // Registering needed it until 2026-11-04 (docs/plans/limited-live.md,
    // step 1, detail 6). Said here so a leftover setting isn't a mystery.
    if (process.env.MAXRECALL_PASSWORD) {
      console.log('MAXRECALL_PASSWORD is set but no longer used: registering needs an invite now. Remove it (on the VPS, /etc/maxrecall-dsa/test.env).');
    }
    console.log(`Sandbox: ${describeSandbox()}`);
    console.log(`Judge queue: at most ${MAX_RUNNING} judgings at once, ${MAX_WAITING} more waiting; beyond that Run and Submit get 503`);
  },
);

if (TRUSTED_PORT !== null) {
  // Marks the request before handing it to the same app, so the code above
  // knows which listener it arrived on.
  const trustedServer = http.createServer(
    /**
     * Every request on the trusted listener: marked, then handled by app.
     *
     * @param {import('http').IncomingMessage & { viaTrustedPort?: boolean }} req -
     *   The request; viaTrustedPort is set on it.
     * @param {import('http').ServerResponse} res - The response, for app.
     * @returns {void}
     */
    (req, res) => {
      req.viaTrustedPort = true;
      app(req, res);
    },
  );
  trustedServer.listen(
    TRUSTED_PORT,
    '127.0.0.1',
    /**
     * Logs that the trusted listener is up.
     *
     * @returns {void}
     */
    () => {
      console.log(`Trusted listener on 127.0.0.1:${TRUSTED_PORT} only: every request there is ${OWNER_EMAIL}, no sign-in`);
    },
  );
}

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

const { runSubmission } = require('./judge/runner');
const { describeSandbox } = require('./judge/sandbox');
const { MAX_RUNNING, MAX_WAITING } = require('./judge/queue');
const { resolveInside } = require('./paths');
const { USERS_DIR, OWNER_EMAIL, saveSubmission, listSubmissions, loadSubmission, readProfileFile, writeProfileFile, readUserFile, writeUserFile, listUsers } = require('./users');
const { LANGUAGES, parseProfile, applyPreferredChange } = require('./profile');
const { QUESTIONS_DIR, isQuestionFile, questionInfos } = require('./question-files');
const { checkConsistency, countLevels, formatFinding, describeCounts } = require('./consistency');
const { readSources } = require('./scripts/consistency-check');
const { parseQueueFiles, backlogPairs, fillBacklog, passFor, recordSubmit, nextPair, listPairs, canOpenPair } = require('./order');
const { AUTH_DIR, SESSION_LIFETIME_MS, register, login, sessionEmail, endSession } = require('./auth');

/**
 * Express's request, plus what this server adds to it: who the request is
 * from (set by the first middleware below), and whether it came in on the
 * trusted listener.
 *
 * @typedef {import('express').Request & { userEmail?: string | null, viaTrustedPort?: boolean }} AppRequest
 */

/** @typedef {import('express').Response} Response */
/** @typedef {import('./users').SavedSubmission} SavedSubmission */
/** @typedef {import('./auth').AuthResult} AuthResult */

/**
 * One test case in a question file. Function mode has args, program mode
 * has input (readme.html, "Problem file format").
 *
 * @typedef {object} TestCase
 * @property {unknown[]} [args] - Function mode: the arguments to call with.
 * @property {string} [input] - Program mode: the program's standard input.
 * @property {unknown} expected - The expected return value (function mode)
 *   or standard output (program mode).
 * @property {boolean} [hidden] - True if it's only used by Submit, and never
 *   sent to the browser.
 */

/**
 * A question file, questions/<slug>.json, as far as the server uses it.
 * Fields shown only by the page (description, learning, examples,
 * constraints) aren't listed; they're passed through unchanged.
 *
 * @typedef {object} Problem
 * @property {string} slug - Its id; should match the file name.
 * @property {string} title
 * @property {string} difficulty - "Easy", "Medium" or "Hard".
 * @property {string[]} topics
 * @property {string[]} sources
 * @property {string} created - When it was created, as UTC ISO 8601
 *   (spaced-repetition plan, step 3): the backlog's order.
 * @property {string} [judgeMode] - "function" (the default) or "program".
 * @property {Record<string, string>} starterCode - By language; a language
 *   missing here can't be submitted for this question.
 * @property {Record<string, string>} [functionName] - Function mode: the
 *   function to call, by language.
 * @property {Record<string, import('./judge/runner').FunctionSignature>} [signature] -
 *   Function mode, cpp/java/d only: the types the harness needs.
 * @property {TestCase[]} testCases
 */

/**
 * One line of the problem list (GET /api/questions).
 *
 * @typedef {Pick<Problem, 'slug' | 'title' | 'difficulty' | 'topics' | 'sources'>} ProblemSummary
 */

/**
 * One line of the Submissions tab (GET /api/submissions): a saved Submit
 * without its code, stdout and stderr.
 *
 * @typedef {object} SubmissionSummary
 * @property {string} id
 * @property {string} submittedAt
 * @property {string} question
 * @property {string} language
 * @property {string | null} status - null for a Skip.
 * @property {number | null} passed - null for a Skip.
 * @property {number | null} total - null for a Skip.
 * @property {number | null} runtimeMs - null for a Skip.
 * @property {number | null} elapsedMs - null if the record doesn't have it.
 * @property {'yes'} [skipped] - "yes" for a Skip (step 8; D8); absent for a
 *   Submit.
 */

/**
 * What the judge can throw (judge/sandbox.js, judge/queue.js): an Error
 * whose code says when the server should answer 503 rather than 500.
 *
 * @typedef {Error & { code?: string, retryAfterSeconds?: number }} JudgeError
 */

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
// The judge's five languages, kept in one place (profile.js).
const SUPPORTED_LANGUAGES = LANGUAGES;

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

// --- Problem data -----------------------------------------------------

/**
 * Reads a question file. Returns the parsed problem, and the SHA-256 of the
 * file's exact bytes so a saved submission can tell later whether the
 * question has been edited since. Both come from one read, so they match.
 *
 * @param {string} slug - The question's id, from the request; kept inside
 *   questions/ by resolveInside().
 * @returns {{ problem: Problem, sha256: string } | null} The problem and the
 *   file's SHA-256 (hex), or null if there's no such question.
 * @throws {SyntaxError} If the file isn't valid JSON.
 */
function loadProblem(slug) {
  if (!isQuestionFile(`${slug}.json`)) return null; // e.g. "renames", the rename log
  const file = resolveInside(QUESTIONS_DIR, `${slug}.json`);
  if (!file || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return {
    problem: JSON.parse(bytes.toString('utf8')),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

/**
 * Every question in questions/, for the problem list.
 *
 * @returns {ProblemSummary[]} One per .json file, sorted by title.
 * @throws {Error} If questions/ can't be read, or a file isn't valid JSON.
 */
function listProblems() {
  return fs
    .readdirSync(QUESTIONS_DIR)
    .filter(isQuestionFile)
    .map(
    /**
     * Reads one question file's summary.
     *
     * @param {string} f - The file's name in questions/.
     * @returns {ProblemSummary} Its slug, title, difficulty, topics and sources.
     */
    (f) => {
        const { slug, title, difficulty, topics, sources } = JSON.parse(
          fs.readFileSync(path.join(QUESTIONS_DIR, f), 'utf8')
        );
        return { slug, title, difficulty, topics, sources };
      },
  )
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Strips expected answers/inputs for hidden test cases before sending to the
 * client. Test case shape depends on judgeMode (args/expected for
 * "function", input/expected for "program"), so this strips just `hidden`
 * rather than picking specific fields.
 *
 * @param {Problem} problem - The question as read from its file.
 * @returns {Omit<Problem, 'testCases'> & { visibleTestCases: Omit<TestCase, 'hidden'>[], hiddenCount: number }}
 *   Everything else unchanged, the visible test cases without their
 *   `hidden` field, and how many are hidden.
 */
function toPublicProblem(problem) {
  const { testCases, ...rest } = problem;
  return {
    ...rest,
    visibleTestCases: testCases
      .filter((tc) => !tc.hidden)
      .map(({ hidden, ...tc }) => tc),
    hiddenCount: testCases.filter((tc) => tc.hidden).length,
  };
}

// --- API ----------------------------------------------------------------

app.get(
  '/api/questions',
  /**
   * GET /api/questions: the problem list.
   *
   * @param {import('express').Request} req - The request.
   * @param {Response} res - ProblemSummary[], sorted by title.
   * @returns {void}
   */
  (req, res) => {
    res.json(listProblems());
  },
);

app.get(
  '/api/questions/:slug',
  /**
   * GET /api/questions/:slug: one question, without its hidden test cases.
   *
   * @param {import('express').Request} req - req.params.slug names the question.
   * @param {Response} res - toPublicProblem()'s result, or 404.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res) => {
    const loaded = loadProblem(req.params.slug);
    if (!loaded) return res.status(404).json({ error: 'Question not found' });
    res.json(toPublicProblem(loaded.problem));
  },
);

/**
 * A Run, Submit or Skip request that passed checkExecutionRequest().
 *
 * @typedef {object} CheckedRequest
 * @property {Problem} problem - The question.
 * @property {string} sha256 - Its file's SHA-256, for the record.
 * @property {string} email - The signed-in user.
 * @property {string} language - One of SUPPORTED_LANGUAGES, allowed by the
 *   profile and the question.
 * @property {string} code - The editor's code.
 * @property {number | undefined} elapsedMs - The page's timer, if sent.
 */

/**
 * The checks Run, Submit and Skip share, so they refuse the same things:
 * 404 for an unknown question; 400 for a bad language, code or elapsedMs,
 * or a language the question lacks; 403 for one the profile doesn't allow;
 * 500 for an invalid profile or queue file (fail closed). Each refusal is
 * sent here.
 *
 * @param {AppRequest} req - The request; its body should be
 *   { language, code, elapsedMs? }.
 * @param {Response} res - The response, sent if the request is refused.
 * @param {{ codeRequired: boolean }} options - false for Skip, whose code
 *   may be empty (step 8, detail 5); it must still be a string.
 * @returns {CheckedRequest | null} What was asked, or null if refused.
 */
function checkExecutionRequest(req, res, { codeRequired }) {
  const loaded = loadProblem(req.params.slug);
  if (!loaded) {
    res.status(404).json({ error: 'Question not found' });
    return null;
  }
  const { problem } = loaded;
  /** @type {string} */
  const email = /** @type {string} */ (req.userEmail); // signed in: the gate

  const { language, code, elapsedMs } = req.body || {};
  /**
   * Sends one refusal.
   *
   * @param {number} status - The HTTP status.
   * @param {string} error - Why.
   * @returns {null} So a check can `return refuse(...)`.
   */
  const refuse = (status, error) => {
    res.status(status).json({ error });
    return null;
  };
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return refuse(400, `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}`);
  }
  if (typeof code !== 'string' || (codeRequired && !code.trim())) {
    return refuse(400, codeRequired ? 'code is required' : 'code must be a string (it may be empty)');
  }
  // How long the learner took, from the problem page's timer (issue #20).
  // Optional, so a page loaded before the timer existed can still Submit;
  // the record then says null. It's what the browser reports, not measured
  // here (docs/plans/elapsed-timer.md, T6).
  if (elapsedMs !== undefined && !(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0)) {
    return refuse(400, 'elapsedMs must be a whole number of milliseconds, 0 or more');
  }

  if (!problem.starterCode[language]) {
    return refuse(400, `This problem doesn't support ${language}.`);
  }
  // The learner's profile decides which languages they may use (403
  // otherwise). An invalid profile refuses everything rather than guess
  // (fail closed): 500, naming the problem.
  let profile;
  try {
    profile = loadProfile(email);
  } catch (err) {
    sendProfileError(res, /** @type {Error & { code?: string }} */ (err));
    return null;
  }
  if (!profile.allowedLanguages.includes(language)) {
    return refuse(403, `${language} isn't one of the languages you can use (${profile.allowedLanguages.join(', ')}).`);
  }
  // Broken order.json or backlog.json: refused the same way (step 5,
  // decision 3).
  try {
    loadQueueFiles(email);
  } catch (err) {
    sendQueueError(res, /** @type {Error & { code?: string }} */ (err));
    return null;
  }
  return { problem, sha256: loaded.sha256, email, language, code, elapsedMs };
}

/**
 * A Submit or Skip record (readme.html, "Where data lives"). Version 3
 * (step 8, detail 6) added skipped: "yes" on a Skip; a Submit leaves it
 * out. A Skip isn't judged, so its judging fields are null and results
 * empty (D8).
 *
 * @param {CheckedRequest} request - What was asked.
 * @param {string} submittedAt - When, as UTC ISO 8601.
 * @param {import('./judge/runner').JudgeResult | null} result - The judge's
 *   result, or null for a Skip.
 * @returns {import('./users').SubmissionRecord} The record to save.
 */
function submissionRecord({ problem, sha256, language, code, elapsedMs }, submittedAt, result) {
  return {
    // 2 added elapsedMs (2026-11-03), 3 skipped (step 8).
    schemaVersion: 3,
    submittedAt,
    question: problem.slug,
    questionSha256: sha256,
    language,
    judgeMode: problem.judgeMode || 'function',
    code,
    ...(result === null && { skipped: /** @type {'yes'} */ ('yes') }),
    status: result ? result.status : null,
    passed: result ? result.passed : null,
    total: result ? result.total : null,
    runtimeMs: result ? result.runtimeMs : null,
    elapsedMs: elapsedMs ?? null,
    results: result ? result.results.map((/** @type {{ passed: boolean }} */ r) => r.passed) : [],
    stdout: result ? result.stdout : null,
    stderr: result ? result.stderr : null,
  };
}

/**
 * Handles Run (visible test cases only) and Submit (all of them, then saves
 * a record and moves the queue). Refuses what checkExecutionRequest()
 * refuses; 503 when the judge is unavailable or busy; otherwise the judge's
 * result, with saved/submissionId (or saveError) and queueUpdated (or
 * queueError) for a Submit.
 *
 * @param {AppRequest} req - The request; its body should be
 *   { language, code, elapsedMs? }.
 * @param {Response} res - The response.
 * @param {{ onlyVisible: boolean }} options - true for Run, false for Submit.
 * @returns {Promise<Response | void>} Nothing that's used: the
 *   `return res...` lines only stop early.
 */
async function handleExecution(req, res, { onlyVisible }) {
  const request = checkExecutionRequest(req, res, { codeRequired: true });
  if (!request) return;
  const { problem, email, language, code } = request;

  const judgeMode = problem.judgeMode || 'function';
  // A function-mode question always has functionName (the problem file
  // format); one without would throw here, as before.
  const functionName = judgeMode === 'function' ? /** @type {Record<string, string>} */ (problem.functionName)[language] : undefined;
  const testCases = onlyVisible ? problem.testCases.filter((tc) => !tc.hidden) : problem.testCases;
  const signature = problem.signature && problem.signature[language];

  try {
    const submittedAt = new Date().toISOString();
    // Submit adds what happened to its record: saved, then submissionId or saveError.
    const result = /** @type {import('./judge/runner').JudgeResult & { saved?: boolean, submissionId?: string, saveError?: string, queueUpdated?: boolean, queueError?: string }} */ (
      await runSubmission({ language, code, functionName, testCases, signature, judgeMode })
    );
    // Only Submit is recorded (Run isn't). A failed save mustn't cost the
    // learner their result, so it's reported alongside it instead.
    if (!onlyVisible) {
      try {
        // saveSubmission checks the user again.
        result.submissionId = await saveSubmission(email, submissionRecord(request, submittedAt, result));
        result.saved = true;
      } catch (err) {
        console.error(`Failed to save submission for ${problem.slug}:`, err);
        result.saved = false;
        result.saveError = /** @type {Error} */ (err).message;
      }
      // Only a saved Submit moves the queue (D3). Like a failed save, a
      // failed update doesn't cost the learner their result (step 6,
      // detail 5). No await from here to the response: see updateQueue().
      if (result.saved) {
        try {
          updateQueue(email, { question: problem.slug, language }, passFor(result.status));
          result.queueUpdated = true;
        } catch (err) {
          console.error(`Queue not updated for ${problem.slug} in ${language}: ${/** @type {Error} */ (err).message}`);
          result.queueUpdated = false;
          result.queueError = /** @type {Error} */ (err).message;
        }
      }
    }
    res.json(result);
  } catch (err) {
    // 503 Service Unavailable: the server is fine, but judging is turned
    // off until its sandbox works (judge/sandbox.js), or the judge's queue
    // is full for now (judge/queue.js), in which case Retry-After says
    // when to try again (RFC 9110, section 10.2.3).
    const judgeError = /** @type {JudgeError} */ (err);
    const httpStatus = judgeError.code === 'SANDBOX_UNAVAILABLE' || judgeError.code === 'JUDGE_BUSY' ? 503 : 500;
    if (judgeError.code === 'JUDGE_BUSY') res.set('Retry-After', String(judgeError.retryAfterSeconds));
    res.status(httpStatus).json({ error: judgeError.message || 'Execution failed' });
  }
}

app.post(
  '/api/questions/:slug/run',
  /**
   * POST /api/questions/:slug/run: handleExecution() on the visible test cases.
   *
   * @param {AppRequest} req - Body { language, code }.
   * @param {Response} res - Answered by handleExecution().
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  (req, res) => handleExecution(req, res, { onlyVisible: true }),
);
app.post(
  '/api/questions/:slug/submit',
  /**
   * POST /api/questions/:slug/submit: handleExecution() on every test case,
   * then saved.
   *
   * @param {AppRequest} req - Body { language, code, elapsedMs? }.
   * @param {Response} res - Answered by handleExecution().
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  (req, res) => handleExecution(req, res, { onlyVisible: false }),
);

/**
 * Handles Skip (step 8; D8): saves a Skip record, then moves the pair as a
 * failed Submit would (recordSubmit() with pass "no"), and answers with
 * what's next, so the page can go straight there (detail 2). Refuses what
 * checkExecutionRequest() refuses, with code allowed to be empty. A pair
 * with passesInARow above 0 needs confirmed: true, or it's 409 with
 * { code: "CONFIRM_STREAK", passesInARow } and nothing changes (detail 1).
 * That check reads order.json before the record is saved (an await), so
 * it's a preflight; the queue change itself is updateQueue()'s, with no
 * await.
 *
 * @param {AppRequest} req - The request; its body should be
 *   { language, code, elapsedMs?, confirmed? }.
 * @param {Response} res - { saved, submissionId?, saveError?, queueUpdated?,
 *   queueError?, next?, nextError? }.
 * @returns {Promise<Response | void>} Nothing that's used: the
 *   `return res...` lines only stop early.
 */
async function handleSkip(req, res) {
  const { confirmed } = req.body || {};
  if (confirmed !== undefined && typeof confirmed !== 'boolean') {
    return res.status(400).json({ error: 'confirmed must be true or false' });
  }
  const request = checkExecutionRequest(req, res, { codeRequired: false });
  if (!request) return;
  const { problem, email, language } = request;
  const pair = { question: problem.slug, language };

  let element;
  try {
    element = loadQueueFiles(email).order.queue.find((e) => e.question === pair.question && e.language === pair.language);
  } catch (err) {
    return sendQueueError(res, /** @type {Error & { code?: string }} */ (err));
  }
  if (element && element.passesInARow > 0 && confirmed !== true) {
    const n = element.passesInARow;
    return res.status(409).json({
      error: `Skipping resets your ${n} ${n === 1 ? 'pass' : 'passes'} in a row; send confirmed: true to skip anyway.`,
      code: 'CONFIRM_STREAK',
      passesInARow: n,
    });
  }

  /** @type {{ saved: boolean, submissionId?: string, saveError?: string, queueUpdated?: boolean, queueError?: string, next?: (import('./order').BacklogElement & { title: string }) | null, nextError?: string }} */
  const answer = { saved: false };
  try {
    answer.submissionId = await saveSubmission(email, submissionRecord(request, new Date().toISOString(), null));
    answer.saved = true;
  } catch (err) {
    console.error(`Failed to save skip for ${problem.slug}:`, err);
    answer.saveError = /** @type {Error} */ (err).message;
    return res.json(answer); // nothing changed: the page stays (detail 3a)
  }
  // From here to the response, no await (updateQueue()).
  try {
    updateQueue(email, pair, 'no');
    answer.queueUpdated = true;
  } catch (err) {
    console.error(`Queue not updated for ${problem.slug} in ${language}: ${/** @type {Error} */ (err).message}`);
    answer.queueUpdated = false;
    answer.queueError = /** @type {Error} */ (err).message;
  }
  try {
    answer.next = workOutNext(email);
  } catch (err) {
    answer.nextError = /** @type {Error} */ (err).message;
  }
  res.json(answer);
}

app.post(
  '/api/questions/:slug/skip',
  /**
   * POST /api/questions/:slug/skip: handleSkip().
   *
   * @param {AppRequest} req - Body { language, code, elapsedMs?, confirmed? }.
   * @param {Response} res - Answered by handleSkip().
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  (req, res) => handleSkip(req, res),
);

// --- Saved submissions (the signed-in user's own) --------------------------------
// Express 4 doesn't catch errors from async handlers, hence the try/catch.

/**
 * A summary for a list: everything except code, stdout and stderr.
 * elapsedMs is null for records without it (schemaVersion 1, or a page
 * that didn't send it).
 *
 * @param {SavedSubmission} record - A saved Submit.
 * @returns {SubmissionSummary} Its summary.
 */
function toSubmissionSummary({ id, submittedAt, question, language, status, passed, total, runtimeMs, elapsedMs, skipped }) {
  return { id, submittedAt, question, language, status, passed, total, runtimeMs, elapsedMs: elapsedMs ?? null, ...(skipped === 'yes' && { skipped }) };
}

// Newest first. Optional ?question=<slug> and ?language=<language> narrow
// it down. Progress is per (question, language), so the problem page asks
// for exactly one pair.
app.get(
  '/api/submissions',
  /**
   * GET /api/submissions: the user's saved Submits, as summaries.
   *
   * @param {AppRequest} req - ?question= and ?language=, each optional.
   * @param {Response} res - SubmissionSummary[], newest first; 400 for a bad
   *   query; 500 if they can't be read.
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  async (req, res) => {
    const { question, language } = req.query;
    if (question !== undefined && typeof question !== 'string') {
      return res.status(400).json({ error: 'question must be given at most once' });
    }
    if (language !== undefined && !(typeof language === 'string' && SUPPORTED_LANGUAGES.includes(language))) {
      return res.status(400).json({ error: `language must be given at most once, as one of: ${SUPPORTED_LANGUAGES.join(', ')}` });
    }
    try {
      const records = await listSubmissions(/** @type {string} */ (req.userEmail)); // signed in: the gate
      res.json(
        records
          .filter((r) => (!question || r.question === question) && (!language || r.language === language))
          .map(toSubmissionSummary)
      );
    } catch (err) {
      res.status(500).json({ error: /** @type {Error} */ (err).message || 'Could not read submissions' });
    }
  },
);

// One submission in full, including code, stdout and stderr.
app.get(
  '/api/submissions/:id',
  /**
   * GET /api/submissions/:id: one saved Submit in full.
   *
   * @param {AppRequest} req - req.params.id is its id.
   * @param {Response} res - The record, or 404; 500 if it can't be read.
   * @returns {Promise<Response | void>} Nothing that's used.
   */
  async (req, res) => {
    try {
      const record = await loadSubmission(/** @type {string} */ (req.userEmail), req.params.id); // signed in: the gate
      if (!record) return res.status(404).json({ error: 'Submission not found' });
      res.json(record);
    } catch (err) {
      res.status(500).json({ error: /** @type {Error} */ (err).message || 'Could not read submission' });
    }
  },
);

// --- The learner's profile (spaced-repetition plan, D2) -------------------------

/**
 * The signed-in user's effective profile, from users/<email>/profile.json.
 *
 * @param {string} email - The user's email.
 * @returns {import('./profile').EffectiveProfile} The profile to use.
 * @throws {Error} ProfileError (code INVALID_PROFILE) if the file is
 *   invalid; another Error if it can't be read.
 */
function loadProfile(email) {
  return parseProfile(readProfileFile(email));
}

/**
 * Answers a request that a profile problem stopped: 500 for an invalid
 * profile.json (the server's data, not the request, is wrong) or one that
 * can't be read, and logs it, since the owner has to fix the file.
 *
 * @param {Response} res - The response.
 * @param {Error & { code?: string }} err - From loadProfile() or
 *   applyPreferredChange().
 * @returns {Response} The response, sent.
 */
function sendProfileError(res, err) {
  console.error(`Profile problem: ${err.message}`);
  return res.status(500).json({ error: err.message, code: err.code === 'INVALID_PROFILE' ? 'INVALID_PROFILE' : undefined });
}

// The effective profile: allowedLanguages, languages (turned on, in order),
// defaultLanguage and the three can... permissions.
app.get(
  '/api/profile',
  /**
   * GET /api/profile: the user's effective profile.
   *
   * @param {AppRequest} req - The request.
   * @param {Response} res - The EffectiveProfile, or 500 if profile.json is invalid.
   * @returns {void}
   */
  (req, res) => {
    try {
      res.json(loadProfile(/** @type {string} */ (req.userEmail))); // signed in: the gate
    } catch (err) {
      sendProfileError(res, /** @type {Error & { code?: string }} */ (err));
    }
  },
);

// The learner changes their own choices: body { languages?, defaultLanguage? }.
// Only preferred changes (profile.js, applyPreferredChange): 403 when an
// allowed flag forbids it, 400 when it doesn't fit allowed. Read, changed
// and written with no await in between (synchronous file calls), so two at
// once can't overwrite each other's change. Answers the new effective profile.
app.patch(
  '/api/profile/preferred',
  /**
   * PATCH /api/profile/preferred: the learner changes their own choices.
   *
   * @param {AppRequest} req - Body { languages?, defaultLanguage? }.
   * @param {Response} res - The new EffectiveProfile; 403 if not permitted,
   *   400 if it doesn't fit, 500 if profile.json is invalid.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res) => {
    const email = /** @type {string} */ (req.userEmail); // signed in: the gate
    let contents;
    try {
      const text = readProfileFile(email);
      let raw;
      try {
        raw = text === undefined ? undefined : JSON.parse(text);
      } catch {
        // Not JSON: parseProfile says so, as an invalid profile.
        parseProfile(/** @type {string} */ (text));
      }
      contents = applyPreferredChange(raw, req.body || {});
    } catch (err) {
      const { code, message } = /** @type {Error & { code?: string }} */ (err);
      if (code === 'NOT_PERMITTED') return res.status(403).json({ error: message });
      if (code === 'INVALID_CHANGE') return res.status(400).json({ error: message });
      return sendProfileError(res, /** @type {Error & { code?: string }} */ (err));
    }
    try {
      writeProfileFile(email, contents);
      res.json(parseProfile(readProfileFile(email)));
    } catch (err) {
      sendProfileError(res, /** @type {Error} */ (err));
    }
  },
);

// What to open next (spaced-repetition plan, step 7; D7): the front of the
// queue that can be opened, else the backlog's (detail 3). Safe, as a GET
// should be (RFC 9110, section 9.2.1): the backlog is filled in memory
// only, as it would be at start (detail 4), and nothing is written.
app.get(
  '/api/next',
  /**
   * GET /api/next: { next: { question, language, title } }, or
   * { next: null } if nothing can be opened (detail 1).
   *
   * @param {AppRequest} req - The request.
   * @param {Response} res - The answer, or 500 if the profile, a queue file
   *   or a question file is invalid.
   * @returns {Response | void} Nothing that's used: the `return res...`
   *   lines only stop early.
   */
  (req, res) => {
    try {
      res.json({ next: workOutNext(/** @type {string} */ (req.userEmail)) }); // signed in: the gate
    } catch (err) {
      return sendViewError(res, /** @type {Error & { code?: string }} */ (err), 'Next not worked out');
    }
  },
);

// The problem list (spaced-repetition plan, step 9; D7): the pairs that can
// be opened, queue first, then backlog. Safe, like GET /api/next: the
// backlog is filled in memory only, and nothing is written.
app.get(
  '/api/queue',
  /**
   * GET /api/queue: { pairs: [{ question, language, where, pass?,
   * passesInARow?, title, difficulty, topics, sources }] }, next first.
   *
   * @param {AppRequest} req - The request.
   * @param {Response} res - The list, or 500 if the profile, a queue file
   *   or a question file is invalid.
   * @returns {Response | void} Nothing that's used.
   */
  (req, res) => {
    try {
      const { order, backlog, canOpen, questionOf } = queueView(/** @type {string} */ (req.userEmail)); // signed in: the gate
      res.json({
        pairs: listPairs(order, backlog, canOpen).map(
          /**
           * Adds what the list shows of the pair's question.
           *
           * @param {import('./order').ListedPair} p - A pair.
           * @returns {import('./order').ListedPair & Pick<Problem, 'title' | 'difficulty' | 'topics' | 'sources'>} The line.
           */
          (p) => {
            const { title, difficulty, topics, sources } = questionOf(p.question);
            return { ...p, title, difficulty, topics, sources };
          },
        ),
      });
    } catch (err) {
      return sendViewError(res, /** @type {Error & { code?: string }} */ (err), 'Queue not listed');
    }
  },
);

/**
 * What to open next for a user (step 7): nextPair() over their files, the
 * backlog filled in memory only (detail 4), with canOpenPair(). Writes
 * nothing. Used by GET /api/next and by Skip's answer.
 *
 * @param {string} email - The user's email.
 * @returns {(import('./order').BacklogElement & { title: string }) | null}
 *   The pair and its question's title, or null if nothing can be opened.
 * @throws {Error} ProfileError (INVALID_PROFILE) or QueueFileError
 *   (INVALID_QUEUE) for an invalid file; another Error if a file can't be
 *   read, or a question file is invalid.
 */
function workOutNext(email) {
  const { order, backlog, canOpen, questionOf } = queueView(email);
  const next = nextPair(order, backlog, canOpen);
  return next && { ...next, title: questionOf(next.question).title };
}

/**
 * A user's queue and backlog as Next and the problem list see them (steps
 * 7 and 9): the backlog filled in memory only (step 7, detail 4), the
 * canOpenPair() test, and a way to look up a question. Writes nothing.
 *
 * @param {string} email - The user's email.
 * @returns {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile,
 *   canOpen: (pair: import('./order').BacklogElement) => boolean,
 *   questionOf: (slug: string) => QuestionListing }} The view. questionOf()
 *   is only for a pair canOpen() accepted, whose question is known.
 * @throws {Error} ProfileError (INVALID_PROFILE) or QueueFileError
 *   (INVALID_QUEUE) for an invalid file; another Error if a file can't be
 *   read, or a question file is invalid.
 */
function queueView(email) {
  const profile = loadProfile(email);
  const files = loadQueueFiles(email);
  const questions = questionInfos();
  const bySlug = new Map(questions.map((q) => [q.slug, q]));
  return {
    order: files.order,
    backlog: fillBacklog(files.order, files.backlog, backlogPairs(questions, profile)).backlog,
    canOpen: canOpenPair(profile, questions),
    // canOpenPair() accepts only pairs whose question is in questions.
    questionOf: (slug) => /** @type {QuestionListing} */ (bySlug.get(slug)),
  };
}

/**
 * Answers a request that a queue view stopped: the profile's or the
 * queue's 500, or a plain 500 for anything else (logged as `what`).
 *
 * @param {Response} res - The response.
 * @param {Error & { code?: string }} err - From queueView().
 * @param {string} what - What couldn't be done, for the log.
 * @returns {Response} The response, sent.
 */
function sendViewError(res, err, what) {
  if (err.code === 'INVALID_PROFILE') return sendProfileError(res, err);
  if (err.code === 'INVALID_QUEUE') return sendQueueError(res, err);
  console.error(`${what}: ${err.message}`);
  return res.status(500).json({ error: err.message });
}

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

// --- The learner's queue and backlog (spaced-repetition plan, D1, D5, D6) ---

/**
 * A user's order.json and backlog.json, checked together (order.js).
 *
 * @param {string} email - The user's email.
 * @returns {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile }}
 *   Both; a missing file reads as an empty queue or backlog.
 * @throws {Error} QueueFileError (code INVALID_QUEUE) if either is invalid,
 *   or a pair is in both; another Error if one can't be read.
 */
function loadQueueFiles(email) {
  return parseQueueFiles(readUserFile(email, 'order.json'), readUserFile(email, 'backlog.json'));
}

/**
 * Answers a request that a queue problem stopped: 500, as for the profile
 * (sendProfileError), and logs it, since the owner has to fix the file.
 *
 * @param {Response} res - The response.
 * @param {Error & { code?: string }} err - From loadQueueFiles().
 * @returns {Response} The response, sent.
 */
function sendQueueError(res, err) {
  console.error(`Queue problem: ${err.message}`);
  return res.status(500).json({ error: err.message, code: err.code === 'INVALID_QUEUE' ? 'INVALID_QUEUE' : undefined });
}

/** @typedef {import('./question-files').QuestionListing} QuestionListing */

/**
 * Gives one user an order.json and a backlog.json holding every pair their
 * profile allows (step 5, decision 4; D6): with neither file, an empty
 * queue and a full backlog; otherwise the pairs in neither file are
 * appended to the backlog. With a chosen backlog (profile.json's backlog
 * "chosen", step 13) nothing is appended: a missing file is written empty.
 * order.js's backlogPairs() is the rule. A file is written only if it's
 * new or has changed.
 *
 * @param {string} email - The user's email.
 * @param {import('./order').QuestionInfo[]} questions - From questionInfos().
 * @returns {string} What was done, for the log, e.g. "0 in order.json, 26
 *   in backlog.json (26 added)".
 * @throws {Error} ProfileError or QueueFileError if a file is invalid
 *   (nothing is written then); another Error if one can't be read or written.
 */
function prepareUserQueues(email, questions) {
  const orderText = readUserFile(email, 'order.json');
  const backlogText = readUserFile(email, 'backlog.json');
  const { order, backlog } = parseQueueFiles(orderText, backlogText);
  const filled = fillBacklog(order, backlog, backlogPairs(questions, loadProfile(email)));
  if (orderText === undefined) writeUserFile(email, 'order.json', order);
  if (backlogText === undefined || filled.added > 0) writeUserFile(email, 'backlog.json', filled.backlog);
  return `${order.queue.length} in order.json, ${filled.backlog.backlog.length} in backlog.json (${filled.added} added)`;
}

/**
 * At start, prepareUserQueues() for every user (listUsers()), each logged.
 * A user whose profile or queue files are invalid is left alone, and
 * logged: their Run and Submit refuse until the file is fixed (fail
 * closed). Nothing here stops the server starting.
 *
 * @returns {void}
 */
function prepareQueues() {
  let questions, users;
  try {
    questions = questionInfos();
    users = listUsers();
  } catch (err) {
    console.error(`Queues: not prepared: ${/** @type {Error} */ (err).message}`);
    return;
  }
  for (const email of users) {
    try {
      console.log(`Queues: ${email}: ${prepareUserQueues(email, questions)}`);
    } catch (err) {
      console.error(`Queues: ${email}: left alone, ${/** @type {Error} */ (err).message}`);
    }
  }
}

/**
 * Moves a pair through the user's queue after a saved Submit
 * (recordSubmit() in order.js; step 6). A user without both files yet is
 * first given them as at start (detail 6). Only pairs canOpenPair()
 * accepts can come in from the backlog (detail 3).
 *
 * Synchronous on purpose: reading, changing and writing happen with no
 * await in between, so two Submits at once (two tabs) can't each read the
 * old queue and one overwrite the other's move (a lost update; D1).
 * backlog.json is written before order.json: a crash between the two then
 * leaves a pair in neither file, which the next start puts back in the
 * backlog, rather than in both, which would refuse the learner's Run and
 * Submit until the owner fixed it by hand.
 *
 * @param {string} email - The user's email.
 * @param {import('./order').BacklogElement} pair - The pair submitted.
 * @param {'yes' | 'no'} pass - From passFor().
 * @returns {void}
 * @throws {Error} If a question file, the profile or a queue file can't be
 *   read or is invalid, or a file can't be written.
 */
function updateQueue(email, pair, pass) {
  const questions = questionInfos();
  if (readUserFile(email, 'order.json') === undefined || readUserFile(email, 'backlog.json') === undefined) {
    console.log(`Queues: ${email}: ${prepareUserQueues(email, questions)}`);
  }
  const { order, backlog } = loadQueueFiles(email);
  const profile = loadProfile(email);
  const result = recordSubmit(order, backlog, pair, pass, { canIntroduce: canOpenPair(profile, questions) });
  if (JSON.stringify(result.backlog) !== JSON.stringify(backlog)) writeUserFile(email, 'backlog.json', result.backlog);
  writeUserFile(email, 'order.json', result.order);
}

prepareQueues();

/** How many errors and warnings the start log lists per user (step 10, detail 3). @type {number} */
const CONSISTENCY_LOG_LIMIT = 10;

/**
 * Logs the consistency check once, at start, after the queues are filled
 * (D5; step 10, detail 3): the totals, then a line per user with the counts, then its
 * errors and warnings, at most CONSISTENCY_LOG_LIMIT of them; info is only
 * counted. Never stops the server: the check only reports.
 *
 * @returns {Promise<void>} Never rejects: a failure is logged.
 */
async function logConsistency() {
  try {
    const sources = await readSources();
    const findings = checkConsistency(sources);
    const n = sources.users.length;
    console.log(`Consistency: ${n} ${n === 1 ? 'user' : 'users'} checked: ${describeCounts(countLevels(findings))}`);
    for (const f of findings.filter((x) => x.email === '')) console.log(`Consistency: ${formatFinding(f)}`);
    for (const { email } of sources.users) {
      const own = findings.filter((f) => f.email === email);
      console.log(`Consistency: ${email}: ${own.length ? describeCounts(countLevels(own)) : 'nothing found'}`);
      const listed = own.filter((f) => f.level !== 'info');
      for (const f of listed.slice(0, CONSISTENCY_LOG_LIMIT)) console.log(`  ${formatFinding(f)}`);
      if (listed.length > CONSISTENCY_LOG_LIMIT) console.log(`  …and ${listed.length - CONSISTENCY_LOG_LIMIT} more: run make consistency-check`);
    }
  } catch (err) {
    console.error(`Consistency: not checked: ${/** @type {Error} */ (err).message}`);
  }
}

logConsistency();

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

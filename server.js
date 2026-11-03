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
const { USERS_DIR, OWNER_EMAIL, saveSubmission, listSubmissions, loadSubmission, readProfileFile, writeProfileFile } = require('./users');
const { LANGUAGES, parseProfile, applyPreferredChange } = require('./profile');
const { AUTH_DIR, SESSION_LIFETIME_MS, registrationOpen, register, login, sessionEmail, endSession } = require('./auth');

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
 * @property {string} status
 * @property {number} passed
 * @property {number} total
 * @property {number} runtimeMs
 * @property {number | null} elapsedMs - null if the record doesn't have it.
 */

/**
 * What the judge can throw (judge/sandbox.js, judge/queue.js): an Error
 * whose code says when the server should answer 503 rather than 500.
 *
 * @typedef {Error & { code?: string, retryAfterSeconds?: number }} JudgeError
 */

const app = express();
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
const QUESTIONS_DIR = path.join(__dirname, 'questions');
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

app.use(async (/** @type {AppRequest} */ req, res, next) => {
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
});

// Every POST (and PATCH) to the API must be JSON. A form on another site
// can't send JSON here without a CORS preflight, which this server never
// approves, so this (with SameSite=Lax) stops cross-site request forgery,
// logout included. A form can't send PATCH at all, and a cross-site fetch
// with it needs a preflight too; the same rule covers it for simplicity.
app.use('/api', (req, res, next) => {
  if ((req.method === 'POST' || req.method === 'PATCH') && !req.is('application/json')) {
    return res.status(415).json({ error: 'Send JSON (Content-Type: application/json)' });
  }
  next();
});

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

app.post('/api/auth/register', (req, res) => signIn(req, res, register, 400));
app.post('/api/auth/login', (req, res) => signIn(req, res, login, 401));

app.post('/api/auth/logout', async (req, res) => {
  try {
    await endSession(readCookie(req, SESSION_COOKIE));
  } catch (err) {
    return res.status(500).json({ error: /** @type {Error} */ (err).message || 'Logout failed' });
  }
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (/** @type {AppRequest} */ req, res) => {
  if (!req.userEmail) return res.status(401).json({ error: 'Not signed in' });
  res.json({ email: req.userEmail, trusted: Boolean(req.viaTrustedPort) });
});

// The gate. Not signed in: pages redirect to the login page (which comes
// back here afterwards via ?next=), API calls get 401.
const PUBLIC_PATHS = new Set(['/login.html', '/login-page.js', '/style.css']);
app.use((/** @type {AppRequest} */ req, res, next) => {
  if (req.userEmail || PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(302, `/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  }
  res.status(401).end();
});

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
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const { slug, title, difficulty, topics, sources } = JSON.parse(
        fs.readFileSync(path.join(QUESTIONS_DIR, f), 'utf8')
      );
      return { slug, title, difficulty, topics, sources };
    })
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

app.get('/api/questions', (req, res) => {
  res.json(listProblems());
});

app.get('/api/questions/:slug', (req, res) => {
  const loaded = loadProblem(req.params.slug);
  if (!loaded) return res.status(404).json({ error: 'Question not found' });
  res.json(toPublicProblem(loaded.problem));
});

/**
 * Handles Run (visible test cases only) and Submit (all of them, then saves
 * a record). Answers 400 for a bad request, 404 for an unknown question,
 * 503 when the judge is unavailable or busy, otherwise the judge's result,
 * with saved/submissionId (or saveError) for a Submit.
 *
 * @param {AppRequest} req - The request; its body should be
 *   { language, code, elapsedMs? }.
 * @param {Response} res - The response.
 * @param {{ onlyVisible: boolean }} options - true for Run, false for Submit.
 * @returns {Promise<Response | void>} Nothing that's used: the
 *   `return res...` lines only stop early.
 */
async function handleExecution(req, res, { onlyVisible }) {
  const loaded = loadProblem(req.params.slug);
  if (!loaded) return res.status(404).json({ error: 'Question not found' });
  const { problem } = loaded;

  const { language, code, elapsedMs } = req.body || {};
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}` });
  }
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'code is required' });
  }
  // How long the learner took, from the problem page's timer (issue #20).
  // Optional, so a page loaded before the timer existed can still Submit;
  // the record then says null. It's what the browser reports, not measured
  // here (docs/plans/elapsed-timer.md, T6).
  if (elapsedMs !== undefined && !(Number.isSafeInteger(elapsedMs) && elapsedMs >= 0)) {
    return res.status(400).json({ error: 'elapsedMs must be a whole number of milliseconds, 0 or more' });
  }

  if (!problem.starterCode[language]) {
    return res.status(400).json({ error: `This problem doesn't support ${language}.` });
  }
  // The learner's profile decides which languages they may use (403
  // otherwise). An invalid profile refuses everything rather than guess
  // (fail closed): 500, naming the problem.
  let profile;
  try {
    profile = loadProfile(/** @type {string} */ (req.userEmail)); // signed in: the gate
  } catch (err) {
    return sendProfileError(res, /** @type {Error & { code?: string }} */ (err));
  }
  if (!profile.allowedLanguages.includes(language)) {
    return res.status(403).json({ error: `${language} isn't one of the languages you can use (${profile.allowedLanguages.join(', ')}).` });
  }

  const judgeMode = problem.judgeMode || 'function';
  // A function-mode question always has functionName (the problem file
  // format); one without would throw here, as before.
  const functionName = judgeMode === 'function' ? /** @type {Record<string, string>} */ (problem.functionName)[language] : undefined;
  const testCases = onlyVisible ? problem.testCases.filter((tc) => !tc.hidden) : problem.testCases;
  const signature = problem.signature && problem.signature[language];

  try {
    const submittedAt = new Date().toISOString();
    // Submit adds what happened to its record: saved, then submissionId or saveError.
    const result = /** @type {import('./judge/runner').JudgeResult & { saved?: boolean, submissionId?: string, saveError?: string }} */ (
      await runSubmission({ language, code, functionName, testCases, signature, judgeMode })
    );
    // Only Submit is recorded (Run isn't). A failed save mustn't cost the
    // learner their result, so it's reported alongside it instead.
    if (!onlyVisible) {
      try {
        // The gate above lets only signed-in requests this far, so there is
        // a user (and saveSubmission checks it again).
        result.submissionId = await saveSubmission(/** @type {string} */ (req.userEmail), {
          // 2 added elapsedMs (2026-11-03); version 1 records don't have it.
          schemaVersion: 2,
          submittedAt,
          question: problem.slug,
          questionSha256: loaded.sha256,
          language,
          judgeMode,
          code,
          status: result.status,
          passed: result.passed,
          total: result.total,
          runtimeMs: result.runtimeMs,
          elapsedMs: elapsedMs ?? null,
          results: result.results.map((/** @type {{ passed: boolean }} */ r) => r.passed),
          stdout: result.stdout,
          stderr: result.stderr,
        });
        result.saved = true;
      } catch (err) {
        console.error(`Failed to save submission for ${problem.slug}:`, err);
        result.saved = false;
        result.saveError = /** @type {Error} */ (err).message;
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

app.post('/api/questions/:slug/run', (req, res) => handleExecution(req, res, { onlyVisible: true }));
app.post('/api/questions/:slug/submit', (req, res) => handleExecution(req, res, { onlyVisible: false }));

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
function toSubmissionSummary({ id, submittedAt, question, language, status, passed, total, runtimeMs, elapsedMs }) {
  return { id, submittedAt, question, language, status, passed, total, runtimeMs, elapsedMs: elapsedMs ?? null };
}

// Newest first. Optional ?question=<slug> and ?language=<language> narrow
// it down. Progress is per (question, language), so the problem page asks
// for exactly one pair.
app.get('/api/submissions', async (/** @type {AppRequest} */ req, res) => {
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
});

// One submission in full, including code, stdout and stderr.
app.get('/api/submissions/:id', async (/** @type {AppRequest} */ req, res) => {
  try {
    const record = await loadSubmission(/** @type {string} */ (req.userEmail), req.params.id); // signed in: the gate
    if (!record) return res.status(404).json({ error: 'Submission not found' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: /** @type {Error} */ (err).message || 'Could not read submission' });
  }
});

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
app.get('/api/profile', (/** @type {AppRequest} */ req, res) => {
  try {
    res.json(loadProfile(/** @type {string} */ (req.userEmail))); // signed in: the gate
  } catch (err) {
    sendProfileError(res, /** @type {Error & { code?: string }} */ (err));
  }
});

// The learner changes their own choices: body { languages?, defaultLanguage? }.
// Only preferred changes (profile.js, applyPreferredChange): 403 when an
// allowed flag forbids it, 400 when it doesn't fit allowed. Read, changed
// and written with no await in between (synchronous file calls), so two at
// once can't overwrite each other's change. Answers the new effective profile.
app.patch('/api/profile/preferred', (/** @type {AppRequest} */ req, res) => {
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
});

// Any other /api/ URL is an error, not a page: without this, GET requests
// would fall through to the index.html fallback below and get a 200 with
// HTML (e.g. the old /api/problems URLs, renamed to /api/questions).
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `No such API endpoint: ${req.method} ${req.path}` });
});

// --- Static front end -----------------------------------------------------

// Explicitly serve only the front-end assets (project root also holds server
// source and config, so we avoid a blanket express.static(__dirname)).
const STATIC_FILES = ['index.html', 'style.css', 'problem.html', 'problems-list.js', 'problem-page.js', 'labels.json', 'bubbles.js', 'timer.js', 'login.html', 'login-page.js', 'account.js'];
for (const file of STATIC_FILES) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
}

// Fallback to index.html for any unmatched route (simple SPA-style fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// PORT may be a string from the environment, and HOST undefined (every
// interface). Node's listen() accepts both, but Express's types allow only a
// number and a string, hence the casts.
app.listen(/** @type {number} */ (/** @type {unknown} */ (PORT)), /** @type {string} */ (HOST), () => {
  const where = HOST ? `${HOST}:${PORT} only` : `port ${PORT} on every interface`;
  console.log(`Server listening on ${where}, http://localhost:${PORT} (submissions in ${USERS_DIR})`);
  console.log(`Sign-in data in ${AUTH_DIR}; registration ${registrationOpen() ? `open for ${OWNER_EMAIL} only` : 'closed (MAXRECALL_PASSWORD not set)'}`);
  console.log(`Sandbox: ${describeSandbox()}`);
  console.log(`Judge queue: at most ${MAX_RUNNING} judgings at once, ${MAX_WAITING} more waiting; beyond that Run and Submit get 503`);
});

if (TRUSTED_PORT !== null) {
  // Marks the request before handing it to the same app, so the code above
  // knows which listener it arrived on.
  const trustedServer = http.createServer((/** @type {import('http').IncomingMessage & { viaTrustedPort?: boolean }} */ req, res) => {
    req.viaTrustedPort = true;
    app(req, res);
  });
  trustedServer.listen(TRUSTED_PORT, '127.0.0.1', () => {
    console.log(`Trusted listener on 127.0.0.1:${TRUSTED_PORT} only: every request there is ${OWNER_EMAIL}, no sign-in`);
  });
}

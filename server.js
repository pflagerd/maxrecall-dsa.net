const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

// Settings may come from a gitignored .env file (see .env.example). Loaded
// before any module below reads process.env. Variables already set in the
// environment win over the file; no file is fine.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const { runSubmission } = require('./judge/runner');
const { resolveInside } = require('./paths');
const { USERS_DIR, OWNER_EMAIL, saveSubmission, listSubmissions, loadSubmission } = require('./users');
const { AUTH_DIR, SESSION_LIFETIME_MS, registrationOpen, register, login, sessionEmail, endSession } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
// Which network address to listen on. Unset means every interface (the
// Node default), so other devices on a home network can connect.
// HOST=127.0.0.1 accepts only connections from this machine, e.g. on a
// server reached through an SSH tunnel.
const HOST = process.env.HOST || undefined;
const QUESTIONS_DIR = path.join(__dirname, 'questions');
const SUPPORTED_LANGUAGES = ['javascript', 'python', 'cpp', 'java', 'd'];

app.use(express.json());

// --- Signing in ---------------------------------------------------------------
// Every request first works out who it's from (req.userEmail) using the
// session cookie. The gate further down then lets through only signed-in
// requests, plus what the login page itself needs.

const SESSION_COOKIE = 'maxrecall_session';

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

// HttpOnly: page scripts can't read it. SameSite=Lax: sent when following a
// link to the app from elsewhere, but not with cross-site POSTs. Secure
// whenever the request came over HTTPS.
function setSessionCookie(req, res, token) {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: SESSION_LIFETIME_MS, secure: req.secure });
}

app.use(async (req, res, next) => {
  try {
    req.userEmail = await sessionEmail(readCookie(req, SESSION_COOKIE));
    next();
  } catch (err) {
    next(err);
  }
});

// Every POST to the API must be JSON. A form on another site can't send JSON
// here without a CORS preflight, which this server never approves, so this
// (with SameSite=Lax) stops cross-site request forgery, logout included.
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Send JSON (Content-Type: application/json)' });
  }
  next();
});

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

// Register and log in both start a new session, ending any the browser
// already had (a fresh token after every sign-in).
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
    res.status(500).json({ error: err.message || 'Sign-in failed' });
  }
}

app.post('/api/auth/register', (req, res) => signIn(req, res, register, 400));
app.post('/api/auth/login', (req, res) => signIn(req, res, login, 401));

app.post('/api/auth/logout', async (req, res) => {
  try {
    await endSession(readCookie(req, SESSION_COOKIE));
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Logout failed' });
  }
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.userEmail) return res.status(401).json({ error: 'Not signed in' });
  res.json({ email: req.userEmail });
});

// The gate. Not signed in: pages redirect to the login page (which comes
// back here afterwards via ?next=), API calls get 401.
const PUBLIC_PATHS = new Set(['/login.html', '/login-page.js', '/style.css']);
app.use((req, res, next) => {
  if (req.userEmail || PUBLIC_PATHS.has(req.path)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.redirect(302, `/login.html?next=${encodeURIComponent(req.originalUrl)}`);
  }
  res.status(401).end();
});

// --- Problem data -----------------------------------------------------

// Returns { problem, sha256 }: the parsed problem, and the SHA-256 of the
// file's exact bytes so a saved submission can tell later whether the
// question has been edited since. Both come from one read, so they match.
function loadProblem(slug) {
  const file = resolveInside(QUESTIONS_DIR, `${slug}.json`);
  if (!file || !fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  return {
    problem: JSON.parse(bytes.toString('utf8')),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

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

// Strip expected answers/inputs for hidden test cases before sending to the
// client. Test case shape depends on judgeMode (args/expected for
// "function", input/expected for "program"), so this strips just `hidden`
// rather than picking specific fields.
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

async function handleExecution(req, res, { onlyVisible }) {
  const loaded = loadProblem(req.params.slug);
  if (!loaded) return res.status(404).json({ error: 'Question not found' });
  const { problem } = loaded;

  const { language, code } = req.body || {};
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}` });
  }
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'code is required' });
  }

  if (!problem.starterCode[language]) {
    return res.status(400).json({ error: `This problem doesn't support ${language}.` });
  }

  const judgeMode = problem.judgeMode || 'function';
  const functionName = judgeMode === 'function' ? problem.functionName[language] : undefined;
  const testCases = onlyVisible ? problem.testCases.filter((tc) => !tc.hidden) : problem.testCases;
  const signature = problem.signature && problem.signature[language];

  try {
    const submittedAt = new Date().toISOString();
    const result = await runSubmission({ language, code, functionName, testCases, signature, judgeMode });
    // Only Submit is recorded (Run isn't). A failed save mustn't cost the
    // learner their result, so it's reported alongside it instead.
    if (!onlyVisible) {
      try {
        result.submissionId = await saveSubmission(req.userEmail, {
          schemaVersion: 1,
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
          results: result.results.map((r) => r.passed),
          stdout: result.stdout,
          stderr: result.stderr,
        });
        result.saved = true;
      } catch (err) {
        console.error(`Failed to save submission for ${problem.slug}:`, err);
        result.saved = false;
        result.saveError = err.message;
      }
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Execution failed' });
  }
}

app.post('/api/questions/:slug/run', (req, res) => handleExecution(req, res, { onlyVisible: true }));
app.post('/api/questions/:slug/submit', (req, res) => handleExecution(req, res, { onlyVisible: false }));

// --- Saved submissions (the signed-in user's own) --------------------------------
// Express 4 doesn't catch errors from async handlers, hence the try/catch.

// Summaries for a list: everything except code, stdout and stderr.
function toSubmissionSummary({ id, submittedAt, question, language, status, passed, total, runtimeMs }) {
  return { id, submittedAt, question, language, status, passed, total, runtimeMs };
}

// Newest first. Optional ?question=<slug> keeps only that question's.
app.get('/api/submissions', async (req, res) => {
  const { question } = req.query;
  if (question !== undefined && typeof question !== 'string') {
    return res.status(400).json({ error: 'question must be given at most once' });
  }
  try {
    const records = await listSubmissions(req.userEmail);
    res.json(records.filter((r) => !question || r.question === question).map(toSubmissionSummary));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read submissions' });
  }
});

// One submission in full, including code, stdout and stderr.
app.get('/api/submissions/:id', async (req, res) => {
  try {
    const record = await loadSubmission(req.userEmail, req.params.id);
    if (!record) return res.status(404).json({ error: 'Submission not found' });
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read submission' });
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
const STATIC_FILES = ['index.html', 'style.css', 'problem.html', 'problems-list.js', 'problem-page.js', 'labels.json', 'bubbles.js', 'login.html', 'login-page.js', 'account.js'];
for (const file of STATIC_FILES) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
}

// Fallback to index.html for any unmatched route (simple SPA-style fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  const where = HOST ? `${HOST}:${PORT} only` : `port ${PORT} on every interface`;
  console.log(`Server listening on ${where}, http://localhost:${PORT} (submissions in ${USERS_DIR})`);
  console.log(`Sign-in data in ${AUTH_DIR}; registration ${registrationOpen() ? `open for ${OWNER_EMAIL} only` : 'closed (MAXRECALL_PASSWORD not set)'}`);
});

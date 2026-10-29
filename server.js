const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const { runSubmission } = require('./judge/runner');
const { resolveInside } = require('./paths');
const { CURRENT_USER, saveSubmission, listSubmissions, loadSubmission } = require('./users');

const app = express();
const PORT = process.env.PORT || 3000;
const QUESTIONS_DIR = path.join(__dirname, 'questions');
const SUPPORTED_LANGUAGES = ['javascript', 'python', 'cpp', 'java', 'd'];

app.use(express.json());

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
        result.submissionId = await saveSubmission({
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

// --- Saved submissions (current user only) ----------------------------------
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
    const records = await listSubmissions();
    res.json(records.filter((r) => !question || r.question === question).map(toSubmissionSummary));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not read submissions' });
  }
});

// One submission in full, including code, stdout and stderr.
app.get('/api/submissions/:id', async (req, res) => {
  try {
    const record = await loadSubmission(req.params.id);
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
const STATIC_FILES = ['index.html', 'style.css', 'problem.html', 'problems-list.js', 'problem-page.js', 'labels.json', 'bubbles.js'];
for (const file of STATIC_FILES) {
  app.get(`/${file}`, (req, res) => res.sendFile(path.join(__dirname, file)));
}

// Fallback to index.html for any unmatched route (simple SPA-style fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT} (recording Submits for ${CURRENT_USER})`);
});

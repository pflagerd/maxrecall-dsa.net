const crypto = require('crypto');
const express = require('express');
const fs = require('fs');
const path = require('path');

const { runSubmission } = require('./judge/runner');
const { resolveInside } = require('./paths');
const { CURRENT_USER, saveSubmission } = require('./users');

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
      const { slug, title, difficulty, tags } = JSON.parse(
        fs.readFileSync(path.join(QUESTIONS_DIR, f), 'utf8')
      );
      return { slug, title, difficulty, tags };
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

app.get('/api/problems', (req, res) => {
  res.json(listProblems());
});

app.get('/api/problems/:slug', (req, res) => {
  const loaded = loadProblem(req.params.slug);
  if (!loaded) return res.status(404).json({ error: 'Problem not found' });
  res.json(toPublicProblem(loaded.problem));
});

async function handleExecution(req, res, { onlyVisible }) {
  const loaded = loadProblem(req.params.slug);
  if (!loaded) return res.status(404).json({ error: 'Problem not found' });
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

app.post('/api/problems/:slug/run', (req, res) => handleExecution(req, res, { onlyVisible: true }));
app.post('/api/problems/:slug/submit', (req, res) => handleExecution(req, res, { onlyVisible: false }));

// --- Static front end -----------------------------------------------------

// Explicitly serve only the front-end assets (project root also holds server
// source and config, so we avoid a blanket express.static(__dirname)).
const STATIC_FILES = ['index.html', 'style.css', 'problem.html', 'problems-list.js', 'problem-page.js'];
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

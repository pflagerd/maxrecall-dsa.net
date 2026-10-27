const express = require('express');
const fs = require('fs');
const path = require('path');

const { runSubmission } = require('./judge/runner');

const app = express();
const PORT = process.env.PORT || 3000;
const PROBLEMS_DIR = path.join(__dirname, 'problems');
const SUPPORTED_LANGUAGES = ['javascript', 'python', 'cpp'];

app.use(express.json());

// --- Problem data -----------------------------------------------------

function loadProblem(slug) {
  const file = path.join(PROBLEMS_DIR, `${slug}.json`);
  if (!file.startsWith(PROBLEMS_DIR) || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function listProblems() {
  return fs
    .readdirSync(PROBLEMS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const { slug, title, difficulty, tags } = JSON.parse(
        fs.readFileSync(path.join(PROBLEMS_DIR, f), 'utf8')
      );
      return { slug, title, difficulty, tags };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

// Strip expected answers/inputs for hidden test cases before sending to the client.
function toPublicProblem(problem) {
  const { testCases, ...rest } = problem;
  return {
    ...rest,
    visibleTestCases: testCases
      .filter((tc) => !tc.hidden)
      .map((tc) => ({ args: tc.args, expected: tc.expected })),
    hiddenCount: testCases.filter((tc) => tc.hidden).length,
  };
}

// --- API ----------------------------------------------------------------

app.get('/api/problems', (req, res) => {
  res.json(listProblems());
});

app.get('/api/problems/:slug', (req, res) => {
  const problem = loadProblem(req.params.slug);
  if (!problem) return res.status(404).json({ error: 'Problem not found' });
  res.json(toPublicProblem(problem));
});

async function handleExecution(req, res, { onlyVisible }) {
  const problem = loadProblem(req.params.slug);
  if (!problem) return res.status(404).json({ error: 'Problem not found' });

  const { language, code } = req.body || {};
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}` });
  }
  if (typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'code is required' });
  }

  const functionName = problem.functionName[language];
  if (!functionName) {
    return res.status(400).json({ error: `This problem doesn't support ${language}.` });
  }

  const testCases = onlyVisible ? problem.testCases.filter((tc) => !tc.hidden) : problem.testCases;
  const signature = problem.signature && problem.signature[language];

  try {
    const result = await runSubmission({ language, code, functionName, testCases, signature });
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
  console.log(`Server running at http://localhost:${PORT}`);
});

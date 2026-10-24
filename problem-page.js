const slug = new URLSearchParams(window.location.search).get('slug');

const titleEl = document.getElementById('problem-title');
const difficultyEl = document.getElementById('problem-difficulty');
const tagsEl = document.getElementById('problem-tags');
const descriptionEl = document.getElementById('problem-description');
const examplesEl = document.getElementById('problem-examples');
const constraintsEl = document.getElementById('problem-constraints');
const languageSelect = document.getElementById('language-select');
const runBtn = document.getElementById('run-btn');
const submitBtn = document.getElementById('submit-btn');
const consoleStatusEl = document.getElementById('console-status');
const consoleResultsEl = document.getElementById('console-results');

let problem = null;
let editor = null;
const codeByLanguage = {};

const CM_MODE = { javascript: 'javascript', python: 'python' };

function renderProblem() {
  titleEl.textContent = problem.title;
  difficultyEl.textContent = problem.difficulty;
  difficultyEl.className = `badge difficulty-${String(problem.difficulty || '').toLowerCase()}`;
  tagsEl.textContent = (problem.tags || []).join(' · ');
  descriptionEl.innerHTML = problem.description;

  examplesEl.innerHTML = (problem.examples || [])
    .map(
      (ex, i) => `
      <div class="example">
        <p><strong>Example ${i + 1}:</strong></p>
        <pre><strong>Input:</strong> ${ex.input}\n<strong>Output:</strong> ${ex.output}${
          ex.explanation ? `\n<strong>Explanation:</strong> ${ex.explanation}` : ''
        }</pre>
      </div>`
    )
    .join('');

  constraintsEl.innerHTML = (problem.constraints || []).map((c) => `<li><code>${c}</code></li>`).join('');
}

function setLanguage(language) {
  if (editor) {
    codeByLanguage[languageSelect.value] = editor.getValue();
  }
  languageSelect.value = language;
  const code = codeByLanguage[language] ?? problem.starterCode[language] ?? '';
  codeByLanguage[language] = code;

  if (!editor) {
    editor = CodeMirror(document.getElementById('editor-host'), {
      value: code,
      mode: CM_MODE[language],
      theme: 'dracula',
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
    });
  } else {
    editor.setOption('mode', CM_MODE[language]);
    editor.setValue(code);
  }
}

function formatValue(v) {
  return JSON.stringify(v);
}

function renderResults(result) {
  consoleStatusEl.textContent = `${result.status}${
    typeof result.passed === 'number' ? ` — ${result.passed}/${result.total} test cases passed` : ''
  }${typeof result.runtimeMs === 'number' ? ` (${result.runtimeMs} ms)` : ''}`;
  consoleStatusEl.className = result.status === 'Accepted' ? 'status-pass' : 'status-fail';

  if (result.error) {
    consoleResultsEl.innerHTML = `<pre class="error-block">${result.error}</pre>`;
    return;
  }

  consoleResultsEl.innerHTML = (result.results || [])
    .map((r) => {
      if (r.hidden) {
        return `<div class="test-case ${r.passed ? 'pass' : 'fail'}">
          <strong>Hidden test case ${r.index + 1}:</strong> ${r.passed ? 'Passed' : 'Failed'}
        </div>`;
      }
      return `<div class="test-case ${r.passed ? 'pass' : 'fail'}">
        <strong>Test case ${r.index + 1}:</strong> ${r.passed ? 'Passed' : 'Failed'}<br/>
        <span>Input: <code>${formatValue(r.input)}</code></span><br/>
        <span>Expected: <code>${formatValue(r.expected)}</code></span><br/>
        ${
          r.error
            ? `<span>Error: <code>${r.error}</code></span>`
            : `<span>Actual: <code>${formatValue(r.actual)}</code></span>`
        }
      </div>`;
    })
    .join('');
}

async function execute(endpoint, button) {
  button.disabled = true;
  consoleStatusEl.textContent = 'Running...';
  consoleStatusEl.className = '';
  consoleResultsEl.innerHTML = '';

  try {
    const res = await fetch(`/api/problems/${slug}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: languageSelect.value, code: editor.getValue() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderResults(data);
  } catch (err) {
    consoleStatusEl.textContent = 'Error';
    consoleStatusEl.className = 'status-fail';
    consoleResultsEl.innerHTML = `<pre class="error-block">${err.message}</pre>`;
  } finally {
    button.disabled = false;
  }
}

async function init() {
  if (!slug) {
    titleEl.textContent = 'No problem specified';
    return;
  }

  try {
    const res = await fetch(`/api/problems/${slug}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    problem = await res.json();
  } catch (err) {
    titleEl.textContent = `Failed to load problem: ${err.message}`;
    return;
  }

  renderProblem();
  setLanguage('javascript');

  languageSelect.addEventListener('change', () => setLanguage(languageSelect.value));
  runBtn.addEventListener('click', () => execute('run', runBtn));
  submitBtn.addEventListener('click', () => execute('submit', submitBtn));
}

init();

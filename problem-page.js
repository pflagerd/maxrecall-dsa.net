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
const modalOverlay = document.getElementById('language-switch-modal');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalDiscardBtn = document.getElementById('modal-discard-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const fullscreenIcon = document.getElementById('fullscreen-icon');

// Icon paths swapped on the same button depending on fullscreen state.
const EXPAND_ICON_PATHS = '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>';
const COMPRESS_ICON_PATHS = '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>';

function updateFullscreenButton() {
  const isFullscreen = Boolean(document.fullscreenElement);
  fullscreenIcon.innerHTML = isFullscreen ? COMPRESS_ICON_PATHS : EXPAND_ICON_PATHS;
  const label = isFullscreen ? 'Exit full screen' : 'Enter full screen';
  fullscreenBtn.title = label;
  fullscreenBtn.setAttribute('aria-label', label);
}

if (fullscreenBtn && document.documentElement.requestFullscreen) {
  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  });
  // Keeps the icon in sync if fullscreen is exited another way (Escape, browser UI).
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  updateFullscreenButton();
} else if (fullscreenBtn) {
  fullscreenBtn.hidden = true; // Fullscreen API not supported in this browser.
}

let problem = null;
let editor = null;
let currentLanguage = null;

// Browser-chrome shortcuts CodeMirror doesn't bind itself (Tab, Ctrl-Z/Y,
// Ctrl-A are already in its default keymap and need no help). Bound to a
// no-op so CodeMirror treats them as handled, which blocks the browser
// action. Note: some shortcuts (Ctrl/Cmd+W, +T, +N, +Shift+T, ...) are
// intentionally unblockable by browsers for security/UX reasons regardless.
const BLOCKED_KEYS = ['S', 'B', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'O', 'P', 'U', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const EXTRA_KEYS = Object.fromEntries(BLOCKED_KEYS.map((k) => [`Mod-${k}`, () => {}]));

// Language-independent header: title, difficulty, tags. Rendered once.
function renderHeader() {
  titleEl.textContent = problem.title;
  difficultyEl.textContent = problem.difficulty;
  difficultyEl.className = `badge difficulty-${String(problem.difficulty || '').toLowerCase()}`;
  tagsEl.textContent = (problem.tags || []).join(' · ');
}

// Description/examples/constraints are per-language (like starterCode), so this
// re-renders whenever the language changes, same as the editor's starter code.
function renderLanguageContent(language) {
  descriptionEl.innerHTML = problem.description[language] ?? '';

  examplesEl.innerHTML = (problem.examples[language] || [])
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

  constraintsEl.innerHTML = (problem.constraints[language] || []).map((c) => `<li><code>${c}</code></li>`).join('');
}

// Loads a language's starter template into the editor, discarding whatever was there,
// and swaps the description/examples/constraints to match.
function loadLanguage(language) {
  const code = problem.starterCode[language] ?? '';

  if (!editor) {
    editor = CodeMirror(document.getElementById('editor-host'), {
      value: code,
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
      extraKeys: EXTRA_KEYS,
    });
  } else {
    editor.setValue(code);
  }
  currentLanguage = language;
  renderLanguageContent(language);
}

// Shows the discard-changes modal and resolves true/false with the user's choice.
function confirmDiscard() {
  return new Promise((resolve) => {
    function settle(discard) {
      modalOverlay.classList.add('hidden');
      modalCancelBtn.removeEventListener('click', onCancel);
      modalDiscardBtn.removeEventListener('click', onDiscardClick);
      modalOverlay.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeydown);
      resolve(discard);
    }
    function onCancel() { settle(false); }
    function onDiscardClick() { settle(true); }
    function onOverlayClick(e) { if (e.target === modalOverlay) settle(false); }
    function onKeydown(e) { if (e.key === 'Escape') settle(false); }

    modalCancelBtn.addEventListener('click', onCancel);
    modalDiscardBtn.addEventListener('click', onDiscardClick);
    modalOverlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeydown);
    modalOverlay.classList.remove('hidden');
  });
}

async function handleLanguageChange() {
  const newLanguage = languageSelect.value;
  if (newLanguage === currentLanguage) return;

  const isUnmodified = editor.getValue() === problem.starterCode[currentLanguage];
  if (!isUnmodified) {
    const discard = await confirmDiscard();
    if (!discard) {
      languageSelect.value = currentLanguage;
      return;
    }
  }
  loadLanguage(newLanguage);
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

  renderHeader();
  loadLanguage('javascript');

  languageSelect.addEventListener('change', handleLanguageChange);
  runBtn.addEventListener('click', () => execute('run', runBtn));
  submitBtn.addEventListener('click', () => execute('submit', submitBtn));
}

init();

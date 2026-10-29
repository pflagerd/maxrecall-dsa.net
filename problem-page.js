const slug = new URLSearchParams(window.location.search).get('slug');

const titleEl = document.getElementById('problem-title');
const difficultyEl = document.getElementById('problem-difficulty');
const bubblesEl = document.getElementById('problem-bubbles');
const descriptionEl = document.getElementById('problem-description');
const examplesEl = document.getElementById('problem-examples');
const constraintsEl = document.getElementById('problem-constraints');
const learningEl = document.getElementById('tab-learning');
const languageSelect = document.getElementById('language-select');
const languageFilterBtn = document.getElementById('language-filter-btn');
const languageFilterMenu = document.getElementById('language-filter-menu');
const languageCheckboxes = Array.from(languageFilterMenu.querySelectorAll('input[type="checkbox"]'));
const languageFilterNames = Array.from(languageFilterMenu.querySelectorAll('.language-filter-name'));
const runBtn = document.getElementById('run-btn');
const submitBtn = document.getElementById('submit-btn');
const skipBtn = document.getElementById('skip-btn');
const consoleStatusEl = document.getElementById('console-status');
const consoleResultsEl = document.getElementById('console-results');
const consoleResultsListEl = document.getElementById('console-results-list');
const consoleStdoutEl = document.getElementById('console-stdout');
const consoleStderrEl = document.getElementById('console-stderr');
const consoleTabPanels = { results: consoleResultsEl, stdout: consoleStdoutEl, stderr: consoleStderrEl };
const descriptionTabPanels = {
  learning: document.getElementById('tab-learning'),
  applying: document.getElementById('tab-applying'),
  submissions: document.getElementById('tab-submissions'),
  insights: document.getElementById('tab-insights'),
};
const fullscreenBtn = document.getElementById('fullscreen-btn');
const fullscreenIcon = document.getElementById('fullscreen-icon');
const resetSplitBtn = document.getElementById('reset-split-btn');
const paneResizer = document.getElementById('pane-resizer');
const descriptionPaneEl = document.querySelector('.description-pane');
const editorPaneEl = document.querySelector('.editor-pane');
const rowResizer = document.getElementById('row-resizer');
const editorHostEl = document.getElementById('editor-host');
const consolePanelEl = document.querySelector('.console-panel');

// Drag-to-resize the description/editor split. Pointer capture keeps the
// drag tracking even if the cursor moves off the thin resizer bar. The
// chosen width is remembered across reloads via localStorage. Neither pane
// may go below 20% of the split's total width (also enforced in CSS via
// min-width: 20%, which additionally protects against the window itself
// being resized smaller after a drag).
const MIN_PANE_FRACTION = 0.2;
// 1 - 1/φ (golden ratio), rounded to 3 decimals. Kept in sync with
// .description-pane's flex-basis (38.2%) in style.css.
const DEFAULT_PANE_FRACTION = 0.382;
const PANE_WIDTH_STORAGE_KEY = 'maxrecall-dsa:description-pane-width';

// Resizer width + both flex gaps, measured rather than hardcoded so this
// doesn't need to track the CSS gap/padding values separately.
function getPaneWidthBounds() {
  const paneLeft = descriptionPaneEl.getBoundingClientRect().left;
  const editorRight = editorPaneEl.getBoundingClientRect().right;
  const span = editorRight - paneLeft;
  const fixedOverhead = span - descriptionPaneEl.getBoundingClientRect().width - editorPaneEl.getBoundingClientRect().width;
  const minWidth = span * MIN_PANE_FRACTION;
  return { paneLeft, span, minWidth, maxWidth: span - fixedOverhead - minWidth };
}

function setDescriptionPaneWidth(width, bounds) {
  const { minWidth, maxWidth } = bounds || getPaneWidthBounds();
  const clamped = Math.max(minWidth, Math.min(width, maxWidth));
  descriptionPaneEl.style.flex = `0 0 ${clamped}px`;
}

function savePaneWidth() {
  try {
    localStorage.setItem(PANE_WIDTH_STORAGE_KEY, String(descriptionPaneEl.getBoundingClientRect().width));
  } catch {
    // Ignore (private browsing, storage disabled, etc.) — just won't persist.
  }
}

(function restorePaneWidth() {
  let saved;
  try {
    saved = localStorage.getItem(PANE_WIDTH_STORAGE_KEY);
  } catch {
    return;
  }
  const width = Number(saved);
  if (Number.isFinite(width) && width > 0) setDescriptionPaneWidth(width);
})();

resetSplitBtn.addEventListener('click', () => {
  const bounds = getPaneWidthBounds();
  setDescriptionPaneWidth(bounds.span * DEFAULT_PANE_FRACTION, bounds);
  savePaneWidth();
});

paneResizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  paneResizer.setPointerCapture(e.pointerId);
  paneResizer.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const bounds = getPaneWidthBounds();

  function onMove(moveEvent) {
    setDescriptionPaneWidth(moveEvent.clientX - bounds.paneLeft, bounds);
  }

  function onUp(upEvent) {
    paneResizer.releasePointerCapture(upEvent.pointerId);
    paneResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    paneResizer.removeEventListener('pointermove', onMove);
    paneResizer.removeEventListener('pointerup', onUp);
    savePaneWidth();
  }

  paneResizer.addEventListener('pointermove', onMove);
  paneResizer.addEventListener('pointerup', onUp);
});

// Drag-to-resize the editor/console split, same approach as the pane
// resizer above but on the vertical axis. #editor-host defaults to flex: 1
// (fills whatever's left) and .console-panel defaults to max-height: 35%
// (CSS alone) until the first drag, at which point both switch to explicit
// inline sizing driven by the pointer position.
const MIN_EDITOR_HEIGHT = 180; // matches #editor-host's CSS min-height
const MIN_CONSOLE_HEIGHT = 80;

rowResizer.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  rowResizer.setPointerCapture(e.pointerId);
  rowResizer.classList.add('dragging');
  document.body.style.cursor = 'row-resize';
  document.body.style.userSelect = 'none';

  const editorTop = editorHostEl.getBoundingClientRect().top;
  const consoleBottom = consolePanelEl.getBoundingClientRect().bottom;
  const span = consoleBottom - editorTop;
  // row-resizer height + the fixed-height console-toolbar between them,
  // measured rather than hardcoded for the same reason as the pane resizer.
  const fixedOverhead = span - editorHostEl.getBoundingClientRect().height - consolePanelEl.getBoundingClientRect().height;
  const maxEditorHeight = span - fixedOverhead - MIN_CONSOLE_HEIGHT;

  // Once a drag happens, .console-panel switches from its CSS max-height
  // cap to filling whatever #editor-host doesn't take.
  consolePanelEl.style.flex = '1 1 auto';
  consolePanelEl.style.maxHeight = 'none';

  function onMove(moveEvent) {
    const newEditorHeight = Math.max(MIN_EDITOR_HEIGHT, Math.min(moveEvent.clientY - editorTop, maxEditorHeight));
    editorHostEl.style.flex = `0 0 ${newEditorHeight}px`;
  }

  function onUp(upEvent) {
    rowResizer.releasePointerCapture(upEvent.pointerId);
    rowResizer.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    rowResizer.removeEventListener('pointermove', onMove);
    rowResizer.removeEventListener('pointerup', onUp);
  }

  rowResizer.addEventListener('pointermove', onMove);
  rowResizer.addEventListener('pointerup', onUp);
});

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

// Generic tab-group wiring, shared by the console panel (Results/stdout/stderr)
// and the description pane (Learning/Applying/Submissions/Insights). Switching
// tabs only changes which panel is visible — every panel stays populated/alive
// underneath, nothing is torn down or re-fetched on tab switch.
function setupTabGroup(tabsContainerSelector, panels, defaultTab) {
  const tabs = document.querySelectorAll(`${tabsContainerSelector} .tab-button`);

  function setActive(tabName) {
    tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === tabName;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', String(isActive));
    });
    Object.entries(panels).forEach(([name, panel]) => {
      panel.hidden = name !== tabName;
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => setActive(tab.dataset.tab));
  });
  setActive(defaultTab);
  return setActive;
}

setupTabGroup('.console-tabs', consoleTabPanels, 'results');
const setDescriptionTab = setupTabGroup('.description-tabs', descriptionTabPanels, 'applying');

// Handles any in-content link (`.tab-ref-link`, e.g. "see the Learning tab"
// in a description, or "click the Applying tab" in the Learning CTA) that
// cross-references another description-pane tab. Delegated on the pane
// itself — not attached per-render — since both tabs' content gets
// replaced wholesale on every language switch.
descriptionPaneEl.addEventListener('click', (e) => {
  const link = e.target.closest('.tab-ref-link');
  if (link) setDescriptionTab(link.dataset.tab);
});

let problem = null;
let editor = null;
let currentLanguage = null;

// Code the user has typed for each language on this problem, so switching
// away and back doesn't lose it. In-memory only (scoped to this page load,
// same as `problem`/`currentLanguage`) — a fresh page load for this
// problem starts from starterCode again, same as before this existed.
const codeByLanguage = {};

// Last Run/Submit outcome shown for each language, so switching away and
// back restores it too instead of clearing the console. Either
// { kind: 'result', data } (a judge result, same shape renderResults takes)
// or { kind: 'error', message } (a client-side failure — network/parse
// error — before any judge result came back).
const consoleStateByLanguage = {};

// Default language used to open problems, remembered across problems/reloads
// via localStorage. Changing either language dropdown updates this default
// (not just the editor-toolbar one) — picking a language is "what I want to
// use from now on", not just a one-off for the current problem.
const KNOWN_LANGUAGES = ['javascript', 'python', 'cpp', 'java', 'd'];
const LANGUAGE_LABELS = { javascript: 'JavaScript', python: 'Python', cpp: 'C++', java: 'Java', d: 'D' };
const DEFAULT_LANGUAGE_STORAGE_KEY = 'maxrecall-dsa:default-language';

function getStoredDefaultLanguage() {
  let saved;
  try {
    saved = localStorage.getItem(DEFAULT_LANGUAGE_STORAGE_KEY);
  } catch {
    return 'javascript';
  }
  return KNOWN_LANGUAGES.includes(saved) ? saved : 'javascript';
}

function setStoredDefaultLanguage(language) {
  try {
    localStorage.setItem(DEFAULT_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignore (private browsing, storage disabled, etc.) — just won't persist.
  }
}

// Which languages are offered at all (checkboxes in the header's language
// filter menu), separate from which one is the default. Unchecking a
// language here removes it as an option from language-select everywhere.
const AVAILABLE_LANGUAGES_STORAGE_KEY = 'maxrecall-dsa:available-languages';

function getAvailableLanguages() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(AVAILABLE_LANGUAGES_STORAGE_KEY));
  } catch {
    return new Set(KNOWN_LANGUAGES);
  }
  const filtered = Array.isArray(saved) ? saved.filter((l) => KNOWN_LANGUAGES.includes(l)) : [];
  return new Set(filtered.length ? filtered : KNOWN_LANGUAGES);
}

function setAvailableLanguages(languageSet) {
  try {
    localStorage.setItem(AVAILABLE_LANGUAGES_STORAGE_KEY, JSON.stringify(Array.from(languageSet)));
  } catch {
    // Ignore (private browsing, storage disabled, etc.) — just won't persist.
  }
}

// Rebuilds language-select's <option> list from the available set, keeping
// the current selection if it's still available.
function renderLanguageSelectOptions(available) {
  const previousValue = languageSelect.value;
  languageSelect.innerHTML = KNOWN_LANGUAGES.filter((l) => available.has(l))
    .map((l) => `<option value="${l}">${LANGUAGE_LABELS[l]}</option>`)
    .join('');
  if (available.has(previousValue)) languageSelect.value = previousValue;
}

// Picks which language a problem should open with: the stored default if
// it's both globally available and supported by this problem, otherwise the
// first known language that satisfies both. The stored preference itself is
// never touched here — a problem/availability mismatch is a one-off
// fallback for this load, not a change to what the user actually wants.
function pickInitialLanguage(problem) {
  const preferred = getStoredDefaultLanguage();
  const available = getAvailableLanguages();
  const candidates = [preferred, ...KNOWN_LANGUAGES];
  return candidates.find((l) => available.has(l) && problem.starterCode[l]) || KNOWN_LANGUAGES[0];
}

// A checkbox for the only remaining checked language can't be unchecked —
// language-select must never end up with zero options.
function updateCheckboxDisabledStates() {
  const checkedCount = languageCheckboxes.filter((cb) => cb.checked).length;
  languageCheckboxes.forEach((cb) => {
    cb.disabled = checkedCount === 1 && cb.checked;
  });
}

function closeLanguageFilterMenu() {
  languageFilterMenu.hidden = true;
  languageFilterBtn.setAttribute('aria-expanded', 'false');
}

// Marks whichever language name is the current default — independent of
// the checkboxes, which only control availability.
function updateDefaultLanguageHighlight() {
  const defaultLanguage = getStoredDefaultLanguage();
  languageFilterNames.forEach((el) => {
    el.classList.toggle('is-default', el.dataset.lang === defaultLanguage);
  });
}

languageFilterBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = !languageFilterMenu.hidden;
  if (isOpen) {
    closeLanguageFilterMenu();
  } else {
    languageFilterMenu.hidden = false;
    languageFilterBtn.setAttribute('aria-expanded', 'true');
  }
});

document.addEventListener('click', (e) => {
  if (!languageFilterMenu.hidden && !e.target.closest('.language-filter')) closeLanguageFilterMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !languageFilterMenu.hidden) closeLanguageFilterMenu();
});

languageCheckboxes.forEach((checkbox) => {
  checkbox.addEventListener('change', async () => {
    const lang = checkbox.dataset.lang;

    // Unchecking the language currently active in the editor: switch to
    // another available language this problem supports first, or revert
    // the checkbox if there's no such language to fall back to.
    if (!checkbox.checked && problem && lang === currentLanguage) {
      const fallback = KNOWN_LANGUAGES.find((l) =>
        l !== lang
        && problem.starterCode[l]
        && languageCheckboxes.some((cb) => cb.dataset.lang === l && cb.checked)
      );
      if (!fallback || !(await switchLanguage(fallback))) {
        checkbox.checked = true;
        return;
      }
    }

    const available = new Set(languageCheckboxes.filter((cb) => cb.checked).map((cb) => cb.dataset.lang));
    setAvailableLanguages(available);
    renderLanguageSelectOptions(available);
    updateCheckboxDisabledStates();
  });
});

// Clicking a language's name sets it as the default and switches the editor
// to it (independent of its checkbox — clicking the checkbox only toggles
// availability, never the default). Setting a language as default also
// makes it available, since a default that isn't selectable in
// language-select wouldn't make sense.
languageFilterNames.forEach((nameEl) => {
  nameEl.addEventListener('click', async () => {
    const lang = nameEl.dataset.lang;
    const checkbox = languageCheckboxes.find((cb) => cb.dataset.lang === lang);
    const wasChecked = checkbox.checked;
    checkbox.checked = true;

    const switched = await switchLanguage(lang);
    if (!switched) {
      checkbox.checked = wasChecked;
      return;
    }

    if (!wasChecked) {
      const available = new Set(languageCheckboxes.filter((cb) => cb.checked).map((cb) => cb.dataset.lang));
      setAvailableLanguages(available);
      renderLanguageSelectOptions(available);
      updateCheckboxDisabledStates();
    }
    closeLanguageFilterMenu();
  });
});

(function initLanguageFilter() {
  const available = getAvailableLanguages();
  languageCheckboxes.forEach((cb) => { cb.checked = available.has(cb.dataset.lang); });
  updateCheckboxDisabledStates();
  renderLanguageSelectOptions(available);
  updateDefaultLanguageHighlight();
})();

// Browser-chrome shortcuts CodeMirror doesn't bind itself (Tab, Ctrl-Z/Y,
// Ctrl-A are already in its default keymap and need no help). Bound to a
// no-op so CodeMirror treats them as handled, which blocks the browser
// action. Note: some shortcuts (Ctrl/Cmd+W, +T, +N, +Shift+T, ...) are
// intentionally unblockable by browsers for security/UX reasons regardless.
const BLOCKED_KEYS = ['S', 'B', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'O', 'P', 'U', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const EXTRA_KEYS = Object.fromEntries(BLOCKED_KEYS.map((k) => [`Mod-${k}`, () => {}]));

// Renders $...$ math (powers, inequalities, etc.) within an element's
// existing content in place; throwOnError: false means a typo in the
// source LaTeX degrades to showing the raw text instead of breaking the page.
function renderMath(el) {
  if (typeof renderMathInElement !== 'function') return;
  renderMathInElement(el, {
    delimiters: [{ left: '$', right: '$', display: false }],
    throwOnError: false,
  });
}

// Language-independent header: title, difficulty, then source and topic
// bubbles (bubbles.js). Rendered once.
function renderHeader(labels) {
  titleEl.textContent = problem.title;
  difficultyEl.textContent = problem.difficulty;
  difficultyEl.className = `badge difficulty-${String(problem.difficulty || '').toLowerCase()}`;
  renderBubbles(bubblesEl, problem, labels);
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

  constraintsEl.innerHTML = (problem.constraints[language] || []).map((c) => `<li>${c}</li>`).join('');
  renderMath(constraintsEl);

  // Learning content is optional per problem — most don't have it yet, so
  // fall back to the "Coming Soon!" placeholder already in the HTML. The
  // call-to-action is appended here (not per-problem content) so any future
  // problem with learning content gets it automatically, with no duplication.
  if (problem.learning && problem.learning[language]) {
    learningEl.innerHTML = `${problem.learning[language]}<p class="learning-cta">Ready? Click the <button type="button" class="tab-ref-link" data-tab="applying">Applying</button> tab to try it yourself.</p>`;
    renderMath(learningEl);
  } else {
    learningEl.innerHTML = '<p class="coming-soon">Coming Soon!</p>';
  }
}

// Loads a language's code into the editor — whatever the user last had
// there (see codeByLanguage), or its starter template on first visit — and
// swaps the description/examples/constraints to match.
// Results/stdout/stderr are restored the same way (see
// consoleStateByLanguage/restoreConsoleState) rather than cleared, so
// switching languages and back shows exactly what was there before.
function clearConsoleOutput() {
  consoleStatusEl.textContent = 'Run your code to see results.';
  consoleStatusEl.className = '';
  consoleResultsListEl.innerHTML = '';
  consoleStdoutEl.textContent = '';
  consoleStderrEl.textContent = '';
}

// Restores whatever Run/Submit outcome was last shown for `language`
// (see consoleStateByLanguage), or shows the "nothing run yet" state if
// there isn't one.
function restoreConsoleState(language) {
  const state = consoleStateByLanguage[language];
  if (!state) clearConsoleOutput();
  else if (state.kind === 'error') renderClientError(state.message);
  else renderResults(state.data);
}

function loadLanguage(language) {
  const code = codeByLanguage[language] ?? problem.starterCode[language] ?? '';

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
  languageSelect.value = language;
  languageSelect.title = `Current language: ${LANGUAGE_LABELS[language]}`;
  renderLanguageContent(language);
  restoreConsoleState(language);
}

// Switches the active editor language, saving whatever's in the editor for
// the language being left (into codeByLanguage, so switching back restores
// it) before loading the new one, and persists the new language as the
// default. Shared by language-select, the language-filter menu's
// name-click, its checkbox-uncheck fallback, and the Submissions tab's Load
// — every path that changes "what language is this" goes through here.
// Load passes { saveAsDefault: false }: looking at an old submission isn't
// choosing a new default language.
async function switchLanguage(newLanguage, { saveAsDefault = true } = {}) {
  if (!problem) {
    setStoredDefaultLanguage(newLanguage);
    updateDefaultLanguageHighlight();
    return true;
  }
  if (newLanguage !== currentLanguage) {
    codeByLanguage[currentLanguage] = editor.getValue();
    loadLanguage(newLanguage);
  }
  if (saveAsDefault) {
    setStoredDefaultLanguage(newLanguage);
    updateDefaultLanguageHighlight();
  }
  return true;
}

async function handleLanguageChange(selectEl) {
  const newLanguage = selectEl.value;
  const switched = await switchLanguage(newLanguage);
  if (!switched) selectEl.value = currentLanguage;
}

function formatValue(v) {
  return JSON.stringify(v);
}

// result.error/r.error come from the submission's own exception message (or
// compiler stderr) — unlike other fields here, that's text the submission's
// author controls, so it's escaped before going into innerHTML.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Renders one test-case entry. showErrorIfHidden is only set true for the
// full-crash path below — a compile/timeout error isn't test-specific (it
// doesn't depend on which input was used), so it's safe to show even for a
// hidden case, unlike a per-test exception message which might incidentally
// reveal something about that hidden case's input.
function renderTestCase(r, { showErrorIfHidden = false } = {}) {
  if (r.hidden) {
    const errorLine = showErrorIfHidden && r.error
      ? `<br/><span class="test-case-error">Error: <code>${escapeHtml(r.error)}</code></span>`
      : '';
    return `<div class="test-case ${r.passed ? 'pass' : 'fail'}">
      <strong>Hidden test case ${r.index + 1}:</strong> ${r.passed ? 'Passed' : 'Failed'}${errorLine}
    </div>`;
  }
  // Expected only makes sense to show next to an actual result to compare
  // against — once the case has thrown, there's nothing to compare, so
  // skip straight to the error instead.
  return `<div class="test-case ${r.passed ? 'pass' : 'fail'}">
    <strong>Test case ${r.index + 1}:</strong> ${r.passed ? 'Passed' : 'Failed'}<br/>
    <span>Input: <code>${formatValue(r.input)}</code></span><br/>
    ${
      r.error
        ? `<span class="test-case-error">Error: <code>${escapeHtml(r.error)}</code></span>`
        : `<span>Expected: <code>${formatValue(r.expected)}</code></span><br/>
    <span>Actual: <code>${formatValue(r.actual)}</code></span>`
    }
  </div>`;
}

function renderResults(result) {
  consoleStatusEl.textContent = `${result.status}${
    typeof result.passed === 'number' ? ` — ${result.passed}/${result.total} test cases passed` : ''
  }${typeof result.runtimeMs === 'number' ? ` (${result.runtimeMs} ms)` : ''}${
    result.saved === false ? ` — ⚠ not saved: ${result.saveError}` : ''
  }`;
  consoleStatusEl.className = result.status === 'Accepted' ? 'status-pass' : 'status-fail';

  // textContent, not innerHTML — this is raw program output, not markup.
  consoleStdoutEl.textContent = result.stdout || '';
  consoleStderrEl.textContent = result.stderr || '';

  const results = result.results || [];

  if (result.error) {
    // Full-crash scenario (compile error / timeout / no valid output): every
    // test case fails identically, so show just the first one and stop,
    // rather than repeating the same error for every case.
    consoleResultsListEl.innerHTML = results.length
      ? renderTestCase(results[0], { showErrorIfHidden: true })
      : `<pre class="error-block">${escapeHtml(result.error)}</pre>`;
    return;
  }

  consoleResultsListEl.innerHTML = results.map((r) => renderTestCase(r)).join('');
}

// A client-side failure (network/parse error) before any judge result came
// back — distinct from a judge result that itself reports an error (e.g.
// Compile Error), which renderResults already handles.
function renderClientError(message) {
  consoleStatusEl.textContent = 'Error';
  consoleStatusEl.className = 'status-fail';
  consoleResultsListEl.innerHTML = `<pre class="error-block">${escapeHtml(message)}</pre>`;
}

async function execute(endpoint, button) {
  button.disabled = true;
  consoleStatusEl.textContent = 'Running...';
  consoleStatusEl.className = '';
  consoleResultsListEl.innerHTML = '';
  consoleStdoutEl.textContent = '';
  consoleStderrEl.textContent = '';

  try {
    const res = await fetch(`/api/questions/${slug}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: languageSelect.value, code: editor.getValue() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    renderResults(data);
    consoleStateByLanguage[currentLanguage] = { kind: 'result', data };
    if (endpoint === 'submit' && data.saved) refreshSubmissions();
  } catch (err) {
    renderClientError(err.message);
    consoleStateByLanguage[currentLanguage] = { kind: 'error', message: err.message };
  } finally {
    button.disabled = false;
  }
}

// --- Submissions tab ---------------------------------------------------------
// Lists this question's saved Submits (GET /api/submissions?question=…),
// newest first, and can load one's code back into the editor. Built with
// createElement/textContent, so nothing from a record is treated as HTML.

function makeEl(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

async function refreshSubmissions() {
  const panel = descriptionTabPanels.submissions;
  let summaries;
  try {
    const res = await fetch(`/api/submissions?question=${encodeURIComponent(slug)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    summaries = data;
  } catch (err) {
    panel.replaceChildren(makeEl('p', `Couldn't load submissions: ${err.message}`, 'status-fail'));
    return;
  }
  if (!summaries.length) {
    panel.replaceChildren(makeEl('p', 'No submissions yet. Press Submit to record one.', 'coming-soon'));
    return;
  }

  const table = makeEl('table', undefined, 'submissions-table');
  const head = table.createTHead().insertRow();
  ['When', 'Language', 'Result', 'Time', ''].forEach((h) => head.appendChild(makeEl('th', h)));
  const body = table.createTBody();
  for (const s of summaries) {
    const row = body.insertRow();
    const when = makeEl('td', new Date(s.submittedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }));
    when.title = `${s.submittedAt} (UTC)`;
    row.append(
      when,
      makeEl('td', LANGUAGE_LABELS[s.language] || s.language),
      makeEl('td', `${s.status} · ${s.passed}/${s.total}`, s.status === 'Accepted' ? 'status-pass' : 'status-fail'),
      makeEl('td', `${s.runtimeMs} ms`)
    );
    const loadBtn = makeEl('button', 'Load');
    loadBtn.type = 'button';
    loadBtn.title = 'Load this code into the editor';
    loadBtn.addEventListener('click', () => loadSubmissionIntoEditor(s.id));
    const cell = makeEl('td');
    cell.appendChild(loadBtn);
    row.appendChild(cell);
  }
  // Scrolls sideways rather than being cut off when the pane is narrow.
  const scroller = makeEl('div', undefined, 'submissions-scroll');
  scroller.appendChild(table);
  panel.replaceChildren(scroller);
}

// Switches to the submission's language and puts its code in the editor.
// Asks first only if that language's current code has been edited (it's
// neither the starter code nor already this submission's code).
async function loadSubmissionIntoEditor(id) {
  let record;
  try {
    const res = await fetch(`/api/submissions/${encodeURIComponent(id)}`);
    record = await res.json();
    if (!res.ok) throw new Error(record.error || `HTTP ${res.status}`);
  } catch (err) {
    alert(`Couldn't load that submission: ${err.message}`);
    return;
  }

  const { language, code } = record;
  const label = LANGUAGE_LABELS[language] || language;
  if (![...languageSelect.options].some((o) => o.value === language)) {
    alert(`${label} is turned off in the language menu. Turn it on to load this submission.`);
    return;
  }
  const starter = problem.starterCode[language] ?? '';
  const current = language === currentLanguage ? editor.getValue() : codeByLanguage[language] ?? starter;
  if (current !== starter && current !== code && !confirm(`Replace your current ${label} code with this submission's code?`)) {
    return;
  }
  await switchLanguage(language, { saveAsDefault: false });
  editor.setValue(code);
}

async function init() {
  if (!slug) {
    titleEl.textContent = 'No problem specified';
    return;
  }

  // Fetched alongside the problem; loadLabels() never rejects.
  const labelsPromise = loadLabels();

  try {
    const res = await fetch(`/api/questions/${slug}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    problem = await res.json();
  } catch (err) {
    titleEl.textContent = `Failed to load problem: ${err.message}`;
    return;
  }

  renderHeader(await labelsPromise);
  refreshSubmissions();
  loadLanguage(pickInitialLanguage(problem));

  // Default to the Learning tab on first load only, when it has real content
  // for this language — switching languages afterward keeps whatever tab
  // the user is already on rather than jumping back to Learning each time.
  if (problem.learning && problem.learning[currentLanguage]) {
    setDescriptionTab('learning');
  }

  languageSelect.addEventListener('change', () => handleLanguageChange(languageSelect));
  runBtn.addEventListener('click', () => execute('run', runBtn));
  submitBtn.addEventListener('click', () => execute('submit', submitBtn));
  // Stub: real skip logic (advance to next problem, record as missed, etc.) comes later.
  skipBtn.addEventListener('click', () => alert('Skip button pressed'));
}

init();

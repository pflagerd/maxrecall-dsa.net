const slug = new URLSearchParams(window.location.search).get('slug');

// Every element looked up below is in problem.html, so each lookup is cast
// to the element it finds there, without null (decision 2 in
// docs/plans/documentation-standard.md: casts, not null checks). If one went
// missing from problem.html, the page would fail as it always has.

const titleEl = /** @type {HTMLElement} */ (document.getElementById('problem-title'));
const difficultyEl = /** @type {HTMLElement} */ (document.getElementById('problem-difficulty'));
const bubblesEl = /** @type {HTMLElement} */ (document.getElementById('problem-bubbles'));
const descriptionEl = /** @type {HTMLElement} */ (document.getElementById('problem-description'));
const examplesEl = /** @type {HTMLElement} */ (document.getElementById('problem-examples'));
const constraintsEl = /** @type {HTMLElement} */ (document.getElementById('problem-constraints'));
const learningEl = /** @type {HTMLElement} */ (document.getElementById('tab-learning'));
const languageSelect = /** @type {HTMLSelectElement} */ (document.getElementById('language-select'));
const languageFilterBtn = /** @type {HTMLButtonElement} */ (document.getElementById('language-filter-btn'));
const languageFilterMenu = /** @type {HTMLElement} */ (document.getElementById('language-filter-menu'));
const languageCheckboxes = Array.from(/** @type {NodeListOf<HTMLInputElement>} */ (languageFilterMenu.querySelectorAll('input[type="checkbox"]')));
const languageFilterNames = Array.from(/** @type {NodeListOf<HTMLElement>} */ (languageFilterMenu.querySelectorAll('.language-filter-name')));
const runBtn = /** @type {HTMLButtonElement} */ (document.getElementById('run-btn'));
const submitBtn = /** @type {HTMLButtonElement} */ (document.getElementById('submit-btn'));
const skipBtn = /** @type {HTMLButtonElement} */ (document.getElementById('skip-btn'));
const timerBtn = /** @type {HTMLButtonElement} */ (document.getElementById('elapsed-timer'));
const timerDigitsEl = /** @type {HTMLElement} */ (document.getElementById('elapsed-timer-digits'));
const consoleStatusEl = /** @type {HTMLElement} */ (document.getElementById('console-status'));
const consoleResultsEl = /** @type {HTMLElement} */ (document.getElementById('console-results'));
const consoleResultsListEl = /** @type {HTMLElement} */ (document.getElementById('console-results-list'));
const consoleStdoutEl = /** @type {HTMLElement} */ (document.getElementById('console-stdout'));
const consoleStderrEl = /** @type {HTMLElement} */ (document.getElementById('console-stderr'));
const consoleTabPanels = { results: consoleResultsEl, stdout: consoleStdoutEl, stderr: consoleStderrEl };
const descriptionTabPanels = {
  learning: /** @type {HTMLElement} */ (document.getElementById('tab-learning')),
  applying: /** @type {HTMLElement} */ (document.getElementById('tab-applying')),
  submissions: /** @type {HTMLElement} */ (document.getElementById('tab-submissions')),
  insights: /** @type {HTMLElement} */ (document.getElementById('tab-insights')),
};
const fullscreenBtn = /** @type {HTMLButtonElement} */ (document.getElementById('fullscreen-btn'));
const fullscreenIcon = /** @type {Element} */ (document.getElementById('fullscreen-icon'));
const resetSplitBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-split-btn'));
const paneResizer = /** @type {HTMLElement} */ (document.getElementById('pane-resizer'));
const descriptionPaneEl = /** @type {HTMLElement} */ (document.querySelector('.description-pane'));
const editorPaneEl = /** @type {HTMLElement} */ (document.querySelector('.editor-pane'));
const rowResizer = /** @type {HTMLElement} */ (document.getElementById('row-resizer'));
const editorHostEl = /** @type {HTMLElement} */ (document.getElementById('editor-host'));
const consolePanelEl = /** @type {HTMLElement} */ (document.querySelector('.console-panel'));

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

/**
 * Where the description/editor split can go: the space both panes share,
 * less the resizer and both flex gaps, measured rather than hardcoded so
 * this doesn't need to track the CSS gap/padding values separately.
 *
 * @typedef {{ paneLeft: number, span: number, minWidth: number, maxWidth: number }} PaneBounds
 *
 * @returns {PaneBounds} In pixels: the description pane's left edge, the
 *   width both panes span, and the smallest and largest width the
 *   description pane may have.
 */
function getPaneWidthBounds() {
  const paneLeft = descriptionPaneEl.getBoundingClientRect().left;
  const editorRight = editorPaneEl.getBoundingClientRect().right;
  const span = editorRight - paneLeft;
  const fixedOverhead = span - descriptionPaneEl.getBoundingClientRect().width - editorPaneEl.getBoundingClientRect().width;
  const minWidth = span * MIN_PANE_FRACTION;
  return { paneLeft, span, minWidth, maxWidth: span - fixedOverhead - minWidth };
}

/**
 * Sets the description pane's width, kept within its bounds.
 *
 * @param {number} width - The width wanted, in pixels.
 * @param {PaneBounds} [bounds] - From getPaneWidthBounds(); measured now if
 *   not given.
 * @returns {void}
 */
function setDescriptionPaneWidth(width, bounds) {
  const { minWidth, maxWidth } = bounds || getPaneWidthBounds();
  const clamped = Math.max(minWidth, Math.min(width, maxWidth));
  descriptionPaneEl.style.flex = `0 0 ${clamped}px`;
}

/**
 * Remembers the description pane's width in localStorage, if it can.
 *
 * @returns {void}
 */
function savePaneWidth() {
  try {
    localStorage.setItem(PANE_WIDTH_STORAGE_KEY, String(descriptionPaneEl.getBoundingClientRect().width));
  } catch {
    // Ignore (private browsing, storage disabled, etc.) — just won't persist.
  }
}

/**
 * Restores the description pane's remembered width, if there is one. Runs
 * once, as the page loads.
 *
 * @returns {void}
 */
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

resetSplitBtn.addEventListener(
  'click',
  /**
   * Puts the description/editor split back to its default (the golden
   * ratio), and remembers that.
   *
   * @returns {void}
   */
  () => {
    const bounds = getPaneWidthBounds();
    setDescriptionPaneWidth(bounds.span * DEFAULT_PANE_FRACTION, bounds);
    savePaneWidth();
  },
);

paneResizer.addEventListener(
  'pointerdown',
  /**
   * Starts dragging the description/editor split: follows the pointer
   * until it's released, then remembers the width.
   *
   * @param {PointerEvent} e - The press on the resizer bar.
   * @returns {void}
   */
  (e) => {
    e.preventDefault();
    paneResizer.setPointerCapture(e.pointerId);
    paneResizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const bounds = getPaneWidthBounds();

    /**
     * Follows the pointer while dragging.
     *
     * @param {PointerEvent} moveEvent - The pointer's move.
     * @returns {void}
     */
    function onMove(moveEvent) {
      setDescriptionPaneWidth(moveEvent.clientX - bounds.paneLeft, bounds);
    }

    /**
     * Ends the drag and remembers the width.
     *
     * @param {PointerEvent} upEvent - The pointer's release.
     * @returns {void}
     */
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
  },
);

// Drag-to-resize the editor/console split, same approach as the pane
// resizer above but on the vertical axis. #editor-host defaults to flex: 1
// (fills whatever's left) and .console-panel defaults to max-height: 35%
// (CSS alone) until the first drag, at which point both switch to explicit
// inline sizing driven by the pointer position.
const MIN_EDITOR_HEIGHT = 180; // matches #editor-host's CSS min-height
const MIN_CONSOLE_HEIGHT = 80;

rowResizer.addEventListener(
  'pointerdown',
  /**
   * Starts dragging the editor/console split: follows the pointer until
   * it's released.
   *
   * @param {PointerEvent} e - The press on the resizer bar.
   * @returns {void}
   */
  (e) => {
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

    /**
     * Follows the pointer while dragging.
     *
     * @param {PointerEvent} moveEvent - The pointer's move.
     * @returns {void}
     */
    function onMove(moveEvent) {
      const newEditorHeight = Math.max(MIN_EDITOR_HEIGHT, Math.min(moveEvent.clientY - editorTop, maxEditorHeight));
      editorHostEl.style.flex = `0 0 ${newEditorHeight}px`;
    }

    /**
     * Ends the drag.
     *
     * @param {PointerEvent} upEvent - The pointer's release.
     * @returns {void}
     */
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
  },
);

// Icon paths swapped on the same button depending on fullscreen state.
const EXPAND_ICON_PATHS = '<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>';
const COMPRESS_ICON_PATHS = '<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>';

/**
 * Shows the expand or compress icon, and the matching label, for whether
 * the page is in full screen now.
 *
 * @returns {void}
 */
function updateFullscreenButton() {
  const isFullscreen = Boolean(document.fullscreenElement);
  fullscreenIcon.innerHTML = isFullscreen ? COMPRESS_ICON_PATHS : EXPAND_ICON_PATHS;
  const label = isFullscreen ? 'Exit full screen' : 'Enter full screen';
  fullscreenBtn.title = label;
  fullscreenBtn.setAttribute('aria-label', label);
}

if (fullscreenBtn && document.documentElement.requestFullscreen) {
  fullscreenBtn.addEventListener(
    'click',
    /**
     * Enters full screen, or leaves it.
     *
     * @returns {void}
     */
    () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    },
  );
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
/**
 * Wires up one group of tabs: clicking a .tab-button shows the panel named
 * by its data-tab, and hides the others.
 *
 * @param {string} tabsContainerSelector - A CSS selector for the element
 *   holding the group's .tab-button elements.
 * @param {Record<string, HTMLElement>} panels - The panels, by tab name.
 * @param {string} defaultTab - The tab shown to begin with.
 * @returns {(tabName: string) => void} A function that shows a tab by name.
 */
function setupTabGroup(tabsContainerSelector, panels, defaultTab) {
  const tabs = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`${tabsContainerSelector} .tab-button`));

  /**
   * Shows one tab's panel and marks its button, hiding the others.
   *
   * @param {string} tabName - The tab to show.
   * @returns {void}
   */
  function setActive(tabName) {
    tabs.forEach(
      /**
       * Marks one tab button active or not.
       *
       * @param {HTMLElement} tab - A .tab-button in the group.
       * @returns {void}
       */
      (tab) => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
      },
    );
    Object.entries(panels).forEach(
      /**
       * Shows one panel if it's the active tab's, hides it otherwise.
       *
       * @param {[string, HTMLElement]} entry - The panel's tab name, and the panel.
       * @returns {void}
       */
      ([name, panel]) => {
        panel.hidden = name !== tabName;
      },
    );
  }

  tabs.forEach(
    /**
     * Makes clicking a tab button show its panel.
     *
     * @param {HTMLElement} tab - A .tab-button in the group.
     * @returns {void}
     */
    (tab) => {
      // Every .tab-button has a data-tab (problem.html).
      tab.addEventListener('click', () => setActive(/** @type {string} */ (tab.dataset.tab)));
    },
  );
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
descriptionPaneEl.addEventListener(
  'click',
  /**
   * Follows a link to another description tab (a .tab-ref-link).
   *
   * @param {MouseEvent} e - Any click in the description pane.
   * @returns {void}
   */
  (e) => {
    // A click's target is an element; a .tab-ref-link has a data-tab.
    const link = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.tab-ref-link'));
    if (link) setDescriptionTab(/** @type {string} */ (link.dataset.tab));
  },
);

/**
 * One example in a question's description.
 *
 * @typedef {object} Example
 * @property {string} input
 * @property {string} output
 * @property {string} [explanation]
 */

/**
 * A question as GET /api/questions/:slug sends it: the question file with
 * its hidden test cases taken out (server.js, toPublicProblem). Only the
 * fields this page uses are listed.
 *
 * @typedef {object} PublicProblem
 * @property {string} slug
 * @property {string} title
 * @property {string} difficulty - "Easy", "Medium" or "Hard".
 * @property {string[]} [topics]
 * @property {string[]} [sources]
 * @property {Record<string, string>} [learning] - The Learning tab's HTML, by language.
 * @property {Record<string, string>} description - HTML, by language.
 * @property {Record<string, Example[]>} [examples] - By language.
 * @property {Record<string, string[]>} [constraints] - HTML items, by language.
 * @property {Record<string, string>} starterCode - By language; the
 *   languages this question can be answered in.
 */

/** The question shown; null until it has loaded. @type {PublicProblem | null} */
let problem = null;
/** The CodeMirror editor; null until the first language is loaded. @type {CodeMirror.Editor | null} */
let editor = null;
/** The language shown, e.g. "python"; null until the first is loaded. @type {string | null} */
let currentLanguage = null;

// Code the user has typed for each language on this problem, so switching
// away and back doesn't lose it. In-memory only (scoped to this page load,
// same as `problem`/`currentLanguage`) — a fresh page load for this
// problem starts from starterCode again, same as before this existed.
/** @type {Record<string, string>} */
const codeByLanguage = {};

// Last Run/Submit outcome shown for each language, so switching away and
// back restores it too instead of clearing the console. One of
// { kind: 'running' } (a Run or Submit is waiting for its answer),
// { kind: 'result', data } (a judge result, same shape renderResults takes)
// or { kind: 'error', message } (a client-side failure — network/parse
// error — before any judge result came back).
/**
 * @typedef {{ kind: 'running' } | { kind: 'result', data: JudgeResult } | { kind: 'error', message: string }} ConsoleState
 */

/** @type {Record<string, ConsoleState>} */
const consoleStateByLanguage = {};

// Default language used to open problems, remembered across problems/reloads
// via localStorage. Changing either language dropdown updates this default
// (not just the editor-toolbar one) — picking a language is "what I want to
// use from now on", not just a one-off for the current problem.
const KNOWN_LANGUAGES = ['javascript', 'python', 'cpp', 'java', 'd'];
/** Each language's name as shown. @type {Record<string, string>} */
const LANGUAGE_LABELS = { javascript: 'JavaScript', python: 'Python', cpp: 'C++', java: 'Java', d: 'D' };

// Languages this question has been Submitted in, and saved, since the page
// opened (issue #18). Submit is then grayed out for that language, nudging
// the learner on to the next question. Per language because progress is per
// (question, language). Run stays available, and a reload starts afresh:
// it's a nudge, not a rule the server enforces (owner's decisions).
/** @type {Set<string | null>} */
const submittedLanguages = new Set();
const SUBMIT_TITLE = submitBtn.title;

/**
 * Grays out Submit for a language already submitted, with a tooltip that
 * says why; otherwise enables it.
 *
 * @returns {void}
 */
function updateSubmitButton() {
  const done = submittedLanguages.has(currentLanguage);
  submitBtn.disabled = done;
  submitBtn.title = done
    ? `Already submitted in ${LANGUAGE_LABELS[/** @type {string} */ (currentLanguage)]}. Go back to the list for the next question.`
    : SUBMIT_TITLE;
}

// --- Elapsed-time timer (issue #20, docs/plans/elapsed-timer.md) ---------
// One stopwatch (timer.js) per language, like progress: it starts when the
// question opens in that language and counts only while that language is
// shown and this tab is visible (the Page Visibility API's document.hidden:
// another tab, a minimized window or a locked screen pause it, another
// window on top doesn't). A saved Submit freezes it, and Submit sends the
// time so the record keeps it. While a Submit waits for its answer the
// clock is held, so judging time isn't counted. A reload starts afresh.
/** One stopwatch per language, made when first needed. @type {Record<string, import('./timer').Stopwatch>} */
const clockByLanguage = {};
/** Languages whose Submit is waiting for its answer. @type {Set<string>} */
const submittingLanguages = new Set();
const TIMER_HIDDEN_STORAGE_KEY = 'maxrecall-dsa:timer-hidden';

/**
 * A language's stopwatch, made (paused at zero) the first time it's asked for.
 *
 * @param {string} language - e.g. "python".
 * @returns {import('./timer').Stopwatch} Its stopwatch.
 */
function clockFor(language) {
  if (!clockByLanguage[language]) clockByLanguage[language] = createStopwatch();
  return clockByLanguage[language];
}

/**
 * Runs the current language's clock when it should count, and pauses all
 * the others. Called whenever any of that changes.
 *
 * @returns {void}
 */
function updateClocks() {
  for (const [language, clock] of Object.entries(clockByLanguage)) {
    if (language !== currentLanguage) clock.pause();
  }
  if (!currentLanguage) return;
  const clock = clockFor(currentLanguage);
  if (document.hidden || submittingLanguages.has(currentLanguage)) clock.pause();
  else clock.resume();
  renderTimer();
}

/**
 * Whether the learner hid the timer's digits, as remembered in localStorage.
 *
 * @returns {boolean} True if hidden; false if not, or if storage can't be read.
 */
function getStoredTimerHidden() {
  try {
    return localStorage.getItem(TIMER_HIDDEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Remembers whether the timer's digits are hidden, if storage allows.
 *
 * @param {boolean} hidden - Whether they're hidden.
 * @returns {void}
 */
function setStoredTimerHidden(hidden) {
  try {
    localStorage.setItem(TIMER_HIDDEN_STORAGE_KEY, String(hidden));
  } catch {
    // Storage unavailable (e.g. blocked): the choice lasts until a reload.
  }
}

let timerHidden = getStoredTimerHidden();

/**
 * Shows the current language's time, or only the clock icon if the learner
 * hid the digits. The clock counts either way.
 *
 * @returns {void}
 */
function renderTimer() {
  if (!currentLanguage) return;
  const clock = clockFor(currentLanguage);
  const label = LANGUAGE_LABELS[currentLanguage];
  timerDigitsEl.textContent = formatElapsed(clock.elapsedMs());
  timerDigitsEl.hidden = timerHidden;
  timerBtn.classList.toggle('frozen', clock.frozen);
  const what = clock.frozen
    ? `Time taken in ${label}, saved with your Submit.`
    : `Time on this question in ${label}, counted while this tab is visible.`;
  timerBtn.title = `${what} Click to ${timerHidden ? 'show' : 'hide'} the time.`;
  timerBtn.setAttribute('aria-label', timerBtn.title);
}

timerBtn.addEventListener(
  'click',
  /**
   * Hides or shows the timer's digits, and remembers that. The clock
   * counts either way.
   *
   * @returns {void}
   */
  () => {
    timerHidden = !timerHidden;
    setStoredTimerHidden(timerHidden);
    renderTimer();
  },
);
document.addEventListener('visibilitychange', updateClocks);
// A quarter second, so the display never skips a second.
setInterval(renderTimer, 250);
// --- The learner's profile (spaced-repetition plan, D2; step 4c) -------------
// Which languages the learner has, their default, and what they may change
// come from the server (GET /api/profile), and changes are saved there
// (PATCH /api/profile/preferred). Before 2026-11-03 the default language and
// the language menu's choices were kept in this browser's localStorage; they
// are copied to the profile once (migrateLocalStorageChoices) and not used
// after that.

/**
 * The profile as GET /api/profile sends it (profile.js, effectiveProfile).
 *
 * @typedef {object} EffectiveProfile
 * @property {string[]} allowedLanguages - Languages the learner may use at all.
 * @property {string[]} languages - The allowed ones turned on, in the learner's order.
 * @property {string} defaultLanguage - One of languages.
 * @property {boolean} canChooseLanguages - May they turn languages on and off?
 * @property {boolean} canSwitchLanguage - May they change a question's language themselves?
 * @property {boolean} canSetDefaultLanguage - May they set their default language?
 */

/**
 * The learner's profile. Until it has loaded, or if it can't be loaded,
 * everything is allowed (the server refuses Run and Submit itself when the
 * profile is invalid).
 *
 * @type {EffectiveProfile}
 */
let profile = {
  allowedLanguages: [...KNOWN_LANGUAGES],
  languages: [...KNOWN_LANGUAGES],
  defaultLanguage: 'javascript',
  canChooseLanguages: true,
  canSwitchLanguage: true,
  canSetDefaultLanguage: true,
};

/**
 * Sends a request about the profile and reads the answer.
 *
 * @param {RequestInit} [options] - fetch()'s options: none for GET.
 * @returns {Promise<EffectiveProfile>} The profile the server answers with.
 * @throws {Error} The server's message if it refuses, with status set to
 *   the HTTP status (0 if no answer came back at all).
 */
async function profileRequest(options) {
  const url = options ? '/api/profile/preferred' : '/api/profile';
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw Object.assign(new Error("Can't reach the server."), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

/**
 * Saves a change to the learner's own choices, and keeps the answer.
 *
 * @param {{ languages?: string[], defaultLanguage?: string }} change - What to change.
 * @returns {Promise<EffectiveProfile>} The new profile (also kept in profile).
 * @throws {Error} As profileRequest() does, if it's refused or fails.
 */
async function saveProfileChange(change) {
  profile = await profileRequest({
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  });
  return profile;
}

// Where these choices were kept before the profile (step 4c).
const OLD_DEFAULT_LANGUAGE_KEY = 'maxrecall-dsa:default-language';
const OLD_AVAILABLE_LANGUAGES_KEY = 'maxrecall-dsa:available-languages';

/**
 * Copies the language choices this browser kept in localStorage into the
 * profile, once (owner's decision, 2026-11-03), then forgets them. Only
 * what the profile permits is sent: languages it allows, the menu's choices
 * if canChooseLanguages, the default if canSetDefaultLanguage and on. If
 * the server refuses them, they're forgotten anyway, so this isn't tried on
 * every page load; if it can't be reached, they're kept for next time.
 *
 * @returns {Promise<void>} Never rejects.
 */
async function migrateLocalStorageChoices() {
  /** @type {string | null} */
  let savedDefault = null;
  /** @type {string | null} */
  let savedLanguages = null;
  try {
    savedDefault = localStorage.getItem(OLD_DEFAULT_LANGUAGE_KEY);
    savedLanguages = localStorage.getItem(OLD_AVAILABLE_LANGUAGES_KEY);
  } catch {
    return; // storage unavailable: nothing to copy
  }
  if (savedDefault === null && savedLanguages === null) return;

  /** @type {{ languages?: string[], defaultLanguage?: string }} */
  const change = {};
  let parsed = null;
  try {
    parsed = JSON.parse(savedLanguages || 'null');
  } catch {
    // Not a list: nothing to copy for the menu.
  }
  if (profile.canChooseLanguages && Array.isArray(parsed)) {
    const languages = profile.allowedLanguages.filter((l) => parsed.includes(l));
    if (languages.length) change.languages = languages;
  }
  const turnedOn = change.languages || profile.languages;
  if (profile.canSetDefaultLanguage && savedDefault !== null && turnedOn.includes(savedDefault)) {
    change.defaultLanguage = savedDefault;
  }

  if (Object.keys(change).length) {
    try {
      await saveProfileChange(change);
    } catch (err) {
      if (/** @type {Error & { status?: number }} */ (err).status === 0) return; // try again next time
      console.warn(`Couldn't copy this browser's language choices to your profile: ${/** @type {Error} */ (err).message}`);
    }
  }
  try {
    localStorage.removeItem(OLD_DEFAULT_LANGUAGE_KEY);
    localStorage.removeItem(OLD_AVAILABLE_LANGUAGES_KEY);
  } catch {
    // Storage unavailable: nothing to forget.
  }
}

/**
 * Loads the profile, copies any old localStorage choices into it, and sets
 * the language menu and language-select from it. If it can't be loaded,
 * says why and carries on with everything allowed.
 *
 * @returns {Promise<void>} Never rejects.
 */
async function loadProfile() {
  try {
    profile = await profileRequest();
    await migrateLocalStorageChoices();
  } catch (err) {
    alert(`Your profile couldn't be loaded: ${/** @type {Error} */ (err).message}\n\nThe page shows every language, but the server will refuse Run and Submit until it's fixed.`);
  }
  applyProfileToControls();
}

/**
 * Sets the language menu and language-select from the profile: languages
 * not allowed are hidden; the checkboxes show the ones turned on, and are
 * disabled unless canChooseLanguages; language-select offers the ones on,
 * disabled unless canSwitchLanguage; the default is marked.
 *
 * @returns {void}
 */
function applyProfileToControls() {
  languageCheckboxes.forEach(
    /**
     * Shows or hides one language's menu row, and ticks its checkbox if the
     * language is turned on.
     *
     * @param {HTMLInputElement} cb - A language's checkbox.
     * @returns {void}
     */
    (cb) => {
      const lang = /** @type {string} */ (cb.dataset.lang); // every checkbox has data-lang
      // Each checkbox is in its row, a .language-filter-row (problem.html).
      /** @type {HTMLElement} */ (cb.closest('.language-filter-row')).hidden = !profile.allowedLanguages.includes(lang);
      cb.checked = profile.languages.includes(lang);
    },
  );
  updateCheckboxDisabledStates();
  renderLanguageSelectOptions(new Set(profile.languages));
  languageSelect.disabled = !profile.canSwitchLanguage;
  updateDefaultLanguageHighlight();
}

/**
 * Saves a new default language, if the profile permits and it's changed.
 *
 * @param {string} language - The new default.
 * @returns {Promise<void>} Never rejects: a failure is shown in an alert.
 */
async function saveDefaultLanguage(language) {
  if (!profile.canSetDefaultLanguage || language === profile.defaultLanguage || !profile.languages.includes(language)) return;
  try {
    await saveProfileChange({ defaultLanguage: language });
  } catch (err) {
    alert(`Couldn't save ${LANGUAGE_LABELS[language]} as your default language: ${/** @type {Error} */ (err).message}`);
  }
  updateDefaultLanguageHighlight();
}

/**
 * Rebuilds language-select's <option> list from the available set, keeping
 * the current selection if it's still available.
 *
 * @param {Set<string>} available - The languages switched on.
 * @returns {void}
 */
function renderLanguageSelectOptions(available) {
  const previousValue = languageSelect.value;
  languageSelect.innerHTML = KNOWN_LANGUAGES.filter((l) => available.has(l))
    .map((l) => `<option value="${l}">${LANGUAGE_LABELS[l]}</option>`)
    .join('');
  if (available.has(previousValue)) languageSelect.value = previousValue;
}

// Picks which language a problem should open with: the profile's default
// if this problem supports it, otherwise the first language turned on that
// it does. The default itself is never touched here — a mismatch is a
// one-off fallback for this load, not a change to what the user wants.
/**
 * @param {PublicProblem} problem - The question being opened.
 * @returns {string} The language to open it in.
 */
function pickInitialLanguage(problem) {
  const candidates = [profile.defaultLanguage, ...profile.languages];
  return candidates.find((l) => problem.starterCode[l]) || profile.languages[0];
}

// A checkbox for the only remaining checked language can't be unchecked —
// language-select must never end up with zero options. None can be changed
// unless the profile's canChooseLanguages allows it.
/** @returns {void} */
function updateCheckboxDisabledStates() {
  const checkedCount = languageCheckboxes.filter((cb) => cb.checked).length;
  languageCheckboxes.forEach(
    /**
     * Enables or disables one checkbox.
     *
     * @param {HTMLInputElement} cb - A language's checkbox.
     * @returns {void}
     */
    (cb) => {
      cb.disabled = !profile.canChooseLanguages || (checkedCount === 1 && cb.checked);
      cb.title = profile.canChooseLanguages ? '' : 'Choosing languages is turned off for you.';
    },
  );
}

/**
 * Closes the language menu.
 *
 * @returns {void}
 */
function closeLanguageFilterMenu() {
  languageFilterMenu.hidden = true;
  languageFilterBtn.setAttribute('aria-expanded', 'false');
}

// Marks whichever language name is the profile's default — independent of
// the checkboxes, which only control availability.
/** @returns {void} */
function updateDefaultLanguageHighlight() {
  languageFilterNames.forEach(
    /**
     * Marks one language's name if it's the default.
     *
     * @param {HTMLElement} el - A .language-filter-name.
     * @returns {void}
     */
    (el) => {
      el.classList.toggle('is-default', el.dataset.lang === profile.defaultLanguage);
    },
  );
}

languageFilterBtn.addEventListener(
  'click',
  /**
   * Opens or closes the language menu.
   *
   * @param {MouseEvent} e - The click, kept from reaching the document's
   *   close-on-click-outside handler.
   * @returns {void}
   */
  (e) => {
    e.stopPropagation();
    const isOpen = !languageFilterMenu.hidden;
    if (isOpen) {
      closeLanguageFilterMenu();
    } else {
      languageFilterMenu.hidden = false;
      languageFilterBtn.setAttribute('aria-expanded', 'true');
    }
  },
);

document.addEventListener(
  'click',
  /**
   * Closes the language menu on a click outside it.
   *
   * @param {MouseEvent} e - Any click on the page.
   * @returns {void}
   */
  (e) => {
    // A click's target is an element.
    if (!languageFilterMenu.hidden && !/** @type {Element} */ (e.target).closest('.language-filter')) closeLanguageFilterMenu();
  },
);

document.addEventListener(
  'keydown',
  /**
   * Closes the language menu on Escape.
   *
   * @param {KeyboardEvent} e - Any key pressed on the page.
   * @returns {void}
   */
  (e) => {
    if (e.key === 'Escape' && !languageFilterMenu.hidden) closeLanguageFilterMenu();
  },
);

languageCheckboxes.forEach(
  /**
   * Wires up one language's checkbox.
   *
   * @param {HTMLInputElement} checkbox - A language's checkbox.
   * @returns {void}
   */
  (checkbox) => {
    checkbox.addEventListener(
      'change',
      /**
       * Turns a language on or off, and saves that to the profile. Reverts
       * the checkbox if it can't be saved.
       *
       * @returns {Promise<void>} Never rejects: a failure is shown in an alert.
       */
      async () => {
        const lang = /** @type {string} */ (checkbox.dataset.lang); // every checkbox has data-lang

        // Unchecking the language currently active in the editor: switch to
        // another available language this problem supports first, or revert
        // the checkbox if there's no such language to fall back to.
        if (!checkbox.checked && problem && lang === currentLanguage) {
          // problem was checked just above; the checker can't see that inside this callback.
          const fallback = KNOWN_LANGUAGES.find((l) =>
            l !== lang
            && /** @type {PublicProblem} */ (problem).starterCode[l]
            && languageCheckboxes.some((cb) => cb.dataset.lang === l && cb.checked)
          );
          if (!fallback || !(await switchLanguage(fallback))) {
            checkbox.checked = true;
            return;
          }
        }

        // The learner's order is kept (it orders new pairs, D2 decision 2); a
        // language turned on goes last.
        const languages = checkbox.checked ? [...profile.languages, lang] : profile.languages.filter((l) => l !== lang);
        try {
          await saveProfileChange({ languages });
        } catch (err) {
          checkbox.checked = !checkbox.checked;
          alert(`Couldn't save that: ${/** @type {Error} */ (err).message}`);
        }
        applyProfileToControls();
      },
    );
  },
);

// Clicking a language's name sets it as the default and switches the editor
// to it (independent of its checkbox — clicking the checkbox only toggles
// availability, never the default). Setting a language as default also
// turns it on, since a default that isn't selectable in language-select
// wouldn't make sense. Each part happens only if the profile permits it.
languageFilterNames.forEach(
  /**
   * Wires up one language's name in the menu.
   *
   * @param {HTMLElement} nameEl - A .language-filter-name.
   * @returns {void}
   */
  (nameEl) => {
    nameEl.addEventListener(
      'click',
      /**
       * Turns the language on if needed, then switches to it (which also
       * saves it as the default), as far as the profile permits.
       *
       * @returns {Promise<void>} Never rejects: a failure is shown in an alert.
       */
      async () => {
        const lang = /** @type {string} */ (nameEl.dataset.lang); // every name has data-lang (problem.html)
        if (!profile.languages.includes(lang)) {
          if (!profile.canChooseLanguages) {
            alert(`${LANGUAGE_LABELS[lang]} is turned off, and choosing languages is turned off for you.`);
            return;
          }
          try {
            await saveProfileChange({ languages: [...profile.languages, lang] });
          } catch (err) {
            alert(`Couldn't turn ${LANGUAGE_LABELS[lang]} on: ${/** @type {Error} */ (err).message}`);
            return;
          }
          applyProfileToControls();
        }
        if (profile.canSwitchLanguage) await switchLanguage(lang);
        else await saveDefaultLanguage(lang);
        closeLanguageFilterMenu();
      },
    );
  },
);

// Browser-chrome shortcuts CodeMirror doesn't bind itself (Tab, Ctrl-Z/Y,
// Ctrl-A are already in its default keymap and need no help). Bound to a
// no-op so CodeMirror treats them as handled, which blocks the browser
// action. Note: some shortcuts (Ctrl/Cmd+W, +T, +N, +Shift+T, ...) are
// intentionally unblockable by browsers for security/UX reasons regardless.
const BLOCKED_KEYS = ['S', 'B', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'O', 'P', 'U', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

// Indentation is always spaces, INDENT_WIDTH per level (issue #16; owner's
// choice, following PEP 8: "Use 4 spaces per indentation level" and
// "Spaces are the preferred indentation method"). Mixing tabs and spaces is
// what made Python refuse code ("TabError: inconsistent use of tabs and
// spaces in indentation"): CodeMirror's automatic indentation used spaces
// (indentWithTabs defaults to false) while its Tab key inserted a tab
// character (its default "defaultTab" command), and the two look the same.
const INDENT_WIDTH = 4;

// Turns tabs in the indentation at the start of each line into spaces, each
// tab reaching the next multiple of INDENT_WIDTH. Only leading whitespace:
// a tab later in a line (in a string, say) is left alone.
/**
 * @param {string} text - Code, possibly with tabs in its indentation.
 * @returns {string} The same code with those tabs turned into spaces.
 */
function normalizeIndentation(text) {
  return text.replace(
    /^[ \t]+/gm,
    /**
     * Replaces one line's leading whitespace.
     *
     * @param {string} lead - The spaces and tabs at the start of a line.
     * @returns {string} lead with each tab turned into spaces up to the next
     *   indentation stop; unchanged if it has no tab.
     */
    (lead) => {
      if (!lead.includes('\t')) return lead;
      let column = 0;
      for (const ch of lead) column = ch === '\t' ? (Math.floor(column / INDENT_WIDTH) + 1) * INDENT_WIDTH : column + 1;
      return ' '.repeat(column);
    },
  );
}

// After any edit that isn't our own (typing, paste, drag-and-drop, undo),
// the lines it touched get the same treatment, so a tab can't get in by
// another route. Code put in with setValue is normalized beforehand.
/**
 * CodeMirror's "change" handler.
 *
 * @param {CodeMirror.Editor} cm - The editor.
 * @param {CodeMirror.EditorChange} change - What changed, and how
 *   (change.origin).
 * @returns {void}
 */
function normalizeChangedLines(cm, change) {
  if (change.origin === 'setValue' || change.origin === 'normalize-indentation') return;
  const last = change.from.line + change.text.length - 1;
  cm.operation(
    /**
     * Normalizes the changed lines, as one CodeMirror operation (one undo
     * step, one redraw).
     *
     * @returns {void}
     */
    () => {
      for (let line = change.from.line; line <= last && line < cm.lineCount(); line++) {
        const text = cm.getLine(line);
        // ^[ \t]* always matches, if only the empty string.
        const lead = /** @type {RegExpMatchArray} */ (text.match(/^[ \t]*/))[0];
        if (!lead.includes('\t')) continue;
        cm.replaceRange(normalizeIndentation(lead), { line, ch: 0 }, { line, ch: lead.length }, 'normalize-indentation');
      }
    },
  );
}

/** Key bindings added to CodeMirror's defaults. @type {CodeMirror.KeyMap} */
const EXTRA_KEYS = {
  ...Object.fromEntries(BLOCKED_KEYS.map((k) => [`Mod-${k}`, () => {}])),
  // Tab: with a selection, indent the selected lines one level; otherwise
  // insert spaces up to the next indentation stop (CodeMirror's
  // "insertSoftTab"), never a tab character.
  Tab: (cm) => cm.execCommand(cm.somethingSelected() ? 'indentMore' : 'insertSoftTab'),
  // Shift-Tab: out-dent the current line, or the selected lines, one level
  // (issue #15). CodeMirror's default, "indentAuto", re-indents by the
  // language mode, and this editor has none, so it did nothing useful.
  'Shift-Tab': 'indentLess',
};

// Renders $...$ math (powers, inequalities, etc.) within an element's
// existing content in place; throwOnError: false means a typo in the
// source LaTeX degrades to showing the raw text instead of breaking the page.
/**
 * Does nothing if KaTeX didn't load (e.g. the CDN is blocked).
 *
 * @param {HTMLElement} el - The element whose text may hold math.
 * @returns {void}
 */
function renderMath(el) {
  if (typeof renderMathInElement !== 'function') return;
  renderMathInElement(el, {
    delimiters: [{ left: '$', right: '$', display: false }],
    throwOnError: false,
  });
}

// Language-independent header: title, difficulty, then source and topic
// bubbles (bubbles.js). Rendered once, after the question has loaded (init),
// hence the casts: problem is set by then.
/**
 * @param {Labels} labels - The bubble styles (bubbles.js).
 * @returns {void}
 */
function renderHeader(labels) {
  titleEl.textContent = /** @type {PublicProblem} */ (problem).title;
  difficultyEl.textContent = /** @type {PublicProblem} */ (problem).difficulty;
  difficultyEl.className = `badge difficulty-${String(/** @type {PublicProblem} */ (problem).difficulty || '').toLowerCase()}`;
  renderBubbles(bubblesEl, /** @type {PublicProblem} */ (problem), labels);
}

// Description/examples/constraints are per-language (like starterCode), so this
// re-renders whenever the language changes, same as the editor's starter code.
// Only called once the question has loaded, hence the casts.
/**
 * @param {string} language - The language to show the question in.
 * @returns {void}
 */
function renderLanguageContent(language) {
  descriptionEl.innerHTML = /** @type {PublicProblem} */ (problem).description[language] ?? '';

  // Read as before: a question with no examples (or constraints) at all
  // would throw here, so every question has both.
  examplesEl.innerHTML = (/** @type {Record<string, Example[]>} */ (/** @type {PublicProblem} */ (problem).examples)[language] || [])
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

  constraintsEl.innerHTML = (/** @type {Record<string, string[]>} */ (/** @type {PublicProblem} */ (problem).constraints)[language] || []).map((c) => `<li>${c}</li>`).join('');
  renderMath(constraintsEl);

  // Learning content is optional per problem — most don't have it yet, so
  // fall back to the "Coming Soon!" placeholder already in the HTML. The
  // call-to-action is appended here (not per-problem content) so any future
  // problem with learning content gets it automatically, with no duplication.
  // learning is checked first, so the second and third casts hold.
  if (/** @type {PublicProblem} */ (problem).learning && /** @type {Record<string, string>} */ (/** @type {PublicProblem} */ (problem).learning)[language]) {
    learningEl.innerHTML = `${/** @type {Record<string, string>} */ (/** @type {PublicProblem} */ (problem).learning)[language]}<p class="learning-cta">Ready? Click the <button type="button" class="tab-ref-link" data-tab="applying">Applying</button> tab to try it yourself.</p>`;
    renderMath(learningEl);
  } else {
    learningEl.innerHTML = '<p class="coming-soon">Coming Soon!</p>';
  }
}

/**
 * Empties the console, with a status line.
 *
 * @param {string} [status='Run your code to see results.'] - The text shown.
 * @returns {void}
 */
function clearConsoleOutput(status = 'Run your code to see results.') {
  consoleStatusEl.textContent = status;
  consoleStatusEl.className = '';
  consoleResultsListEl.innerHTML = '';
  consoleStdoutEl.textContent = '';
  consoleStderrEl.textContent = '';
}

// Restores whatever Run/Submit outcome was last shown for `language`
// (see consoleStateByLanguage), or shows the "nothing run yet" state if
// there isn't one.
/**
 * @param {string} language - The language whose console to show.
 * @returns {void}
 */
function restoreConsoleState(language) {
  const state = consoleStateByLanguage[language];
  if (!state) clearConsoleOutput();
  else if (state.kind === 'running') clearConsoleOutput('Running...');
  else if (state.kind === 'error') renderClientError(state.message);
  else renderResults(state.data);
}

/**
 * Loads a language's code into the editor — whatever the user last had
 * there (see codeByLanguage), or its starter template on first visit — and
 * swaps the description/examples/constraints to match.
 * Results/stdout/stderr are restored the same way (see
 * consoleStateByLanguage/restoreConsoleState) rather than cleared, so
 * switching languages and back shows exactly what was there before.
 * Creates the editor the first time. Only called once the question has
 * loaded.
 *
 * @param {string} language - The language to show.
 * @returns {void}
 */
function loadLanguage(language) {
  const code = codeByLanguage[language] ?? /** @type {PublicProblem} */ (problem).starterCode[language] ?? '';

  if (!editor) {
    editor = CodeMirror(/** @type {HTMLElement} */ (document.getElementById('editor-host')), {
      value: normalizeIndentation(code),
      lineNumbers: true,
      indentUnit: INDENT_WIDTH,
      tabSize: INDENT_WIDTH,
      indentWithTabs: false,
      extraKeys: EXTRA_KEYS,
    });
    editor.on('change', normalizeChangedLines);
  } else {
    editor.setValue(normalizeIndentation(code));
  }
  currentLanguage = language;
  languageSelect.value = language;
  languageSelect.title = `Current language: ${LANGUAGE_LABELS[language]}${profile.canSwitchLanguage ? '' : ' (changing it is turned off for you)'}`;
  renderLanguageContent(language);
  restoreConsoleState(language);
  updateSubmitButton();
  updateClocks();
}

// Switches the active editor language, saving whatever's in the editor for
// the language being left (into codeByLanguage, so switching back restores
// it) before loading the new one, and persists the new language as the
// default. Shared by language-select, the language-filter menu's
// name-click, its checkbox-uncheck fallback, and the Submissions tab's Load
// — every path that changes "what language is this" goes through here.
// When the user picks a language themselves (chosenByUser, the default) it
// becomes their default language, and any loaded submission is dropped
// from the page address so a reload doesn't bring it back over their
// choice. Loading a submission passes { chosenByUser: false }: it does
// neither.
/**
 * @param {string} newLanguage - The language to switch to.
 * @param {{ chosenByUser?: boolean }} [options] - chosenByUser (default
 *   true): false when loading a submission.
 * @returns {Promise<boolean>} Always true as written (callers still check
 *   it, from when a switch could be refused).
 */
async function switchLanguage(newLanguage, { chosenByUser = true } = {}) {
  if (!problem) {
    await saveDefaultLanguage(newLanguage);
    return true;
  }
  if (newLanguage !== currentLanguage) {
    if (!(await showLanguage(newLanguage))) return true; // a later switch took over
    if (chosenByUser) setSubmissionInAddress(null);
  }
  // The default is saved to the profile only if it permits (saveDefaultLanguage).
  if (chosenByUser) await saveDefaultLanguage(newLanguage);
  return true;
}

/**
 * language-select's change handler.
 *
 * @param {HTMLSelectElement} selectEl - language-select.
 * @returns {Promise<void>}
 */
async function handleLanguageChange(selectEl) {
  const newLanguage = selectEl.value;
  const switched = await switchLanguage(newLanguage);
  if (!switched) selectEl.value = /** @type {string} */ (currentLanguage);
}

/**
 * A value from a test case, as shown in the console.
 *
 * @param {unknown} v - An input, expected or actual value: any JSON value
 *   (a number, an array, a string…), so it really can be anything.
 * @returns {string | undefined} Its JSON (undefined for undefined, which
 *   JSON.stringify gives back as undefined).
 */
function formatValue(v) {
  return JSON.stringify(v);
}

// result.error/r.error come from the submission's own exception message (or
// compiler stderr) — unlike other fields here, that's text the submission's
// author controls, so it's escaped before going into innerHTML.
/**
 * @param {string} str - Text: an error message. (Passed through String()
 *   all the same.)
 * @returns {string} The text with &, < and > escaped for HTML.
 */
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
/**
 * @param {TestResult} r - One test case's result.
 * @param {{ showErrorIfHidden?: boolean }} [options] - showErrorIfHidden
 *   (default false): show the error even for a hidden case.
 * @returns {string} The entry's HTML.
 */
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

/**
 * One test case's result, as the judge sends it. Hidden cases have only
 * index, hidden and passed (and error).
 *
 * @typedef {object} TestResult
 * @property {number} index - Its position in the question's test cases, from 0.
 * @property {boolean} hidden
 * @property {boolean} passed
 * @property {unknown} [input]
 * @property {unknown} [expected]
 * @property {unknown} [actual]
 * @property {string} [error] - The submission's own error text, for this case.
 */

/**
 * What POST /api/questions/:slug/run or /submit answers (server.js,
 * handleExecution).
 *
 * @typedef {object} JudgeResult
 * @property {string} status - e.g. "Accepted", "Wrong Answer", "Compile Error".
 * @property {number} [passed]
 * @property {number} [total]
 * @property {number} [runtimeMs]
 * @property {string} [error] - When judging failed as a whole (compile error, timeout).
 * @property {string} [stdout]
 * @property {string} [stderr]
 * @property {TestResult[]} [results]
 * @property {boolean} [saved] - Submit only: whether the record was saved.
 * @property {string} [saveError] - Submit only, when not saved: why.
 * @property {string} [submissionId] - Submit only, when saved.
 */

/**
 * Shows a judge result in the console.
 *
 * @param {JudgeResult} result - The result.
 * @returns {void}
 */
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
/**
 * @param {string} message - What went wrong.
 * @returns {void}
 */
function renderClientError(message) {
  consoleStatusEl.textContent = 'Error';
  consoleStatusEl.className = 'status-fail';
  consoleResultsListEl.innerHTML = `<pre class="error-block">${escapeHtml(message)}</pre>`;
}

/**
 * Runs or submits the editor's code, and shows and files the answer.
 *
 * @param {'run' | 'submit'} endpoint - Which to do.
 * @param {HTMLButtonElement} button - Run or Submit, disabled meanwhile.
 * @returns {Promise<void>} Never rejects: failures are shown in the console.
 */
async function execute(endpoint, button) {
  // The language sent. The learner may switch languages while waiting for
  // the answer, so the answer is filed under this language, not whichever
  // is current when it arrives, and is only shown if it's still on screen.
  // Run and Submit are wired up only after the first language is shown
  // (init), so there is one.
  const language = /** @type {string} */ (currentLanguage);
  const stillShown = () => language === currentLanguage;
  const isSubmit = endpoint === 'submit';
  if (isSubmit) {
    // Hold the clock while judging; the time sent is the time shown now.
    submittingLanguages.add(language);
    updateClocks();
  }
  const elapsedMs = Math.round(clockFor(language).elapsedMs());
  button.disabled = true;
  consoleStateByLanguage[language] = { kind: 'running' };
  restoreConsoleState(language);

  try {
    const res = await fetch(`/api/questions/${slug}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: languageSelect.value, code: /** @type {CodeMirror.Editor} */ (editor).getValue(), ...(isSubmit && { elapsedMs }) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    consoleStateByLanguage[language] = { kind: 'result', data };
    if (stillShown()) renderResults(data);
    if (isSubmit && data.saved) {
      submittedLanguages.add(language);
      clockFor(language).freeze();
      submissionsNotice = null;
      // A saved Submit becomes the submission named in the page address, so
      // a reload reopens what was just submitted rather than an older one;
      // but not if the learner has meanwhile picked another language, which
      // took the submission out of the address. Switching back to this
      // language refreshes its Submissions tab anyway (showLanguage).
      if (stillShown()) {
        setSubmissionInAddress(data.submissionId);
        refreshSubmissions();
      }
    }
  } catch (err) {
    consoleStateByLanguage[language] = { kind: 'error', message: /** @type {Error} */ (err).message };
    if (stillShown()) renderClientError(/** @type {Error} */ (err).message);
  } finally {
    // Submit stays grayed out after a saved Submit; a failed one (network
    // error, judge busy, not saved) can be tried again.
    if (button === submitBtn) updateSubmitButton();
    else button.disabled = false;
    if (isSubmit) {
      submittingLanguages.delete(language);
      updateClocks();
    }
  }
}

// --- Submissions tab ---------------------------------------------------------
// Lists this question's saved Submits (GET /api/submissions?question=…),
// newest first, and can load one's code back into the editor. Built with
// createElement/textContent, so nothing from a record is treated as HTML.

/**
 * Makes an element, with text and a class if given.
 *
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag - The tag name, e.g. "td". (A type parameter, K: the
 *   result's type follows the tag, as with document.createElement.)
 * @param {string} [text] - Its text, set as textContent, so never HTML.
 * @param {string} [className] - Its class attribute.
 * @returns {HTMLElementTagNameMap[K]} The element, not yet in the page.
 */
function makeEl(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}

// A message shown above the Submissions list, e.g. why the submission named
// in the page address couldn't be opened. Null when there's nothing to say.
/** @type {string | null} */
let submissionsNotice = null;

/**
 * Replaces the Submissions tab's content, with the notice (if any) first.
 *
 * @param {...Node} nodes - What to show.
 * @returns {void}
 */
function showInSubmissionsPanel(...nodes) {
  const notice = submissionsNotice ? [makeEl('p', submissionsNotice, 'status-fail')] : [];
  descriptionTabPanels.submissions.replaceChildren(...notice, ...nodes);
}

// Progress is per (question, language), the owner's design (2026-10-30):
// answering in C++ says nothing about Python. So everything below is about
// one language at a time.

// This question's saved Submits for the signed-in user in one language,
// newest first.
/**
 * One line of the Submissions tab, as GET /api/submissions sends it.
 *
 * @typedef {object} SubmissionSummary
 * @property {string} id
 * @property {string} submittedAt - UTC ISO 8601.
 * @property {string} question
 * @property {string} language
 * @property {string} status
 * @property {number} passed
 * @property {number} total
 * @property {number} runtimeMs
 * @property {number | null} elapsedMs - null for submissions before the timer.
 */

/**
 * @param {string} language - The language.
 * @returns {Promise<SubmissionSummary[]>} Newest first.
 * @throws {Error} If the request fails (rejects the promise).
 */
async function fetchSubmissionSummaries(language) {
  // init() stops before anything here runs when there's no slug.
  const params = new URLSearchParams({ question: /** @type {string} */ (slug), language });
  const res = await fetch(`/api/submissions?${params}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// The tab to show when the question is opened in `language`, or the user
// switches to it: Learning until they have a saved Submit in that language,
// then Applying, to encourage answering it. A question with no Learning text
// for that language shows Applying. If the Submits can't be loaded, treat it
// as never submitted. Otherwise the user moves between tabs freely, and
// submitting doesn't move them.
/**
 * @param {string} language - The language being shown.
 * @param {Promise<SubmissionSummary[]>} summariesPromise - Its submissions.
 * @returns {Promise<'learning' | 'applying'>} The tab to show.
 */
async function tabForLanguage(language, summariesPromise) {
  const submitted = await summariesPromise.then((summaries) => summaries.length > 0, () => false);
  const hasLearning = Boolean(/** @type {PublicProblem} */ (problem).learning && /** @type {Record<string, string>} */ (/** @type {PublicProblem} */ (problem).learning)[language]); // learning checked first
  return !submitted && hasLearning ? 'learning' : 'applying';
}

// Puts `language` in the editor and applies the per-language rules: the tab
// as if the question had just been opened in it, and the Submissions tab
// listing only its submissions. The tab is decided before the new content
// appears, so the page doesn't show one tab and then jump to another.
// Returns false if a later call took over while this one was waiting (e.g.
// two quick language changes), so the slower answer can't overwrite it.
let latestShowLanguage = 0;
/**
 * @param {string} language - The language to show.
 * @returns {Promise<boolean>} False if a later call took over meanwhile.
 */
async function showLanguage(language) {
  const call = ++latestShowLanguage;
  const summaries = fetchSubmissionSummaries(language);
  summaries.catch(() => {}); // still awaited below; this only stops an "unhandled" warning
  const tab = await tabForLanguage(language, summaries);
  if (call !== latestShowLanguage) return false;
  if (editor && currentLanguage) codeByLanguage[currentLanguage] = editor.getValue();
  loadLanguage(language);
  setDescriptionTab(tab);
  refreshSubmissions(summaries, language);
  return true;
}

// Fills the Submissions tab with one language's submissions. Pass a fetch
// already in flight to reuse it; otherwise it fetches afresh for the
// current language. Ignored if the language has changed meanwhile. Only
// called once a language is shown, so the defaults' casts hold.
/**
 * @param {Promise<SubmissionSummary[]>} [summariesPromise] - A fetch already
 *   in flight; by default, a new one for the current language.
 * @param {string} [language] - The language they're for; by default, the
 *   current one.
 * @returns {Promise<void>} Never rejects: failures are shown in the tab.
 */
async function refreshSubmissions(summariesPromise = fetchSubmissionSummaries(/** @type {string} */ (currentLanguage)), language = /** @type {string} */ (currentLanguage)) {
  /** @type {SubmissionSummary[]} */
  let summaries;
  try {
    summaries = await summariesPromise;
    if (language !== currentLanguage) return;
  } catch (err) {
    if (language !== currentLanguage) return;
    showInSubmissionsPanel(makeEl('p', `Couldn't load submissions: ${/** @type {Error} */ (err).message}`, 'status-fail'));
    return;
  }
  const label = LANGUAGE_LABELS[language] || language;
  if (!summaries.length) {
    showInSubmissionsPanel(makeEl('p', `No ${label} submissions yet. Press Submit to record one.`, 'coming-soon'));
    return;
  }

  const table = makeEl('table', undefined, 'submissions-table');
  const head = table.createTHead().insertRow();
  ['When', 'Result', 'Runtime', 'Your time', ''].forEach((h) => head.appendChild(makeEl('th', h)));
  const body = table.createTBody();
  for (const s of summaries) {
    const row = body.insertRow();
    const when = makeEl('td', new Date(s.submittedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }));
    when.title = `${s.submittedAt} (UTC)`;
    row.append(
      when,
      makeEl('td', `${s.status} · ${s.passed}/${s.total}`, s.status === 'Accepted' ? 'status-pass' : 'status-fail'),
      makeEl('td', `${s.runtimeMs} ms`)
    );
    // How long you took (issue #20); older submissions didn't record it.
    const took = makeEl('td', s.elapsedMs === null ? '—' : formatElapsed(s.elapsedMs));
    took.title = s.elapsedMs === null ? 'Not recorded (submitted before the timer existed)' : 'Time on the question before this Submit';
    row.appendChild(took);
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
  showInSubmissionsPanel(makeEl('p', `Your ${label} submissions, newest first:`, 'submissions-heading'), scroller);
}

// The page address records which submission is loaded
// (problem.html?slug=…&submission=<id>), so a reload reopens it.
// replaceState changes the address without reloading or adding history.
/**
 * @param {string | null} id - The submission to name in the address, or
 *   null to take it out.
 * @returns {void}
 */
function setSubmissionInAddress(id) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set('submission', id);
  else url.searchParams.delete('submission');
  history.replaceState(null, '', url);
}

/**
 * One saved Submit in full, as GET /api/submissions/:id sends it. Only the
 * fields this page uses are listed.
 *
 * @typedef {object} SubmissionRecord
 * @property {string} id
 * @property {string} question
 * @property {string} language
 * @property {string} code
 */

/**
 * @param {string} id - The submission's id.
 * @returns {Promise<SubmissionRecord>} The record.
 * @throws {Error} If the request fails (rejects the promise).
 */
async function fetchSubmission(id) {
  const res = await fetch(`/api/submissions/${encodeURIComponent(id)}`);
  const record = await res.json();
  if (!res.ok) throw new Error(record.error || `HTTP ${res.status}`);
  return record;
}

/**
 * Why a submission can't be loaded on this page, or null if it can.
 *
 * @param {SubmissionRecord} record - The submission.
 * @returns {string | null} The reason, or null.
 */
function whyNotLoadable(record) {
  if (record.question !== slug) return `That submission is for a different question (${record.question}).`;
  if (![...languageSelect.options].some((o) => o.value === record.language)) {
    const label = LANGUAGE_LABELS[record.language] || record.language;
    return `${label} is turned off in the language menu. Turn it on to load this submission.`;
  }
  return null;
}

// Switches to the submission's language (without making it the default),
// puts its code in the editor, and records it in the page address.
/**
 * @param {SubmissionRecord} record - The submission.
 * @returns {Promise<void>}
 */
async function applySubmission(record) {
  await switchLanguage(record.language, { chosenByUser: false });
  // The editor exists once a language has been shown, which switchLanguage just did.
  /** @type {CodeMirror.Editor} */ (editor).setValue(normalizeIndentation(record.code));
  setSubmissionInAddress(record.id);
  if (submissionsNotice) {
    submissionsNotice = null;
    refreshSubmissions();
  }
}

// The Submissions tab's Load button. Asks first only if that language's
// current code has been edited (it's neither the starter code nor already
// this submission's code).
/**
 * @param {string} id - The submission's id.
 * @returns {Promise<void>} Never rejects: failures are shown in an alert.
 */
async function loadSubmissionIntoEditor(id) {
  let record;
  try {
    record = await fetchSubmission(id);
  } catch (err) {
    alert(`Couldn't load that submission: ${/** @type {Error} */ (err).message}`);
    return;
  }
  const problemWithIt = whyNotLoadable(record);
  if (problemWithIt) {
    alert(problemWithIt);
    return;
  }
  const label = LANGUAGE_LABELS[record.language] || record.language;
  // The Submissions tab only exists once the question and a language are shown.
  const starter = /** @type {PublicProblem} */ (problem).starterCode[record.language] ?? '';
  const current = record.language === currentLanguage ? /** @type {CodeMirror.Editor} */ (editor).getValue() : codeByLanguage[record.language] ?? starter;
  if (current !== starter && current !== record.code && !confirm(`Replace your current ${label} code with this submission's code?`)) {
    return;
  }
  await applySubmission(record);
}

// On page load: if the address names a submission, open it. Nothing has
// been edited yet, so there's nothing to confirm. If it can't be opened,
// the page stays as it opened, the address is cleaned up, and the
// Submissions tab says why.
/** @returns {Promise<void>} Never rejects. */
async function openSubmissionFromAddress() {
  const id = new URLSearchParams(window.location.search).get('submission');
  if (!id) return;
  let reason;
  try {
    const record = await fetchSubmission(id);
    reason = whyNotLoadable(record);
    if (!reason) {
      await applySubmission(record);
      // The question now opens in that submission's language, which by
      // definition has a Submit, so the opening-tab rule says Applying.
      setDescriptionTab('applying');
      return;
    }
  } catch (err) {
    reason = `Couldn't open submission ${id} from the page address: ${/** @type {Error} */ (err).message}.`;
  }
  submissionsNotice = reason;
  setSubmissionInAddress(null);
  setDescriptionTab('submissions');
  refreshSubmissions();
}

/**
 * Loads the question named by ?slug= and opens it, then wires up Run,
 * Submit, Skip and language-select. Runs once, as the page loads.
 *
 * @returns {Promise<void>} Never rejects: failures are shown in the title.
 */
async function init() {
  // The profile decides which languages there are and which one opens, so
  // it's loaded before anything else uses them. Never rejects.
  const profilePromise = loadProfile();
  if (!slug) {
    await profilePromise;
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
    titleEl.textContent = `Failed to load problem: ${/** @type {Error} */ (err).message}`;
    return;
  }
  await profilePromise;

  renderHeader(await labelsPromise);
  // Opening the question in its initial language applies the same
  // per-language rules as switching to one (showLanguage).
  await showLanguage(pickInitialLanguage(/** @type {PublicProblem} */ (problem)));

  languageSelect.addEventListener('change', () => handleLanguageChange(languageSelect));
  runBtn.addEventListener('click', () => execute('run', runBtn));
  submitBtn.addEventListener('click', () => execute('submit', submitBtn));
  // Stub: real skip logic (advance to next problem, record as missed, etc.) comes later.
  skipBtn.addEventListener('click', () => alert('Skip button pressed'));

  // Last, so the buttons above are wired up without waiting for this fetch.
  openSubmissionFromAddress();
}

init();

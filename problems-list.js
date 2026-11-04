// The problem list (index.html): your queue in order, then your backlog
// (spaced-repetition plan, step 9; D7), one row per (question, language)
// pair, from GET /api/queue. If that can't be had, a message and every
// question by title (GET /api/questions), as before step 9 (detail 7).
// Rows are built from elements with textContent, never innerHTML, so text
// from question files can't inject markup.

// index.html has both elements, hence the casts. textContent is given a
// number, which the browser turns into text; the cast says that's intended.
/** @type {HTMLElement} */ (document.getElementById('year')).textContent = /** @type {any} */ (new Date().getFullYear());

const rowsEl = /** @type {HTMLTableSectionElement} */ (document.getElementById('problem-rows')); // the <tbody>
const nextLineEl = /** @type {HTMLElement} */ (document.getElementById('next-line'));

// Each language's name as shown: the same names as problem-page.js's
// LANGUAGE_LABELS. Another name, since the browser files share one global
// scope as far as TypeScript knows (they're plain scripts, not modules).
/** @type {Record<string, string>} */
const LANGUAGE_NAMES = { javascript: 'JavaScript', python: 'Python', cpp: 'C++', java: 'Java', d: 'D' };

/**
 * What the list shows of a question (GET /api/questions, GET /api/queue).
 *
 * @typedef {object} QuestionSummary
 * @property {string} slug - Its file name without .json (GET /api/questions only).
 * @property {string} title
 * @property {string} difficulty - "Easy", "Medium" or "Hard".
 * @property {string[]} topics
 * @property {string[]} sources
 */

/**
 * One line of GET /api/queue.
 *
 * @typedef {object} QueuedPair
 * @property {string} question - The question's file name without .json.
 * @property {string} language - One of LANGUAGE_NAMES's keys.
 * @property {'queue' | 'backlog'} where - In the queue, or waiting in the backlog.
 * @property {'yes' | 'no'} [pass] - Queue only: the latest result, if any.
 * @property {number} [passesInARow] - Queue only.
 * @property {string} title
 * @property {string} difficulty
 * @property {string[]} topics
 * @property {string[]} sources
 */

/**
 * The CSS class for a difficulty badge.
 *
 * @param {string} difficulty - "Easy", "Medium" or "Hard", from the
 *   question. (A missing one gives "difficulty-".)
 * @returns {string} e.g. "difficulty-easy" (style.css colours these).
 */
function difficultyClass(difficulty) {
  return `difficulty-${String(difficulty || '').toLowerCase()}`;
}

/**
 * The address that opens a question, in a language if one is given (step
 * 9, detail 6: problem.html's ?language=).
 *
 * @param {string} slug - The question.
 * @param {string} [language] - The language; the learner's usual one if
 *   left out.
 * @returns {string} e.g. "/problem.html?slug=two-sum&language=cpp".
 */
function questionUrl(slug, language) {
  const params = new URLSearchParams({ slug });
  if (language) params.set('language', language);
  return `/problem.html?${params}`;
}

/**
 * A table cell holding text.
 *
 * @param {string} text - What it says.
 * @param {string} [className] - Its class, if any.
 * @param {string} [title] - Its tooltip, if any.
 * @returns {HTMLTableCellElement} The cell.
 */
function textCell(text, className, title) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  if (title) td.title = title;
  return td;
}

/**
 * What the Last result column says of a pair (step 9, detail 4).
 *
 * @param {QueuedPair} pair - The pair.
 * @returns {{ text: string, className: string, title: string }} Its text,
 *   class and tooltip.
 */
function lastResult(pair) {
  if (pair.where === 'backlog') return { text: 'new', className: 'result-new', title: 'Not started: waiting in your backlog' };
  if (pair.pass === 'yes') {
    const n = /** @type {number} */ (pair.passesInARow); // queue elements always have it
    return { text: `✓ ×${n}`, className: 'status-pass', title: `Passed ${n} ${n === 1 ? 'time' : 'times'} in a row` };
  }
  if (pair.pass === 'no') return { text: '✗', className: 'status-fail', title: 'The latest attempt failed or was skipped' };
  return { text: '—', className: '', title: 'In your queue, not submitted yet' };
}

/**
 * Adds one row to the table, opening `href` when clicked.
 *
 * @param {HTMLTableCellElement[]} cells - The row's cells, in column order.
 * @param {string} href - Where clicking it goes.
 * @returns {void}
 */
function addRow(cells, href) {
  const row = document.createElement('tr');
  row.className = 'problem-row';
  row.append(...cells);
  row.addEventListener('click', () => window.location.assign(href));
  rowsEl.appendChild(row);
}

/**
 * The cells every row ends with: sources and topics as bubbles, and the
 * difficulty badge.
 *
 * @param {Omit<QuestionSummary, 'slug'>} question - The row's question,
 *   or a queue line, which has the same fields.
 * @param {Awaited<ReturnType<typeof loadLabels>>} labels - From bubbles.js.
 * @returns {HTMLTableCellElement[]} The two cells.
 */
function questionCells(question, labels) {
  const bubblesCell = textCell('', 'problem-bubbles');
  const bubbles = document.createElement('span');
  bubbles.className = 'bubbles';
  bubblesCell.appendChild(bubbles);
  renderBubbles(bubbles, question, labels);
  const difficultyCell = textCell('');
  const badge = document.createElement('span');
  badge.className = `badge ${difficultyClass(question.difficulty)}`;
  badge.textContent = question.difficulty;
  difficultyCell.appendChild(badge);
  return [bubblesCell, difficultyCell];
}

/**
 * Fills the page from GET /api/queue's pairs: the Next shortcut above the
 * table (detail 5), then one row per pair, next first.
 *
 * @param {QueuedPair[]} pairs - The pairs, next first.
 * @param {Awaited<ReturnType<typeof loadLabels>>} labels - From bubbles.js.
 * @returns {void}
 */
function showQueue(pairs, labels) {
  rowsEl.replaceChildren();
  if (!pairs.length) {
    nextLineEl.textContent = 'Nothing to practise: no question can be opened in the languages you have turned on.';
    return;
  }
  const first = pairs[0];
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'primary';
  nextBtn.textContent = `Next: ${first.title}, in ${LANGUAGE_NAMES[first.language] || first.language}`;
  nextBtn.title = 'Open the first question in your queue';
  nextBtn.addEventListener('click', () => window.location.assign(questionUrl(first.question, first.language)));
  nextLineEl.replaceChildren(nextBtn);

  pairs.forEach(
    /**
     * Adds one pair's row.
     *
     * @param {QueuedPair} pair - The pair.
     * @param {number} i - Its position, 0 for next.
     * @returns {void}
     */
    (pair, i) => {
      const result = lastResult(pair);
      addRow([
        textCell(String(i + 1), 'queue-position'),
        textCell(pair.title, 'problem-title'),
        textCell(LANGUAGE_NAMES[pair.language] || pair.language),
        textCell(result.text, result.className, result.title),
        ...questionCells(pair, labels),
      ], questionUrl(pair.question, pair.language));
    },
  );
}

/**
 * When the queue can't be listed (detail 7): says why above the table,
 * then lists every question by title, opening in the learner's usual
 * language. Nothing about the queue is guessed.
 *
 * @param {string} why - The queue's error, e.g. from an invalid order.json.
 * @param {Awaited<ReturnType<typeof loadLabels>>} labels - From bubbles.js.
 * @returns {Promise<void>} Never rejects: a failure here is shown in the table.
 */
async function showAllQuestions(why, labels) {
  nextLineEl.textContent = `Your queue couldn't be listed: ${why}. Every question, by title:`;
  try {
    const res = await fetch('/api/questions');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    /** @type {QuestionSummary[]} */
    const questions = await res.json();
    rowsEl.replaceChildren();
    for (const q of questions) {
      addRow([textCell(''), textCell(q.title, 'problem-title'), textCell(''), textCell(''), ...questionCells(q, labels)], questionUrl(q.slug));
    }
  } catch (err) {
    rowsEl.replaceChildren();
    const row = rowsEl.insertRow();
    const cell = textCell(`Failed to load problems: ${/** @type {Error} */ (err).message}`);
    cell.colSpan = 6;
    row.appendChild(cell);
  }
}

/**
 * Fills the page: the queue if it can be listed, otherwise every question.
 *
 * @returns {Promise<void>} Never rejects: failures are shown on the page.
 */
async function loadProblems() {
  // Fetched alongside the list; loadLabels() (bubbles.js) never rejects.
  const labelsPromise = loadLabels();
  let pairs;
  let why = '';
  try {
    const res = await fetch('/api/queue');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    pairs = /** @type {QueuedPair[]} */ (data.pairs);
  } catch (err) {
    why = /** @type {Error} */ (err).message;
  }
  const labels = await labelsPromise;
  if (pairs) showQueue(pairs, labels);
  else await showAllQuestions(why, labels);
}

loadProblems();

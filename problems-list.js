// The problem list (index.html): your queue in order, then your backlog
// (spaced-repetition plan, step 9; D7), one row per (question, language)
// pair, from GET /api/queue. If that can't be had, a message and every
// question by title (GET /api/questions), as before step 9 (detail 7).
// With ?view=bank, the question bank instead (#133,
// docs/plans/question-bank-page.md): every question, one row each, with
// where each language of it is in your queue and backlog, from GET
// /api/question-bank; only for a profile with canSeeQuestionBank.
// Rows are built from elements with textContent, never innerHTML, so text
// from question files can't inject markup.

// index.html has both elements, hence the casts. textContent is given a
// number, which the browser turns into text; the cast says that's intended.
/** @type {HTMLElement} */ (document.getElementById('year')).textContent = /** @type {any} */ (new Date().getFullYear());

const rowsEl = /** @type {HTMLTableSectionElement} */ (document.getElementById('problem-rows')); // the <tbody>
const nextLineEl = /** @type {HTMLElement} */ (document.getElementById('next-line'));
const headEl = /** @type {HTMLTableSectionElement} */ (document.getElementById('problem-head')); // the <thead>
const viewSwitchEl = /** @type {HTMLElement} */ (document.getElementById('view-switch'));

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

// --- The question bank (#133) ------------------------------------------------

/**
 * Where one pair is (GET /api/question-bank).
 *
 * @typedef {object} BankPair
 * @property {'queue' | 'backlog'} where - The file it's in.
 * @property {number} [position] - In the queue and listed: its number on
 *   the problem list, 1 next.
 * @property {boolean} listed - False for a language turned off: the list
 *   doesn't show it.
 */

/**
 * One question of GET /api/question-bank.
 *
 * @typedef {object} BankQuestion
 * @property {string} slug - Its file name without .json.
 * @property {string} created - UTC ISO 8601.
 * @property {string[]} languages - The languages it has.
 * @property {string} title
 * @property {string} difficulty
 * @property {string[]} topics
 * @property {string[]} sources
 * @property {Record<string, BankPair>} pairs - By language; a language in
 *   neither file isn't there.
 */

/**
 * GET /api/question-bank's answer.
 *
 * @typedef {object} QuestionBank
 * @property {string[]} languages - The columns, in order.
 * @property {BankQuestion[]} questions - By created, then slug.
 */

/**
 * The cell for one language of a question in the bank: "#3" (in the queue,
 * third on the list), "backlog", "—" (in neither), or empty if the question
 * doesn't have that language. Each mark links to the question in that
 * language. A pair in a language turned off is dimmed: it's in a file, but
 * not on the list.
 *
 * @param {BankQuestion} question - The row's question.
 * @param {string} language - The column's language.
 * @returns {HTMLTableCellElement} The cell.
 */
function bankLanguageCell(question, language) {
  const name = LANGUAGE_NAMES[language] || language;
  if (!question.languages.includes(language)) return textCell('', 'bank-pair', `${question.title} has no ${name}`);
  const pair = question.pairs[language];
  let text = '—';
  let title = `In neither your queue nor your backlog, in ${name}`;
  if (pair && pair.where === 'queue') {
    text = pair.position ? `#${pair.position}` : 'queue';
    title = pair.position ? `In your queue in ${name}: number ${pair.position} on your list` : `In your queue in ${name}`;
  } else if (pair) {
    text = 'backlog';
    title = `In your backlog in ${name}`;
  }
  if (pair && !pair.listed) title += `, but ${name} is turned off, so your list doesn't show it`;
  const cell = textCell('', `bank-pair${pair ? '' : ' bank-neither'}${pair && !pair.listed ? ' bank-off' : ''}`);
  const link = document.createElement('a');
  link.href = questionUrl(question.slug, language);
  link.textContent = text;
  link.title = `${title}. Opens it in ${name}.`;
  // The row's own click opens the usual language; this one is the link's.
  link.addEventListener('click', (event) => event.stopPropagation());
  cell.appendChild(link);
  return cell;
}

/**
 * Shows the question bank: its columns, a line saying what a row does, and
 * one row per question, which opens it in the learner's usual language.
 *
 * @param {QuestionBank} bank - From GET /api/question-bank.
 * @param {Awaited<ReturnType<typeof loadLabels>>} labels - From bubbles.js.
 * @returns {void}
 */
function showBank(bank, labels) {
  nextLineEl.textContent = 'Every question, in the order they were added, and where each language of it is: #n in your queue, backlog, or — for neither. '
    + 'Opening a question changes nothing. A Submit or Skip moves it: from the backlog or neither, to near the front of your queue; from your queue, further back from where it is now.';
  rowsEl.replaceChildren();
  for (const q of bank.questions) {
    const slugCell = textCell(q.slug, 'bank-slug');
    const created = textCell(q.created.slice(0, 10), 'bank-created', q.created);
    addRow([slugCell, textCell(q.title, 'problem-title'), ...bank.languages.map((l) => bankLanguageCell(q, l)), ...questionCells(q, labels), created], questionUrl(q.slug));
  }
}

/**
 * Replaces the table's header with the bank's columns.
 *
 * @param {string[]} languages - The language columns, in order.
 * @returns {number} How many columns there are, for a message row.
 */
function showBankHead(languages) {
  const row = document.createElement('tr');
  const names = ['Slug', 'Title', ...languages.map((l) => LANGUAGE_NAMES[l] || l), 'Sources & topics', 'Difficulty', 'Created'];
  for (const name of names) {
    const th = document.createElement('th');
    th.textContent = name;
    row.appendChild(th);
  }
  headEl.replaceChildren(row);
  return names.length;
}

/**
 * Fills the page with the question bank (GET /api/question-bank), or says
 * why it can't (a 403 for anyone but the owner, or an invalid file).
 *
 * @returns {Promise<void>} Never rejects: failures are shown on the page.
 */
async function loadBank() {
  document.title = 'MaxRecall Code — Question bank';
  // Wider than the queue's 800px: more columns (style.css, .bank-view).
  /** @type {HTMLElement} */ (document.querySelector('.list-wrap')).classList.add('bank-view');
  const labelsPromise = loadLabels();
  try {
    const res = await fetch('/api/question-bank');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const bank = /** @type {QuestionBank} */ (data);
    showBankHead(bank.languages);
    showBank(bank, await labelsPromise);
  } catch (err) {
    nextLineEl.textContent = '';
    rowsEl.replaceChildren();
    const cell = textCell(`The question bank couldn't be shown: ${/** @type {Error} */ (err).message}`);
    cell.colSpan = headEl.rows[0] ? headEl.rows[0].cells.length : 6;
    rowsEl.insertRow().appendChild(cell);
  }
}

/**
 * Shows the link between the two views: to the bank from the queue, for
 * a profile with canSeeQuestionBank, and back to the queue from the bank.
 *
 * @param {boolean} inBank - Whether the bank is shown.
 * @returns {Promise<void>} Never rejects: without the profile, no link to
 *   the bank.
 */
async function showViewSwitch(inBank) {
  const link = document.createElement('a');
  if (inBank) {
    link.href = '/';
    link.textContent = '← Your queue';
  } else {
    try {
      const res = await fetch('/api/profile');
      if (!res.ok || !(await res.json()).canSeeQuestionBank) return;
    } catch {
      return;
    }
    link.href = '/?view=bank';
    link.textContent = 'Question bank: every question →';
  }
  viewSwitchEl.replaceChildren(link);
}

const inBank = new URLSearchParams(window.location.search).get('view') === 'bank';
showViewSwitch(inBank);
if (inBank) loadBank();
else loadProblems();

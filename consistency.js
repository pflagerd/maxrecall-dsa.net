'use strict';

// The consistency check (docs/plans/spaced-repetition.md, D5; step 10):
// compares the sources of truth (questions/, questions/renames.json, and
// each user's profile.json, order.json, backlog.json and submission
// records) and returns what disagrees. It only reports: nothing here
// changes a file, since a question file can be missing for a harmless
// reason, such as a branch that doesn't have it yet.
//
// Pure functions only: reading the files is scripts/consistency-check.js's
// job (readSources()), shared by `make consistency-check` and server start.

const { parseQueueFiles, backlogPairs, passFor } = require('./order');
const { parseProfile } = require('./profile');

/**
 * One thing the check found. error: the files are invalid (the server
 * already refuses that user's Run and Submit); warning: something
 * disagrees, often for a harmless reason; info: kept on purpose (step 10,
 * detail 2).
 *
 * @typedef {object} Finding
 * @property {'error' | 'warning' | 'info'} level - How serious.
 * @property {string} email - Whose files, or "" for questions/renames.json.
 * @property {string} file - Which file, e.g. "order.json" or
 *   "submissions/<id>.json".
 * @property {string} where - Which element, e.g. "queue[3]", or "".
 * @property {string} message - What's wrong.
 */

/**
 * What check 6 needs of a submission record (users.js, SavedSubmission).
 *
 * @typedef {object} RecordSummary
 * @property {string} submittedAt - UTC ISO 8601, so text order is time order.
 * @property {string} question - The question's name when it was saved.
 * @property {string} language - One of LANGUAGES.
 * @property {string | null} status - The verdict; null for a Skip.
 * @property {'yes'} [skipped] - "yes" for a Skip.
 */

/**
 * One user's files, as read by readSources().
 *
 * @typedef {object} UserSources
 * @property {string} email - The user.
 * @property {string | undefined} profileText - profile.json, or undefined.
 * @property {string | undefined} orderText - order.json, or undefined.
 * @property {string | undefined} backlogText - backlog.json, or undefined.
 * @property {RecordSummary[]} records - Every readable record.
 * @property {{ id: string, message: string }[]} unreadable - Records that
 *   couldn't be read, and why.
 */

/**
 * Everything the check compares.
 *
 * @typedef {object} Sources
 * @property {import('./order').QuestionInfo[]} questions - Every question.
 * @property {string | undefined} renamesText - questions/renames.json, or
 *   undefined if there's none (no renames yet).
 * @property {UserSources[]} users - Every user (users.js, listUsers()).
 */

/**
 * Reads questions/renames.json (D5): { "old-name": "new-name" }, each a
 * question's file name without .json (step 10, detail 4).
 *
 * @param {string | undefined} text - The file's contents, or undefined if
 *   there's none.
 * @returns {Record<string, string>} The renames; empty for no file.
 * @throws {Error} If it isn't valid JSON, not an object, a name isn't a
 *   non-empty string, a question is renamed to itself, or renames loop.
 */
function parseRenames(text) {
  if (text === undefined) return {};
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`not valid JSON (${/** @type {Error} */ (err).message})`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('must be a JSON object, { "old-name": "new-name" }');
  for (const [from, to] of Object.entries(raw)) {
    if (from === '' || typeof to !== 'string' || to === '') throw new Error(`"${from}" must be renamed to a question's file name`);
    if (from === to) throw new Error(`"${from}" is renamed to itself`);
  }
  const renames = /** @type {Record<string, string>} */ (raw);
  for (const from of Object.keys(renames)) {
    const seen = new Set([from]);
    for (let name = renames[from]; Object.hasOwn(renames, name); name = renames[name]) {
      if (seen.has(name)) throw new Error(`renames loop: ${[...seen, name].join(' → ')}`);
      seen.add(name);
    }
  }
  return renames;
}

/**
 * A question's current name, following renames (a → b, then b → c gives c).
 *
 * @param {string} name - A name, maybe an old one.
 * @param {Record<string, string>} renames - From parseRenames(), so it
 *   doesn't loop.
 * @returns {string} The name it has now.
 */
function currentName(name, renames) {
  let current = name;
  while (Object.hasOwn(renames, current)) current = renames[current];
  return current;
}

/**
 * What a pair's pass and passesInARow should be, from its records (check 6;
 * step 10, detail 6; the core of a later recalculation): pass from the
 * latest record (only Accepted is "yes"; a Skip is "no", D8), and
 * passesInARow the number of Accepted records in a row at the end.
 *
 * @param {RecordSummary[]} records - One pair's records, in any order.
 * @returns {{ pass: 'yes' | 'no', passesInARow: number } | null} What the
 *   records say, or null if there are none.
 */
function expectedProgress(records) {
  if (!records.length) return null;
  const sorted = [...records].sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0));
  /**
   * Whether one record is a pass.
   *
   * @param {RecordSummary} r - The record.
   * @returns {boolean} True for an Accepted Submit.
   */
  const passed = (r) => r.skipped !== 'yes' && passFor(/** @type {string} */ (r.status)) === 'yes';
  let passesInARow = 0;
  for (let i = sorted.length - 1; i >= 0 && passed(sorted[i]); i--) passesInARow++;
  return { pass: passed(sorted[sorted.length - 1]) ? 'yes' : 'no', passesInARow };
}

/**
 * Checks one user's files (checks 1 to 6 of D5).
 *
 * @param {UserSources} user - The user's files.
 * @param {import('./order').QuestionInfo[]} questions - Every question.
 * @param {Record<string, string>} renames - From parseRenames().
 * @param {boolean} verbose - List each backlog pair with records, rather
 *   than one summary (step 10, detail 1).
 * @returns {Finding[]} What was found, in check order.
 */
function checkUser(user, questions, renames, verbose) {
  /** @type {Finding[]} */
  const findings = [];
  /**
   * Adds a finding for this user.
   *
   * @param {Finding['level']} level - How serious.
   * @param {string} file - Which file.
   * @param {string} where - Which element, or "".
   * @param {string} message - What's wrong.
   * @returns {void}
   */
  const add = (level, file, where, message) => {
    findings.push({ level, email: user.email, file, where, message });
  };
  for (const { id, message } of user.unreadable) add('warning', `submissions/${id}.json`, '', `can't be read, so check 6 leaves it out: ${message}`);

  let profile = null;
  try {
    profile = parseProfile(user.profileText);
  } catch (err) {
    add('error', 'profile.json', '', `${/** @type {Error} */ (err).message.replace(/^profile\.json: /, '')} (checks 4 and 5 not run)`);
  }

  // Checks 1 and 2: the files themselves, and no pair twice (order.js).
  let files;
  try {
    files = parseQueueFiles(user.orderText, user.backlogText);
  } catch (err) {
    const m = /^(order\.json|backlog\.json): ([\s\S]*)$/.exec(/** @type {Error} */ (err).message);
    add('error', m ? m[1] : 'order.json', '', `${m ? m[2] : /** @type {Error} */ (err).message} (checks 3 to 6 not run)`);
    return findings;
  }

  const bySlug = new Map(questions.map((q) => [q.slug, q]));
  const key = (/** @type {{ question: string, language: string }} */ p) => `${p.question}/${p.language}`;
  const elements = [
    ...files.order.queue.map((e, i) => ({ e, file: 'order.json', where: `queue[${i}]` })),
    ...files.backlog.backlog.map((e, i) => ({ e, file: 'backlog.json', where: `backlog[${i}]` })),
  ];

  // Check 3: deleted or renamed questions, and languages a question lost.
  for (const { e, file, where } of elements) {
    const q = bySlug.get(e.question);
    if (!q) {
      const to = renames[e.question];
      add('warning', file, where, to
        ? `${e.question} was renamed to ${currentName(to, renames)}; make rename-question (step 11) updates the reference`
        : `${e.question}: no such question (deleted, or not on this branch?); kept, and skipped when choosing what's next`);
    } else if (!q.languages.includes(e.language)) {
      add('warning', file, where, `${e.question} has no ${e.language} starter code; kept, and skipped when choosing what's next`);
    }
  }

  if (profile) {
    // Check 4: every pair the learner could do is in one of the files. Not
    // for a chosen backlog (step 13, detail 2): there, a pair not chosen is
    // meant to be in neither, and backlogPairs() is empty.
    const present = new Set(elements.map(({ e }) => key(e)));
    for (const p of backlogPairs(questions, profile)) {
      if (!present.has(key(p))) add('warning', 'backlog.json', '', `${p.question} in ${p.language} is in neither file; the next server start appends it to the backlog`);
    }
    // Check 5: languages the profile no longer allows (detail 5: not ones
    // merely turned off, which is everyday use).
    for (const { e, file, where } of elements) {
      if (!profile.allowedLanguages.includes(e.language)) {
        add('info', file, where, `${e.question} in ${e.language}: the profile no longer allows ${e.language}; kept on purpose (D2), and skipped`);
      }
    }
  }

  // Check 6: the records agree. Old names are followed through renames.
  // Records of deleted questions are ignored: no element looks them up,
  // and an element whose question is missing is check 3's (comparing it
  // here too would only repeat that).
  /** @type {Map<string, RecordSummary[]>} */
  const history = new Map();
  for (const r of user.records) {
    const question = currentName(r.question, renames);
    const k = key({ question, language: r.language });
    history.set(k, [...(history.get(k) ?? []), r]);
  }
  files.order.queue.forEach(
    /**
     * Compares one queue element with its records.
     *
     * @param {import('./order').QueueElement} e - The element.
     * @param {number} i - Its position.
     * @returns {void}
     */
    (e, i) => {
      if (!bySlug.has(e.question)) return; // check 3 reported it
      const records = history.get(key(e)) ?? [];
      const expected = expectedProgress(records);
      const where = `queue[${i}]`;
      const pair = `${e.question} in ${e.language}`;
      if (!expected) {
        if (e.pass !== undefined) add('warning', 'order.json', where, `${pair}: pass is "${e.pass}", but there are no records of it`);
      } else if (e.pass === undefined) {
        add('warning', 'order.json', where, `${pair} has ${records.length} ${records.length === 1 ? 'record' : 'records'} but no pass; they say pass "${expected.pass}", passesInARow ${expected.passesInARow}`);
      } else if (e.pass !== expected.pass || e.passesInARow !== expected.passesInARow) {
        add('warning', 'order.json', where, `${pair}: the file says pass "${e.pass}", passesInARow ${e.passesInARow}; the records say "${expected.pass}", ${expected.passesInARow}`);
      }
    },
  );
  const inBacklog = files.backlog.backlog
    .map((e, i) => ({ e, where: `backlog[${i}]`, n: (history.get(key(e)) ?? []).length }))
    .filter(({ n }) => n > 0);
  if (verbose) {
    for (const { e, where, n } of inBacklog) add('warning', 'backlog.json', where, `${e.question} in ${e.language} has ${n} ${n === 1 ? 'record' : 'records'} but is still in the backlog`);
  } else if (inBacklog.length) {
    const named = inBacklog.slice(0, 3).map(({ e }) => `${e.question} in ${e.language}`).join(', ');
    const more = inBacklog.length > 3 ? `, and ${inBacklog.length - 3} more` : '';
    add('warning', 'backlog.json', '', `${inBacklog.length} ${inBacklog.length === 1 ? 'pair has' : 'pairs have'} records but ${inBacklog.length === 1 ? 'is' : 'are'} still in the backlog (e.g. submitted before the queue existed, before step 6): ${named}${more}. make consistency-check VERBOSE=1 lists each`);
  }
  return findings;
}

/**
 * The consistency check (D5): every finding, for every user.
 *
 * @param {Sources} sources - From readSources().
 * @param {{ verbose?: boolean }} [options] - verbose: list each backlog
 *   pair with records rather than one summary per user (detail 1).
 * @returns {Finding[]} What was found: questions/renames.json's first, then
 *   each user's, in sources.users' order.
 */
function checkConsistency(sources, { verbose = false } = {}) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Record<string, string>} */
  let renames = {};
  try {
    renames = parseRenames(sources.renamesText);
  } catch (err) {
    findings.push({ level: 'error', email: '', file: 'questions/renames.json', where: '', message: `${/** @type {Error} */ (err).message} (renames ignored)` });
  }
  for (const user of sources.users) findings.push(...checkUser(user, sources.questions, renames, verbose));
  return findings;
}

/**
 * How many findings there are of each level.
 *
 * @param {Finding[]} findings - Findings.
 * @returns {{ error: number, warning: number, info: number }} The counts.
 */
function countLevels(findings) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.level]++;
  return counts;
}

/**
 * One finding as a line of text, e.g. "warning order.json queue[3]: …".
 *
 * @param {Finding} f - The finding.
 * @returns {string} The line (without the user, which callers group by).
 */
function formatFinding(f) {
  return `${f.level} ${f.file}${f.where ? ` ${f.where}` : ''}: ${f.message}`;
}

/**
 * The counts as words, e.g. "1 error, 2 warnings, 0 info".
 *
 * @param {{ error: number, warning: number, info: number }} counts - From countLevels().
 * @returns {string} The words.
 */
function describeCounts({ error, warning, info }) {
  return `${error} ${error === 1 ? 'error' : 'errors'}, ${warning} ${warning === 1 ? 'warning' : 'warnings'}, ${info} info`;
}

/**
 * The rename log after renaming `from` to `to` (step 11, detail 4), kept so
 * every value is a current question's name: names that led to `from` now
 * lead to `to`, and renaming back (to was an old name) removes that entry,
 * so no loop is ever written.
 *
 * @param {Record<string, string>} renames - From parseRenames() (not changed).
 * @param {string} from - The name being renamed, a current question's.
 * @param {string} to - Its new name.
 * @returns {Record<string, string>} The new rename log.
 */
function updateRenames(renames, from, to) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const [old, current] of Object.entries(renames)) {
    if (old !== to) result[old] = current === from ? to : current;
  }
  result[from] = to;
  return result;
}

module.exports = { checkConsistency, expectedProgress, parseRenames, updateRenames, currentName, countLevels, formatFinding, describeCounts };

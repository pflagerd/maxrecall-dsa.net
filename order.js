'use strict';

// A learner's queue and backlog: users/<email>/order.json and backlog.json
// (docs/plans/spaced-repetition.md, D1, D5 and D6; the layout was decided
// 2026-11-03).
//
//   order.json:   { "schemaVersion": 1, "submitsSinceLastIntroduced": 0,
//                   "queue": [{ "question", "language", "pass"?, "passesInARow" }] }
//   backlog.json: { "schemaVersion": 1, "backlog": [{ "question", "language" }] }
//
// The front of the queue is the next question. A pair (question, language)
// is in the queue or the backlog, never both. Invalid files fail closed, as
// the profile does: a mistake must refuse rather than guess.
//
// Pure functions only: reading and writing the files is users.js's job.

const { LANGUAGES } = require('./profile');
const { advance } = require('./advance');
const { introduceCount } = require('./introduce');

/** The order.json and backlog.json format this file reads and writes. @type {number} */
const SCHEMA_VERSION = 1;

/**
 * One (question, language) pair in the queue.
 *
 * @typedef {object} QueueElement
 * @property {string} question - The question's file name without .json.
 * @property {string} language - One of LANGUAGES.
 * @property {'yes' | 'no'} [pass] - The latest Submit's result; absent
 *   until the pair is first submitted (D3).
 * @property {number} passesInARow - Passes in a row: k in advance.js (D4).
 */

/**
 * order.json.
 *
 * @typedef {object} OrderFile
 * @property {number} schemaVersion - SCHEMA_VERSION.
 * @property {number} submitsSinceLastIntroduced - Submits and Skips since a
 *   pair last came in from the backlog (D6, introduce.js).
 * @property {QueueElement[]} queue - The queue, next question first.
 */

/**
 * One pair waiting in the backlog.
 *
 * @typedef {{ question: string, language: string }} BacklogElement
 */

/**
 * backlog.json.
 *
 * @typedef {object} BacklogFile
 * @property {number} schemaVersion - SCHEMA_VERSION.
 * @property {BacklogElement[]} backlog - In the order they'll come in.
 */

/**
 * What allowedPairs() needs to know about a question.
 *
 * @typedef {object} QuestionInfo
 * @property {string} slug - Its file name without .json.
 * @property {string} created - When it was created, UTC ISO 8601 (step 3).
 * @property {string[]} languages - The languages it can be answered in
 *   (its starterCode's keys).
 */

/**
 * Why order.json or backlog.json can't be used. The server refuses that
 * learner's Run and Submit with its message rather than guess.
 */
class QueueFileError extends Error {
  /**
   * @param {string} file - "order.json" or "backlog.json".
   * @param {string} message - What's wrong, naming the field.
   */
  constructor(file, message) {
    super(`${file}: ${message}`);
    this.code = 'INVALID_QUEUE';
  }
}

/**
 * Whether value is a plain object (not null, not an array).
 *
 * @param {unknown} value - The value.
 * @returns {value is Record<string, unknown>} True for a plain object.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Whether value is a whole number, 0 or more.
 *
 * @param {unknown} value - The value.
 * @returns {value is number} True if so.
 */
function isCount(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0;
}

/**
 * Throws if an object has a field this format doesn't know.
 *
 * @param {string} file - "order.json" or "backlog.json", for the message.
 * @param {Record<string, unknown>} object - The object.
 * @param {string[]} known - Its field names.
 * @param {string} where - Where it is, for the message ("" for the top level).
 * @returns {void}
 * @throws {QueueFileError} Naming the first unknown field.
 */
function rejectUnknownFields(file, object, known, where) {
  const unknown = Object.keys(object).find((key) => !known.includes(key));
  if (unknown !== undefined) throw new QueueFileError(file, `unknown field "${where}${unknown}"`);
}

/**
 * Checks one pair's question and language, and that it isn't a second copy.
 *
 * @param {string} file - "order.json" or "backlog.json", for the message.
 * @param {Record<string, unknown>} element - The element.
 * @param {string} where - Where it is, e.g. "queue[3]".
 * @param {Map<string, string>} seen - The pairs seen so far, as
 *   "question/language", each with where it was (e.g. "order.json queue[0]");
 *   this one is added.
 * @returns {void}
 * @throws {QueueFileError} If the question or language isn't valid, or the
 *   pair was seen already.
 */
function checkPair(file, element, where, seen) {
  if (typeof element.question !== 'string' || element.question === '') {
    throw new QueueFileError(file, `${where}.question must be a question's file name`);
  }
  if (!LANGUAGES.includes(/** @type {string} */ (element.language))) {
    throw new QueueFileError(file, `${where}.language must be one of ${LANGUAGES.join(', ')}`);
  }
  const key = `${element.question}/${element.language}`;
  const first = seen.get(key);
  if (first !== undefined) {
    throw new QueueFileError(file, `${where}: ${element.question} in ${element.language} is listed twice (first at ${first})`);
  }
  seen.set(key, `${file} ${where}`);
}

/**
 * Reads order.json's text.
 *
 * @param {string | undefined} text - The file's contents, or undefined if
 *   there's none (an empty queue).
 * @param {Map<string, string>} [seen] - Pairs seen already (checkPair());
 *   those in the queue are added.
 * @returns {OrderFile} The queue.
 * @throws {QueueFileError} If it isn't valid JSON, or not a valid order.json.
 */
function parseOrder(text, seen = new Map()) {
  if (text === undefined) return { schemaVersion: SCHEMA_VERSION, submitsSinceLastIntroduced: 0, queue: [] };
  const raw = parseJson('order.json', text);
  rejectUnknownFields('order.json', raw, ['schemaVersion', 'submitsSinceLastIntroduced', 'queue'], '');
  if (raw.schemaVersion !== SCHEMA_VERSION) throw new QueueFileError('order.json', `schemaVersion must be ${SCHEMA_VERSION}`);
  if (!isCount(raw.submitsSinceLastIntroduced)) throw new QueueFileError('order.json', 'submitsSinceLastIntroduced must be a whole number, 0 or more');
  if (!Array.isArray(raw.queue)) throw new QueueFileError('order.json', 'queue must be a list');
  raw.queue.forEach(
    /**
     * Checks one element of the queue.
     *
     * @param {unknown} element - The element.
     * @param {number} i - Its position.
     * @returns {void}
     */
    (element, i) => {
      const where = `queue[${i}]`;
      if (!isPlainObject(element)) throw new QueueFileError('order.json', `${where} must be an object`);
      rejectUnknownFields('order.json', element, ['question', 'language', 'pass', 'passesInARow'], `${where}.`);
      checkPair('order.json', element, where, seen);
      if (element.pass !== undefined && element.pass !== 'yes' && element.pass !== 'no') {
        throw new QueueFileError('order.json', `${where}.pass must be "yes" or "no"`);
      }
      if (!isCount(element.passesInARow)) throw new QueueFileError('order.json', `${where}.passesInARow must be a whole number, 0 or more`);
      if (element.pass !== 'yes' && element.passesInARow !== 0) {
        throw new QueueFileError('order.json', `${where}.passesInARow must be 0 when pass isn't "yes"`);
      }
    },
  );
  return /** @type {OrderFile} */ (/** @type {unknown} */ (raw));
}

/**
 * Reads backlog.json's text.
 *
 * @param {string | undefined} text - The file's contents, or undefined if
 *   there's none (an empty backlog).
 * @param {Map<string, string>} [seen] - Pairs seen already (in the queue;
 *   checkPair()); those in the backlog are added, and one seen already is an
 *   error.
 * @returns {BacklogFile} The backlog.
 * @throws {QueueFileError} If it isn't valid JSON, or not a valid
 *   backlog.json, or names a pair that's also in the queue.
 */
function parseBacklog(text, seen = new Map()) {
  if (text === undefined) return { schemaVersion: SCHEMA_VERSION, backlog: [] };
  const raw = parseJson('backlog.json', text);
  rejectUnknownFields('backlog.json', raw, ['schemaVersion', 'backlog'], '');
  if (raw.schemaVersion !== SCHEMA_VERSION) throw new QueueFileError('backlog.json', `schemaVersion must be ${SCHEMA_VERSION}`);
  if (!Array.isArray(raw.backlog)) throw new QueueFileError('backlog.json', 'backlog must be a list');
  raw.backlog.forEach(
    /**
     * Checks one element of the backlog.
     *
     * @param {unknown} element - The element.
     * @param {number} i - Its position.
     * @returns {void}
     */
    (element, i) => {
      const where = `backlog[${i}]`;
      if (!isPlainObject(element)) throw new QueueFileError('backlog.json', `${where} must be an object`);
      rejectUnknownFields('backlog.json', element, ['question', 'language'], `${where}.`);
      checkPair('backlog.json', element, where, seen);
    },
  );
  return /** @type {BacklogFile} */ (/** @type {unknown} */ (raw));
}

/**
 * Parses a file's text as a JSON object.
 *
 * @param {string} file - "order.json" or "backlog.json", for the message.
 * @param {string} text - The text.
 * @returns {Record<string, unknown>} The object.
 * @throws {QueueFileError} If it isn't valid JSON, or not an object.
 */
function parseJson(file, text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new QueueFileError(file, `not valid JSON (${/** @type {Error} */ (err).message})`);
  }
  if (!isPlainObject(raw)) throw new QueueFileError(file, 'must be a JSON object');
  return raw;
}

/**
 * Reads both files together, checking that no pair is in both (D5, check 2).
 *
 * @param {string | undefined} orderText - order.json's contents, or undefined.
 * @param {string | undefined} backlogText - backlog.json's contents, or undefined.
 * @returns {{ order: OrderFile, backlog: BacklogFile }} Both.
 * @throws {QueueFileError} If either is invalid, or a pair is in both.
 */
function parseQueueFiles(orderText, backlogText) {
  /** @type {Map<string, string>} */
  const seen = new Map();
  const order = parseOrder(orderText, seen);
  const backlog = parseBacklog(backlogText, seen);
  return { order, backlog };
}

/**
 * Every (question, language) pair the profile allows, in the order they
 * come into a backlog (D6, decision 2 of D2): questions by creation time,
 * ties by file name; within a question, the languages turned on in the
 * learner's order, then the allowed ones turned off (kept for when they're
 * turned on: D2, decision 1).
 *
 * @param {QuestionInfo[]} questions - Every question.
 * @param {import('./profile').EffectiveProfile} profile - The learner's profile.
 * @returns {BacklogElement[]} The pairs.
 */
function allowedPairs(questions, profile) {
  const languageOrder = [...profile.languages, ...profile.allowedLanguages.filter((l) => !profile.languages.includes(l))];
  const sorted = [...questions].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return sorted.flatMap((q) => languageOrder.filter((l) => q.languages.includes(l)).map((language) => ({ question: q.slug, language })));
}

/**
 * The backlog with every allowed pair that's in neither file appended, in
 * allowedPairs() order (D6: missing pairs are added automatically).
 *
 * @param {OrderFile} order - The queue.
 * @param {BacklogFile} backlog - The backlog.
 * @param {BacklogElement[]} pairs - From allowedPairs().
 * @returns {{ backlog: BacklogFile, added: number }} The new backlog (a
 *   copy; the one given isn't changed), and how many pairs were added.
 */
function fillBacklog(order, backlog, pairs) {
  const present = new Set([...order.queue, ...backlog.backlog].map(pairKey));
  const missing = pairs.filter((p) => !present.has(pairKey(p)));
  return { backlog: { ...backlog, backlog: [...backlog.backlog, ...missing] }, added: missing.length };
}

/**
 * Whether a Submit passed (D3): only Accepted, all tests passing, is a pass.
 * Every other verdict, Time Limit Exceeded included, is a fail. The one
 * place this rule lives.
 *
 * @param {string} status - The judge's verdict, e.g. "Accepted" or
 *   "Wrong Answer".
 * @returns {'yes' | 'no'} order.json's pass value.
 */
function passFor(status) {
  return status === 'Accepted' ? 'yes' : 'no';
}

/**
 * The key a pair is compared by.
 *
 * @param {BacklogElement} pair - A pair, from either file.
 * @returns {string} "question/language".
 */
function pairKey(pair) {
  return `${pair.question}/${pair.language}`;
}

/**
 * The queue and backlog after one saved Submit (step 6; D3, D4, D6, D8):
 *
 * 1. The pair is taken from where it is in the queue; from the backlog, or
 *    from neither file (a question added since the server started), it
 *    starts at the front of the queue.
 * 2. pass is set, and passesInARow goes up by 1 on a pass or back to 0.
 * 3. It moves advance(passesInARow) places: that many other pairs end up
 *    ahead of it, or all of them if there aren't that many.
 * 4. submitsSinceLastIntroduced goes up by 1.
 * 5. introduceCount() pairs come in from the backlog, the first ones
 *    canIntroduce() accepts, in backlog order, to the front of the queue
 *    (so the backlog's first is the next question); the others stay where
 *    they are. If any come in, the counter goes back to 0.
 *
 * @param {OrderFile} order - The queue (not changed).
 * @param {BacklogFile} backlog - The backlog (not changed).
 * @param {BacklogElement} pair - The pair submitted.
 * @param {'yes' | 'no'} pass - From passFor().
 * @param {object} options - What the files don't say.
 * @param {(pair: BacklogElement) => boolean} options.canIntroduce - Whether
 *   a backlog pair may come in now: its language turned on (D2) and its
 *   question still there (D5).
 * @param {() => number} [options.random=Math.random] - For advance().
 * @returns {{ order: OrderFile, backlog: BacklogFile, introduced: BacklogElement[] }}
 *   New copies of both files, and the pairs that came in.
 * @throws {RangeError} From advance() or introduceCount(), if a count in
 *   the files is invalid (parseOrder() refuses those first).
 */
function recordSubmit(order, backlog, pair, pass, { canIntroduce, random = Math.random }) {
  const key = pairKey(pair);
  const queue = [...order.queue];
  let backlogList = backlog.backlog.filter((p) => pairKey(p) !== key);
  let from = queue.findIndex((p) => pairKey(p) === key);
  let passesInARow = 0;
  if (from === -1) {
    from = 0; // from the backlog or neither file: starts at the front (step 6, details 1 and 2)
  } else {
    passesInARow = queue.splice(from, 1)[0].passesInARow;
  }
  passesInARow = pass === 'yes' ? passesInARow + 1 : 0;
  const to = Math.min(from + advance(passesInARow, random), queue.length);
  queue.splice(to, 0, { question: pair.question, language: pair.language, pass, passesInARow });

  let submitsSinceLastIntroduced = order.submitsSinceLastIntroduced + 1;
  const candidates = backlogList.filter(canIntroduce);
  const introduced = candidates.slice(0, introduceCount(queue.length, submitsSinceLastIntroduced, candidates.length));
  if (introduced.length > 0) {
    const keys = new Set(introduced.map(pairKey));
    backlogList = backlogList.filter((p) => !keys.has(pairKey(p)));
    queue.unshift(...introduced.map((p) => ({ question: p.question, language: p.language, passesInARow: 0 })));
    submitsSinceLastIntroduced = 0;
  }
  return {
    order: { ...order, submitsSinceLastIntroduced, queue },
    backlog: { ...backlog, backlog: backlogList },
    introduced,
  };
}

/**
 * The pair to open next (step 7; D7): the first in the queue that canOpen()
 * accepts, else the first such in the backlog (a new user's queue is empty
 * until their first Submit, which then moves it into the queue: step 6,
 * detail 1), else none. Pairs passed over stay where they are. Changes
 * nothing, so asking twice gives the same answer.
 *
 * @param {OrderFile} order - The queue.
 * @param {BacklogFile} backlog - The backlog.
 * @param {(pair: BacklogElement) => boolean} canOpen - Whether a pair can
 *   be opened now: its language turned on (D2) and its question still
 *   having that language (D5). The same test recordSubmit()'s canIntroduce
 *   uses.
 * @returns {BacklogElement | null} The pair (question and language only),
 *   or null if nothing can be opened.
 */
function nextPair(order, backlog, canOpen) {
  const found = order.queue.find(canOpen) ?? backlog.backlog.find(canOpen);
  return found ? { question: found.question, language: found.language } : null;
}

/**
 * One line of the problem list (step 9).
 *
 * @typedef {object} ListedPair
 * @property {string} question - The question's file name without .json.
 * @property {string} language - One of LANGUAGES.
 * @property {'queue' | 'backlog'} where - Which file it's in.
 * @property {'yes' | 'no'} [pass] - Queue only: the latest result, if it's
 *   been submitted (or skipped).
 * @property {number} [passesInARow] - Queue only.
 */

/**
 * The problem list (step 9; D7): every pair canOpen() accepts, the queue
 * first, in order, then the backlog. Its first is what nextPair() names.
 * Changes nothing.
 *
 * @param {OrderFile} order - The queue.
 * @param {BacklogFile} backlog - The backlog.
 * @param {(pair: BacklogElement) => boolean} canOpen - The same test as
 *   nextPair()'s (step 9, detail 2).
 * @returns {ListedPair[]} The pairs, next first.
 */
function listPairs(order, backlog, canOpen) {
  return [
    ...order.queue.filter(canOpen).map((e) => ({ question: e.question, language: e.language, where: /** @type {'queue'} */ ('queue'), ...(e.pass && { pass: e.pass }), passesInARow: e.passesInARow })),
    ...backlog.backlog.filter(canOpen).map((p) => ({ question: p.question, language: p.language, where: /** @type {'backlog'} */ ('backlog') })),
  ];
}

module.exports = { SCHEMA_VERSION, QueueFileError, parseOrder, parseBacklog, parseQueueFiles, allowedPairs, fillBacklog, passFor, recordSubmit, nextPair, listPairs };

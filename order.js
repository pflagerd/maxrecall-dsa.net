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
 * @property {string[]} [alreadyLearned] - The questions it builds on
 *   directly (its file's alreadyLearned; #146): allowedPairs() puts it
 *   after them. Missing means none.
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
 * Questions in the order a backlog takes them (D6; #146, choice A(a)): each
 * after every question it builds on (alreadyLearned), and otherwise by
 * creation time, ties by file name. At each step it takes the earliest
 * question whose alreadyLearned are all placed (a topological sort, Kahn's
 * algorithm with creation time choosing among the ready ones), so questions
 * that build on nothing keep plain creation order.
 *
 * An alreadyLearned entry naming no question here is ignored. A loop, which
 * checkQuestion refuses (make test), would leave its questions never ready:
 * they're appended in creation order rather than lost, since a pair left out
 * of the backlog would never be introduced.
 *
 * @param {QuestionInfo[]} questions - Every question.
 * @returns {QuestionInfo[]} The same questions, in that order.
 */
function dependencyOrder(questions) {
  const byCreated = [...questions].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const present = new Set(byCreated.map((q) => q.slug));
  /** @type {Set<string>} */
  const placed = new Set();
  /** @type {QuestionInfo[]} */
  const ordered = [];
  let waiting = byCreated;
  while (waiting.length > 0) {
    const next = waiting.find((q) => (q.alreadyLearned ?? []).every((s) => placed.has(s) || !present.has(s)));
    if (!next) {
      ordered.push(...waiting); // a loop: see above
      break;
    }
    ordered.push(next);
    placed.add(next.slug);
    waiting = waiting.filter((q) => q !== next);
  }
  return ordered;
}

/**
 * Every (question, language) pair the profile allows, in the order they
 * come into a backlog (D6, decision 2 of D2): questions in dependencyOrder()
 * (after the ones they build on, then by creation time; #146); within a
 * question, the languages turned on in the learner's order, then the
 * allowed ones turned off (kept for when they're turned on: D2, decision 1).
 *
 * @param {QuestionInfo[]} questions - Every question.
 * @param {import('./profile').EffectiveProfile} profile - The learner's profile.
 * @returns {BacklogElement[]} The pairs.
 */
function allowedPairs(questions, profile) {
  const languageOrder = [...profile.languages, ...profile.allowedLanguages.filter((l) => !profile.languages.includes(l))];
  return dependencyOrder(questions).flatMap((q) => languageOrder.filter((l) => q.languages.includes(l)).map((language) => ({ question: q.slug, language })));
}

/**
 * The pairs the server keeps in a learner's backlog by itself, for
 * fillBacklog(): with the profile's backlog "all" (the default), every
 * allowed pair (D6, allowedPairs()); with "chosen", none, since the learner
 * (or a teacher) picks them with make backlog-add (step 13, detail 1). The
 * one place this rule lives: server start, Next, the problem list, the
 * consistency check's check 4 and the replay all use it.
 *
 * @param {QuestionInfo[]} questions - Every question.
 * @param {import('./profile').EffectiveProfile} profile - The learner's profile.
 * @returns {BacklogElement[]} The pairs, in allowedPairs() order; empty for
 *   a chosen backlog.
 */
function backlogPairs(questions, profile) {
  return profile.backlog === 'chosen' ? [] : allowedPairs(questions, profile);
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
 * The pairs make backlog-add adds for these questions (step 13, detail 4):
 * the questions in the order given, each in every language turned on in the
 * profile that it has, in the learner's order (so only Python for a learner
 * with only Python on).
 *
 * @param {string[]} slugs - Question names, in the order wanted.
 * @param {QuestionInfo[]} questions - Every question.
 * @param {import('./profile').EffectiveProfile} profile - The learner's profile.
 * @returns {BacklogElement[]} The pairs, in that order.
 * @throws {Error} If a name is given twice, isn't a question, or the
 *   question has none of the languages turned on (nothing is added then).
 */
function pairsToAdd(slugs, questions, profile) {
  const bySlug = new Map(questions.map((q) => [q.slug, q]));
  const twice = slugs.find((slug, i) => slugs.indexOf(slug) !== i);
  if (twice !== undefined) throw new Error(`${twice} is named twice`);
  return slugs.flatMap(
    /**
     * One question's pairs.
     *
     * @param {string} slug - The question's name.
     * @returns {BacklogElement[]} Its pairs, in the learner's language order.
     */
    (slug) => {
      const q = bySlug.get(slug);
      if (!q) throw new Error(`${slug}: no such question (make backlog-show lists them)`);
      const languages = profile.languages.filter((l) => q.languages.includes(l));
      if (!languages.length) throw new Error(`${slug} has none of the languages turned on (${profile.languages.join(', ')})`);
      return languages.map((language) => ({ question: slug, language }));
    },
  );
}

/**
 * The backlog with pairs added (step 13, detail 4, make backlog-add), at
 * the end or before position `at`. A pair already in the queue or the
 * backlog isn't added again (a pair is in one place only, D5); it's listed
 * in skipped instead, so moving one means removing it first.
 *
 * @param {OrderFile} order - The queue (not changed; only looked in).
 * @param {BacklogFile} backlog - The backlog (not changed).
 * @param {BacklogElement[]} pairs - From pairsToAdd(), in the order wanted.
 * @param {number} [at] - The position the first added pair takes, counting
 *   from 1 (1 is the front: the next to come in); absent means the end.
 * @returns {{ backlog: BacklogFile, added: BacklogElement[], skipped: string[] }}
 *   The new backlog (a copy), the pairs added, and the ones left out, e.g.
 *   "two-sum in python: already in the queue".
 * @throws {RangeError} If at isn't a whole number from 1 to one more than
 *   the backlog's length.
 */
function addToBacklog(order, backlog, pairs, at) {
  const length = backlog.backlog.length;
  if (at !== undefined && !(Number.isInteger(at) && at >= 1 && at <= length + 1)) {
    throw new RangeError(`AT must be a whole number from 1 to ${length + 1} (the backlog has ${length})`);
  }
  const inQueue = new Set(order.queue.map(pairKey));
  const inBacklog = new Set(backlog.backlog.map(pairKey));
  /** @type {string[]} */
  const skipped = [];
  const added = pairs.filter(
    /**
     * Whether a pair is new, noting it in skipped if not.
     *
     * @param {BacklogElement} p - The pair.
     * @returns {boolean} True if it's in neither file.
     */
    (p) => {
      const where = inQueue.has(pairKey(p)) ? 'the queue' : inBacklog.has(pairKey(p)) ? 'the backlog' : null;
      if (where) skipped.push(`${p.question} in ${p.language}: already in ${where}`);
      return where === null;
    },
  );
  const list = [...backlog.backlog];
  list.splice(at === undefined ? length : at - 1, 0, ...added.map((p) => ({ question: p.question, language: p.language })));
  return { backlog: { ...backlog, backlog: list }, added, skipped };
}

/**
 * The backlog without these questions, in every language (step 13, detail
 * 4, make backlog-remove). Only the backlog changes: a question already in
 * the queue stays there, and is listed in notRemoved.
 *
 * @param {OrderFile} order - The queue (not changed; only looked in).
 * @param {BacklogFile} backlog - The backlog (not changed).
 * @param {string[]} slugs - Question names. A deleted question's name works
 *   too.
 * @returns {{ backlog: BacklogFile, removed: BacklogElement[], notRemoved: string[] }}
 *   The new backlog (a copy), the pairs taken out, and why some named
 *   weren't, e.g. "two-sum in python: in the queue, so not removed".
 */
function removeFromBacklog(order, backlog, slugs) {
  const names = new Set(slugs);
  const removed = backlog.backlog.filter((p) => names.has(p.question));
  /** @type {string[]} */
  const notRemoved = order.queue.filter((e) => names.has(e.question)).map((e) => `${e.question} in ${e.language}: in the queue, so not removed`);
  for (const slug of names) {
    if (!removed.some((p) => p.question === slug) && !order.queue.some((e) => e.question === slug)) notRemoved.push(`${slug}: not in the backlog`);
  }
  return { backlog: { ...backlog, backlog: backlog.backlog.filter((p) => !names.has(p.question)) }, removed, notRemoved };
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
 *    from neither file (a question added since the server started, or one
 *    the learner opened by its slug without having chosen it), it starts
 *    at the front of the queue. The latter is a feature (owner,
 *    2026-11-06): it's how a learner puts a question of their choice into
 *    their queue (docs/how-to-put-a-question-directly-into-my-queue-by-slug.html),
 *    so a Submit or Skip of any pair must keep joining the queue.
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

/**
 * The files without any reference to a deleted question (D5; step 11,
 * make delete-question). Its records are kept (they're history); only the
 * queue and backlog lose it.
 *
 * @param {OrderFile} order - The queue (not changed).
 * @param {BacklogFile} backlog - The backlog (not changed).
 * @param {string} slug - The deleted question's name.
 * @returns {{ order: OrderFile, backlog: BacklogFile, removed: string[] }}
 *   New copies, and what was removed, e.g. "order.json: two-sum in python".
 */
function removeReferences(order, backlog, slug) {
  const removed = [
    ...order.queue.filter((e) => e.question === slug).map((e) => `order.json: ${e.question} in ${e.language}`),
    ...backlog.backlog.filter((p) => p.question === slug).map((p) => `backlog.json: ${p.question} in ${p.language}`),
  ];
  return {
    order: { ...order, queue: order.queue.filter((e) => e.question !== slug) },
    backlog: { ...backlog, backlog: backlog.backlog.filter((p) => p.question !== slug) },
    removed,
  };
}

/**
 * The files with every reference to a renamed question changed to its new
 * name (D5; step 11, make rename-question), so its progress is kept. A
 * pair can then be there twice; the copy dropped is:
 *
 * - in the queue under both names (the new one submitted after a git pull
 *   and before this ran): the old-name element, since the new one's place
 *   reflects the latest Submit (detail 3);
 * - in the backlog under the new name while the queue has it (step 5's
 *   fill added it, the old name not counting: step 10's note): the
 *   backlog copy, so the queue's progress is kept;
 * - in the backlog under both names: the later one.
 *
 * @param {OrderFile} order - The queue (not changed).
 * @param {BacklogFile} backlog - The backlog (not changed).
 * @param {string} from - The old name.
 * @param {string} to - The new name.
 * @returns {{ order: OrderFile, backlog: BacklogFile, renamed: string[], dropped: string[] }}
 *   New copies; what was renamed, and what was dropped and why.
 */
function renameReferences(order, backlog, from, to) {
  /** @type {string[]} */
  const renamed = [];
  /** @type {string[]} */
  const dropped = [];
  const toInQueue = new Set(order.queue.filter((e) => e.question === to).map((e) => e.language));
  /** @type {QueueElement[]} */
  const queue = [];
  for (const e of order.queue) {
    if (e.question !== from) {
      queue.push(e);
    } else if (toInQueue.has(e.language)) {
      dropped.push(`order.json: ${from} in ${e.language}, already in the queue as ${to}`);
    } else {
      queue.push({ ...e, question: to });
      renamed.push(`order.json: ${from} in ${e.language}`);
    }
  }
  const inQueue = new Set(queue.map(pairKey));
  const seen = new Set();
  /** @type {BacklogElement[]} */
  const kept = [];
  for (const p of backlog.backlog) {
    const pair = p.question === from ? { question: to, language: p.language } : p;
    const k = pairKey(pair);
    if (inQueue.has(k) && (p.question === from || p.question === to)) {
      dropped.push(`backlog.json: ${p.question} in ${p.language}, in the queue as ${to}`);
    } else if (seen.has(k)) {
      dropped.push(`backlog.json: ${p.question} in ${p.language}, already in the backlog as ${to}`);
    } else {
      kept.push(pair);
      seen.add(k);
      if (p.question === from) renamed.push(`backlog.json: ${from} in ${p.language}`);
    }
  }
  return { order: { ...order, queue }, backlog: { ...backlog, backlog: kept }, renamed, dropped };
}

/**
 * Whether a pair can be opened, or brought in from the backlog, now (step
 * 6, detail 3; step 7, detail 2): its language is turned on in the profile
 * (D2) and its question is still there with that language (D5). One rule
 * for both, so Next never names a pair that couldn't be brought in, or the
 * other way round. Also what recalculate.js brings pairs in with. Moved
 * here from server.js (2026-11-03).
 *
 * @param {import('./profile').EffectiveProfile} profile - The learner's profile.
 * @param {QuestionInfo[]} questions - Every question (question-files.js,
 *   questionInfos()).
 * @returns {(pair: BacklogElement) => boolean} The test.
 */
function canOpenPair(profile, questions) {
  const available = new Set(questions.flatMap((q) => q.languages.map((l) => `${q.slug}/${l}`)));
  return (pair) => profile.languages.includes(pair.language) && available.has(`${pair.question}/${pair.language}`);
}

module.exports = { SCHEMA_VERSION, QueueFileError, parseOrder, parseBacklog, parseQueueFiles, dependencyOrder, allowedPairs, backlogPairs, fillBacklog, pairsToAdd, addToBacklog, removeFromBacklog, passFor, recordSubmit, nextPair, listPairs, removeReferences, renameReferences, canOpenPair };

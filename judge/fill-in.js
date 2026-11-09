'use strict';

// Judging a fill-in question (#160): the learner types a few characters
// into a blank, and the question's own judge, questions/<slug>.judge.js,
// reads them and says whether they're the form asked for. Nothing the
// learner typed is run, so this happens in the server, not the sandbox.
//
// A judge file is server code (docs/roles/questions.md, "Judge files"):
// it runs with the server's access. So this file loads a judge only by the
// slug of a fill-in question, through resolveInside (R2), and treats what
// a judge returns as untrusted until checked (Q7, #171): its verdict must
// be { pass, message?, hints? }, with the text capped, or the answer
// counts as "couldn't judge" (Q9a), not as the learner's fail.
//
// Users' routes check the answer before calling judgeFillIn (contract 2):
// `blank` a string no longer than the question's maxLength, and no other
// field. judgeFillIn checks again, cheaply, in case a route ever doesn't.

const { QUESTIONS_DIR, kindOf, fillInMaxLength } = require('../question-files');
const { resolveInside } = require('../paths');

/** The longest message a judge may give, in UTF-16 code units (#171). @type {number} */
const MESSAGE_MAX_LENGTH = 500;
/** The most hints a judge may give (#171). @type {number} */
const HINTS_MAX = 5;
/** The longest hint a judge may give, in UTF-16 code units (#171). @type {number} */
const HINT_MAX_LENGTH = 300;

/**
 * What a judge says about one answer (#160, Q6b): whether it's the form
 * asked for, and for a fail, what went wrong and optional nudges.
 *
 * @typedef {object} Verdict
 * @property {boolean} pass - True if the answer is the form asked for.
 * @property {string} [message] - What went wrong, shown as text.
 * @property {string[]} [hints] - Nudges toward the taught form, as text.
 */

/**
 * What judgeFillIn gives back (contract 2): the status, mapped from the
 * verdict's pass here and nowhere else, and the judge's message and hints.
 * No passed or total: the page would print them as "0/1 test cases passed".
 *
 * @typedef {object} FillInResult
 * @property {'Accepted' | 'Wrong Answer'} status - The verdict, as a status.
 * @property {string} [message] - The judge's message, if it gave one.
 * @property {string[]} [hints] - The judge's hints, if it gave any.
 */

/**
 * A judge's file, as this file loads it: the judge, and the cases that
 * questions.test.js runs against it (#160, Q6b.3).
 *
 * @typedef {object} JudgeModule
 * @property {(blank: string, context: { language: string }) => unknown} judge -
 *   Judges one answer. Its result is checked (checkVerdict), not trusted.
 * @property {unknown} [cases] - Its test cases, for questions.test.js.
 */

/**
 * Thrown when a fill-in question's judge fails: it can't be loaded, it
 * throws, or it returns anything but a Verdict (#160, Q9a). Users' routes
 * match its code, 'JUDGE_FAILED', as a string, as they match 'JUDGE_BUSY':
 * they record nothing, change no queue, and show only a generic message.
 * The details are logged here, never sent to the page.
 */
class JudgeFailedError extends Error {
  /**
   * @param {string} slug - The question whose judge failed.
   * @param {string} why - What went wrong, for the log.
   */
  constructor(slug, why) {
    super(`The judge for ${slug} failed: ${why}`);
    this.name = 'JudgeFailedError';
    /** @type {'JUDGE_FAILED'} */
    this.code = 'JUDGE_FAILED';
    this.slug = slug;
  }
}

/**
 * Whether a judge's result is a Verdict (#171): an object with a boolean
 * `pass`, an optional `message` of at most MESSAGE_MAX_LENGTH, optional
 * `hints`, at most HINTS_MAX strings of at most HINT_MAX_LENGTH each, and
 * nothing else.
 *
 * @param {unknown} result - What the judge returned.
 * @returns {string | null} What's wrong with it, or null if it's a Verdict.
 */
function checkVerdict(result) {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return 'not an object';
  if (typeof (/** @type {{ then?: unknown }} */ (result).then) === 'function') return 'a promise: a judge must be synchronous';
  const v = /** @type {Record<string, unknown>} */ (result);
  const extra = Object.keys(v).filter((key) => !['pass', 'message', 'hints'].includes(key));
  if (extra.length) return `unknown fields ${extra.join(', ')}`;
  if (typeof v.pass !== 'boolean') return 'pass is not true or false';
  if (v.message !== undefined && (typeof v.message !== 'string' || v.message.length > MESSAGE_MAX_LENGTH)) return `message is not text of at most ${MESSAGE_MAX_LENGTH} characters`;
  if (v.hints !== undefined) {
    if (!Array.isArray(v.hints) || v.hints.length > HINTS_MAX) return `hints is not a list of at most ${HINTS_MAX}`;
    if (!v.hints.every((h) => typeof h === 'string' && h.length <= HINT_MAX_LENGTH)) return `a hint is not text of at most ${HINT_MAX_LENGTH} characters`;
  }
  return null;
}

/**
 * A judge's result, read once into plain data before it's checked (the
 * architect's R3 review of #181): its own fields' values, and a copy of
 * hints if that's a list. A getter is called once here, inside
 * judgeFillIn's try, so it can neither throw past the check nor give one
 * value to checkVerdict and another to the result (a time-of-check to
 * time-of-use gap). Anything that isn't a plain, non-promise object is
 * returned as it is, for checkVerdict to refuse.
 *
 * @param {unknown} result - What the judge returned.
 * @returns {unknown} A plain copy, or result itself.
 * @throws {Error} Whatever a getter, or a then property, throws.
 */
function plainCopy(result) {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return result;
  if (typeof (/** @type {{ then?: unknown }} */ (result).then) === 'function') return result;
  const source = /** @type {Record<string, unknown>} */ (result);
  /** @type {Record<string, unknown>} */
  const copy = {};
  for (const key of Object.keys(source)) copy[key] = source[key];
  if (Array.isArray(copy.hints)) copy.hints = copy.hints.slice();
  return copy;
}

/**
 * The path of a fill-in question's judge file, questions/<slug>.judge.js,
 * found through resolveInside so that no slug can reach outside the
 * folder (R2).
 *
 * @param {string} slug - The question's slug, as its file names it.
 * @param {string} [dir] - The folder of questions; QUESTIONS_DIR unless a
 *   test gives its own.
 * @returns {string | null} The absolute path, or null if the slug would
 *   lead outside the folder.
 */
function judgeFilePath(slug, dir = QUESTIONS_DIR) {
  return resolveInside(dir, `${slug}.judge.js`);
}

/**
 * Loads a fill-in question's judge (R2): only for a question whose kind is
 * "fill-in", by its own slug, through resolveInside. Node caches it
 * (require), so a changed judge takes effect when the server restarts.
 *
 * @param {{ slug: string, kind?: string }} question - The question, as
 *   loaded from its file (routes.js's loadProblem).
 * @param {string} [dir] - The folder of questions; QUESTIONS_DIR unless a
 *   test gives its own.
 * @returns {JudgeModule} The judge's module.
 * @throws {TypeError} If the question isn't a fill-in question: a caller's
 *   mistake, not a failed judge.
 * @throws {JudgeFailedError} If its judge file can't be loaded, or doesn't
 *   export a judge function.
 */
function loadJudge(question, dir = QUESTIONS_DIR) {
  if (kindOf(question) !== 'fill-in') throw new TypeError(`loadJudge: ${question.slug} isn't a fill-in question`);
  const file = judgeFilePath(question.slug, dir);
  if (file === null) throw new JudgeFailedError(question.slug, 'its slug leads outside the questions folder');
  /** @type {unknown} */
  let mod;
  try {
    mod = require(file);
  } catch (err) {
    throw new JudgeFailedError(question.slug, `its judge file couldn't be loaded: ${/** @type {Error} */ (err).message}`);
  }
  if (typeof mod !== 'object' || mod === null || typeof (/** @type {{ judge?: unknown }} */ (mod).judge) !== 'function') {
    throw new JudgeFailedError(question.slug, 'its judge file exports no judge function');
  }
  return /** @type {JudgeModule} */ (mod);
}

/**
 * Judges a learner's answer to a fill-in question (#160): calls the
 * question's judge on the blank's text, checks what it returns, and maps
 * its pass to a status, here and nowhere else (Q6b.1).
 *
 * @param {{ slug: string, kind?: string, maxLength?: number }} question -
 *   The fill-in question, as loaded from its file.
 * @param {{ blank: string }} answer - The learner's answer, already
 *   checked by the route (contract 2); checked again here, and refused
 *   with a TypeError if it isn't { blank } with blank a string within the
 *   question's maxLength.
 * @param {string} language - The language it's answered in, which the
 *   judge is told.
 * @param {string} [dir] - The folder of questions; QUESTIONS_DIR unless a
 *   test gives its own.
 * @returns {FillInResult} The status, and the judge's message and hints.
 * @throws {TypeError} If the question isn't fill-in, or the answer isn't
 *   what the route should have let through: a caller's mistake.
 * @throws {JudgeFailedError} If the judge can't be loaded, throws, or
 *   returns anything but a Verdict (Q9a). It's logged here.
 */
function judgeFillIn(question, answer, language, dir = QUESTIONS_DIR) {
  const keys = typeof answer === 'object' && answer !== null ? Object.keys(answer) : [];
  if (keys.length !== 1 || keys[0] !== 'blank' || typeof answer.blank !== 'string' || answer.blank.length > fillInMaxLength(question)) {
    throw new TypeError('judgeFillIn: the answer must be { blank }, a string within maxLength, checked by the route first (contract 2)');
  }
  try {
    const { judge } = loadJudge(question, dir);
    /** @type {unknown} */
    let result;
    try {
      result = judge(answer.blank, { language });
    } catch (err) {
      throw new JudgeFailedError(question.slug, `it threw: ${/** @type {Error} */ (err).stack || err}`);
    }
    /** @type {unknown} */
    let plain;
    try {
      plain = plainCopy(result);
    } catch (err) {
      // A getter in the verdict threw (architect's R3 review of #181).
      throw new JudgeFailedError(question.slug, `reading its verdict threw: ${/** @type {Error} */ (err).stack || err}`);
    }
    const wrong = checkVerdict(plain);
    if (wrong) throw new JudgeFailedError(question.slug, `it returned ${wrong}`);
    const verdict = /** @type {Verdict} */ (plain);
    return {
      status: verdict.pass ? 'Accepted' : 'Wrong Answer',
      ...(verdict.message !== undefined && { message: verdict.message }),
      ...(verdict.hints !== undefined && { hints: verdict.hints }),
    };
  } catch (err) {
    if (err instanceof JudgeFailedError) console.error(`Judging: ${err.message}`);
    throw err;
  }
}

module.exports = { judgeFillIn, loadJudge, judgeFilePath, checkVerdict, plainCopy, JudgeFailedError, MESSAGE_MAX_LENGTH, HINTS_MAX, HINT_MAX_LENGTH };

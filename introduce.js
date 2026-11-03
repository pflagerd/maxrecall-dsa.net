'use strict';

// How many (question, language) pairs to bring from the backlog into the
// queue: docs/plans/spaced-repetition.md, decision D6.
//
//   - at least MIN_QUEUE_LENGTH pairs are kept in the queue, so the next
//     question is never the one just answered; and
//   - one more comes in every INTRODUCE_EVERY Submits (Skips count too, D8),
//     so new material keeps arriving.
//
// A queue of one pair would give back that same pair every time: in a
// simulation (D6) the same pair came back 299 times in 300 Submits.
// This file only works out *how many*; taking them from the front of
// backlog.json and putting them at the front of order.json, and setting
// submitsSinceLastIntroduced back to 0, is the job of the code that owns
// those files. So the rule can be changed here alone, e.g. later to bring
// pairs in faster when the learner is doing well, as MaxRecall does.

/** The fewest pairs the queue should hold. @type {number} */
const MIN_QUEUE_LENGTH = 3;
/** How many Submits apart new pairs come in. @type {number} */
const INTRODUCE_EVERY = 5;

/**
 * Throws unless value is a whole number, 0 or more. The values come from
 * order.json and backlog.json, which can be edited by hand, so a mistake
 * there should fail loudly rather than quietly bring in nothing.
 *
 * @param {string} name - The argument's name, for the message.
 * @param {number} value - The argument.
 * @returns {void}
 * @throws {RangeError} If value isn't a whole number, 0 or more.
 */
function checkCount(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a whole number, 0 or more; got ${JSON.stringify(value)}`);
  }
}

/**
 * How many pairs to bring in from the backlog now. Called after a Submit or
 * Skip has been counted, and for a new user, whose queue starts empty.
 *
 * When both rules apply (say 2 in the queue and 5 Submits since the last),
 * the larger number is enough for both: here 1, not 2.
 *
 * @param {number} queueLength - Pairs in order.json now.
 * @param {number} submitsSinceLastIntroduced - Submits and Skips since a
 *   pair was last brought in (order.json's counter, after counting this one).
 * @param {number} backlogLength - Pairs waiting in backlog.json.
 * @returns {number} How many to take from the front of the backlog: from 0
 *   up to MIN_QUEUE_LENGTH, never more than backlogLength.
 * @throws {RangeError} If an argument isn't a whole number, 0 or more.
 */
function introduceCount(queueLength, submitsSinceLastIntroduced, backlogLength) {
  checkCount('queueLength', queueLength);
  checkCount('submitsSinceLastIntroduced', submitsSinceLastIntroduced);
  checkCount('backlogLength', backlogLength);
  const toFill = Math.max(0, MIN_QUEUE_LENGTH - queueLength);
  const onSchedule = submitsSinceLastIntroduced >= INTRODUCE_EVERY ? 1 : 0;
  return Math.min(backlogLength, Math.max(toFill, onSchedule));
}

module.exports = { introduceCount, MIN_QUEUE_LENGTH, INTRODUCE_EVERY };

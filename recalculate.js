'use strict';

// Recalculating a learner's queue and backlog from their records
// (docs/plans/spaced-repetition.md, step 12, first part; D5's "recalculate
// it from the Submit records"). It replays: starting as a new user does,
// with an empty queue and every allowed pair in the backlog, it puts every
// Submit and Skip record, oldest first, through recordSubmit(), the rule a
// real Submit or Skip uses. The result is the queue the learner would have
// had if spaced repetition had existed from their first Submit. With a
// chosen backlog (profile.json's backlog "chosen", step 13, detail 3), it
// starts instead from the pairs the learner chose: those in the queue now,
// in queue order, then the backlog, in its order.
//
// Pure functions only: make recalculate-queue (scripts/recalculate-queue.js)
// reads and writes the files.

const { SCHEMA_VERSION, backlogPairs, recordSubmit, passFor, canOpenPair } = require('./order');
const { currentName } = require('./consistency');

/**
 * A small seeded random number generator (mulberry32), so a replay gives
 * the same queue every time it's run, and the dry run shows exactly what
 * will be written (detail 2). Also used by advance.test.js. Source:
 * https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 *
 * @param {number} seed - The starting state: a whole number (only its low
 *   32 bits are used). The same seed always gives the same numbers.
 * @returns {() => number} A function that returns the next number each
 *   time it's called, from 0 up to, but not including, 1, like Math.random.
 */
function seededRandom(seed) {
  return (
    /**
     * The generator itself.
     *
     * @returns {number} The next number, from 0 up to, but not including, 1.
     */
    () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  );
}

/**
 * A user's seed for seededRandom(): the 32-bit FNV-1a hash of their email,
 * so each learner's replay is fixed, and different learners' differ.
 *
 * @param {string} email - The user's email.
 * @returns {number} A whole number from 0 to 2^32 − 1.
 */
function seedFor(email) {
  let hash = 0x811c9dc5;
  for (const char of email) {
    hash ^= /** @type {number} */ (char.codePointAt(0));
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The backlog a replay starts from (detail 1; step 13, detail 3): for
 * backlog "all", every allowed pair, as a new user's; for "chosen", the
 * pairs chosen so far, which are every pair in the files now: the queue's,
 * in queue order (the order they were chosen in isn't kept once they're in
 * the queue), then the backlog's, in its order.
 *
 * @param {import('./order').QuestionInfo[]} questions - Every question.
 * @param {import('./profile').EffectiveProfile} profile - The learner's profile.
 * @param {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile }} [current] -
 *   The files now; needed only for a chosen backlog.
 * @returns {import('./order').BacklogElement[]} The pairs.
 * @throws {TypeError} For a chosen backlog without current: the choice
 *   would be lost.
 */
function startingBacklog(questions, profile, current) {
  if (profile.backlog !== 'chosen') return backlogPairs(questions, profile);
  if (!current) throw new TypeError('a chosen backlog needs the files as they are now, to know what was chosen');
  return [
    ...current.order.queue.map((e) => ({ question: e.question, language: e.language })),
    ...current.backlog.backlog.map((p) => ({ question: p.question, language: p.language })),
  ];
}

/**
 * The queue and backlog the records make (step 12, first part; detail 1).
 * Records are taken oldest first; old names are followed through renames;
 * records of deleted questions are left out (D5). A record in a language
 * the profile no longer allows, or has turned off, is replayed too, so the
 * pair keeps its history and is skipped while its language is off (detail
 * 5; D2).
 *
 * @param {import('./consistency').RecordSummary[]} records - Every record
 *   of the user's, in any order.
 * @param {import('./order').QuestionInfo[]} questions - Every question.
 * @param {import('./profile').EffectiveProfile} profile - The learner's profile.
 * @param {Record<string, string>} renames - From parseRenames().
 * @param {() => number} random - For advance(), e.g. seededRandom(seedFor(email)).
 * @param {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile }} [current] -
 *   The files now: needed for a chosen backlog (startingBacklog()), and
 *   not read otherwise.
 * @returns {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile, replayed: number, leftOut: number }}
 *   The files, how many records were replayed, and how many were left out
 *   (their question is gone).
 * @throws {TypeError} From startingBacklog(), for a chosen backlog without
 *   current.
 */
function recalculate(records, questions, profile, renames, random, current) {
  const exists = new Set(questions.map((q) => q.slug));
  const canIntroduce = canOpenPair(profile, questions);
  let order = { schemaVersion: SCHEMA_VERSION, submitsSinceLastIntroduced: 0, queue: /** @type {import('./order').QueueElement[]} */ ([]) };
  let backlog = { schemaVersion: SCHEMA_VERSION, backlog: startingBacklog(questions, profile, current) };
  const sorted = [...records].sort((a, b) => (a.submittedAt < b.submittedAt ? -1 : a.submittedAt > b.submittedAt ? 1 : 0));
  let replayed = 0;
  for (const r of sorted) {
    const question = currentName(r.question, renames);
    if (!exists.has(question)) continue;
    // A Skip is a fail (D8); otherwise only Accepted passes (D3).
    const pass = r.skipped === 'yes' ? 'no' : passFor(/** @type {string} */ (r.status));
    ({ order, backlog } = recordSubmit(order, backlog, { question, language: r.language }, pass, { canIntroduce, random }));
    replayed++;
  }
  return { order, backlog, replayed, leftOut: records.length - replayed };
}

module.exports = { seededRandom, seedFor, startingBacklog, recalculate };

'use strict';

// A new learner's starting files (docs/plans/spaced-repetition.md, step 14;
// make learner-create): profile.json, order.json and backlog.json, for a
// learner set up by hand before their invite goes out (limited-live Q3,
// option (c)). Their languages are allowed.languages, so they can't turn
// their chosen questions' language off, and their backlog is "chosen", in
// the order given.
//
// Pure functions only: scripts/learner-create.js reads the environment and
// users.js's createUser() writes the folder. The checks are profile.js's
// (effectiveProfile) and order.js's (pairsToAdd, addToBacklog), the same
// ones the server and make backlog-add use, so there's one rule for each.

const { SCHEMA_VERSION: PROFILE_SCHEMA_VERSION, effectiveProfile } = require('./profile');
const { parseOrder, parseBacklog, pairsToAdd, addToBacklog } = require('./order');

/**
 * A new learner's three files, as objects to write.
 *
 * @typedef {object} LearnerFiles
 * @property {import('./profile').ProfileFile} profile - profile.json.
 * @property {import('./order').OrderFile} order - order.json: an empty queue.
 * @property {import('./order').BacklogFile} backlog - backlog.json: the
 *   questions chosen, in order.
 */

/**
 * Splits a list given in one variable, e.g. SLUGS="hello-world two-sum" or
 * LANGUAGES="python,java", on spaces and commas.
 *
 * @param {string | undefined} text - The variable's value, or undefined if
 *   it isn't set.
 * @returns {string[]} The items, in order; empty for none.
 */
function splitList(text) {
  return (text || '').split(/[\s,]+/).filter(Boolean);
}

/**
 * The files for a new learner (step 14, details 3 to 5): a profile allowing
 * these languages, the first being their default, with a chosen backlog;
 * an empty queue; and a backlog of these questions, in this order, each in
 * every one of these languages it has, in this language order.
 *
 * @param {string[]} languages - The languages they may use, e.g. ["python"].
 * @param {string[]} slugs - Their questions, in the order they'll get them.
 * @param {import('./order').QuestionInfo[]} questions - Every question.
 * @returns {LearnerFiles} The files.
 * @throws {Error} A ProfileError if the languages aren't valid (none, an
 *   unknown one, or one twice); an Error if no question is given, or as
 *   pairsToAdd() throws (an unknown question, one named twice, or one in
 *   none of the languages).
 */
function newLearnerFiles(languages, slugs, questions) {
  /** @type {import('./profile').ProfileFile} */
  const profile = { schemaVersion: PROFILE_SCHEMA_VERSION, allowed: { languages: [...languages] }, backlog: 'chosen' };
  const effective = effectiveProfile(profile); // the one check of a profile
  if (!slugs.length) throw new Error('at least one question is needed, or Next would have nothing to give them');
  const order = parseOrder(undefined);
  const { backlog } = addToBacklog(order, parseBacklog(undefined), pairsToAdd(slugs, questions, effective));
  return { profile, order, backlog };
}

module.exports = { splitList, newLearnerFiles };

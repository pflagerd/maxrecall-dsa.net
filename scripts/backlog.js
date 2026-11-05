'use strict';

// make backlog-show, make backlog-add and make backlog-remove
// (docs/plans/spaced-repetition.md, step 13): looking at, and choosing, a
// learner's backlog when their profile.json says "backlog": "chosen". The
// values come from the environment (EMAIL, SLUGS, AT, DRY_RUN), as for make
// rename-question, so make never pastes them into a shell command.
//
//   EMAIL=owner@example.com node scripts/backlog.js show
//   EMAIL=owner@example.com SLUGS="hello-world two-sum" AT=1 node scripts/backlog.js add
//   EMAIL=owner@example.com SLUGS="two-sum" node scripts/backlog.js remove
//
// show only reads. add and remove refuse, changing nothing, unless EMAIL is
// a user, their profile and queue files are valid, the backlog is chosen,
// every name is valid, and no server answers on 127.0.0.1:$PORT (or
// $TRUSTED_PORT), since a Submit rewrites backlog.json too. Then they write
// backlog.json only (unless DRY_RUN). Exit 0 when done, 1 when refused.

const { EMAIL_PATTERN, listUsers, readUserFile, writeUserFile } = require('../users');
const { questionInfos } = require('../question-files');
const { parseProfile } = require('../profile');
const { parseQueueFiles, pairsToAdd, addToBacklog, removeFromBacklog } = require('../order');
const { Refusal, refuseIfServerRunning, checkName } = require('./question-admin');
const { splitList } = require('../learner');

/**
 * A user's profile and queue files, checked.
 *
 * @typedef {object} UserState
 * @property {string} email - The user.
 * @property {import('../profile').EffectiveProfile} profile - Their profile.
 * @property {import('../order').OrderFile} order - order.json (empty if there's none yet).
 * @property {import('../order').BacklogFile} backlog - backlog.json (empty if there's none yet).
 */

/**
 * Reads EMAIL's profile and queue files, refusing if anything is wrong.
 *
 * @returns {UserState} The user's state.
 * @throws {Refusal} If EMAIL is missing or not a user, or a file is invalid.
 */
function readUser() {
  const email = process.env.EMAIL;
  if (!email) throw new Refusal('EMAIL is required');
  if (!EMAIL_PATTERN.test(email) || !listUsers().includes(email)) {
    throw new Refusal(`${JSON.stringify(email)} isn't a user here: a user is a folder in the users folder, named by the email, holding submissions/ or profile.json`);
  }
  try {
    const profile = parseProfile(readUserFile(email, 'profile.json'));
    const { order, backlog } = parseQueueFiles(readUserFile(email, 'order.json'), readUserFile(email, 'backlog.json'));
    return { email, profile, order, backlog };
  } catch (err) {
    throw new Refusal(`${/** @type {Error} */ (err).message}: fix it first`);
  }
}

/**
 * Throws unless the backlog is a chosen one: with "all", the server adds
 * every pair itself, so an addition changes nothing and a removal comes
 * back at the next start.
 *
 * @param {UserState} user - The user.
 * @returns {void}
 * @throws {Refusal} If profile.json's backlog isn't "chosen".
 */
function requireChosen(user) {
  if (user.profile.backlog !== 'chosen') {
    throw new Refusal(`${user.email}'s profile.json doesn't have "backlog": "chosen", so the server keeps every question in the backlog itself. Add it (with the server stopped) first`);
  }
}

/**
 * SLUGS as a list of question names, each checked.
 *
 * @returns {string[]} The names, in the order given.
 * @throws {Refusal} If SLUGS is missing or a name isn't valid.
 */
function readSlugs() {
  const slugs = splitList(process.env.SLUGS);
  if (!slugs.length) throw new Refusal('SLUGS is required: question names, separated by spaces, e.g. SLUGS="hello-world two-sum"');
  return slugs.map((slug) => checkName('SLUGS', slug));
}

/**
 * AT as a number, if it's set.
 *
 * @returns {number | undefined} The position, counting from 1, or
 *   undefined for the end.
 * @throws {Refusal} If it's set but isn't a whole number (addToBacklog()
 *   checks its range).
 */
function readAt() {
  const at = process.env.AT;
  if (at === undefined || at === '') return undefined;
  if (!/^[0-9]+$/.test(at)) throw new Refusal(`AT=${JSON.stringify(at)} isn't a position: a whole number, 1 for the front`);
  return Number(at);
}

/**
 * One pair, as the commands show it.
 *
 * @param {import('../order').BacklogElement} p - The pair.
 * @returns {string} e.g. "two-sum in python".
 */
const named = (p) => `${p.question} in ${p.language}`;

/**
 * make backlog-show: the user's settings, queue and backlog, then every
 * question, oldest first, with where each of its pairs in a language turned
 * on is. Only reads.
 *
 * @returns {void}
 * @throws {Refusal} As readUser() does.
 */
function show() {
  const user = readUser();
  const { profile, order, backlog } = user;
  console.log(`${user.email}: backlog "${profile.backlog}"; languages turned on: ${profile.languages.join(', ')}`);
  console.log(`Queue (${order.queue.length}):${order.queue.length ? '' : ' empty'}`);
  order.queue.forEach(
    /**
     * Prints one queue element.
     *
     * @param {import('../order').QueueElement} e - The element.
     * @param {number} i - Its position.
     * @returns {void}
     */
    (e, i) => {
      const result = e.pass === 'yes' ? `✓ ×${e.passesInARow}` : e.pass === 'no' ? '✗' : '—';
      console.log(`  ${i + 1}. ${named(e)} ${result}`);
    },
  );
  console.log(`Backlog (${backlog.backlog.length}):${backlog.backlog.length ? '' : ' empty'}`);
  backlog.backlog.forEach((p, i) => console.log(`  ${i + 1}. ${named(p)}`));

  /** @type {Map<string, string>} */
  const where = new Map();
  order.queue.forEach((e, i) => where.set(named(e), `queue ${i + 1}`));
  backlog.backlog.forEach((p, i) => where.set(named(p), `backlog ${i + 1}`));
  const questions = [...questionInfos()].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.slug < b.slug ? -1 : 1));
  const width = Math.max(...questions.map((q) => q.slug.length));
  console.log(`Every question, oldest first (${questions.length}):`);
  for (const q of questions) {
    const pairs = profile.languages.filter((l) => q.languages.includes(l)).map((language) => `${language}: ${where.get(named({ question: q.slug, language })) ?? 'not chosen'}`);
    console.log(`  ${q.slug.padEnd(width)}  ${q.created.slice(0, 10)}  ${q.difficulty.padEnd(6)}  ${pairs.join(', ') || '(none of your languages)'}  ${q.title}`);
  }
}

/**
 * make backlog-add: adds SLUGS, in that order, in each language turned on,
 * at AT or the end.
 *
 * @param {boolean} dryRun - Show, and change nothing.
 * @returns {Promise<void>} Resolves when done.
 * @throws {Refusal} If anything checked first isn't right.
 */
async function add(dryRun) {
  const user = readUser();
  requireChosen(user);
  const slugs = readSlugs();
  const at = readAt();
  let result;
  try {
    result = addToBacklog(user.order, user.backlog, pairsToAdd(slugs, questionInfos(), user.profile), at);
  } catch (err) {
    throw new Refusal(/** @type {Error} */ (err).message);
  }
  await refuseIfServerRunning();
  report(user, result.backlog, dryRun, [...result.added.map((p) => `added: ${named(p)}`), ...result.skipped.map((s) => `not added: ${s}`)]);
}

/**
 * make backlog-remove: takes SLUGS out of the backlog, in every language.
 *
 * @param {boolean} dryRun - Show, and change nothing.
 * @returns {Promise<void>} Resolves when done.
 * @throws {Refusal} If anything checked first isn't right.
 */
async function remove(dryRun) {
  const user = readUser();
  requireChosen(user);
  const result = removeFromBacklog(user.order, user.backlog, readSlugs());
  await refuseIfServerRunning();
  report(user, result.backlog, dryRun, [...result.removed.map((p) => `removed: ${named(p)}`), ...result.notRemoved.map((s) => `not removed: ${s}`)]);
}

/**
 * Prints what changed and the backlog after, then writes it, unless it's a
 * dry run or nothing changed.
 *
 * @param {UserState} user - The user, with the backlog before.
 * @param {import('../order').BacklogFile} after - The new backlog.
 * @param {boolean} dryRun - Write nothing.
 * @param {string[]} lines - What happened to each pair named.
 * @returns {void}
 */
function report(user, after, dryRun, lines) {
  for (const line of lines) console.log(`  ${line}`);
  console.log(`Backlog after (${after.backlog.length}): ${after.backlog.map((p, i) => `${i + 1}. ${named(p)}`).join(', ') || 'empty'}`);
  if (JSON.stringify(after) === JSON.stringify(user.backlog)) {
    console.log('Nothing to change.');
  } else if (dryRun) {
    console.log('Dry run: nothing was written.');
  } else {
    writeUserFile(user.email, 'backlog.json', after);
    console.log(`Written: ${user.email}'s backlog.json.`);
  }
}

/**
 * Runs the command named on the command line, and sets the exit code.
 *
 * @returns {Promise<void>} Resolves when done.
 */
async function main() {
  const command = process.argv[2];
  const dryRun = Boolean(process.env.DRY_RUN);
  try {
    if (command === 'show') show();
    else if (command === 'add') await add(dryRun);
    else if (command === 'remove') await remove(dryRun);
    else throw new Refusal(`unknown command ${JSON.stringify(command)}: show, add or remove`);
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    console.error(`Refused: ${err.message}`);
    process.exitCode = 1;
  }
}

main();

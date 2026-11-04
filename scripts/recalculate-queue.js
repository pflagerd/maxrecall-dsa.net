'use strict';

// make recalculate-queue EMAIL=… (docs/plans/spaced-repetition.md, step 12,
// first part): rewrites one learner's order.json and backlog.json as the
// replay of their records makes them (recalculate.js). EMAIL and DRY_RUN
// come from the environment, as for make rename-question.
//
//   EMAIL=owner@example.com DRY_RUN=1 node scripts/recalculate-queue.js
//
// Refuses, changing nothing, unless EMAIL is a user, their profile and
// every record can be read, renames.json is valid, and no server answers
// on 127.0.0.1:$PORT (or $TRUSTED_PORT). Shows the queue before and after.
// Unless DRY_RUN, keeps a copy of both files (<name>.before-recalculate-
// <UTC time to the millisecond>) and writes the new ones, backlog.json first. Exits 0 when
// done, 1 when refused.

const { EMAIL_PATTERN, listUsers, readUserFile, writeUserFile, backupUserFile, readAllRecords } = require('../users');
const { questionInfos, readRenamesText } = require('../question-files');
const { parseProfile } = require('../profile');
const { parseQueueFiles, canOpenPair } = require('../order');
const { parseRenames } = require('../consistency');
const { recalculate, seededRandom, seedFor } = require('../recalculate');
const { Refusal, refuseIfServerRunning } = require('./question-admin');

/** How many pairs of each queue the summary shows. @type {number} */
const SHOWN = 10;

/**
 * One queue, as the summary shows it: its length, then its first pairs
 * with their results.
 *
 * @param {import('../order').OrderFile} order - order.json.
 * @param {(pair: import('../order').BacklogElement) => boolean} canOpen - Marks pairs passed over.
 * @returns {string} e.g. "3 pairs: 1. two-sum in python ✓ ×2, …".
 */
function describeQueue(order, canOpen) {
  const shown = order.queue.slice(0, SHOWN).map(
    /**
     * One pair.
     *
     * @param {import('../order').QueueElement} e - The element.
     * @param {number} i - Its position.
     * @returns {string} e.g. "1. two-sum in python ✓ ×2".
     */
    (e, i) => {
      const result = e.pass === 'yes' ? `✓ ×${e.passesInARow}` : e.pass === 'no' ? '✗' : '—';
      return `${i + 1}. ${e.question} in ${e.language} ${result}${canOpen(e) ? '' : ' (passed over)'}`;
    },
  );
  const more = order.queue.length > SHOWN ? `, and ${order.queue.length - SHOWN} more` : '';
  return `${order.queue.length} ${order.queue.length === 1 ? 'pair' : 'pairs'}${shown.length ? `: ${shown.join(', ')}` : ''}${more}`;
}

/**
 * Recalculates EMAIL's queue, or shows what it would be.
 *
 * @param {boolean} dryRun - Show, and change nothing.
 * @returns {Promise<void>} Resolves when done.
 * @throws {Refusal} If anything checked first isn't right.
 */
async function recalculateQueue(dryRun) {
  const email = process.env.EMAIL;
  if (!email) throw new Refusal('EMAIL is required');
  if (!EMAIL_PATTERN.test(email) || !listUsers().includes(email)) throw new Refusal(`${JSON.stringify(email)} isn't a user here (make consistency-check lists them)`);
  let profile;
  try {
    profile = parseProfile(readUserFile(email, 'profile.json'));
  } catch (err) {
    throw new Refusal(`${/** @type {Error} */ (err).message}: fix it first`);
  }
  const { records, unreadable } = await readAllRecords(email);
  if (unreadable.length) throw new Refusal(`${unreadable.length} of ${email}'s records can't be read, so the replay would leave them out: ${unreadable.map((u) => u.id).join(', ')}`);
  let renames;
  try {
    renames = parseRenames(readRenamesText());
  } catch (err) {
    throw new Refusal(`questions/renames.json: ${/** @type {Error} */ (err).message}`);
  }
  await refuseIfServerRunning();
  const questions = questionInfos();
  const canOpen = canOpenPair(profile, questions);

  /** @type {{ order: import('../order').OrderFile, backlog: import('../order').BacklogFile } | undefined} */
  let before;
  let invalid = '';
  try {
    before = parseQueueFiles(readUserFile(email, 'order.json'), readUserFile(email, 'backlog.json'));
  } catch (err) {
    invalid = /** @type {Error} */ (err).message;
    // A chosen backlog is read from these files (step 13, detail 3), so
    // replacing them would lose the choice.
    if (profile.backlog === 'chosen') throw new Refusal(`${invalid}: fix it first, since the chosen backlog is read from it`);
  }

  const result = recalculate(records, questions, profile, renames, seededRandom(seedFor(email)), before);
  console.log(`Recalculate ${email}'s queue from ${result.replayed} ${result.replayed === 1 ? 'record' : 'records'}${profile.backlog === 'chosen' ? ', starting from the pairs chosen' : ''}${dryRun ? ' (dry run: nothing is written)' : ''}`);
  if (result.leftOut) console.log(`  ${result.leftOut} left out: their question is gone`);
  if (before) {
    console.log(`  queue before: ${describeQueue(before.order, canOpen)}`);
    console.log(`  backlog before: ${before.backlog.backlog.length} pairs`);
  } else {
    console.log(`  the files now are invalid (${invalid}); they'd be replaced`);
  }
  console.log(`  queue after: ${describeQueue(result.order, canOpen)}`);
  console.log(`  backlog after: ${result.backlog.backlog.length} pairs`);
  if (dryRun) return;

  // To the millisecond, so two runs never collide (copies are never overwritten).
  const label = `recalculate-${new Date().toISOString().replace(/[-:.]/g, '')}`;
  for (const name of ['order.json', 'backlog.json']) {
    const copy = backupUserFile(email, name, label);
    if (copy) console.log(`  kept a copy: ${copy}`);
  }
  writeUserFile(email, 'backlog.json', result.backlog);
  writeUserFile(email, 'order.json', result.order);
  console.log('Done. make consistency-check should now find nothing for this user to do with check 6.');
}

/**
 * Runs it, and sets the exit code.
 *
 * @returns {Promise<void>} Resolves when done.
 */
async function main() {
  try {
    await recalculateQueue(Boolean(process.env.DRY_RUN));
  } catch (err) {
    console.error(`Refused: ${/** @type {Error} */ (err).message}`);
    process.exitCode = 1;
  }
}

main();

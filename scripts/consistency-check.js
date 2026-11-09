'use strict';

// make consistency-check (docs/plans/spaced-repetition.md, D5; step 10):
// reads the sources of truth, runs consistency.js's check, and prints what
// it finds, grouped by user. Only reads. Exits 1 if there's an error (an
// invalid file), 0 otherwise, even with warnings, which often have harmless
// causes (step 10, detail 2); 2 if the sources can't be read at all.
// `--verbose` (VERBOSE=1 for make) lists each backlog pair with records.
// server.js uses readSources() too, for its log at start.

const { USERS_DIR, listUsers, readUserFile, readAllRecords, testBankRefusal } = require('../users');
const { questionInfos, readRenamesText } = require('../question-files');
const { checkConsistency, countLevels, formatFinding, describeCounts } = require('../consistency');

/**
 * Reads everything the check compares (consistency.js, Sources): every
 * question, the rename log, and every user's files and records.
 *
 * @returns {Promise<import('../consistency').Sources>} The sources.
 * @throws {Error} If questions/ or a question file, the users folder, or a
 *   user's files can't be read (an invalid file is the check's to report,
 *   not an error here).
 */
async function readSources() {
  const questions = questionInfos();
  const renamesText = readRenamesText();
  /** @type {import('../consistency').UserSources[]} */
  const users = [];
  for (const email of listUsers()) {
    const { records, unreadable } = await readAllRecords(email);
    users.push({
      email,
      profileText: readUserFile(email, 'profile.json'),
      orderText: readUserFile(email, 'order.json'),
      backlogText: readUserFile(email, 'backlog.json'),
      records,
      unreadable,
    });
  }
  return { questions, renamesText, users };
}

/**
 * Prints every finding, grouped by user, then the totals, and sets the
 * exit code (1 if there's an error).
 *
 * @returns {Promise<void>} Rejects if the sources can't be read, or if
 *   testBankRefusal() refuses.
 */
async function main() {
  // A test question bank only with a test users folder (owner, 2026-11-09,
  // B2): reported below as "Consistency check not run", exit code 2.
  const refused = testBankRefusal();
  if (refused) throw new Error(refused);
  const verbose = process.argv.includes('--verbose');
  const sources = await readSources();
  const findings = checkConsistency(sources, { verbose });
  console.log(`Consistency check: ${sources.questions.length} questions; ${sources.users.length} ${sources.users.length === 1 ? 'user' : 'users'} in ${USERS_DIR}`);
  for (const f of findings.filter((x) => x.email === '')) console.log(formatFinding(f));
  for (const { email } of sources.users) {
    const own = findings.filter((f) => f.email === email);
    console.log(`${email}: ${own.length ? describeCounts(countLevels(own)) : 'nothing found'}`);
    for (const f of own) console.log(`  ${formatFinding(f)}`);
  }
  const counts = countLevels(findings);
  console.log(`Total: ${describeCounts(counts)}`);
  process.exitCode = counts.error ? 1 : 0;
}

if (require.main === module) {
  main().catch(
    /**
     * Reports sources that couldn't be read at all.
     *
     * @param {Error} err - Why.
     * @returns {void}
     */
    (err) => {
      console.error(`Consistency check not run: ${err.message}`);
      process.exitCode = 2;
    },
  );
}

module.exports = { readSources };

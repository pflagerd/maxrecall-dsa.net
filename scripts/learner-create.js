'use strict';

// make learner-create EMAIL=… LANGUAGES=… SLUGS=… (docs/plans/spaced-
// repetition.md, step 14; limited-live Q3, option (c)): sets up a new
// learner before their invite goes out. The values come from the
// environment, as for make backlog-add, so make never pastes them into a
// shell command.
//
//   EMAIL=tester@example.com LANGUAGES=python SLUGS="hello-world two-sum" node scripts/learner-create.js
//
// Writes their folder, users/<email>/, with profile.json (allowed.languages,
// "backlog": "chosen"), an empty order.json and backlog.json, all at once
// (users.js, createUser). Refuses, changing nothing, if the email isn't
// valid, a language or question isn't, or the folder exists already (it
// never replaces anyone: make backlog-add and backlog-remove change an
// existing learner). The server can keep running (detail 6): nothing else
// writes the folder of someone with no account yet, and the server reads a
// learner's files at each request. It doesn't make the invite; it prints
// the command for it. DRY_RUN=1 shows the files and writes nothing. Exits 0
// when done, 1 when refused.

const fs = require('fs');
const path = require('path');

const { USERS_DIR, EMAIL_PATTERN, createUser } = require('../users');
const { questionInfos } = require('../question-files');
const { splitList, newLearnerFiles } = require('../learner');
const { Refusal, checkName } = require('./question-admin');

/**
 * Why a learner whose folder exists isn't set up again (detail 6).
 *
 * @param {string} email - The learner, lower case.
 * @returns {string} The refusal's message, saying what to use instead.
 */
function alreadyThere(email) {
  return `${email} already has a folder in ${USERS_DIR}: they're set up already, or have used the app. `
    + `make backlog-show EMAIL=${email} shows what's there; make backlog-add and backlog-remove change it`;
}

/**
 * Sets up the learner $EMAIL, or shows what it would write.
 *
 * @param {boolean} dryRun - Show, and write nothing.
 * @returns {void}
 * @throws {Refusal} If anything checked first isn't right, or the folder
 *   exists.
 */
function learnerCreate(dryRun) {
  const raw = process.env.EMAIL;
  if (!raw) throw new Refusal('EMAIL is required: who the learner is, e.g. EMAIL=tester@example.com');
  // Lower case, as registering makes it (auth.js, normalizeEmail; detail
  // 2), so this is the folder their work will go to.
  const email = raw.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Refusal(`EMAIL=${JSON.stringify(raw)} isn't an email address this app accepts`);
  const dir = path.join(USERS_DIR, email);
  // Checked first, so a refusal shows nothing that looks like a plan;
  // createUser() checks again when it writes.
  if (fs.existsSync(dir)) throw new Refusal(alreadyThere(email));
  const languages = splitList(process.env.LANGUAGES);
  if (!languages.length) throw new Refusal('LANGUAGES is required: the languages they may use, the first being their default, e.g. LANGUAGES=python');
  const slugs = splitList(process.env.SLUGS);
  if (!slugs.length) throw new Refusal('SLUGS is required: their questions, in order, e.g. SLUGS="hello-world two-sum" (make backlog-show EMAIL=<anyone> lists them all)');
  slugs.forEach((slug) => checkName('SLUGS', slug));

  let files;
  try {
    files = newLearnerFiles(languages, slugs, questionInfos());
  } catch (err) {
    throw new Refusal(/** @type {Error} */ (err).message);
  }

  console.log(`Learner ${email}${email === raw ? '' : ` (lower case, as registering makes it; given as ${JSON.stringify(raw)})`}, in ${dir}:`);
  console.log(`  profile.json: ${JSON.stringify(files.profile)}`);
  console.log(`  backlog (${files.backlog.backlog.length}): ${files.backlog.backlog.map((p, i) => `${i + 1}. ${p.question} in ${p.language}`).join(', ')}`);
  console.log('  queue: empty');
  if (dryRun) {
    console.log('Dry run: nothing was written.');
    return;
  }
  try {
    createUser(email, { 'profile.json': files.profile, 'order.json': files.order, 'backlog.json': files.backlog });
  } catch (err) {
    if (/** @type {Error & { code?: string }} */ (err).code !== 'USER_EXISTS') throw err;
    throw new Refusal(alreadyThere(email));
  }
  console.log(`Written. Next, their invite (docs/deploy-vps.md, section 11): make invite EMAIL=${email}`);
  console.log(`  on the VPS: sudo -u maxrecall env MAXRECALL_AUTH_DIR=/srv/maxrecall/data/auth make invite EMAIL=${email}`);
}

/**
 * Runs it, and sets the exit code.
 *
 * @returns {void}
 */
function main() {
  try {
    learnerCreate(Boolean(process.env.DRY_RUN));
  } catch (err) {
    if (!(err instanceof Refusal)) throw err;
    console.error(`Refused: ${err.message}`);
    process.exitCode = 1;
  }
}

main();

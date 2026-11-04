'use strict';

// make delete-question and make rename-question (docs/plans/spaced-
// repetition.md, D5; step 11). The names come from the environment
// (SLUG, or FROM and TO; DRY_RUN=1 for a dry run), not from arguments, so
// make never pastes them into a shell command: GNU make puts command-line
// variables into a recipe's environment.
//
//   SLUG=two-sum node scripts/question-admin.js delete
//   FROM=two-sum TO=pair-sum node scripts/question-admin.js rename
//
// Each one: refuses unless the names are valid, no server answers on
// 127.0.0.1:$PORT (or $TRUSTED_PORT), and every user's queue files are
// valid; then changes the question file with git (staged, not committed),
// unless that already happened (a git pull on the VPS); then updates every
// user's order.json and backlog.json. Records are never changed. Exits 0
// when done (or nothing to do), 1 when refused.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { listUsers, readUserFile, writeUserFile } = require('../users');
const { QUESTIONS_DIR, RENAMES_FILE, readRenamesText } = require('../question-files');
const { parseRenames, updateRenames } = require('../consistency');
const { parseQueueFiles, removeReferences, renameReferences } = require('../order');

/** A question's name: lowercase letters and digits, joined by single hyphens (detail 5). @type {RegExp} */
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** The repository, for git. @type {string} */
const REPO = path.dirname(QUESTIONS_DIR);

/**
 * Why the command stops without changing anything.
 */
class Refusal extends Error {}

/**
 * Throws unless a name is a valid question name.
 *
 * @param {string} variable - Where it came from, e.g. "SLUG", for the message.
 * @param {string | undefined} name - Its value.
 * @returns {string} The name.
 * @throws {Refusal} If it's missing or doesn't match NAME_PATTERN.
 */
function checkName(variable, name) {
  if (!name) throw new Refusal(`${variable} is required`);
  if (!NAME_PATTERN.test(name)) throw new Refusal(`${variable}=${JSON.stringify(name)} isn't a question name (lowercase letters, digits and single hyphens)`);
  return name;
}

/**
 * Throws if a server answers on 127.0.0.1 at $PORT (default 3000) or
 * $TRUSTED_PORT, since its Submits rewrite order.json too and one change
 * could be lost (detail 1). A server on another port, not named in the
 * environment, can't be seen.
 *
 * @returns {Promise<void>} Resolves when no server answered.
 * @throws {Refusal} If one did.
 */
async function refuseIfServerRunning() {
  const ports = [process.env.PORT || '3000', process.env.TRUSTED_PORT].filter(Boolean);
  for (const port of ports) {
    try {
      await fetch(`http://127.0.0.1:${port}/login.html`, { signal: AbortSignal.timeout(1000) });
    } catch {
      continue; // nothing there (connection refused, or no answer in a second)
    }
    throw new Refusal(`a server answers on 127.0.0.1:${port}: stop it first, since its Submits rewrite order.json too`);
  }
}

/**
 * Every user's queue files, read and checked before anything changes, so
 * an invalid one refuses the whole command (fail closed).
 *
 * @returns {{ email: string, order: import('../order').OrderFile, backlog: import('../order').BacklogFile }[]}
 *   Each user's files.
 * @throws {Refusal} Naming each user whose files are invalid.
 */
function readAllQueues() {
  const queues = [];
  const problems = [];
  for (const email of listUsers()) {
    try {
      queues.push({ email, ...parseQueueFiles(readUserFile(email, 'order.json'), readUserFile(email, 'backlog.json')) });
    } catch (err) {
      problems.push(`${email}: ${/** @type {Error} */ (err).message}`);
    }
  }
  if (problems.length) throw new Refusal(`fix these first (make consistency-check shows them too):\n  ${problems.join('\n  ')}`);
  return queues;
}

/**
 * Runs git in the repository.
 *
 * @param {string[]} args - git's arguments, e.g. ["rm", "--", "questions/a.json"].
 * @returns {void}
 * @throws {Error} If git fails (its message included).
 */
function git(args) {
  execFileSync('git', ['-C', REPO, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
}

/**
 * Writes one user's changed files: backlog.json first, then order.json, as
 * updateQueue() does in server.js, so a crash between them leaves a pair
 * in neither file (put back at the next start), not in both.
 *
 * @param {string} email - The user.
 * @param {{ order: import('../order').OrderFile, backlog: import('../order').BacklogFile }} before - The files as read.
 * @param {{ order: import('../order').OrderFile, backlog: import('../order').BacklogFile }} after - The files to write.
 * @returns {void}
 */
function writeQueues(email, before, after) {
  if (JSON.stringify(after.backlog) !== JSON.stringify(before.backlog)) writeUserFile(email, 'backlog.json', after.backlog);
  if (JSON.stringify(after.order) !== JSON.stringify(before.order)) writeUserFile(email, 'order.json', after.order);
}

/**
 * make delete-question: git rm questions/<SLUG>.json, unless it's already
 * gone, then removes the question from every user's files.
 *
 * @param {boolean} dryRun - Print what would change, and change nothing.
 * @returns {Promise<void>} Resolves when done.
 * @throws {Refusal} If SLUG is invalid, is an old name in renames.json,
 *   a server is running, or a user's files are invalid.
 */
async function deleteQuestion(dryRun) {
  const slug = checkName('SLUG', process.env.SLUG);
  const renames = parseRenames(readRenamesText());
  if (Object.hasOwn(renames, slug)) throw new Refusal(`${slug} is an old name (renames.json: it became ${renames[slug]}); delete ${renames[slug]} instead`);
  await refuseIfServerRunning();
  const queues = readAllQueues();
  const file = `questions/${slug}.json`;
  const exists = fs.existsSync(path.join(REPO, file));

  console.log(`Delete ${slug}${dryRun ? ' (dry run: nothing is written)' : ''}`);
  console.log(`  ${file}: ${exists ? 'git rm' : 'already gone (e.g. by git pull): only the references'}`);
  const changes = queues.map((q) => ({ q, result: removeReferences(q.order, q.backlog, slug) }));
  for (const { q, result } of changes) console.log(`  ${q.email}: ${result.removed.length ? `removes ${result.removed.join('; ')}` : 'nothing to change'}`);
  if (dryRun) return;

  if (exists) git(['rm', '--quiet', '--', file]);
  for (const { q, result } of changes) writeQueues(q.email, q, result);
  if (exists) console.log(`Done. Staged, not committed: git commit -m "Delete question ${slug}"`);
  else console.log('Done.');
}

/**
 * make rename-question: git mv questions/<FROM>.json to <TO>.json, sets its
 * slug, and records the rename in renames.json (all staged), unless that
 * already happened; then renames the question in every user's files.
 *
 * @param {boolean} dryRun - Print what would change, and change nothing.
 * @returns {Promise<void>} Resolves when done.
 * @throws {Refusal} If a name is invalid, TO already exists, FROM neither
 *   exists nor is recorded as renamed to TO, a server is running, a user's
 *   files are invalid, or the file's slug line can't be found.
 */
async function renameQuestion(dryRun) {
  const from = checkName('FROM', process.env.FROM);
  const to = checkName('TO', process.env.TO);
  if (from === to) throw new Refusal('FROM and TO are the same');
  const renames = parseRenames(readRenamesText());
  const fromFile = `questions/${from}.json`;
  const toFile = `questions/${to}.json`;
  const fromExists = fs.existsSync(path.join(REPO, fromFile));
  const toExists = fs.existsSync(path.join(REPO, toFile));
  let moveFile;
  if (fromExists && !toExists) moveFile = true;
  else if (!fromExists && toExists && renames[from] === to) moveFile = false; // already renamed (git pull)
  else if (toExists) throw new Refusal(`${toFile} already exists`);
  else throw new Refusal(`${fromFile} doesn't exist, and renames.json doesn't say it became ${to}`);
  await refuseIfServerRunning();
  const queues = readAllQueues();

  console.log(`Rename ${from} to ${to}${dryRun ? ' (dry run: nothing is written)' : ''}`);
  if (moveFile) {
    console.log(`  ${fromFile}: git mv to ${toFile}, its slug set to "${to}"`);
    console.log(`  questions/${RENAMES_FILE}: ${JSON.stringify(updateRenames(renames, from, to))}`);
  } else {
    console.log(`  ${toFile}: already renamed (e.g. by git pull): only the references`);
  }
  const changes = queues.map((q) => ({ q, result: renameReferences(q.order, q.backlog, from, to) }));
  for (const { q, result } of changes) {
    const parts = [...(result.renamed.length ? [`renames ${result.renamed.join('; ')}`] : []), ...result.dropped.map((d) => `drops ${d}`)];
    console.log(`  ${q.email}: ${parts.length ? parts.join('; ') : 'nothing to change'}`);
  }
  if (dryRun) return;

  if (moveFile) {
    const text = fs.readFileSync(path.join(REPO, fromFile), 'utf8');
    const slugLine = `"slug": ${JSON.stringify(from)}`;
    if (text.split(slugLine).length !== 2) throw new Refusal(`${fromFile} doesn't have exactly one ${slugLine} line; nothing changed`);
    git(['mv', '--', fromFile, toFile]);
    fs.writeFileSync(path.join(REPO, toFile), text.replace(slugLine, `"slug": ${JSON.stringify(to)}`));
    fs.writeFileSync(path.join(QUESTIONS_DIR, RENAMES_FILE), `${JSON.stringify(updateRenames(renames, from, to), null, 2)}\n`);
    git(['add', '--', toFile, `questions/${RENAMES_FILE}`]);
  }
  for (const { q, result } of changes) writeQueues(q.email, q, result);
  if (moveFile) console.log(`Done. Staged, not committed: git commit -m "Rename question ${from} to ${to}"`);
  else console.log('Done.');
}

/**
 * Runs the command named by the first argument.
 *
 * @returns {Promise<void>} Resolves when done; sets the exit code.
 */
async function main() {
  const dryRun = Boolean(process.env.DRY_RUN);
  try {
    const command = process.argv[2];
    if (command === 'delete') await deleteQuestion(dryRun);
    else if (command === 'rename') await renameQuestion(dryRun);
    else throw new Refusal('usage: SLUG=… node scripts/question-admin.js delete, or FROM=… TO=… node scripts/question-admin.js rename');
  } catch (err) {
    console.error(`Refused: ${/** @type {Error} */ (err).message}`);
    process.exitCode = 1;
  }
}

main();

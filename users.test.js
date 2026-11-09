'use strict';

// Tests for users.js's user file functions (profile.json, order.json,
// backlog.json) and listUsers(). Run with `make test`. They
// use a temporary users folder: MAXRECALL_USERS_DIR is set before users.js
// is loaded, since it reads it once, when loaded.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const USERS = fs.mkdtempSync(path.join(os.tmpdir(), 'users-test-'));
process.env.MAXRECALL_USERS_DIR = USERS;
const { readProfileFile, writeProfileFile, readUserFile, writeUserFile, createUser, listUsers, testBankRefusal, TEST_USERS_MARKER } = require('./users');
const { spawnSync } = require('child_process');

after(() => fs.rmSync(USERS, { recursive: true, force: true }));

const EMAIL = 'learner@example.com';

test('no profile.json reads as undefined', () => {
  assert.equal(readProfileFile(EMAIL), undefined);
});

test('a written profile reads back, in users/<email>/profile.json, ending in a newline', () => {
  const contents = { schemaVersion: 1, preferred: { languages: ['python'] } };
  writeProfileFile(EMAIL, contents);
  const file = path.join(USERS, EMAIL, 'profile.json');
  assert.ok(fs.existsSync(file));
  const text = /** @type {string} */ (readProfileFile(EMAIL));
  assert.deepEqual(JSON.parse(text), contents);
  assert.ok(text.endsWith('\n'));
});

test('writing again replaces the file, and leaves no temporary file behind', () => {
  writeProfileFile(EMAIL, { schemaVersion: 1, preferred: { defaultLanguage: 'd' } });
  assert.deepEqual(JSON.parse(/** @type {string} */ (readProfileFile(EMAIL))), { schemaVersion: 1, preferred: { defaultLanguage: 'd' } });
  assert.deepEqual(fs.readdirSync(path.join(USERS, EMAIL)), ['profile.json']);
});

test('an email that could reach outside users/ is refused, for reading and writing', () => {
  for (const bad of ['../etc', 'a/b@example.com', 'not-an-email', '']) {
    assert.throws(() => readProfileFile(bad), /Invalid user/);
    assert.throws(() => writeProfileFile(bad, { schemaVersion: 1 }), /Invalid user/);
  }
});

test('order.json and backlog.json are written and read the same way, beside profile.json', () => {
  writeUserFile(EMAIL, 'order.json', { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: [] });
  writeUserFile(EMAIL, 'backlog.json', { schemaVersion: 1, backlog: [] });
  assert.deepEqual(JSON.parse(/** @type {string} */ (readUserFile(EMAIL, 'order.json'))).queue, []);
  assert.deepEqual(fs.readdirSync(path.join(USERS, EMAIL)).sort(), ['backlog.json', 'order.json', 'profile.json']);
});

test('only the known file names are read or written', () => {
  for (const bad of ['../profile.json', 'submissions', 'other.json', '']) {
    assert.throws(() => readUserFile(EMAIL, bad), /Unknown user file/);
    assert.throws(() => writeUserFile(EMAIL, bad, {}), /Unknown user file/);
  }
});

test('listUsers finds folders named by an email that hold submissions/ or profile.json', () => {
  fs.mkdirSync(path.join(USERS, 'submitter@example.com', 'submissions'), { recursive: true });
  fs.mkdirSync(path.join(USERS, 'empty@example.com')); // neither: not a user yet
  fs.mkdirSync(path.join(USERS, 'not-an-email', 'submissions'), { recursive: true });
  fs.writeFileSync(path.join(USERS, 'stray@example.com'), ''); // a file, not a folder
  assert.deepEqual(listUsers(), [EMAIL, 'submitter@example.com']);
});

// Step 14: createUser() for make learner-create.

const FILES = {
  'profile.json': { schemaVersion: 1, allowed: { languages: ['python'] }, backlog: 'chosen' },
  'order.json': { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: [] },
  'backlog.json': { schemaVersion: 1, backlog: [{ question: 'hello-world', language: 'python' }] },
};

/**
 * The names in the users folder that aren't a user's: createUser()'s
 * temporary folders, which must never be left behind.
 *
 * @returns {string[]} Their names.
 */
const leftovers = () => fs.readdirSync(USERS).filter((name) => name.startsWith('.new-user-'));

test('createUser writes every file into a new folder, as writeUserFile would, and the user is listed', () => {
  const dir = createUser('new@example.com', FILES);
  assert.equal(dir, path.join(USERS, 'new@example.com'));
  for (const [name, contents] of Object.entries(FILES)) {
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), `${JSON.stringify(contents, null, 2)}\n`);
    assert.deepEqual(JSON.parse(/** @type {string} */ (readUserFile('new@example.com', name))), contents);
  }
  assert.ok(listUsers().includes('new@example.com'));
  assert.deepEqual(leftovers(), []);
});

test('createUser refuses a user whose folder exists, even an empty one, and changes nothing (detail 6)', () => {
  fs.mkdirSync(path.join(USERS, 'bare@example.com'));
  for (const email of ['new@example.com', 'bare@example.com']) {
    const before = fs.readdirSync(path.join(USERS, email)).sort();
    assert.throws(() => createUser(email, FILES), (/** @type {any} */ err) => err.code === 'USER_EXISTS');
    assert.deepEqual(fs.readdirSync(path.join(USERS, email)).sort(), before);
  }
  assert.deepEqual(leftovers(), []);
});

test('createUser refuses an invalid email or file name before writing anything', () => {
  assert.throws(() => createUser('../escape@example.com', FILES), /Invalid user/);
  assert.throws(() => createUser('Upper@Example.com', FILES), /Invalid user/, 'folder names are lower case');
  // Cast: the type allows only USER_FILES' names; this checks the refusal at run time.
  assert.throws(() => createUser('odd@example.com', /** @type {any} */ ({ 'notes.txt': {} })), /Unknown user file/);
  assert.ok(!fs.existsSync(path.join(USERS, 'odd@example.com')));
  assert.deepEqual(leftovers(), []);
});

test('createUser removes its temporary folder if a file can\'t be written', () => {
  /** @type {any} */
  const circular = {};
  circular.self = circular; // JSON.stringify throws on it
  assert.throws(() => createUser('broken@example.com', { 'profile.json': circular }), TypeError);
  assert.ok(!fs.existsSync(path.join(USERS, 'broken@example.com')));
  assert.deepEqual(leftovers(), []);
});

test('while createUser writes, its temporary folder is there but never listed as a user (detail 5)', () => {
  /** @type {{ dirs: string[], users: string[] } | null} */
  let during = null;
  // JSON.stringify calls toJSON while createUser is writing the files into
  // its temporary folder, so this looks at the folder at that moment.
  const profile = {
    /**
     * Records what's in the users folder, then gives the file's contents.
     *
     * @returns {object} profile.json's contents.
     */
    toJSON() {
      during = { dirs: leftovers(), users: listUsers() };
      return FILES['profile.json'];
    },
  };
  createUser('during@example.com', { ...FILES, 'profile.json': profile });
  assert.ok(during, 'toJSON was called');
  const seen = /** @type {{ dirs: string[], users: string[] }} */ (during);
  assert.equal(seen.dirs.length, 1, 'the temporary folder exists while writing');
  assert.ok(!seen.dirs[0].includes('@'), 'its name has no "@"');
  assert.ok(!seen.users.includes('during@example.com'), 'the user is not listed until the rename');
  assert.ok(!seen.users.some((u) => u.startsWith('.new-user-')), 'nor is the temporary folder');
  assert.ok(listUsers().includes('during@example.com'), 'listed afterwards');
  assert.deepEqual(leftovers(), []);
});

test('a temporary folder is never listed as a user: its name has no "@"', () => {
  fs.mkdirSync(path.join(USERS, '.new-user-abc123'));
  fs.writeFileSync(path.join(USERS, '.new-user-abc123', 'profile.json'), '{}');
  assert.ok(!listUsers().some((u) => u.startsWith('.new-user-')));
  fs.rmSync(path.join(USERS, '.new-user-abc123'), { recursive: true });
});

// ---- A test question bank needs a test users folder (owner, 2026-11-09, B2) ----

test('testBankRefusal: no test bank, or a users folder marked as test data, is fine; anything else refuses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-bank-'));
  try {
    assert.equal(testBankRefusal({}, dir), null, 'no MAXRECALL_QUESTIONS_DIR');
    assert.equal(testBankRefusal({ MAXRECALL_QUESTIONS_DIR: '' }, dir), null, 'empty counts as unset, as question-files.js reads it');
    const bank = { MAXRECALL_QUESTIONS_DIR: '/somewhere/test-questions' };
    assert.match(String(testBankRefusal(bank, dir)), /MAXRECALL_QUESTIONS_DIR is set .*has no TEST-USERS file/, 'a test bank, an unmarked folder');
    // MAXRECALL_USERS_DIR being set says nothing: the live service sets it for its real folder.
    assert.notEqual(testBankRefusal({ ...bank, MAXRECALL_USERS_DIR: dir }, dir), null, 'MAXRECALL_USERS_DIR alone isn\'t a mark');
    fs.mkdirSync(path.join(dir, TEST_USERS_MARKER));
    assert.notEqual(testBankRefusal(bank, dir), null, 'a folder named like the marker isn\'t the marker');
    fs.rmdirSync(path.join(dir, TEST_USERS_MARKER));
    fs.writeFileSync(path.join(dir, TEST_USERS_MARKER), '');
    assert.equal(testBankRefusal(bank, dir), null, 'the marker file: a test users folder');
    assert.ok(!listUsers().includes(TEST_USERS_MARKER), 'the marker is never taken for a user');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the admin scripts refuse a test question bank with an unmarked users folder, and write nothing', () => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-bank-users-'));
  const questionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-bank-questions-'));
  try {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, MAXRECALL_USERS_DIR: usersDir, MAXRECALL_QUESTIONS_DIR: questionsDir };
    // Each script's usual way of refusing: "Refused:" and 1, or the consistency check's "not run" and 2.
    /** @type {[string, string[], number, RegExp][]} */
    const scripts = [
      ['scripts/backlog.js', ['show'], 1, /^Refused: MAXRECALL_QUESTIONS_DIR is set/m],
      ['scripts/learner-create.js', [], 1, /^Refused: MAXRECALL_QUESTIONS_DIR is set/m],
      ['scripts/recalculate-queue.js', [], 1, /^Refused: MAXRECALL_QUESTIONS_DIR is set/m],
      ['scripts/consistency-check.js', [], 2, /^Consistency check not run: MAXRECALL_QUESTIONS_DIR is set/m],
    ];
    for (const [script, args, status, message] of scripts) {
      const run = spawnSync(process.execPath, [script, ...args], { cwd: __dirname, env: { ...env, EMAIL: 'learner@example.com' }, encoding: 'utf8' });
      assert.equal(run.status, status, `${script}: ${run.stderr}`);
      assert.match(run.stderr, message, script);
    }
    assert.deepEqual(fs.readdirSync(usersDir), [], 'nothing written');
  } finally {
    fs.rmSync(usersDir, { recursive: true, force: true });
    fs.rmSync(questionsDir, { recursive: true, force: true });
  }
});

'use strict';

// Tests for users.js's profile file functions. Run with `make test`. They
// use a temporary users folder: MAXRECALL_USERS_DIR is set before users.js
// is loaded, since it reads it once, when loaded.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const USERS = fs.mkdtempSync(path.join(os.tmpdir(), 'users-test-'));
process.env.MAXRECALL_USERS_DIR = USERS;
const { readProfileFile, writeProfileFile } = require('./users');

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

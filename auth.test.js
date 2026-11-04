'use strict';

// Tests for auth.js's invites and registering (docs/plans/limited-live.md,
// step 1). Run with `make test`. They use a temporary sign-in folder:
// MAXRECALL_AUTH_DIR is set before auth.js is loaded, since it reads it
// once, when loaded. Each registration hashes with scrypt (128 MiB, a few
// hundred milliseconds), so they're kept few.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const AUTH = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
process.env.MAXRECALL_AUTH_DIR = AUTH;
const { createInvite, register, login, sessionEmail, INVITE_LIFETIME_MS, MIN_PASSWORD_LENGTH } = require('./auth');

after(() => fs.rmSync(AUTH, { recursive: true, force: true }));

const REFUSED = "Registration isn't open for that email and invite code.";
const PASSWORD = 'correct horse battery';

/**
 * Where an email's invite file is.
 *
 * @param {string} email - Normalized.
 * @returns {string} Its path in the temporary folder.
 */
function inviteFile(email) {
  return path.join(AUTH, 'invites', `${email}.json`);
}

/**
 * The permission bits of a file, e.g. 0o600.
 *
 * @param {string} file - Its path.
 * @returns {number} Its mode without the file type bits.
 */
function modeOf(file) {
  return fs.statSync(file).mode & 0o777;
}

test('an invite: a 22-character base64url code, only its hash stored, owner-only, 7 days', async () => {
  const now = Date.parse('2026-11-04T12:00:00.000Z');
  const invite = await createInvite('  New.Person@Example.com ', now);
  assert.equal(invite.email, 'new.person@example.com');
  assert.match(invite.code, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(invite.expiresAt, new Date(now + INVITE_LIFETIME_MS).toISOString());
  assert.equal(invite.expiresAt, '2026-11-11T12:00:00.000Z');
  const file = inviteFile('new.person@example.com');
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes(invite.code), 'the code itself is not stored');
  assert.deepEqual(Object.keys(JSON.parse(text)), ['schemaVersion', 'email', 'createdAt', 'expiresAt', 'codeSha256']);
  assert.equal(modeOf(file), 0o600);
  assert.deepEqual(fs.readdirSync(path.join(AUTH, 'invites')).filter((n) => n.includes('.tmp-')), []);
});

test('createInvite refuses something that is not an email', async () => {
  await assert.rejects(createInvite('../accounts/x'), /Not an email address/);
  await assert.rejects(createInvite(''), /Not an email address/);
});

test('the right email and code register once; the invite is then gone', async () => {
  const { code } = await createInvite('a@example.com');
  const result = await register('A@example.com', code, PASSWORD);
  assert.equal(result.ok, true);
  assert.ok(result.ok && (await sessionEmail(result.token)) === 'a@example.com');
  assert.equal(fs.existsSync(inviteFile('a@example.com')), false);
  assert.equal(modeOf(path.join(AUTH, 'accounts', 'a@example.com.json')), 0o600);
  assert.deepEqual(await register('a@example.com', code, PASSWORD), { ok: false, error: REFUSED });
});

test('the new password logs in; another does not', async () => {
  assert.equal((await login('a@example.com', PASSWORD)).ok, true);
  assert.deepEqual(await login('a@example.com', 'not the password at all'), { ok: false, error: 'Invalid email or password.' });
});

test('a wrong code is refused and leaves the invite usable', async () => {
  const { code } = await createInvite('b@example.com');
  assert.deepEqual(await register('b@example.com', `${code}x`, PASSWORD), { ok: false, error: REFUSED });
  assert.ok(fs.existsSync(inviteFile('b@example.com')));
});

test("a code works only for its own email, and an email with no invite can't register", async () => {
  const { code } = await createInvite('c@example.com');
  assert.deepEqual(await register('d@example.com', code, PASSWORD), { ok: false, error: REFUSED });
  assert.deepEqual(await register('nobody@example.com', code, PASSWORD), { ok: false, error: REFUSED });
});

test('an expired invite is refused', async () => {
  const { code } = await createInvite('e@example.com', Date.now() - INVITE_LIFETIME_MS - 1000);
  assert.deepEqual(await register('e@example.com', code, PASSWORD), { ok: false, error: REFUSED });
});

test('a new invite for the same email replaces the old one', async () => {
  const first = await createInvite('f@example.com');
  const second = await createInvite('f@example.com');
  assert.notEqual(first.code, second.code);
  assert.deepEqual(await register('f@example.com', first.code, PASSWORD), { ok: false, error: REFUSED });
  assert.equal((await register('f@example.com', second.code, PASSWORD)).ok, true);
});

test('the password minimum is 12, counted in characters, and says so', async () => {
  assert.equal(MIN_PASSWORD_LENGTH, 12);
  const { code } = await createInvite('g@example.com');
  // 11 emoji are 22 UTF-16 code units but 11 characters: too short.
  assert.deepEqual(await register('g@example.com', code, '😀'.repeat(11)), {
    ok: false,
    error: 'The password must be at least 12 characters.',
  });
  assert.ok(fs.existsSync(inviteFile('g@example.com')), 'a short password leaves the invite usable');
  assert.equal((await register('g@example.com', code, '😀'.repeat(12))).ok, true);
});

test('wrong codes count towards throttling, per email', async () => {
  await createInvite('h@example.com');
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await register('h@example.com', 'wrong', PASSWORD), { ok: false, error: REFUSED });
  }
  const throttled = await register('h@example.com', 'wrong', PASSWORD);
  assert.equal(throttled.ok, false);
  assert.ok(!throttled.ok && throttled.retryAfterMs && throttled.retryAfterMs > 0);
});

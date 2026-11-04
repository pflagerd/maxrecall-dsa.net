'use strict';

// Tests for consistency.js (docs/plans/spaced-repetition.md, D5; step 10).
// Run with `make test`. The sources are written here, not read from disk.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { checkConsistency, expectedProgress, parseRenames, updateRenames, currentName, countLevels, formatFinding, describeCounts } = require('./consistency');

const QUESTIONS = [
  { slug: 'a', created: '2026-01-01T00:00:00Z', languages: ['python', 'cpp'] },
  { slug: 'b', created: '2026-01-02T00:00:00Z', languages: ['python'] },
];
const PROFILE = JSON.stringify({ schemaVersion: 1, allowed: { languages: ['python', 'cpp'] }, preferred: { languages: ['python'] } });

/**
 * A record of one Submit or Skip.
 *
 * @param {string} pair - "question/language".
 * @param {string} at - When, as the seconds of a fixed minute ("05").
 * @param {string | null} status - The verdict, or null for a Skip.
 * @returns {import('./consistency').RecordSummary} The record.
 */
function rec(pair, at, status) {
  const [question, language] = pair.split('/');
  return { submittedAt: `2026-02-01T00:00:${at}.000Z`, question, language, status, ...(status === null && { skipped: /** @type {'yes'} */ ('yes') }) };
}

/**
 * One user's sources, consistent unless changed: a/python passed once,
 * the rest in the backlog.
 *
 * @param {Partial<import('./consistency').UserSources>} [change] - What to change.
 * @returns {import('./consistency').UserSources} The user.
 */
function user(change = {}) {
  return {
    email: 'learner@example.com',
    profileText: PROFILE,
    orderText: JSON.stringify({ schemaVersion: 1, submitsSinceLastIntroduced: 1, queue: [{ question: 'a', language: 'python', pass: 'yes', passesInARow: 1 }] }),
    backlogText: JSON.stringify({ schemaVersion: 1, backlog: [{ question: 'b', language: 'python' }, { question: 'a', language: 'cpp' }] }),
    records: [rec('a/python', '05', 'Accepted')],
    unreadable: [],
    ...change,
  };
}

/**
 * The findings for one user, as short lines.
 *
 * @param {Partial<import('./consistency').UserSources>} [change] - What to change from user().
 * @param {{ renamesText?: string, verbose?: boolean }} [options] - The rename log, and verbose.
 * @returns {string[]} formatFinding() of each.
 */
function check(change, { renamesText, verbose } = {}) {
  return checkConsistency({ questions: QUESTIONS, renamesText, users: [user(change)] }, { verbose }).map(formatFinding);
}

/**
 * order.json's text with this queue.
 *
 * @param {object[]} queue - The elements.
 * @returns {string} The text.
 */
const orderOf = (queue) => JSON.stringify({ schemaVersion: 1, submitsSinceLastIntroduced: 0, queue });

test('consistent files give no findings', () => {
  assert.deepEqual(check(), []);
});

test('checks 1 and 2: invalid files are an error, and stop the other checks for that user', () => {
  assert.deepEqual(check({ orderText: '{', records: [] }), ['error order.json: not valid JSON (Expected property name or \'}\' in JSON at position 1 (line 1 column 2)) (checks 3 to 6 not run)']);
  const twice = check({ backlogText: JSON.stringify({ schemaVersion: 1, backlog: [{ question: 'a', language: 'python' }] }) });
  assert.equal(twice.length, 1);
  assert.match(twice[0], /^error backlog\.json: backlog\[0\]: a in python is listed twice \(first at order\.json queue\[0\]\)/);
});

test('an invalid profile is an error; checks 4 and 5 are skipped, the others still run', () => {
  const found = check({ profileText: '{"schemaVersion":1,"allowd":{}}', orderText: orderOf([{ question: 'gone', language: 'python', passesInARow: 0 }]) });
  assert.match(found[0], /^error profile\.json: unknown field "allowd" \(checks 4 and 5 not run\)$/);
  assert.match(found[1], /^warning order\.json queue\[0\]: gone: no such question/);
  assert.equal(found.length, 2, 'no check 4 findings, though a/python is now in neither file');
});

test('check 3: a deleted question, a renamed one (followed to its newest name), a lost language', () => {
  const found = check({
    orderText: orderOf([{ question: 'gone', language: 'python', passesInARow: 0 }, { question: 'old', language: 'python', passesInARow: 0 }, { question: 'b', language: 'cpp', passesInARow: 0 }, { question: 'a', language: 'python', pass: 'yes', passesInARow: 1 }]),
    profileText: undefined, // every language allowed, so check 5 stays quiet
    backlogText: JSON.stringify({ schemaVersion: 1, backlog: [] }),
  }, { renamesText: '{"old":"middle","middle":"b"}' });
  assert.ok(found.includes('warning order.json queue[0]: gone: no such question (deleted, or not on this branch?); kept, and skipped when choosing what\'s next'));
  assert.ok(found.includes('warning order.json queue[1]: old was renamed to b; make rename-question (step 11) updates the reference'));
  assert.ok(found.includes('warning order.json queue[2]: b has no cpp starter code; kept, and skipped when choosing what\'s next'));
});

test('check 4: a pair the learner could do that is in neither file', () => {
  assert.deepEqual(check({ backlogText: JSON.stringify({ schemaVersion: 1, backlog: [{ question: 'b', language: 'python' }] }) }),
    ['warning backlog.json: a in cpp is in neither file; the next server start appends it to the backlog']);
});

test('check 4 is not run for a chosen backlog: a pair not chosen is meant to be in neither file (step 13, detail 2)', () => {
  const chosen = JSON.stringify({ ...JSON.parse(PROFILE), backlog: 'chosen' });
  assert.deepEqual(check({ profileText: chosen, backlogText: JSON.stringify({ schemaVersion: 1, backlog: [] }) }), []);
  assert.deepEqual(check({ profileText: chosen, records: [rec('a/python', '05', 'Accepted'), rec('b/python', '06', 'Accepted')] }),
    ['warning backlog.json: 1 pair has records but is still in the backlog (e.g. submitted before the queue existed, before step 6): b in python. make consistency-check VERBOSE=1 lists each'],
    'check 6 still runs');
});

test('check 5: a language no longer allowed is info; one merely turned off is nothing (detail 5)', () => {
  const narrower = JSON.stringify({ schemaVersion: 1, allowed: { languages: ['python'] } });
  assert.deepEqual(check({ profileText: narrower }), ['info backlog.json backlog[1]: a in cpp: the profile no longer allows cpp; kept on purpose (D2), and skipped']);
  assert.deepEqual(check(), [], 'cpp is allowed but turned off in PROFILE: no finding');
});

test('check 6: pass and passesInARow must match the records', () => {
  const twoPasses = [rec('a/python', '01', 'Accepted'), rec('a/python', '02', 'Accepted')];
  assert.deepEqual(check({ records: twoPasses }), ['warning order.json queue[0]: a in python: the file says pass "yes", passesInARow 1; the records say "yes", 2']);
  assert.deepEqual(check({ records: [rec('a/python', '01', 'Accepted'), rec('a/python', '02', 'Wrong Answer')] }),
    ['warning order.json queue[0]: a in python: the file says pass "yes", passesInARow 1; the records say "no", 0']);
  assert.deepEqual(check({ records: [] }), ['warning order.json queue[0]: a in python: pass is "yes", but there are no records of it']);
  assert.deepEqual(check({ orderText: orderOf([{ question: 'a', language: 'python', passesInARow: 0 }]) }),
    ['warning order.json queue[0]: a in python has 1 record but no pass; they say pass "yes", passesInARow 1']);
});

test('check 6 follows renames for old records, and ignores records of deleted questions', () => {
  assert.deepEqual(check({ records: [rec('old-a/python', '05', 'Accepted'), rec('deleted/python', '06', 'Accepted')] }, { renamesText: '{"old-a":"a"}' }), []);
});

test('check 6 leaves an element of a deleted question to check 3: one warning, not two', () => {
  const found = check({
    orderText: orderOf([{ question: 'a', language: 'python', pass: 'yes', passesInARow: 1 }, { question: 'gone', language: 'python', pass: 'yes', passesInARow: 1 }]),
    records: [rec('a/python', '05', 'Accepted')], // gone's records aren't read: none here, and none needed
  });
  assert.deepEqual(found, ['warning order.json queue[1]: gone: no such question (deleted, or not on this branch?); kept, and skipped when choosing what\'s next']);
});

test('check 6: backlog pairs with records are one summary, or each with verbose (detail 1)', () => {
  const records = [rec('a/python', '05', 'Accepted'), rec('b/python', '01', 'Wrong Answer'), rec('b/python', '02', null), rec('a/cpp', '03', 'Accepted')];
  assert.deepEqual(check({ records }), ['warning backlog.json: 2 pairs have records but are still in the backlog (e.g. submitted before the queue existed, before step 6): b in python, a in cpp. make consistency-check VERBOSE=1 lists each']);
  assert.deepEqual(check({ records }, { verbose: true }), [
    'warning backlog.json backlog[0]: b in python has 2 records but is still in the backlog',
    'warning backlog.json backlog[1]: a in cpp has 1 record but is still in the backlog',
  ]);
});

test('an unreadable record is a warning', () => {
  assert.deepEqual(check({ unreadable: [{ id: '2026-02-01T00-00-09.000Z', message: 'Unexpected end of JSON input' }] }),
    ['warning submissions/2026-02-01T00-00-09.000Z.json: can\'t be read, so check 6 leaves it out: Unexpected end of JSON input']);
});

test('expectedProgress: the latest decides pass; Accepted at the end are counted; a Skip is a fail (D8)', () => {
  assert.equal(expectedProgress([]), null);
  assert.deepEqual(expectedProgress([rec('a/python', '03', 'Accepted'), rec('a/python', '01', 'Wrong Answer'), rec('a/python', '02', 'Accepted')]), { pass: 'yes', passesInARow: 2 });
  assert.deepEqual(expectedProgress([rec('a/python', '01', 'Accepted'), rec('a/python', '02', null)]), { pass: 'no', passesInARow: 0 });
  assert.deepEqual(expectedProgress([rec('a/python', '01', null), rec('a/python', '02', 'Accepted')]), { pass: 'yes', passesInARow: 1 });
  assert.deepEqual(expectedProgress([rec('a/python', '01', 'Time Limit Exceeded')]), { pass: 'no', passesInARow: 0 });
});

test('renames.json: no file is no renames; a bad one is an error, and ignored', () => {
  assert.deepEqual(parseRenames(undefined), {});
  assert.equal(currentName('x', parseRenames('{"x":"y","y":"z"}')), 'z');
  for (const [text, message] of [['[]', /JSON object/], ['{"x":""}', /must be renamed to/], ['{"x":"x"}', /renamed to itself/], ['{"x":"y","y":"x"}', /loop: x → y → x/], ['{', /not valid JSON/]]) {
    assert.throws(() => parseRenames(/** @type {string} */ (text)), /** @type {RegExp} */ (message));
  }
  const found = checkConsistency({ questions: QUESTIONS, renamesText: '{"x":"x"}', users: [user()] });
  assert.deepEqual(found.map(formatFinding), ['error questions/renames.json: "x" is renamed to itself (renames ignored)']);
});

test('counts and their words', () => {
  const found = checkConsistency({ questions: QUESTIONS, renamesText: undefined, users: [user({ orderText: '{' }), user({ records: [] })] });
  assert.deepEqual(countLevels(found), { error: 1, warning: 1, info: 0 });
  assert.equal(describeCounts(countLevels(found)), '1 error, 1 warning, 0 info');
  assert.equal(describeCounts({ error: 2, warning: 0, info: 3 }), '2 errors, 0 warnings, 3 info');
});

test('updateRenames keeps every value a current name, and never writes a loop (step 11, detail 4)', () => {
  assert.deepEqual(updateRenames({}, 'a', 'b'), { a: 'b' });
  assert.deepEqual(updateRenames({ a: 'b' }, 'b', 'c'), { a: 'c', b: 'c' }, 'a led to b, so now to c');
  assert.deepEqual(updateRenames({ a: 'b', x: 'b' }, 'b', 'a'), { x: 'a', b: 'a' }, 'renamed back: a is current again');
  const given = { a: 'b' };
  updateRenames(given, 'b', 'c');
  assert.deepEqual(given, { a: 'b' }, 'the log given is left alone');
  for (const [r, from, to] of [[{}, 'a', 'b'], [{ a: 'b' }, 'b', 'c'], [{ a: 'b', c: 'b' }, 'b', 'a'], [{ a: 'b' }, 'b', 'a']]) {
    assert.doesNotThrow(() => parseRenames(JSON.stringify(updateRenames(/** @type {Record<string, string>} */ (r), /** @type {string} */ (from), /** @type {string} */ (to)))));
  }
});

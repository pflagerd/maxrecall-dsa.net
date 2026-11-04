'use strict';

// Tests for recalculate.js (docs/plans/spaced-repetition.md, step 12, first
// part). Run with `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { seededRandom, seedFor, recalculate } = require('./recalculate');
const { effectiveProfile } = require('./profile');
const { checkConsistency } = require('./consistency');
const { allowedPairs } = require('./order');

const QUESTIONS = [
  { slug: 'a', created: '2026-01-01T00:00:00Z', languages: ['python', 'cpp'] },
  { slug: 'b', created: '2026-01-02T00:00:00Z', languages: ['python', 'cpp'] },
  { slug: 'c', created: '2026-01-03T00:00:00Z', languages: ['python'] },
  { slug: 'd', created: '2026-01-04T00:00:00Z', languages: ['python'] },
  { slug: 'e', created: '2026-01-05T00:00:00Z', languages: ['python'] },
];
const RAW_PROFILE = { schemaVersion: 1, allowed: { languages: ['python', 'cpp'] }, preferred: { languages: ['python'] } };
const PROFILE = effectiveProfile(RAW_PROFILE);

/**
 * A record of one Submit or Skip.
 *
 * @param {string} pair - "question/language".
 * @param {number} n - Its order: the nth second of a fixed day.
 * @param {string | null} status - The verdict, or null for a Skip.
 * @returns {import('./consistency').RecordSummary} The record.
 */
function rec(pair, n, status) {
  const [question, language] = pair.split('/');
  const at = new Date(Date.UTC(2026, 1, 1, 0, 0, n)).toISOString();
  return { submittedAt: at, question, language, status, ...(status === null && { skipped: /** @type {'yes'} */ ('yes') }) };
}

/**
 * The queue as "question/language pass k" strings.
 *
 * @param {import('./order').OrderFile} order - order.json.
 * @returns {string[]} One per element, front first.
 */
const show = (order) => order.queue.map((e) => `${e.question}/${e.language} ${e.pass ?? '-'} ${e.passesInARow}`);

test('no records: an empty queue and every allowed pair in the backlog, as for a new user', () => {
  const { order, backlog, replayed } = recalculate([], QUESTIONS, PROFILE, {}, seededRandom(1));
  assert.deepEqual(order, { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: [] });
  assert.deepEqual(backlog.backlog, allowedPairs(QUESTIONS, PROFILE));
  assert.equal(replayed, 0);
});

test('the first record moves its pair into the queue, and the queue is filled to 3 (D6)', () => {
  const { order } = recalculate([rec('c/python', 1, 'Accepted')], QUESTIONS, PROFILE, {}, seededRandom(1));
  assert.equal(order.queue.length, 3);
  assert.ok(show(order).includes('c/python yes 1'));
  assert.equal(order.submitsSinceLastIntroduced, 0, 'pairs came in, so the counter starts again');
  assert.deepEqual(show(order).filter((s) => s.endsWith('- 0')).map((s) => s.split(' ')[0]), ['a/python', 'b/python'], 'the first two python pairs (cpp is off)');
});

test('records are replayed oldest first, whatever order they come in', () => {
  const inOrder = [rec('a/python', 1, 'Accepted'), rec('a/python', 2, 'Wrong Answer'), rec('a/python', 3, 'Accepted')];
  const shuffled = [inOrder[2], inOrder[0], inOrder[1]];
  const x = recalculate(inOrder, QUESTIONS, PROFILE, {}, seededRandom(5));
  const y = recalculate(shuffled, QUESTIONS, PROFILE, {}, seededRandom(5));
  assert.deepEqual(x, y);
  assert.ok(show(x.order).includes('a/python yes 1'), 'pass from the latest; one Accepted at the end');
});

test('a Skip is a fail (D8)', () => {
  const { order } = recalculate([rec('a/python', 1, 'Accepted'), rec('a/python', 2, null)], QUESTIONS, PROFILE, {}, seededRandom(1));
  assert.ok(show(order).includes('a/python no 0'));
});

test('the same seed gives the same files; seedFor gives each email its own (detail 2)', () => {
  const records = [rec('a/python', 1, 'Accepted'), rec('b/python', 2, 'Accepted'), rec('a/python', 3, 'Accepted'), rec('c/python', 4, 'Accepted')];
  const once = recalculate(records, QUESTIONS, PROFILE, {}, seededRandom(seedFor('owner@example.com')));
  const again = recalculate(records, QUESTIONS, PROFILE, {}, seededRandom(seedFor('owner@example.com')));
  assert.deepEqual(once, again);
  assert.equal(seedFor(''), 0x811c9dc5, 'FNV-1a starts from its offset basis');
  // FNV-1a's published test vectors (32-bit): http://www.isthe.com/chongo/tech/comp/fnv/
  assert.equal(seedFor('a'), 0xe40c292c);
  assert.equal(seedFor('foobar'), 0xbf9cf968);
  assert.notEqual(seedFor('owner@example.com'), seedFor('learner@example.com'));
});

test('old names are followed through renames; records of deleted questions are left out (D5)', () => {
  const { order, replayed, leftOut } = recalculate([rec('old-a/python', 1, 'Accepted'), rec('gone/python', 2, 'Accepted')], QUESTIONS, PROFILE, { 'old-a': 'a' }, seededRandom(1));
  assert.ok(show(order).includes('a/python yes 1'));
  assert.ok(!show(order).some((s) => s.startsWith('gone/')));
  assert.deepEqual([replayed, leftOut], [1, 1]);
});

test('a record in a language turned off, or no longer allowed, is replayed too: kept, skipped while off (detail 5)', () => {
  const pythonOnly = effectiveProfile({ schemaVersion: 1, allowed: { languages: ['python'] } });
  const { order } = recalculate([rec('a/cpp', 1, 'Accepted')], QUESTIONS, pythonOnly, {}, seededRandom(1));
  assert.ok(show(order).includes('a/cpp yes 1'));
  assert.ok(show(order).filter((s) => !s.startsWith('a/cpp')).every((s) => s.includes('/python ')), 'only python pairs are brought in');
});

test('the replayed files pass every check of the consistency check: they are what the records say', () => {
  const random = seededRandom(42);
  const pairs = ['a/python', 'b/python', 'c/python', 'd/python', 'a/cpp', 'b/cpp'];
  const statuses = ['Accepted', 'Accepted', 'Wrong Answer', 'Time Limit Exceeded', null];
  const records = Array.from({ length: 60 }, (_, i) => rec(pairs[Math.floor(random() * pairs.length)], i, statuses[Math.floor(random() * statuses.length)]));
  const { order, backlog } = recalculate(records, QUESTIONS, PROFILE, {}, seededRandom(7));
  const findings = checkConsistency({
    questions: QUESTIONS,
    renamesText: undefined,
    users: [{ email: 'learner@example.com', profileText: JSON.stringify(RAW_PROFILE), orderText: JSON.stringify(order), backlogText: JSON.stringify(backlog), records, unreadable: [] }],
  });
  assert.deepEqual(findings, []);
});

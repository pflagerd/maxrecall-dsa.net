'use strict';

// Tests for order.js (docs/plans/spaced-repetition.md, D1, D5, D6). Run
// with `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseOrder, parseBacklog, parseQueueFiles, allowedPairs, fillBacklog } = require('./order');
const { effectiveProfile } = require('./profile');

/** A valid queue. @type {import('./order').OrderFile} */
const ORDER = { schemaVersion: 1, submitsSinceLastIntroduced: 2, queue: [
  { question: 'two-sum', language: 'python', pass: 'yes', passesInARow: 3 },
  { question: 'hello-world', language: 'cpp', passesInARow: 0 },
  { question: 'two-sum', language: 'd', pass: 'no', passesInARow: 0 },
] };
/** A valid backlog. @type {import('./order').BacklogFile} */
const BACKLOG = { schemaVersion: 1, backlog: [{ question: 'valid-parentheses', language: 'python' }] };

test('no files means an empty queue and an empty backlog', () => {
  assert.deepEqual(parseOrder(undefined), { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: [] });
  assert.deepEqual(parseBacklog(undefined), { schemaVersion: 1, backlog: [] });
});

test('valid files read back as written', () => {
  assert.deepEqual(parseOrder(JSON.stringify(ORDER)), ORDER);
  assert.deepEqual(parseBacklog(JSON.stringify(BACKLOG)), BACKLOG);
  assert.deepEqual(parseQueueFiles(JSON.stringify(ORDER), JSON.stringify(BACKLOG)), { order: ORDER, backlog: BACKLOG });
});

/**
 * ORDER with one queue element changed.
 *
 * @param {object} change - Fields to change in the first element.
 * @returns {string} order.json's text.
 */
function orderWith(change) {
  return JSON.stringify({ ...ORDER, queue: [{ ...ORDER.queue[0], ...change }, ...ORDER.queue.slice(1)] });
}

/** [what is wrong, parse it, a pattern the message must match]. @type {[string, () => unknown, RegExp][]} */
const INVALID = [
  ['order.json not JSON', () => parseOrder('{"schemaVersion": 1,'), /^order\.json: not valid JSON/],
  ['order.json a list', () => parseOrder('[]'), /must be a JSON object/],
  ['an unknown schemaVersion', () => parseOrder(JSON.stringify({ ...ORDER, schemaVersion: 2 })), /schemaVersion/],
  ['a misspelt top-level field', () => parseOrder(JSON.stringify({ ...ORDER, queu: [] })), /unknown field "queu"/],
  ['a negative counter', () => parseOrder(JSON.stringify({ ...ORDER, submitsSinceLastIntroduced: -1 })), /submitsSinceLastIntroduced/],
  ['queue not a list', () => parseOrder(JSON.stringify({ ...ORDER, queue: {} })), /queue must be a list/],
  ['a misspelt element field', () => parseOrder(orderWith({ passes: 1 })), /"queue\[0\]\.passes"/],
  ['no question', () => parseOrder(orderWith({ question: '' })), /queue\[0\]\.question/],
  ['an unknown language', () => parseOrder(orderWith({ language: 'cobol' })), /queue\[0\]\.language/],
  ['pass not "yes" or "no"', () => parseOrder(orderWith({ pass: 'Yes' })), /queue\[0\]\.pass must be "yes" or "no"/],
  ['a negative passesInARow', () => parseOrder(orderWith({ passesInARow: -1 })), /passesInARow/],
  ['passesInARow above 0 after a fail', () => parseOrder(orderWith({ pass: 'no', passesInARow: 2 })), /must be 0 when pass isn't "yes"/],
  ['passesInARow above 0 before any Submit', () => parseOrder(orderWith({ pass: undefined, passesInARow: 1 })), /must be 0 when pass isn't "yes"/],
  ['a pair twice in the queue', () => parseOrder(orderWith({ question: 'hello-world', language: 'cpp' })), /queue\[1\]: hello-world in cpp is listed twice \(first at order\.json queue\[0\]\)/],
  ['a backlog element with queue fields', () => parseBacklog(JSON.stringify({ schemaVersion: 1, backlog: [{ question: 'a', language: 'd', passesInARow: 0 }] })), /"backlog\[0\]\.passesInARow"/],
  ['a pair twice in the backlog', () => parseBacklog(JSON.stringify({ schemaVersion: 1, backlog: [BACKLOG.backlog[0], BACKLOG.backlog[0]] })), /listed twice/],
  ['a pair in both files (D5, check 2)', () => parseQueueFiles(JSON.stringify(ORDER), JSON.stringify({ schemaVersion: 1, backlog: [{ question: 'two-sum', language: 'python' }] })), /^backlog\.json: backlog\[0\]: two-sum in python is listed twice \(first at order\.json queue\[0\]\)$/],
];

for (const [what, parse, message] of INVALID) {
  test(`invalid, refused naming the problem: ${what}`, () => {
    assert.throws(parse, (/** @type {any} */ err) => err.code === 'INVALID_QUEUE' && message.test(err.message));
  });
}

const QUESTIONS = [
  { slug: 'later', created: '2026-10-30T00:00:00Z', languages: ['python', 'cpp', 'javascript'] },
  { slug: 'b-tied', created: '2026-10-24T00:00:00Z', languages: ['python'] },
  { slug: 'a-tied', created: '2026-10-24T00:00:00Z', languages: ['cpp', 'python', 'java'] },
];

test('pairs come by creation time, ties by file name, then languages in the learner\'s order', () => {
  const profile = effectiveProfile({ schemaVersion: 1, allowed: { languages: ['javascript', 'python', 'cpp'] }, preferred: { languages: ['cpp', 'python'] } });
  assert.deepEqual(allowedPairs(QUESTIONS, profile).map((p) => `${p.question}/${p.language}`), [
    'a-tied/cpp', 'a-tied/python', // java isn't allowed
    'b-tied/python',
    'later/cpp', 'later/python', 'later/javascript', // javascript: allowed but turned off, so last
  ]);
});

test('with no profile, every language each question has, in menu order', () => {
  assert.deepEqual(allowedPairs(QUESTIONS, effectiveProfile(undefined)).map((p) => `${p.question}/${p.language}`), [
    'a-tied/python', 'a-tied/cpp', 'a-tied/java', 'b-tied/python', 'later/javascript', 'later/python', 'later/cpp',
  ]);
});

test('filling appends only the pairs in neither file, and leaves the given backlog alone', () => {
  const pairs = [
    { question: 'two-sum', language: 'python' }, // in the queue
    { question: 'valid-parentheses', language: 'python' }, // in the backlog
    { question: 'new-one', language: 'python' },
    { question: 'new-one', language: 'cpp' },
  ];
  const before = JSON.stringify(BACKLOG);
  const { backlog, added } = fillBacklog(ORDER, BACKLOG, pairs);
  assert.equal(added, 2);
  assert.deepEqual(backlog.backlog.map((p) => `${p.question}/${p.language}`), ['valid-parentheses/python', 'new-one/python', 'new-one/cpp']);
  assert.equal(JSON.stringify(BACKLOG), before);
  assert.equal(fillBacklog(ORDER, backlog, pairs).added, 0, 'filling twice adds nothing the second time');
});

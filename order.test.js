'use strict';

// Tests for order.js (docs/plans/spaced-repetition.md, D1, D3–D7, steps 5
// to 9). Run
// with `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseOrder, parseBacklog, parseQueueFiles, allowedPairs, fillBacklog, passFor, recordSubmit, nextPair, listPairs } = require('./order');
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

test('only Accepted is a pass (D3)', () => {
  assert.equal(passFor('Accepted'), 'yes');
  for (const status of ['Wrong Answer', 'Time Limit Exceeded', 'Runtime Error', 'Compile Error', 'accepted']) assert.equal(passFor(status), 'no');
});

// For recordSubmit(): advance() with random() always 0.5 has a factor of
// exactly 1 and rounds down unless the fraction is over 0.5, so k = 0 or 1
// moves 1 place, k = 2 moves 2 (1.3^2 = 1.69), k = 3 moves 2 (2.197), and
// k = 20 moves 190.
const HALF = () => 0.5;
const ANY = () => true;

/**
 * A queue of pairs in Python, from short names, all passed once.
 *
 * @param {string[]} names - The questions, front first.
 * @param {number} [submitsSinceLastIntroduced] - The counter.
 * @returns {import('./order').OrderFile} order.json.
 */
function queueOf(names, submitsSinceLastIntroduced = 0) {
  return { schemaVersion: 1, submitsSinceLastIntroduced, queue: names.map((question) => ({ question, language: 'python', pass: /** @type {'yes'} */ ('yes'), passesInARow: 1 })) };
}

/**
 * A backlog of pairs, from "question/language" strings.
 *
 * @param {string[]} keys - The pairs, front first.
 * @returns {import('./order').BacklogFile} backlog.json.
 */
function backlogOf(keys) {
  return { schemaVersion: 1, backlog: keys.map((k) => ({ question: k.split('/')[0], language: k.split('/')[1] })) };
}

/**
 * The queue as short strings: "question/language pass k".
 *
 * @param {import('./order').OrderFile} order - order.json.
 * @returns {string[]} One per element, front first.
 */
function show(order) {
  return order.queue.map((e) => `${e.question}/${e.language} ${e.pass ?? '-'} ${e.passesInARow}`);
}

const PY = (/** @type {string} */ q) => ({ question: q, language: 'python' });

test('a pass adds 1 to passesInARow and moves the pair advance(k) places', () => {
  const { order } = recordSubmit(queueOf(['a', 'b', 'c', 'd', 'e']), backlogOf([]), PY('a'), 'yes', { canIntroduce: ANY, random: HALF });
  // a had passed once (k becomes 2: 1.69 → 2 places): b and c ahead of it.
  assert.deepEqual(show(order), ['b/python yes 1', 'c/python yes 1', 'a/python yes 2', 'd/python yes 1', 'e/python yes 1']);
  const third = recordSubmit(order, backlogOf([]), PY('a'), 'yes', { canIntroduce: ANY, random: HALF });
  // From position 2, k = 3 moves 2 places: d and e get ahead of it.
  assert.deepEqual(show(third.order), ['b/python yes 1', 'c/python yes 1', 'd/python yes 1', 'e/python yes 1', 'a/python yes 3']);
});

test('a fail sets passesInARow to 0 and pass to "no", moving 1 place', () => {
  const { order } = recordSubmit(queueOf(['a', 'b', 'c']), backlogOf([]), PY('a'), 'no', { canIntroduce: ANY, random: HALF });
  assert.deepEqual(show(order), ['b/python yes 1', 'a/python no 0', 'c/python yes 1']);
});

test('a pair anywhere in the queue moves from where it is (D4)', () => {
  const { order } = recordSubmit(queueOf(['a', 'b', 'c', 'd']), backlogOf([]), PY('b'), 'no', { canIntroduce: ANY, random: HALF });
  assert.deepEqual(show(order).map((s) => s.split(' ')[0]), ['a/python', 'c/python', 'b/python', 'd/python']);
});

test('a move past the end puts the pair last', () => {
  const start = queueOf(['a', 'b', 'c']);
  start.queue[0].passesInARow = 19; // k = 20: 190 places
  const { order } = recordSubmit(start, backlogOf([]), PY('a'), 'yes', { canIntroduce: ANY, random: HALF });
  assert.deepEqual(show(order), ['b/python yes 1', 'c/python yes 1', 'a/python yes 20']);
});

test('a backlog pair leaves the backlog and starts at the front (detail 1)', () => {
  const { order, backlog } = recordSubmit(queueOf(['a', 'b', 'c']), backlogOf(['x/python', 'y/python']), PY('y'), 'yes', { canIntroduce: ANY, random: HALF });
  assert.deepEqual(show(order), ['a/python yes 1', 'y/python yes 1', 'b/python yes 1', 'c/python yes 1']);
  assert.deepEqual(backlog.backlog, [PY('x')]);
});

test('a pair in neither file joins the queue the same way (detail 2)', () => {
  const { order } = recordSubmit(queueOf(['a', 'b', 'c']), backlogOf([]), { question: 'new', language: 'cpp' }, 'no', { canIntroduce: ANY, random: HALF });
  assert.deepEqual(show(order), ['a/python yes 1', 'new/cpp no 0', 'b/python yes 1', 'c/python yes 1']);
});

test('the counter goes up by 1, and the 5th Submit brings one pair in, to the front, resetting it', () => {
  const backlog = backlogOf(['x/python', 'y/python']);
  const fourth = recordSubmit(queueOf(['a', 'b', 'c'], 3), backlog, PY('a'), 'yes', { canIntroduce: ANY, random: HALF });
  assert.equal(fourth.order.submitsSinceLastIntroduced, 4);
  assert.deepEqual(fourth.introduced, []);
  const fifth = recordSubmit(fourth.order, fourth.backlog, PY('b'), 'yes', { canIntroduce: ANY, random: HALF });
  assert.deepEqual(fifth.introduced, [PY('x')]);
  assert.equal(fifth.order.submitsSinceLastIntroduced, 0);
  assert.deepEqual(show(fifth.order)[0], 'x/python - 0'); // no pass yet (D3)
  assert.deepEqual(fifth.backlog.backlog, [PY('y')]);
});

test('a short queue is filled to 3 in backlog order, passing over pairs that can\'t come in (details 3, 4)', () => {
  const backlog = backlogOf(['x/cpp', 'y/python', 'gone/python', 'z/python', 'w/python']);
  const canIntroduce = (/** @type {{ question: string, language: string }} */ p) => p.language === 'python' && p.question !== 'gone';
  const { order, backlog: after, introduced } = recordSubmit(queueOf([]), backlog, PY('a'), 'no', { canIntroduce, random: HALF });
  assert.deepEqual(introduced, [PY('y'), PY('z')]);
  assert.deepEqual(show(order).map((s) => s.split(' ')[0]), ['y/python', 'z/python', 'a/python']);
  assert.deepEqual(after.backlog.map((p) => `${p.question}/${p.language}`), ['x/cpp', 'gone/python', 'w/python']);
  assert.equal(order.submitsSinceLastIntroduced, 0);
});

test('nothing comes in when the backlog has nothing that can, and the counter keeps counting', () => {
  const { order, introduced } = recordSubmit(queueOf(['a'], 7), backlogOf(['x/cpp']), PY('a'), 'yes', { canIntroduce: () => false, random: HALF });
  assert.deepEqual(introduced, []);
  assert.equal(order.submitsSinceLastIntroduced, 8);
  assert.equal(order.queue.length, 1);
});

test('recordSubmit leaves the files it was given unchanged, and its result is valid', () => {
  const order = queueOf(['a', 'b']);
  const backlog = backlogOf(['x/python', 'y/python']);
  const before = JSON.stringify([order, backlog]);
  const result = recordSubmit(order, backlog, PY('x'), 'yes', { canIntroduce: ANY, random: HALF });
  assert.equal(JSON.stringify([order, backlog]), before);
  assert.doesNotThrow(() => parseQueueFiles(JSON.stringify(result.order), JSON.stringify(result.backlog)));
});

test('next is the front of the queue', () => {
  assert.deepEqual(nextPair(queueOf(['a', 'b']), backlogOf(['x/python']), ANY), PY('a'));
});

test('next passes over pairs that can\'t be opened, leaving them where they are', () => {
  const order = queueOf(['gone', 'b', 'c']);
  const before = JSON.stringify(order);
  assert.deepEqual(nextPair(order, backlogOf([]), (p) => p.question !== 'gone'), PY('b'));
  assert.equal(JSON.stringify(order), before);
});

test('with nothing in the queue that can be opened, next is the first such backlog pair (detail 3)', () => {
  assert.deepEqual(nextPair(queueOf([]), backlogOf(['x/cpp', 'y/python']), (p) => p.language === 'python'), PY('y'));
  assert.deepEqual(nextPair(queueOf(['a']), backlogOf(['y/python']), (p) => p.question !== 'a'), PY('y'));
});

test('with nothing anywhere that can be opened, next is null (detail 8)', () => {
  assert.equal(nextPair(queueOf(['a']), backlogOf(['x/cpp']), () => false), null);
  assert.equal(nextPair(queueOf([]), backlogOf([]), ANY), null);
});

test('next names only the pair, not its pass or count', () => {
  assert.deepEqual(Object.keys(/** @type {object} */ (nextPair(queueOf(['a']), backlogOf([]), ANY))), ['question', 'language']);
});

test('the list is the queue in order, then the backlog, each marked', () => {
  const order = queueOf(['a', 'b']);
  order.queue[1] = { question: 'b', language: 'python', passesInARow: 0 }; // never submitted
  assert.deepEqual(listPairs(order, backlogOf(['x/python']), ANY), [
    { question: 'a', language: 'python', where: 'queue', pass: 'yes', passesInARow: 1 },
    { question: 'b', language: 'python', where: 'queue', passesInARow: 0 },
    { question: 'x', language: 'python', where: 'backlog' },
  ]);
});

test('the list leaves out pairs that can\'t be opened, and starts with what next names', () => {
  const order = queueOf(['gone', 'a']);
  const backlog = backlogOf(['x/cpp', 'y/python']);
  const canOpen = (/** @type {{ question: string, language: string }} */ p) => p.question !== 'gone' && p.language === 'python';
  const listed = listPairs(order, backlog, canOpen);
  assert.deepEqual(listed.map((p) => `${p.question}/${p.language}`), ['a/python', 'y/python']);
  assert.deepEqual({ question: listed[0].question, language: listed[0].language }, nextPair(order, backlog, canOpen));
});

test('an empty list when nothing can be opened', () => {
  assert.deepEqual(listPairs(queueOf(['a']), backlogOf(['x/cpp']), () => false), []);
});

'use strict';

// Tests for order.js (docs/plans/spaced-repetition.md, D1, D3–D7, steps 5
// to 11). Run
// with `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseOrder, parseBacklog, parseQueueFiles, allowedPairs, backlogPairs, fillBacklog, pairsToAdd, addToBacklog, removeFromBacklog, passFor, recordSubmit, nextPair, listPairs, removeReferences, renameReferences } = require('./order');
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

test('a pair in neither file joins the queue the same way (detail 2; also a feature, the test below)', () => {
  const { order } = recordSubmit(queueOf(['a', 'b', 'c']), backlogOf([]), { question: 'new', language: 'cpp' }, 'no', { canIntroduce: ANY, random: HALF });
  assert.deepEqual(show(order), ['a/python yes 1', 'new/cpp no 0', 'b/python yes 1', 'c/python yes 1']);
});

// A feature, not a gap (owner, 2026-11-06): a learner puts a question of
// their choice into their queue by opening it by its slug and Submitting or
// Skipping it, chosen backlog or not
// (docs/how-to-put-a-question-directly-into-my-queue-by-slug.html, whose
// example this is). If this fails, the feature is gone: don't "fix" the test.
test('a feature: a question never chosen, opened by its slug, joins the queue at its Skip or Submit', () => {
  const start = backlogOf(['singly-linked-list-hello-world/python']);
  const skipped = recordSubmit(queueOf([]), start, PY('two-sum'), 'no', { canIntroduce: ANY, random: HALF });
  // 1 place down from the front, then the backlog tops the queue up ahead of it.
  assert.deepEqual(show(skipped.order), ['singly-linked-list-hello-world/python - 0', 'two-sum/python no 0']);
  assert.deepEqual(skipped.backlog.backlog, []);
  const passed = recordSubmit(skipped.order, skipped.backlog, PY('climbing-stairs'), 'yes', { canIntroduce: ANY, random: HALF });
  // A first pass moves advance(1) places: 1 with this fixed random number.
  assert.deepEqual(show(passed.order), ['singly-linked-list-hello-world/python - 0', 'climbing-stairs/python yes 1', 'two-sum/python no 0']);
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

/**
 * A queue and backlog of pairs, as "question/language" strings.
 *
 * @param {string[]} queue - The queue's pairs, front first.
 * @param {string[]} backlog - The backlog's.
 * @returns {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile }} The files.
 */
function filesOf(queue, backlog) {
  return {
    order: { schemaVersion: 1, submitsSinceLastIntroduced: 0, queue: queue.map((k) => ({ question: k.split('/')[0], language: k.split('/')[1], passesInARow: 0 })) },
    backlog: backlogOf(backlog),
  };
}

/**
 * The pairs in each file, as "question/language" strings.
 *
 * @param {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile }} f - The files.
 * @returns {string[][]} [queue, backlog].
 */
const pairsIn = (f) => [f.order.queue.map((e) => `${e.question}/${e.language}`), f.backlog.backlog.map((p) => `${p.question}/${p.language}`)];

/**
 * Throws unless the files would pass parseQueueFiles().
 *
 * @param {{ order: import('./order').OrderFile, backlog: import('./order').BacklogFile }} f - The files.
 * @returns {void}
 */
const assertValid = (f) => { parseQueueFiles(JSON.stringify(f.order), JSON.stringify(f.backlog)); };

test('delete removes every pair of the question from both files, and nothing else', () => {
  const { order, backlog } = filesOf(['a/python', 'gone/python', 'b/python'], ['gone/cpp', 'c/python']);
  const result = removeReferences(order, backlog, 'gone');
  assert.deepEqual(pairsIn(result), [['a/python', 'b/python'], ['c/python']]);
  assert.deepEqual(result.removed, ['order.json: gone in python', 'backlog.json: gone in cpp']);
  assert.equal(order.queue.length, 3, 'the files given are left alone');
  assert.deepEqual(removeReferences(order, backlog, 'nothing').removed, []);
});

test('rename keeps each pair\'s place and progress under the new name', () => {
  const files = filesOf(['a/python', 'old/python', 'b/python'], ['old/cpp', 'c/python']);
  files.order.queue[1] = { question: 'old', language: 'python', pass: 'yes', passesInARow: 3 };
  const result = renameReferences(files.order, files.backlog, 'old', 'new');
  assert.deepEqual(pairsIn(result), [['a/python', 'new/python', 'b/python'], ['new/cpp', 'c/python']]);
  assert.deepEqual(result.order.queue[1], { question: 'new', language: 'python', pass: 'yes', passesInARow: 3 });
  assert.deepEqual(result.renamed, ['order.json: old in python', 'backlog.json: old in cpp']);
  assert.deepEqual(result.dropped, []);
  assertValid(result);
});

test('rename: the backlog copy step 5 added under the new name is dropped, keeping the queue\'s (step 10\'s note)', () => {
  const { order, backlog } = filesOf(['old/python'], ['c/python', 'new/python']);
  const result = renameReferences(order, backlog, 'old', 'new');
  assert.deepEqual(pairsIn(result), [['new/python'], ['c/python']]);
  assert.deepEqual(result.dropped, ['backlog.json: new in python, in the queue as new']);
  assertValid(result);
});

test('rename: in the queue under both names, the new-name element is kept (detail 3)', () => {
  const { order, backlog } = filesOf(['old/python', 'a/python', 'new/python'], []);
  const result = renameReferences(order, backlog, 'old', 'new');
  assert.deepEqual(pairsIn(result), [['a/python', 'new/python'], []]);
  assert.deepEqual(result.dropped, ['order.json: old in python, already in the queue as new']);
  assertValid(result);
});

test('rename: a backlog pair under the old name whose new name is in the queue, or in the backlog, is dropped', () => {
  const a = filesOf(['new/python'], ['old/python']);
  const inQueue = renameReferences(a.order, a.backlog, 'old', 'new');
  assert.deepEqual(pairsIn(inQueue), [['new/python'], []]);
  const b = filesOf([], ['new/python', 'old/python']);
  const both = renameReferences(b.order, b.backlog, 'old', 'new');
  assert.deepEqual(pairsIn(both), [[], ['new/python']]);
  assert.deepEqual(both.dropped, ['backlog.json: old in python, already in the backlog as new']);
  assertValid(inQueue); assertValid(both);
});

// Step 13: a chosen backlog, and make backlog-add / backlog-remove.

/** A profile with a chosen backlog and only Python on (step 13). */
const CHOSEN_PYTHON = effectiveProfile({ schemaVersion: 1, preferred: { languages: ['python'] }, backlog: 'chosen' });

test('backlogPairs: every allowed pair for backlog "all", none for "chosen" (detail 1)', () => {
  const all = effectiveProfile(undefined);
  assert.deepEqual(backlogPairs(QUESTIONS, all), allowedPairs(QUESTIONS, all));
  assert.deepEqual(backlogPairs(QUESTIONS, CHOSEN_PYTHON), []);
  const { backlog, added } = fillBacklog(ORDER, BACKLOG, backlogPairs(QUESTIONS, CHOSEN_PYTHON));
  assert.equal(added, 0, 'filling a chosen backlog adds nothing');
  assert.deepEqual(backlog, BACKLOG);
});

test('pairsToAdd: the questions in the order given, each in the languages turned on, in the learner\'s order', () => {
  assert.deepEqual(pairsToAdd(['later', 'a-tied'], QUESTIONS, CHOSEN_PYTHON).map((p) => `${p.question}/${p.language}`), ['later/python', 'a-tied/python']);
  // a-tied's starterCode order is cpp, python, java; the learner's is python, cpp: the learner's wins.
  const two = effectiveProfile({ schemaVersion: 1, preferred: { languages: ['python', 'cpp'] } });
  assert.deepEqual(pairsToAdd(['b-tied', 'a-tied'], QUESTIONS, two).map((p) => `${p.question}/${p.language}`), ['b-tied/python', 'a-tied/python', 'a-tied/cpp']);
});

test('pairsToAdd refuses an unknown question, one named twice, and one with no language turned on', () => {
  assert.throws(() => pairsToAdd(['later', 'nope'], QUESTIONS, CHOSEN_PYTHON), /nope: no such question/);
  assert.throws(() => pairsToAdd(['later', 'later'], QUESTIONS, CHOSEN_PYTHON), /later is named twice/);
  const javaOnly = effectiveProfile({ schemaVersion: 1, preferred: { languages: ['java'] } });
  assert.throws(() => pairsToAdd(['b-tied'], QUESTIONS, javaOnly), /b-tied has none of the languages turned on \(java\)/);
});

test('addToBacklog appends at the end by default, and leaves the files it was given alone', () => {
  const f = filesOf(['q/python'], ['a/python']);
  const before = JSON.stringify(f);
  const result = addToBacklog(f.order, f.backlog, [PY('b'), PY('c')]);
  assert.deepEqual(pairsIn({ order: f.order, backlog: result.backlog })[1], ['a/python', 'b/python', 'c/python']);
  assert.deepEqual(result.added, [PY('b'), PY('c')]);
  assert.deepEqual(result.skipped, []);
  assert.equal(JSON.stringify(f), before);
  assertValid({ order: f.order, backlog: result.backlog });
});

test('addToBacklog with AT puts the first added pair at that position, counting from 1', () => {
  const f = filesOf([], ['a/python', 'b/python']);
  const show1 = (/** @type {number} */ at) => addToBacklog(f.order, f.backlog, [PY('x'), PY('y')], at).backlog.backlog.map((p) => p.question).join(' ');
  assert.equal(show1(1), 'x y a b');
  assert.equal(show1(2), 'a x y b');
  assert.equal(show1(3), 'a b x y');
});

test('addToBacklog refuses an AT outside 1 to length + 1', () => {
  const f = filesOf([], ['a/python', 'b/python']);
  for (const at of [0, 4, 1.5, -1, NaN]) {
    assert.throws(() => addToBacklog(f.order, f.backlog, [PY('x')], at), RangeError, `AT ${at}`);
  }
  assert.doesNotThrow(() => addToBacklog(filesOf([], []).order, filesOf([], []).backlog, [PY('x')], 1), 'AT 1 in an empty backlog');
});

test('addToBacklog skips a pair already in the queue or the backlog (one place only, D5)', () => {
  const f = filesOf(['q/python'], ['a/python']);
  const result = addToBacklog(f.order, f.backlog, [PY('q'), PY('a'), PY('n')]);
  assert.deepEqual(result.backlog.backlog.map((p) => p.question), ['a', 'n']);
  assert.deepEqual(result.added, [PY('n')]);
  assert.deepEqual(result.skipped, ['q in python: already in the queue', 'a in python: already in the backlog']);
  assertValid({ order: f.order, backlog: result.backlog });
});

test('removeFromBacklog takes a question out in every language, and leaves the queue alone', () => {
  const f = filesOf(['q/python'], ['a/python', 'b/python', 'a/cpp', 'c/python']);
  const before = JSON.stringify(f);
  const result = removeFromBacklog(f.order, f.backlog, ['a', 'c']);
  assert.deepEqual(result.backlog.backlog.map((p) => `${p.question}/${p.language}`), ['b/python']);
  assert.deepEqual(result.removed.map((p) => `${p.question}/${p.language}`), ['a/python', 'a/cpp', 'c/python']);
  assert.deepEqual(result.notRemoved, []);
  assert.equal(JSON.stringify(f), before);
});

test('removeFromBacklog says why a name wasn\'t removed: in the queue, or not in the backlog', () => {
  const f = filesOf(['q/python'], ['a/python']);
  const result = removeFromBacklog(f.order, f.backlog, ['q', 'gone']);
  assert.deepEqual(result.backlog, f.backlog);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.notRemoved, ['q in python: in the queue, so not removed', 'gone: not in the backlog']);
});

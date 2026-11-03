'use strict';

// Tests for introduce.js (docs/plans/spaced-repetition.md, D6). Run with
// `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { introduceCount, MIN_QUEUE_LENGTH, INTRODUCE_EVERY } = require('./introduce');

test('the rule is the one decided in D6: at least 3 in the queue, one more every 5 Submits', () => {
  assert.equal(MIN_QUEUE_LENGTH, 3);
  assert.equal(INTRODUCE_EVERY, 5);
});

/** [what it checks, queueLength, submitsSinceLastIntroduced, backlogLength, expected]. @type {[string, number, number, number, number][]} */
const CASES = [
  ['a new user (empty queue) gets 3', 0, 0, 65, 3],
  ['a new user with only 2 pairs in all gets 2', 0, 0, 2, 2],
  ['an empty backlog gives nothing, however short the queue', 0, 0, 0, 0],
  ['an empty backlog gives nothing, however many Submits', 10, 9, 0, 0],
  ['one short of 3 brings in 1', 2, 0, 10, 1],
  ['two short of 3 brings in 2', 1, 0, 10, 2],
  ['exactly 3, no Submits yet: nothing', 3, 0, 10, 0],
  ['exactly 3, 4 Submits: nothing yet', 3, 4, 10, 0],
  ['the 5th Submit brings in 1', 3, 5, 10, 1],
  ['more than 5 (e.g. after a skipped turn) still brings in 1, not more', 10, 7, 10, 1],
  ['both rules at once take the larger, not the sum: 2 in the queue and 5 Submits give 1', 2, 5, 10, 1],
  ['both rules at once, 1 in the queue and 5 Submits, give 2', 1, 5, 10, 2],
  ['a long queue between introductions: nothing', 65, 4, 1, 0],
];

for (const [what, queueLength, since, backlogLength, expected] of CASES) {
  test(what, () => {
    assert.equal(introduceCount(queueLength, since, backlogLength), expected);
  });
}

test('applied after every Submit, the queue never has fewer than 3 while the backlog lasts', () => {
  let queue = 0;
  let backlog = 65;
  let since = 0;
  let introduced = 0;
  for (let submit = 0; submit < 400; submit++) {
    const count = introduceCount(queue, since, backlog);
    if (count > 0) {
      queue += count;
      backlog -= count;
      introduced += count;
      since = 0;
    }
    assert.ok(queue >= Math.min(3, introduced), `after Submit ${submit}: ${queue} in the queue`);
    since += 1; // the next Submit
  }
  assert.equal(backlog, 0, 'every pair is brought in eventually');
  assert.equal(queue, 65);
});

test('an argument that is not a whole number, 0 or more, is refused, naming it', () => {
  for (const bad of [-1, 1.5, '3', undefined, null, NaN, Infinity]) {
    const value = /** @type {any} */ (bad); // deliberately not a number, so typed any
    assert.throws(() => introduceCount(value, 0, 10), /queueLength/);
    assert.throws(() => introduceCount(3, value, 10), /submitsSinceLastIntroduced/);
    assert.throws(() => introduceCount(3, 0, value), /backlogLength/);
  }
});

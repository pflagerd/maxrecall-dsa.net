'use strict';

// Tests for playtest.js (issue #58; docs/plans/playtest.md). Run with
// `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { canTestQuestions, revealHidden, markRevealed } = require('./playtest');

const OWNER = 'owner@example.com';

test('only the owner may Test (detail 2)', () => {
  assert.equal(canTestQuestions(OWNER, OWNER), true);
  assert.equal(canTestQuestions('learner@example.com', OWNER), false);
  assert.equal(canTestQuestions(undefined, OWNER), false);
  assert.equal(canTestQuestions(null, OWNER), false);
  assert.equal(canTestQuestions('', ''), false, 'no email never matches, even an empty owner');
});

const CASES = [
  { args: [1], expected: 1 },
  { args: [2], expected: 4, hidden: true },
  { args: [3], expected: 9, hidden: false },
];

test('revealHidden: copies without hidden, in order; the question\'s cases are unchanged', () => {
  const before = JSON.stringify(CASES);
  const copies = revealHidden(CASES);
  assert.deepEqual(copies, [{ args: [1], expected: 1 }, { args: [2], expected: 4 }, { args: [3], expected: 9 }]);
  assert.ok(copies.every((tc) => !('hidden' in tc)), 'no hidden field at all, so the judge treats each as visible');
  assert.equal(JSON.stringify(CASES), before);
});

test('markRevealed: hidden cases marked hidden and revealed, keeping their details; others hidden false', () => {
  const results = [
    { index: 0, hidden: undefined, passed: true, input: [1], expected: 1, actual: 1 },
    { index: 1, hidden: undefined, passed: false, input: [2], expected: 4, actual: 5 },
    { index: 2, hidden: undefined, passed: true, input: [3], expected: 9, actual: 9 },
  ];
  const before = JSON.stringify(results);
  assert.deepEqual(markRevealed(results, CASES), [
    { index: 0, hidden: false, passed: true, input: [1], expected: 1, actual: 1 },
    { index: 1, hidden: true, revealed: true, passed: false, input: [2], expected: 4, actual: 5 },
    { index: 2, hidden: false, passed: true, input: [3], expected: 9, actual: 9 },
  ]);
  assert.equal(JSON.stringify(results), before, 'the results given are unchanged');
});

test('markRevealed goes by each result\'s index, not its position (a crash sends one result)', () => {
  const marked = markRevealed([{ index: 1, hidden: undefined, passed: false, error: 'boom' }], CASES);
  assert.deepEqual(marked, [{ index: 1, hidden: true, revealed: true, passed: false, error: 'boom' }]);
});

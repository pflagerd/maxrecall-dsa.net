'use strict';

// Tests for advance.js (docs/plans/spaced-repetition.md, D4). Run with
// `make test`. Uses Node's built-in test runner, node:test.

// The named form: the same function as require('node:test') itself, but
// typed as callable for editors that read JSDoc.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { advance, stochasticRound } = require('./advance');

/**
 * A stand-in for Math.random that returns the given numbers in order.
 *
 * @param {...number} values - The numbers to return, each from 0 up to, but
 *   not including, 1.
 * @returns {function(): number} A function that returns the next of the
 *   values each time it's called, and throws an Error once they've run out,
 *   which fails the test if advance() calls random() more often than
 *   expected.
 */
function sequence(...values) {
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error('random() called more times than expected');
    return value;
  };
}

/**
 * A small seeded random number generator (mulberry32), so the statistical
 * tests give the same numbers on every run and every machine. Source:
 * https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 *
 * @param {number} seed - The starting state: a whole number (only its low
 *   32 bits are used). The same seed always gives the same numbers.
 * @returns {function(): number} A function that returns the next number each
 *   time it's called, from 0 up to, but not including, 1, like Math.random.
 */
function seededRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('k = 0 with the factor at exactly 1 moves 1 place', () => {
  // 0.5 → factor 1; 1.3^0 = 1, nothing to round.
  assert.equal(advance(0, sequence(0.5, 0.99)), 1);
});

test('k = 1: 1.3 rounds up to 2 with probability 0.3, otherwise down to 1', () => {
  // Not 0.3 itself: in floating point, 1.3 - 1 is 0.30000000000000004.
  assert.equal(advance(1, sequence(0.5, 0.29)), 2);
  assert.equal(advance(1, sequence(0.5, 0.31)), 1);
});

test('the random factor runs from 0.9 up to 1.1', () => {
  // 1.3^10 = 13.79 (to two places). Lowest: 13.79 × 0.9 = 12.41, rounded
  // down. Highest: 13.79 × 1.1 = 15.16, rounded up.
  assert.equal(advance(10, sequence(0, 0.999999)), 12);
  assert.equal(advance(10, sequence(0.999999, 0)), 16);
});

test('never less than 1 place', () => {
  // 1 × 0.9 = 0.9, rounded down to 0, so it becomes 1.
  assert.equal(advance(0, sequence(0, 0.95)), 1);
});

test('on average, 1.3^k places (within 1%) for k = 1 to 12', () => {
  const random = seededRandom(20261103);
  const samples = 100_000;
  for (let k = 1; k <= 12; k++) {
    let total = 0;
    for (let i = 0; i < samples; i++) total += advance(k, random);
    const average = total / samples;
    const expected = 1.3 ** k;
    assert.ok(
      Math.abs(average - expected) / expected < 0.01,
      `k = ${k}: average ${average.toFixed(3)}, expected ${expected.toFixed(3)}`,
    );
  }
});

test('k = 0 averages 1.025, not 1, because of the at-least-1 rule', () => {
  // The value is spread evenly from 0.9 to 1.1. Below 1 it always ends up
  // as 1; from 1 to 1.1 it's 2 with probability (value - 1), 0.05 on
  // average. Half the values are in that upper half: 1 + 0.5 × 0.05.
  const random = seededRandom(7);
  const samples = 100_000;
  let total = 0;
  for (let i = 0; i < samples; i++) total += advance(0, random);
  assert.ok(Math.abs(total / samples - 1.025) < 0.005, `average ${total / samples}`);
});

test('with Math.random, every result is a whole number in range', () => {
  for (let k = 0; k <= 20; k++) {
    const low = Math.max(1, Math.floor(0.9 * 1.3 ** k));
    const high = Math.ceil(1.1 * 1.3 ** k);
    for (let i = 0; i < 1000; i++) {
      const places = advance(k);
      assert.ok(Number.isInteger(places) && places >= low && places <= high, `k = ${k}: ${places}`);
    }
  }
});

test('a k that is not a whole number, 0 or more, is refused', () => {
  // Deliberately not all numbers, so typed `any` for editors that check types.
  for (const k of /** @type {any[]} */ ([-1, 1.5, '2', undefined, null, NaN, Infinity])) {
    assert.throws(() => advance(k), RangeError, `k = ${String(k)}`);
  }
});

test('stochasticRound leaves whole numbers alone', () => {
  // Even with random() at its lowest, 0, a whole number isn't rounded up.
  assert.equal(stochasticRound(3, () => 0), 3);
});

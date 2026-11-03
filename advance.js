'use strict';

// How many places a (question, language) pair moves down the queue after a
// Submit or a Skip: docs/plans/spaced-repetition.md, decision D4.
//
//   places = 1.3^k, times a random factor between 0.9 and 1.1 (±10%),
//            stochastically rounded, and at least 1
//
// k is passesInARow after this Submit has been counted: 0 after a fail or a
// Skip, 1 after a first pass, and so on. This file only works out *how far*;
// moving the element in order.json (and putting it last when the move is
// longer than the queue) is the job of the code that owns that file. So the
// rule can be changed here alone.

/** The "1.3" in 1.3^k. @type {number} */
const BASE = 1.3;
/** How far the random factor strays from 1, either way: 0.1 is ±10%. @type {number} */
const SPREAD = 0.1;
/** The smallest move, so a pair never comes straight back as the next question. @type {number} */
const MIN_PLACES = 1;

/**
 * Rounds a number down or up at random, so that on average it isn't rounded
 * at all: 1.3 becomes 2 with probability 0.3, and 1 otherwise. A whole number
 * is returned unchanged.
 *
 * @param {number} value - The number to round. Any finite number; advance()
 *   only passes positive ones.
 * @param {function(): number} random - Returns a number from 0 up to, but not
 *   including, 1, as Math.random does. Called exactly once.
 * @returns {number} A whole number: Math.floor(value), or one more than that
 *   with probability (value - Math.floor(value)).
 */
function stochasticRound(value, random) {
  const whole = Math.floor(value);
  return whole + (random() < value - whole ? 1 : 0);
}

/**
 * How many places a pair moves down the queue: 1.3^k, times a random factor
 * from 0.9 up to 1.1, stochastically rounded, and at least 1.
 *
 * @param {number} k - passesInARow after this Submit has been counted: a
 *   whole number, 0 or more. 0 after a fail or a Skip.
 * @param {function(): number} [random=Math.random] - Returns a number from 0
 *   up to, but not including, 1. Passed in so tests can supply fixed numbers.
 *   Called exactly twice: first for the random factor, then for rounding.
 * @returns {number} The number of places to move: a whole number, 1 or more.
 *   It can be more than the queue's length; the caller then puts the pair
 *   last.
 * @throws {RangeError} If k isn't a whole number, 0 or more (for example
 *   -1, 1.5, "2", undefined, NaN or Infinity).
 */
function advance(k, random = Math.random) {
  if (!Number.isInteger(k) || k < 0) {
    // passesInARow comes from a hand-editable file, so say exactly what's wrong.
    throw new RangeError(`k must be a whole number, 0 or more; got ${JSON.stringify(k)}`);
  }
  const factor = 1 + (random() * 2 - 1) * SPREAD; // from 0.9 up to (not including) 1.1
  return Math.max(MIN_PLACES, stochasticRound(BASE ** k * factor, random));
}

module.exports = { advance, stochasticRound, BASE, SPREAD, MIN_PLACES };

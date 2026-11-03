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

const BASE = 1.3; // the "1.3" in 1.3^k
const SPREAD = 0.1; // ±10%
const MIN_PLACES = 1; // never straight back as the next question

// Rounds value down or up at random, so that on average it isn't rounded at
// all: 1.3 becomes 2 with probability 0.3 and 1 otherwise. `random` returns a
// number in [0, 1), like Math.random.
function stochasticRound(value, random) {
  const whole = Math.floor(value);
  return whole + (random() < value - whole ? 1 : 0);
}

// `random` is passed in (default Math.random) so tests can supply fixed
// numbers. It's called twice: first for the ±10% factor, then for rounding.
function advance(k, random = Math.random) {
  if (!Number.isInteger(k) || k < 0) {
    // passesInARow comes from a hand-editable file, so say exactly what's wrong.
    throw new RangeError(`k must be a whole number, 0 or more; got ${JSON.stringify(k)}`);
  }
  const factor = 1 + (random() * 2 - 1) * SPREAD; // from 0.9 up to (not including) 1.1
  return Math.max(MIN_PLACES, stochasticRound(BASE ** k * factor, random));
}

module.exports = { advance, stochasticRound, BASE, SPREAD, MIN_PLACES };

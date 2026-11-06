'use strict';

// Tests for timer.js's idle timeout (issue #102), with a fake clock. Run
// with `make test`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createIdleTimeout } = require('./timer');

const MINUTE = 60 * 1000;
// The owner's numbers (#102): a warning at 55 minutes idle, leaving at 60.
const WARN_AFTER_MS = 55 * MINUTE;
const WARNING_MS = 5 * MINUTE;

/**
 * An idle timeout on a fake clock that starts at a large time, as
 * Date.now() does.
 *
 * @returns {{ idle: import('./timer').IdleTimeout, advance: (ms: number) => void }}
 *   The timeout, and a way to move its clock forward (or back, with a
 *   negative ms).
 */
function setUp() {
  let t = 1_800_000_000_000;
  const idle = createIdleTimeout({ warnAfterMs: WARN_AFTER_MS, warningMs: WARNING_MS, now: () => t });
  /**
   * Moves the fake clock.
   *
   * @param {number} ms - Milliseconds forward, or back if negative.
   * @returns {void}
   */
  const advance = (ms) => {
    t += ms;
  };
  return { idle, advance };
}

test('no warning before 55 minutes without input', () => {
  const { idle, advance } = setUp();
  assert.deepEqual(idle.check(true), { state: 'active' });
  advance(WARN_AFTER_MS - 1);
  assert.deepEqual(idle.check(true), { state: 'active' });
});

test('at 55 minutes, a warning with 5 minutes left; at 60, time to leave', () => {
  const { idle, advance } = setUp();
  advance(WARN_AFTER_MS);
  assert.deepEqual(idle.check(true), { state: 'warning', leaveInMs: WARNING_MS });
  advance(WARNING_MS - 1000);
  assert.deepEqual(idle.check(true), { state: 'warning', leaveInMs: 1000 });
  advance(1000);
  assert.deepEqual(idle.check(true), { state: 'expired' });
});

test('input starts the idle time again', () => {
  const { idle, advance } = setUp();
  advance(WARN_AFTER_MS - MINUTE);
  idle.activity();
  advance(WARN_AFTER_MS - 1);
  assert.deepEqual(idle.check(true), { state: 'active' });
});

test('input during the warning withdraws it, and the next one needs 55 more minutes', () => {
  const { idle, advance } = setUp();
  advance(WARN_AFTER_MS + MINUTE);
  assert.equal(idle.check(true).state, 'warning');
  idle.activity();
  assert.deepEqual(idle.check(true), { state: 'active' });
  advance(WARN_AFTER_MS - 1);
  assert.deepEqual(idle.check(true), { state: 'active' });
  advance(1);
  assert.deepEqual(idle.check(true), { state: 'warning', leaveInMs: WARNING_MS });
});

test('hidden time counts: real time, not the stopwatch\'s visible time', () => {
  const { idle, advance } = setUp();
  advance(WARN_AFTER_MS);
  assert.equal(idle.check(false).state, 'active', 'no warning while hidden');
  assert.equal(idle.check(true).state, 'warning', 'but the 55 minutes were counted');
});

test('hidden when the warning is due: it begins when the page is next visible, with its whole countdown', () => {
  const { idle, advance } = setUp();
  advance(3 * 24 * 60 * MINUTE); // three days hidden
  assert.deepEqual(idle.check(false), { state: 'active' });
  assert.deepEqual(idle.check(true), { state: 'warning', leaveInMs: WARNING_MS });
});

test('once begun, the warning runs in real time even if the page is hidden again', () => {
  const { idle, advance } = setUp();
  advance(WARN_AFTER_MS);
  assert.equal(idle.check(true).state, 'warning');
  advance(WARNING_MS);
  assert.deepEqual(idle.check(false), { state: 'expired' });
});

test('expired stays expired: input afterwards doesn\'t bring the question back', () => {
  const { idle, advance } = setUp();
  advance(WARN_AFTER_MS);
  idle.check(true);
  advance(WARNING_MS);
  assert.equal(idle.check(true).state, 'expired');
  idle.activity();
  assert.deepEqual(idle.check(true), { state: 'expired' });
});

test('a computer clock set back counts as no idle time, not a warning', () => {
  const { idle, advance } = setUp();
  advance(-10 * MINUTE);
  assert.deepEqual(idle.check(true), { state: 'active' });
});

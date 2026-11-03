// A limit on how many submissions are judged at once: sandboxing step 8
// (docs/plans/sandboxing.md, gap G9).
//
// Each Run or Submit starts compilers and sandboxes. Without a limit, a
// burst of them (or a script) would all compete for the CPU and memory, and
// each would likely run out of time unfairly. So at most MAX_RUNNING
// judgings run at once; up to MAX_WAITING more wait their turn, first come
// first served; beyond that a request is refused with JudgeBusyError, which
// the server answers with HTTP 503 and Retry-After.
//
// The server is one Node process, so a counter and a waiting list are
// enough (a semaphore): no locks, since JavaScript runs one piece of code at
// a time. Time spent waiting doesn't count against a submission's limits:
// the judge starts its clock once it has a slot.

const os = require('os');

// The machine's core count, at most 4: 2 on the VPS.
const MAX_RUNNING = Math.min(4, typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length);
const MAX_WAITING = 10;
// Suggested wait before trying again, for the Retry-After header.
const RETRY_AFTER_SECONDS = 5;

let running = 0;
/** Each waiting judging's resolve function, oldest first. @type {((value?: unknown) => void)[]} */
const waiting = [];
// The most judgings seen running at once, for the escape test (probe G9).
let peakRunning = 0;

/**
 * Thrown by withJudgeSlot() when the waiting list is full. server.js answers
 * it with 503 and Retry-After.
 */
class JudgeBusyError extends Error {
  /** Says how many are running and waiting. */
  constructor() {
    super(`The judge is busy (${MAX_RUNNING} running, ${MAX_WAITING} waiting); try again in a few seconds.`);
    this.code = 'JUDGE_BUSY';
    this.retryAfterSeconds = RETRY_AFTER_SECONDS;
  }
}

/**
 * Runs task() when a slot is free, and passes on its result. Throws
 * JudgeBusyError straight away if the waiting list is full.
 *
 * @template T
 * @param {() => Promise<T>} task - The judging to run. (T is a type
 *   parameter: whatever task's promise gives, this one gives too.)
 * @returns {Promise<T>} task's result, or its rejection.
 * @throws {JudgeBusyError} If MAX_RUNNING are running and MAX_WAITING are
 *   already waiting (rejects the promise).
 */
async function withJudgeSlot(task) {
  if (running >= MAX_RUNNING) {
    if (waiting.length >= MAX_WAITING) throw new JudgeBusyError();
    await new Promise((resolve) => waiting.push(resolve));
    // The slot was handed over by the finishing judging: running wasn't
    // decremented for it, so it isn't incremented here.
  } else {
    running += 1;
  }
  peakRunning = Math.max(peakRunning, running);
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next(); // hand this slot straight to the oldest waiter
    else running -= 1;
  }
}

/**
 * The queue's limits and state, for the escape test (probe G9).
 *
 * @returns {{ maxRunning: number, maxWaiting: number, running: number, waiting: number, peakRunning: number }}
 *   The limits, how many are running and waiting now, and the most seen
 *   running at once since resetPeak().
 */
function queueStats() {
  return { maxRunning: MAX_RUNNING, maxWaiting: MAX_WAITING, running, waiting: waiting.length, peakRunning };
}

/**
 * Starts counting peakRunning afresh, from how many are running now.
 *
 * @returns {void}
 */
function resetPeak() {
  peakRunning = running;
}

module.exports = { MAX_RUNNING, MAX_WAITING, JudgeBusyError, withJudgeSlot, queueStats, resetPeak };

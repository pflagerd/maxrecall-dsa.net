// @ts-nocheck: not yet documented, so make typecheck skips it for now; removed by
// the jsdoc-judge pull request (docs/plans/documentation-standard.md).
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
const waiting = []; // resolve functions, oldest first
// The most judgings seen running at once, for the escape test (probe G9).
let peakRunning = 0;

class JudgeBusyError extends Error {
  constructor() {
    super(`The judge is busy (${MAX_RUNNING} running, ${MAX_WAITING} waiting); try again in a few seconds.`);
    this.code = 'JUDGE_BUSY';
    this.retryAfterSeconds = RETRY_AFTER_SECONDS;
  }
}

// Runs task() (which returns a promise) when a slot is free, and passes on
// its result. Throws JudgeBusyError straight away if the waiting list is
// full.
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

function queueStats() {
  return { maxRunning: MAX_RUNNING, maxWaiting: MAX_WAITING, running, waiting: waiting.length, peakRunning };
}

function resetPeak() {
  peakRunning = running;
}

module.exports = { MAX_RUNNING, MAX_WAITING, JudgeBusyError, withJudgeSlot, queueStats, resetPeak };

// A stopwatch for the problem page's elapsed-time timer (issue #20,
// docs/plans/elapsed-timer.md), and the idle timeout that leaves a
// question nobody is working on (issue #102, at the end). The stopwatch
// has no page code in it, so a countdown (issue #21) can reuse it: time
// left is a limit minus elapsedMs().
//
// It counts only while running: pause() stops counting and resume()
// carries on from there. freeze() stops it for good (the problem page
// freezes a language's clock at a saved Submit).
//
// Time comes from performance.now() by default: a monotonic clock, which
// only goes forward, unlike Date.now(), which jumps if the computer's clock
// is set. https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
// A test passes its own now() instead.

/**
 * What createStopwatch() returns.
 *
 * @typedef {object} Stopwatch
 * @property {() => void} resume - Starts or carries on counting.
 * @property {() => void} pause - Stops counting, keeping the time so far.
 * @property {() => void} freeze - Stops counting for good.
 * @property {boolean} running - Whether it's counting now (read-only).
 * @property {boolean} frozen - Whether freeze() has been called (read-only).
 * @property {() => number} elapsedMs - Milliseconds counted so far.
 */

/**
 * Makes a stopwatch, paused at zero.
 *
 * @param {() => number} [now] - Returns the current time in milliseconds,
 *   on a clock that only goes forward. Defaults to performance.now(); a
 *   test passes a fake clock.
 * @returns {Stopwatch} The new stopwatch.
 */
function createStopwatch(now = () => performance.now()) {
  let countedMs = 0; // time counted in earlier running stretches
  /** now() when the current stretch began; null when paused. @type {number | null} */
  let runningSince = null;
  let frozen = false;

  /** @type {Stopwatch} */
  const stopwatch = {
    /**
     * Starts or carries on counting. Does nothing if running or frozen.
     *
     * @returns {void}
     */
    resume() {
      if (frozen || runningSince !== null) return;
      runningSince = now();
    },
    /**
     * Stops counting, keeping the time so far. Does nothing if paused.
     *
     * @returns {void}
     */
    pause() {
      if (runningSince === null) return;
      countedMs += now() - runningSince;
      runningSince = null;
    },
    /**
     * Stops counting for good: resume() does nothing afterwards.
     *
     * @returns {void}
     */
    freeze() {
      stopwatch.pause();
      frozen = true;
    },
    /** @returns {boolean} Whether it's counting now. */
    get running() {
      return runningSince !== null;
    },
    /** @returns {boolean} Whether freeze() has been called. */
    get frozen() {
      return frozen;
    },
    /**
     * Milliseconds counted so far, including the current stretch.
     *
     * @returns {number} The time counted, in milliseconds.
     */
    elapsedMs() {
      return countedMs + (runningSince === null ? 0 : now() - runningSince);
    },
  };
  return stopwatch;
}

/**
 * Formats a time for the timer: 0:07, 4:12, 59:59, then 1:00:00 and up.
 * Rounds down to whole seconds, like a clock.
 *
 * @param {number} ms - Milliseconds; below 0 counts as 0.
 * @returns {string} m:ss under an hour, h:mm:ss from an hour.
 */
function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

// --- The idle timeout (issue #102) -----------------------------------------
// Leaves a question nobody is working on: after warnAfterMs with no input, a
// warning, then, warningMs later, time to leave. Unlike the stopwatch it
// counts real time, hidden tab or not (owner, #102), so it reads Date.now(),
// the wall clock, by default. One exception (owner): a warning is only
// begun while the page is visible, so the learner always sees its whole
// countdown before their code is lost. Once begun, it runs in real time.
// It has no page code in it: the page tells it about input and asks it
// what to show (check()).

/**
 * What IdleTimeout.check() says to show: nothing yet, the warning with the
 * time left, or that it's time to leave.
 *
 * @typedef {{ state: 'active' } | { state: 'warning', leaveInMs: number } | { state: 'expired' }} IdleState
 */

/**
 * What createIdleTimeout() returns.
 *
 * @typedef {object} IdleTimeout
 * @property {() => void} activity - Input from the learner: idle time
 *   starts again and a warning is withdrawn. Does nothing once expired.
 * @property {(visible: boolean) => IdleState} check - What to show now;
 *   visible says whether the page can be seen (a warning begins only then).
 */

/**
 * Makes an idle timeout, starting now as if there had just been input.
 *
 * @param {{ warnAfterMs: number, warningMs: number, now?: () => number }} options -
 *   warnAfterMs: idle time before the warning; warningMs: how long the
 *   warning lasts before it's time to leave; now: the current time in
 *   milliseconds, Date.now() by default (a test passes a fake clock).
 * @returns {IdleTimeout} The new idle timeout.
 */
function createIdleTimeout({ warnAfterMs, warningMs, now = () => Date.now() }) {
  let lastActivity = now();
  /** now() when the warning began; null while there's none. @type {number | null} */
  let warnedAt = null;
  let expired = false;

  return {
    /**
     * Notes input: idle time starts again, and a warning is withdrawn.
     *
     * @returns {void}
     */
    activity() {
      if (expired) return;
      lastActivity = now();
      warnedAt = null;
    },
    /**
     * Works out what to show now, beginning the warning if it's due and the
     * page is visible.
     *
     * @param {boolean} visible - Whether the page can be seen now.
     * @returns {IdleState} What to show.
     */
    check(visible) {
      if (expired) return { state: 'expired' };
      const t = now();
      // A clock set back makes t - lastActivity negative: still active.
      if (warnedAt === null && visible && t - lastActivity >= warnAfterMs) warnedAt = t;
      if (warnedAt === null) return { state: 'active' };
      const leaveInMs = warningMs - (t - warnedAt);
      if (leaveInMs > 0) return { state: 'warning', leaveInMs };
      expired = true;
      return { state: 'expired' };
    },
  };
}

// The page loads this as a plain <script>, so the functions above are
// globals there. Under Node (tests), they're exported instead.
if (typeof module !== 'undefined') module.exports = { createStopwatch, formatElapsed, createIdleTimeout };

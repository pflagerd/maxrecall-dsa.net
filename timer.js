// A stopwatch for the problem page's elapsed-time timer (issue #20,
// docs/plans/elapsed-timer.md). It has no page code in it, so a countdown
// (issue #21) can reuse it: time left is a limit minus elapsedMs().
//
// It counts only while running: pause() stops counting and resume()
// carries on from there. freeze() stops it for good (the problem page
// freezes a language's clock at a saved Submit).
//
// Time comes from performance.now() by default: a monotonic clock, which
// only goes forward, unlike Date.now(), which jumps if the computer's clock
// is set. https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
// A test passes its own now() instead.

function createStopwatch(now = () => performance.now()) {
  let countedMs = 0; // time counted in earlier running stretches
  let runningSince = null; // now() when the current stretch began; null when paused
  let frozen = false;

  const stopwatch = {
    // Starts or carries on counting. Does nothing if running or frozen.
    resume() {
      if (frozen || runningSince !== null) return;
      runningSince = now();
    },
    // Stops counting, keeping the time so far. Does nothing if paused.
    pause() {
      if (runningSince === null) return;
      countedMs += now() - runningSince;
      runningSince = null;
    },
    // Stops counting for good: resume() does nothing afterwards.
    freeze() {
      stopwatch.pause();
      frozen = true;
    },
    get running() {
      return runningSince !== null;
    },
    get frozen() {
      return frozen;
    },
    // Milliseconds counted so far, including the current stretch.
    elapsedMs() {
      return countedMs + (runningSince === null ? 0 : now() - runningSince);
    },
  };
  return stopwatch;
}

// 0:07, 4:12, 59:59, then 1:00:00 and up. Rounds down to whole seconds,
// like a clock.
function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

// The page loads this as a plain <script>, so the two functions above are
// globals there. Under Node (tests), they're exported instead.
if (typeof module !== 'undefined') module.exports = { createStopwatch, formatElapsed };

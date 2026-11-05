'use strict';

// Testing a question without recording anything (issue #58; docs/plans/
// playtest.md): the owner's Test button judges against every test case,
// with the hidden ones' details shown in full, and saves nothing.
//
// The judge (judge/runner.js) leaves out a hidden case's input, expected
// and actual by looking at its own copy's `hidden`, so nothing in the judge
// changes: the server gives it copies with `hidden` taken off
// (revealHidden), then marks the hidden ones again in the result
// (markRevealed), so the page can say which they were.
//
// Pure functions only: server.js does the request and the judging.

/**
 * Whether this user may Test (detail 2): only the owner, MAXRECALL_USER,
 * since they wrote the questions and see hidden cases in full. Not a
 * profile permission: those default to true, so a new one would turn
 * Test on for every learner without a profile.json.
 *
 * @param {string | null | undefined} email - The signed-in user's email
 *   (req.userEmail: none means not signed in, which is never the owner).
 * @param {string} ownerEmail - MAXRECALL_USER (users.js, OWNER_EMAIL).
 * @returns {boolean} True for the owner only.
 */
function canTestQuestions(email, ownerEmail) {
  return typeof email === 'string' && email !== '' && email === ownerEmail;
}

/**
 * Copies of the test cases with `hidden` taken off, for the judge, so it
 * sends back every case's details (detail 4). The question's own test
 * cases aren't changed.
 *
 * @template {{ hidden?: boolean }} T
 * @param {T[]} testCases - The question's test cases, hidden ones included.
 *   (A type parameter, T: each copy has the same fields, less hidden.)
 * @returns {Omit<T, 'hidden'>[]} The copies, in the same order.
 */
function revealHidden(testCases) {
  return testCases.map(
    /**
     * One test case without `hidden`.
     *
     * @param {T} tc - The test case.
     * @returns {Omit<T, 'hidden'>} The copy.
     */
    (tc) => {
      const { hidden, ...rest } = tc;
      return rest;
    },
  );
}

/**
 * One test case's result as Test sends it: the judge's, with hidden and
 * revealed set for a case that's hidden in the question.
 *
 * @typedef {import('./judge/runner').TestResult & { revealed?: true }} TestedResult
 */

/**
 * The judge's results with each case that's hidden in the question marked
 * again: hidden true, and revealed true to say its details are there
 * because this is a Test (detail 4). Others are marked hidden false. The
 * results given aren't changed.
 *
 * @param {import('./judge/runner').TestResult[]} results - From the judge,
 *   given revealHidden()'s copies; index is each case's position.
 * @param {{ hidden?: boolean }[]} testCases - The question's own test cases.
 * @returns {TestedResult[]} The results, in the same order.
 */
function markRevealed(results, testCases) {
  return results.map((r) => (testCases[r.index] && testCases[r.index].hidden ? { ...r, hidden: true, revealed: /** @type {true} */ (true) } : { ...r, hidden: false }));
}

module.exports = { canTestQuestions, revealHidden, markRevealed };

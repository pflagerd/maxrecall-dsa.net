# A fill-in-the-blank answer is sent as `answer: { blank }`; only Run takes one until records version 4; a failed judge is a 500

2026-11-09 · decided by the owner (the first four), proposed by users and decided by the owner's merge of the pull request that adds this file (the last two) · written by users

#160 step 4, item 3 (users): Run and Submit for a fill-in-the-blank
question (contract 2).

- **The request** (owner, 2026-11-09, "a(i)"): a fill-in-the-blank
  question's Run takes `{ language, answer: { blank }, elapsedMs? }`, not
  a flat `blank` beside `language`. The answer is the kind's own object
  (#160's Q5), the same `answer` records version 4 keeps
  (`docs/plans/submission-records-v4.md`), and "no field but the kind's
  own" (#160's Q12) applies to `answer` alone. A code question's body is
  unchanged.
- **Only Run, until records version 4** (owner, 2026-11-09, "b(i)"):
  Submit and Skip on a fill-in-the-blank question are refused until users
  builds records version 4, in a pull request of its own, so each change
  stays small.
- **Test is refused** for a fill-in-the-blank question (owner,
  2026-11-09): it reveals hidden test cases, and this kind has none.
- **`'JUDGE_FAILED'` is a 500** (owner, 2026-11-09), with "We couldn't
  judge this answer; it wasn't recorded." A judge that fails is a fault
  on the server, not in the request (RFC 9110, section 15.6.1). The
  details go only to the server's log (contract 2).
- **Statuses** (users): Test on a fill-in-the-blank question is a 400
  (it doesn't apply, by design); Submit and Skip on one, and any action
  on a question of a kind the server doesn't know, are a 501 Not
  Implemented (RFC 9110, section 15.6.2: "the server does not support
  the functionality required"), since that's missing on the server, not
  wrong in the request.
- **Testable without a question file** (users): the answer check
  (`checkFillInTheBlankAnswer`) and the answer to a failed judging
  (`judgeErrorAnswer`) are functions of their arguments alone, tested in
  `routes.test.js`. Judging end to end needs a fill-in-the-blank question
  in `questions/`, which waits for a test folder (asked of questions,
  #160) or step 5's question.

**Why**: the owner's reasons as given for a(i) and b(i); for the
statuses, that a 4xx says the request should change, and these requests
are right but not yet supported.

Source: `routes.js` (`checkExecutionRequest`, `checkFillInTheBlankAnswer`,
`handleExecution`, `judgeErrorAnswer`, `sendJudgeError`, `COULDNT_JUDGE`),
`routes.test.js`; `docs/contracts.md`, contract 2; #160.

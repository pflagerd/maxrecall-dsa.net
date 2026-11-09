# A fill-in-the-blank question's `blank` is its marker text; a failed judge is `JudgeFailedError`, `'JUDGE_FAILED'`; the code is `judge/fill-in-the-blank.js`

2026-11-09 (UTC; 2026-11-08 Pacific) · decided by the owner, with the small choices marked below · written by questions (questions 2)

**Decided** (owner, 2026-11-08, in the questions 2 session, starting #160's
build step 3), each as questions 2 recommended:

- **`blank` is the marker text** that stands for the blank in every
  language's `template`, e.g. `"___"`. `make test` checks it's one line and
  appears exactly once in each template (`question-files.js`,
  `checkFillInTheBlank`). Chosen over a fixed marker with no field, which contract 4
  already ruled out by naming `blank`, and which would stop a template from
  ever containing the fixed marker itself.
- **A failed judge throws `JudgeFailedError`, whose `code` is
  `'JUDGE_FAILED'`**, as the queue throws `JudgeBusyError` with
  `'JUDGE_BUSY'`. Users' routes match the string, record nothing and show a
  generic message (contract 2, Q9a). Chosen over a field in the result,
  which every result would then have to be checked for.
- **The code is a new file, `judge/fill-in-the-blank.js`**, so the architect's review
  of server code (R3) has one file to look at. Chosen over adding it to
  `judge/runner.js`. It needs listing in `tsconfig.json`, infrastructure and
  security's file.
- **Step 3 is one pull request**, not several.

**Chosen by questions 2** (small, easy to change, recorded here):

- A judge's message is at most 500 characters, with at most 5 hints of at
  most 300 each (`judge/fill-in-the-blank.js`). The judge-file rules (#171) leave the
  numbers "set when built".
- Each judge case runs in a worker thread stopped after 1 s
  (`questions.test.js`, `JUDGE_CASE_TIMEOUT_MS`, #172).
- A judge's cases are `{ blank, language?, pass, messageIncludes? }`: the
  message is checked by a part of it, so rewording a message needn't break
  its test.

**Why**: `blank` was named in contract 4 without a meaning, and the
"couldn't judge" outcome's name was left to questions "when built". The
error with a `code` follows the one precedent users already handle.

Source: `question-files.js`, `judge/fill-in-the-blank.js`, `questions.test.js`;
`docs/contracts.md`, contracts 2 and 4; #160.

**Named** (owner, 2026-11-09, before this file merged): the kind is
`"fill-in-the-blank"`, in code too, replacing #160's Q3 `"fill-in"`, so
the file, its functions and this file's name use the full term
([#160's decision](https://github.com/pflagerd/maxrecall-dsa.net/issues/160#issuecomment-6744721179)).

# Records don't hash the shared `judge/` helpers: `judgeSha256` covers the judge file only

2026-11-08 · decided by the owner, with questions 2 · written by users

**Decided** (owner, 2026-11-08, #160's Q13, in the questions 2 session:
"I don't think hash covers the helpers", confirmed as a decision): a
version 4 record's `judgeSha256` is the SHA-256 of
`questions/<slug>.judge.js` only, as #168's D6 says. No hash covers the
shared helpers in `judge/` that a judge may use (#160 Q6.3), and D6 is
unchanged.

**What it leaves**: a change to a helper can change how answers are
judged with no trace in learners' records. Git history and the
architect's review of every pull request that changes judge code
(#160 Q14) are the record of such a change. (Infrastructure and
security's review, #160 B7.3, had suggested hashing the helpers too.)

Source: #160, B7 (Q13); `docs/session-handoff/questions/20261108T191114-0800.md`;
`docs/plans/submission-records-v4.md`, D6.

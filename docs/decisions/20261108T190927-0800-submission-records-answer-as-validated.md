# A version 4 record keeps a non-code answer as the server validated it, not as the request sent it

2026-11-08 · decided by the owner · written by users

**Decided** (owner, 2026-11-08, #160's Q12, in the questions 2 session:
"your proposal", meaning questions 2's review of #168, with
infrastructure and security's review, #160 B7.2). It changes D1 of
`docs/decisions/20261108T182945-0800-submission-records-v4.md`, which
kept the answer "as the request sent it":

- **An answer has only its kind's own fields.** For fill-in, an answer
  with any field other than `blank` is refused before the judge is
  called, as is a `blank` that isn't a string or is longer than the
  question's `maxLength`. Nothing is recorded for it.
- **A version 4 record keeps the answer as the server validated it**:
  for a valid answer, the same object the request sent, so the example
  `{ "blank": "\\'" }` is unchanged.

**Why**: a request needn't come from our page. Without the refusal, a
hand-made request could put any extra fields, of any size, into a
learner's records.

Contract 2's check on users' routes gains the refusal of other fields
(the architect's, #160 B8 step 1).

Source: #160, B7 ("Decided: Q12") and B8 step 4;
`docs/plans/submission-records-v4.md`, D1.

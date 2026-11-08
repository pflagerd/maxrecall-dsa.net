# A learner's backlog takes a question after the ones it builds on (`alreadyLearned`)

2026-11-08 · decided by the owner · written by users

**Decided** (owner, 2026-11-08, on #146's three choices):

- **A(a)**: a backlog `"all"` is in dependency order: each question after
  every question in its `alreadyLearned`, and otherwise by `created`,
  ties by file name (a topological sort, the earliest-created ready
  question first). Not (b), by difficulty then `created`, which leaves the
  string chain backwards, its six questions being of one difficulty.
- **B(a)**: for a chosen backlog, `make learner-create` and
  `make backlog-add` warn when `SLUGS` puts a question before one it
  builds on, or leaves one out, and write it anyway, so an order can
  still be chosen on purpose. Not refusing (b) or re-sorting (c).
- **C(a)**: backlogs already written are left as they are; only pairs
  added from now on, and new users' backlogs, follow the new order.

**Why**: created in the order they were written, the string chain came
almost backwards (`build-a-new-string`, the first of it, is the newest),
so a learner met questions before the ones they build on. D6
(`docs/plans/spaced-repetition.md`) already expected ordering by
dependencies later.

**On #146's merge order** ("questions first"): `question-files.js`'s
`QuestionListing` type is users' `QuestionInfo` plus fields from
questions' `QuestionFile`, so `questionInfos()` returning
`alreadyLearned`, as #146 described it, fails `make typecheck` (TS2353)
until `QuestionInfo` has the field, and `QuestionFile` didn't declare it
(TS2339): seen by trying that change on top of this one. Questions'
change also adds the field to `QuestionListing`'s own list, so either
pull request can merge first (questions' report, checked both ways
there; not checked here).

Source: `order.js` (`dependencyOrder`, `allowedPairs`), `order.test.js`;
#146; `docs/plans/spaced-repetition.md`, D6.

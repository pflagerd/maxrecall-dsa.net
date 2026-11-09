# The first unit-test question prototype is Python with unittest, and its code is committed

2026-11-09 (Pacific) · decided by the owner · written by questions (questions-1)

**Background.** `docs/plans/unit-test-questions.md` (#174) planned a
one-language prototype of Kind A, to see whether results can be read
without leaking hidden tests, what cheating looks like, and how long a run
takes. The questions-1 session offered JavaScript with `node:test` or
Python with `unittest`, and keeping the prototype in a scratchpad or
committing it.

**Decided** (owner, 2026-11-09, "1a, 2b"):

- **Python with `unittest`**: its `TestCase.run` and `TestResult` give
  each test's outcome as an object, so the harness reads results without
  parsing text. Chosen over `node:test`, whose per-test timeout is already
  known not to stop a synchronous loop (#172).
- **The prototype's code is committed**, in
  `docs/plans/prototypes/unit-test-questions-python/`, so it can be run
  again (rather than kept in a session's scratchpad, with only its
  findings in the plan). Its JavaScript driver, `run.js`, is documented
  as every JavaScript file is, and needs a line in `tsconfig.json`
  (infrastructure and security's) for `make typecheck` and
  `make doc-check` to cover it.
- **Only #174's commits** came onto the questions-1 session's branch; #88's
  stay on hold.

**Why**: a prototype run in the real sandbox answers the plan's open
points with measurements rather than guesses, and a committed one can be
re-run on Kubuntu or the VPS.

Source: `docs/plans/unit-test-questions.md` ("Prototype"),
`docs/plans/prototypes/unit-test-questions-python/README.md`.

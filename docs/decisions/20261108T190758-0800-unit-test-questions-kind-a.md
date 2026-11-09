# Unit-test questions, Kind A: the author's tests as code, the learner's code under test, hidden tests never sent

2026-11-09 · decided by the owner · written by questions

**Decided** (owner, 2026-11-08 and 2026-11-09, in the questions-1
session; `docs/plans/unit-test-questions.md`, on hold, nothing built):

- A planned third way of judging, where a test case is code in the
  language's unit test framework. **The author writes the tests; learners
  read them** (chosen over the learner writing them, which may come later
  as its own kind: an algorithm supplied, the learner's tests judged).
- **The learner submits only the code under test** (chosen over a whole
  program with its runner). The page shows the whole test program.
- **Visible tests are blurred by CSS until Run or Submit** (chosen over the
  server withholding them), **and blurred again on each visit** (chosen
  over staying unblurred once revealed).
- **Hidden tests are always blurred, their source never sent to the
  browser**, and their results are pass or fail only, **with no names**
  (chosen over names and pass or fail).

**Why**: reading well-written tests is a skill worth teaching (owner);
writing the code before seeing the tests keeps the exercise; a hidden
test's name or source would give away what it checks.

Source: `docs/plans/unit-test-questions.md`.

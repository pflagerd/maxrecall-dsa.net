# Unit-test questions: tests written as code, in each language's framework

Status: **proposed** (questions, questions 1 session, 2026-11-09; issue
#174), **on hold** (owner, 2026-11-08: "Everything on hold"). Some of the design is
decided (below); nothing is built, and no pull request is open. Where this
disagrees with `readme.html`, `readme.html` wins: it describes what's
built.

## The idea (owner, 2026-11-08)

A third way of judging, next to function mode and program mode
(`readme.html` §6). There a test case is data: arguments and an expected
return value, or standard input and expected output. Here a **test case
is code**: one test written in the language's usual unit test framework.
"It would allow us to model how to code such test cases, which is a
valuable skill for learners" (owner).

Two kinds:

- **Kind A (this plan): the owner writes the tests; learners read them.**
- **Kind B (later, possibly): a question supplies an algorithm and the
  learner writes the tests** (owner). Judging tests needs a different
  judge, below.

## Kind A: decided (owner, 2026-11-08 and 2026-11-09)

- **Who writes the tests**: the question's author. Learners read the
  visible ones as worked examples.
- **What the learner submits**: only the code under test (a function or
  a class). The judge adds the tests and the framework's start-up code.
  (Chosen over the learner submitting a whole program with its runner.)
- **What the page shows**: the whole test program: imports, the test
  file's or class's structure, the start-up code, with the tests in it.
- **Visible tests are blurred until Run or Submit**, by CSS (a "soft"
  blur: the source is in the page, readable with View Source, so it's a
  nudge to write the code first, not a lock). Chosen over the server
  withholding them until Run.
- **Blurred again on each visit**: when the question comes round in the
  queue, the learner writes the code first again. Nothing is stored.
  (Chosen over staying unblurred once revealed.)
- **Hidden tests are always blurred, and their source never reaches the
  browser**: the page shows a placeholder, as `routes.js`'s
  `toPublicProblem` already strips hidden cases today. A CSS blur alone
  would hide nothing (`filter: blur()`,
  https://developer.mozilla.org/en-US/docs/Web/CSS/filter-function/blur).
- **A hidden test's result is pass or fail only, with no name** ("hidden
  test 3: failed"): a name like `test_empty_list` hints at what it
  checks. (Chosen over names and pass or fail.)

## Kind A: to design

1. **Frameworks.** Built in where the language has one; recommended:
   - JavaScript: `node:test` (https://nodejs.org/api/test.html), what
     this repo's own tests use.
   - Python: `unittest` (https://docs.python.org/3/library/unittest.html).
     A guess, not checked: pytest (https://docs.pytest.org/) is more
     widely used, but it's third-party.
   - D: the language's `unittest` blocks
     (https://dlang.org/spec/unittest.html).
   - Java: JUnit 5 (https://junit.org/junit5/docs/current/user-guide/);
     the language has none.
   - C++: no standard. GoogleTest (https://google.github.io/googletest/),
     Catch2 (https://github.com/catchorg/Catch2) and doctest
     (https://github.com/doctest/doctest) are common; doctest is a single
     header, so it's a guess that it compiles fastest. Measure.
2. **Reading results without leaking hidden tests.** Frameworks print the
   failing assertion, often with its source line and expected value. The
   judge reads only a machine-readable report (each test's name and pass
   or fail: e.g. `node:test`'s TAP reporter, a `unittest` result class of
   our own, JUnit's XML report, GoogleTest's `--gtest_output=json`), and
   withholds everything else for hidden tests. A guess, not checked: D's
   built-in runner reports little per test, and stops a module at its
   first failure by default.
3. **Compile errors and stack traces leak hidden tests.** The hidden tests
   are compiled with the learner's code, so a wrong type in the learner's
   function gives a C++, Java or D error in the hidden test's line,
   quoting it. Where an error or a stack trace points into a hidden test,
   the judge shows instead e.g. "a hidden test doesn't compile against your
   code: check the function's signature".
4. **Visible tests' failure output is kept**: after Run, the framework's
   own message (expected and actual, the failing line) teaches learners to
   read real test failures.
5. **The placeholder** for a hidden test: made-up lines of about the same
   length as the test. Whether even its number of lines is too much of a
   hint is open.
6. **One process for the suite, or one per test.** In one process, the
   sandbox's 5 s kill stops a hung test, but every test's result in that
   run is lost (Time Limit Exceeded for all). A framework's own per-test
   timeout can't be relied on to stop a synchronous loop in-process
   (architect, #172: `node:test`'s timeout option hung on Node 22.23.4).
   One process per test, as program mode does per case, keeps the others'
   results, at a JVM start per test in Java.
7. **Speed and memory**: a JVM starting JUnit, or C++ compiling a test
   framework, may not fit the 10 s compile limit or the memory caps
   (`judge/runner.js`). Guesses to measure.
8. **The question's kind**: #160 adds a field naming a question's kind,
   for later kinds too. Decide with it whether this is a kind, a
   `judgeMode`, or both, so the two don't overlap.
9. **Five frameworks per question**: each question's tests written five
   times, kept equivalent. The guide
   (`docs/roles/questions/how-to-write-a-question.md`) would need a
   section on it.

## The verdict can be faked (a known gap to accept or close)

In function mode the comparison with `expected` happens outside the
sandboxed process (`judge/runner.js`, `runFunctionSubmission`'s comment).
Here it can't: the tests, expected values included, run in the same
process as the learner's code, which could replace an assertion, read the
test file in `/work`, or print a fake success. The sandbox still protects
the server; only the verdict is at stake. Suggested: accept it for invited
learners the owner trusts (D4), and say so in `readme.html` §10.

## Kind B (later): judging the learner's tests

Mutation testing: run the tests against deliberately broken versions of
the code (PIT, https://pitest.org/, and Stryker,
https://stryker-mutator.io/, generate them). For teaching, a guess at
what fits: broken versions the author writes, one per mistake to think
of (an off-by-one, empty input, duplicates):

1. The learner's tests must pass on the correct version, so a test that
   always fails catches nothing.
2. Each broken version must fail at least one of them; each that doesn't
   is a bug the tests missed.
3. Broken versions can be visible (a hint) or hidden, like test cases.

Cheating matters less here: the learner's tests run with the author's
code, and a suite that always fails is caught by step 1 (reasoning, not
tested). It reuses Kind A's machinery (a framework run in the sandbox,
read through its report), once per version, so Kind A comes first.

## Who does what

- **Questions**: the judge (`judge/runner.js`), the format
  (`question-files.js`: e.g. a test case `{ name, code, hidden }`), the
  harnesses and reports, the guide, `readme.html` §5 and §6.
- **Infrastructure and security**: JUnit and a C++ framework on the
  cloud, Kubuntu and the VPS (`make toolchain-deps`, the Makefile), made
  visible in the sandbox; a review of the faked-verdict gap.
- **Users**: the problem page (the test program shown, blurred and
  unblurred, the placeholder), and results without hidden names.
- **Architect**: contracts 2 (judging) and 4 (the format).

## Installed today (the cloud, 2026-11-09)

`node:test` (Node 22.23.4), Python's `unittest`, D (`ldc2` 1.36.0).
Not installed: pytest, any C++ test framework, JUnit 5 (only a JUnit 4
jar inside Gradle, `/opt/gradle-8.14.3/lib`). Kubuntu and the VPS not
checked.

## Next, when the hold lifts

A prototype in one language (JavaScript with `node:test`, or Python with
`unittest`) to show: results read without leaking hidden tests, what
cheating looks like, how long a run takes. Then the open points above,
for the owner to answer here.

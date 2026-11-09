# Unit-test questions: tests written as code, in each language's framework

Status: **proposed** (questions, questions 1 session, 2026-11-09; issue
#174). On hold from 2026-11-08 ("Everything on hold") until the owner
chose its prototype, 2026-11-09. Some of the design is decided (below);
a prototype in Python has run ("Prototype", below); nothing is built into
the app. Where this
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
   run is lost (Time Limit Exceeded for all). **Corrected by the
   prototype** (2026-11-09): only if the results are written at the end.
   Written one line per test as each ends, the ones before the hung test
   are kept; it and those after it are lost. A framework's own per-test
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

## Prototype: Python with `unittest` (2026-11-09)

The owner chose Python first, with the prototype's code committed:
`docs/plans/prototypes/unit-test-questions-python/` (its `README.md` has
how to run it, how it works, and every probe's result). It runs in the
real sandbox, as `judge/runner.js` runs Python. What it showed, in the
cloud container (bubblewrap 0.9.0, Python 3.13.18):

- **Item 2, reading results without leaking**: a harness of our own runs
  each test with `TestCase.run` and writes a report line per test; for a
  hidden test, its number and pass or fail only. No probe's ordinary
  failure showed anything of a hidden test.
- **The likely accidental leak is stopped**: the learner's code printing
  its argument shows under visible tests only; output during a hidden
  test is captured and dropped.
- **Item 4**: a visible test's failure keeps `unittest`'s own message:
  the test's line with Python 3.13's `~~~^^^` marks, then the learner's.
- **Item 6**: the report is written as each test ends, so a test that
  hangs loses only itself and those after it (one process: 5004 ms, both
  visible results kept). One process per test keeps the rest too, at 5 s
  per hung test (10,186 ms with two); it would need program mode's 20 s
  total cap (`PROGRAM_TOTAL_RUN_MS`).
- **Item 7, speed**: one sandboxed run of all five tests took 49 to 75 ms;
  one per test, five runs, 230 to 326 ms. Python only; the VPS not tried.
- **The test list comes from the author's reference solution**, run once,
  never from the learner's code, so a submission can't shrink it.
- **Deliberate code beats it, as predicted**:
  - reading `/work/hidden_tests.py` and printing it during a visible test
    shows the whole hidden file;
  - replacing `unittest.TestCase.assertEqual` with a no-op passes every
    test;
  - reading the report's nonce from the harness's memory lets it write a
    report of its own.

  A random nonce in each report line stopped only a fake written without
  it. Like R1 for judge files, this guards against accidents, not against
  deliberate cheating; everything runs in the learner's process.
- **Not shown**: item 3 (compile errors quoting hidden tests) can't occur
  in Python; C++, Java and D need their own prototype.

## Next

For the owner:

1. **The two deliberate gaps** (hidden file readable; verdict fakeable):
   accept them for invited learners the owner trusts (D4), and say so in
   `readme.html` §10, as suggested above? A step up that's cheap: send the
   hidden tests on standard input rather than as a file, so reading them
   means digging in the harness's memory rather than `open()`. Still
   deliberate-possible.
2. **One process or one per test**: one process with a report line per
   test (recommended: the cheaper, and only a hung test and those after it
   lose their result), or one per test (keeps every other result; costs a
   process start each, small in Python, a JVM start each in Java).
3. **The next prototype**: a compiled language, for item 3 and the
   framework's start-up cost (item 7): Java with JUnit 5, or C++ with a
   single-header framework (doctest). Each needs infrastructure and
   security to install the framework.
4. **Item 8** (a kind or a `judgeMode`): ask questions-2 (Issue 160's
   `kind`) before deciding. Since PR 192, a new kind shows "This page
   can't show this kind of question yet" until users build its page; a
   `judgeMode` keeps the code page.

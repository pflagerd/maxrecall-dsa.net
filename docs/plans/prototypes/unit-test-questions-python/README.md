# Prototype: a unit-test question in Python (`unittest`)

Status: **a prototype** (questions, questions-1 session, 2026-11-09;
issue #174), not part of the app. It answers some of
`docs/plans/unit-test-questions.md`'s open points by running them; its
findings are below and in the plan's "Prototype" section. Nothing in the
app uses these files.

## What's here

| File | What it is |
|---|---|
| `question/solution.py` | The author's reference solution, `count_vowels(s)`. The tests are listed by running them against it, never against the learner's code. |
| `question/visible_tests.py` | Two visible tests, as the page would show them (the whole program, `unittest.main()` included). |
| `question/hidden_tests.py` | Three hidden tests: capitals, a mixed-case sentence, no vowels. |
| `harness.py` | Runs in the sandbox as `/work/harness.py`: loads the learner's `solution.py` and the tests, runs each test with `TestCase.run`, and writes one report line per test as it ends. |
| `run.js` | The driver: runs the harness in the real sandbox (`judge/sandbox.js`), as `judge/runner.js` runs Python, and prints what a learner would see and what's withheld. |
| `probes/*.py` | Eleven submissions: right, wrong, broken, and four deliberate cheats. |

## Running it

Needs the sandbox (`make sandbox-deps` installs bubblewrap and checks it).

```bash
node docs/plans/prototypes/unit-test-questions-python/run.js
```

```bash
node docs/plans/prototypes/unit-test-questions-python/run.js --per-test correct.py hangs_on_capitals.py
```

- `--per-test`: one sandboxed process per test, instead of one for all.
- `correct.py …`: the files in `probes/` to judge; all of them if none is
  named.

Each probe prints its verdict, how many sandboxed runs it took and their
time added up, then **Learner sees** (what the page would show) and
**Withheld** (what only the judge sees).

## How it works

1. The driver writes a fresh work folder: the harness, both test files,
   and the submission as `solution.py`. The sandbox sees it read-only as
   `/work`.
2. It starts `python3 /work/harness.py` in the sandbox with
   `SUBMISSION_ENV`, a 5 s limit (`TIMEOUT_MS`) and `SIGKILL`, and sends
   one line on standard input: a random nonce, and which test to run (all,
   or one).
3. The harness caps its memory at 256 MB (as function judging does),
   imports `solution.py` with its output captured, then the test files,
   then runs each test with its output captured.
4. Each report line is `###UNIT_TEST_REPORT### <nonce> <JSON>`, flushed at
   once. The driver reads only lines with this run's nonce; everything
   else on standard output, and all of standard error, is withheld.
5. For a visible test the report has its name, pass/fail/error,
   `unittest`'s own message and what the code printed. For a hidden test,
   its number and pass or fail only.
6. The driver checks every test the reference solution listed has exactly
   one result (two is "couldn't judge").

## What it showed (2026-11-09, the cloud container: bubblewrap 0.9.0, Python 3.13.18)

| Probe | One process | What it shows |
|---|---|---|
| `correct.py` | Accepted, 69 ms | The whole judging, sandbox start-up included. |
| `lowercase_only.py` | Wrong Answer | Passes both visible tests; "hidden test 1: fail", "hidden test 2: fail": no name, no message. |
| `prints_argument.py` | Accepted | Its prints show under the visible tests, and not at all for hidden ones: the accidental leak of a hidden input is stopped. |
| `raises.py` | Wrong Answer | The visible test's traceback: the test's line, then the learner's line, as `unittest` writes it. |
| `syntax_error.py` | Error | Python's message, in `solution.py` only. |
| `wrong_name.py` | Error | "cannot import name 'count_vowels' from 'solution'", from the visible file. |
| `hangs_on_capitals.py` | Time Limit Exceeded, 5004 ms | Both visible results kept; hidden 1 hung, so 1 to 3 have no result. |
| `reads_hidden_tests.py` | Accepted | **Leak**: prints the whole hidden file during a visible test, and it's shown. |
| `patches_assert.py` | Accepted | **Faked**: replaces `assertEqual` with a no-op and returns 0. |
| `fakes_report_blind.py` | Wrong Answer | Its report lines lack the nonce, so they're withheld and the real results shown. |
| `fakes_report_with_nonce.py` | Accepted | **Faked**: reads the nonce from the harness's memory, writes a report, exits. |

With `--per-test`: `correct.py` took 5 runs, 326 ms in all;
`hangs_on_capitals.py` 10,186 ms, with hidden 3's pass kept (hidden 1 and
2 both have capitals, so both hung, 5 s each); the two fakes still
Accepted.

Measured only here. The VPS is slower to hand out memory (#23), and
wasn't tried.

## What it doesn't show

- Plan item 3 (compile errors quoting a hidden test): Python compiles the
  tests separately from the learner's code, so it can't happen here. C++,
  Java and D need their own prototype.
- The hidden file failing to import while the visible one imports: not
  reached by any probe (the visible file imports first, and both import
  the same name).
- Anything about the page (users').

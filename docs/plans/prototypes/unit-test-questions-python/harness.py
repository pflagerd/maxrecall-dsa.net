"""The prototype's harness for a unit-test question in Python (#174, Kind A).

Runs inside the sandbox, as /work/harness.py, next to the learner's
/work/solution.py and the question's /work/visible_tests.py and
/work/hidden_tests.py. /work is read-only.

It reads one line of JSON from standard input:
  {"nonce": "<random>", "select": null | {"visibility": "visible" | "hidden", "index": <0-based>}}
and writes one report line per event to standard output, each
"###UNIT_TEST_REPORT### <nonce> <JSON>", flushed as it happens, so that a
test that never returns loses only its own result and the ones after it.

What it keeps from the learner, and what it drops:
- Output printed while solution.py is imported, and while a visible test
  runs, is captured and put in the report: the learner's own prints.
- Output printed while a hidden test runs is captured and dropped, so a
  debugging print can't show a hidden test's input by accident.
- A visible test's failure keeps unittest's own message (expected, actual,
  the failing lines). A hidden test's result is pass or fail and its
  number: no name, no message, no output.
Everything here is in the learner's own process, so it guards against
accidents only: deliberate code can read the hidden file, the nonce, or
replace unittest's assertions (the probes show which).

Source of the API used: https://docs.python.org/3/library/unittest.html
(TestLoader.loadTestsFromModule, TestCase.run, TestResult).
"""
import contextlib
import io
import json
import resource
import sys
import time
import traceback
import unittest

# The same memory cap function judging puts on Python (judge/runner.js,
# PYTHON_MEMORY_MB).
MEMORY_BYTES = 256 * 1024 * 1024
resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))

MARKER = "###UNIT_TEST_REPORT###"
SOLUTION_FILE = "/work/solution.py"

config = json.loads(sys.stdin.readline())
sys.stdin.close()
nonce = config["nonce"]
select = config.get("select")
real_stdout = sys.stdout


def emit(record):
    """Writes one report line, with the nonce, and flushes it at once."""
    real_stdout.write(f"{MARKER} {nonce} {json.dumps(record)}\n")
    real_stdout.flush()


def learner_traceback(exc):
    """The exception as text, keeping only the frames in the learner's file.

    A SyntaxError keeps its own file, line and caret. Frames in the
    harness, the import machinery or a test file are left out, so a hidden
    test's line can't appear.
    """
    te = traceback.TracebackException.from_exception(exc)
    te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename == SOLUTION_FILE])
    return "".join(te.format())


def flatten(suite):
    """The tests in a suite, in the loader's order (by method name), suites inside it opened."""
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from flatten(item)
        else:
            yield item


# The learner's code first, with whatever it prints captured.
captured = io.StringIO()
try:
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        import solution  # noqa: F401  (the test files import from it)
except BaseException as exc:  # SyntaxError, NameError, SystemExit, ...
    emit({"event": "solution-failed", "message": learner_traceback(exc), "output": captured.getvalue()})
    sys.exit(0)
emit({"event": "solution-loaded", "output": captured.getvalue()})

# Then the tests. A test file that can't import (the learner's function
# missing or misnamed) is reported, but for the hidden file without its
# message, which would quote the hidden file's import line.
loader = unittest.TestLoader()
tests = {}
for visibility in ("visible", "hidden"):
    try:
        module = __import__(f"{visibility}_tests")
    except Exception as exc:
        message = "".join(traceback.format_exception_only(exc)) if visibility == "visible" else (
            "The hidden tests couldn't load against your code: check the function's name.")
        emit({"event": "tests-failed", "visibility": visibility, "message": message})
        sys.exit(0)
    tests[visibility] = list(flatten(loader.loadTestsFromModule(module)))
emit({"event": "list", "visible": [t._testMethodName for t in tests["visible"]], "hidden": len(tests["hidden"])})

for visibility in ("visible", "hidden"):
    for index, test in enumerate(tests[visibility]):
        if select and (select["visibility"] != visibility or select["index"] != index):
            continue
        result = unittest.TestResult()
        output = io.StringIO()
        started = time.perf_counter()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            test.run(result)
        ms = round((time.perf_counter() - started) * 1000, 2)
        problems = result.failures + result.errors
        if visibility == "visible":
            if result.errors:
                outcome = "error"
            elif result.failures:
                outcome = "fail"
            else:
                outcome = "pass"
            emit({"event": "test", "visibility": "visible", "index": index, "name": test._testMethodName,
                  "outcome": outcome, "message": "".join(text for _, text in problems),
                  "output": output.getvalue(), "ms": ms})
        else:
            emit({"event": "test", "visibility": "hidden", "index": index,
                  "outcome": "fail" if problems else "pass", "ms": ms})
emit({"event": "done"})

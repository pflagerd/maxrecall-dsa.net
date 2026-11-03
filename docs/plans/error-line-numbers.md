# Plan: error line numbers that match the editor (issue #26)

Status: **steps 1 and 2 done** (2026-11-03; step 1 merged from branch
`error-line-numbers`, step 2 on branch `runtime-error-lines`).
Step 2 as built: the message of an exception the harness catches ends in
"(line N)", the deepest line of the learner's code on its stack. D
function judging compiles with `-g` for that, measured at about 200 ms more
per judging (two-sum median 755 → 952 ms in the cloud), so that a
library's exception (e.g. `to!int("x")`) also gets the learner's line.
Without `-g`, only errors thrown at the learner's own line (an index out of
range) would. Decided by the owner: the learner's code as a file of its own (the
revised recommendation below), D by option 2 (a separate module with a
prelude import on line 1; 1b, chosen first, failed on a newer LDC, see
below), L2 (a) runtime lines as step 2, L3 `runpy`, L4 the `solution.*`
names.

## The cause

For function judging, `judge/runner.js` writes one source file per
submission. The file holds the harness (the code that reads the test
cases, calls the submitted function and prints the results) as well as
the learner's code. In four of the five languages, harness lines come
*before* the learner's code (`buildPythonSource`, `buildCppSource`,
`buildJavaSource`, `buildDSource`), so the compiler or interpreter counts
those too.

Measured on 2026-11-03 by submitting code with a mistake on **line 3**
(as the editor numbers it) through `runSubmission`:

| Language | Error | Reported as | Off by | What's in front |
|---|---|---|---|---|
| Python | syntax error | `File "/work/main.py", line 10` | +7 | `import sys, json` and the `resource.setrlimit` block |
| C++ | compile error | `/work/main.cpp:93:12` | +90 | all of `judge/cpp/judge_json.hpp`, inlined, then 13 `#include`s and `using namespace std;` |
| Java | compile error | `/work/Main.java:5` | +2 | `import java.util.Scanner;` and a blank line |
| D | compile error | `/work/main.d(14)` | +11 | 10 `import`s and a blank line |
| JavaScript | (none) | | 0 | nothing: the learner's code comes first |

Program judging (`judgeMode: "program"`) has no harness: the code is
written to the source file exactly as typed (`runProgramSubmission`), so
its numbers are already right. Measured the same day with
`questions/hello-world.json` and a mistake on line 3: every language
reported line 3, for compile and syntax errors and for runtime errors
alike. That includes runtime errors, because nothing catches the exception,
so the language's own report (traceback, stack trace) reaches stderr.
The exception is a C++ exception, which reports no line ("terminate called
after throwing an instance of 'std::runtime_error'"). None of the changes
below touch program judging, and step 1's test checks it stays right.

Two related problems turned up:

1. **Runtime errors show no line at all** in JavaScript, Python and Java.
   The harness catches the exception and reports only its message
   (`err.message`, `str(err)`, `getMessage()`), e.g. "Index 99 out of
   bounds for length 4".
2. **Some errors point into the harness.** A C++ submission whose
   parameter is `vector<int>&` instead of `vector<int>` fails at the
   harness's call to it (`main.cpp:106`), a line the learner can't see.

## Revised recommendation: the learner's code in a file of its own

The owner asked (2026-11-03) whether treating the learner's code as a
linked file or a called module gives the real line numbers. Yes, mostly.
The catch is that the learner's code today relies on the harness's
imports: `sys` and `json` in Python, 13 `#include`s and `using namespace
std;` in C++ (the starter code has no includes), and 10 imports in D. A
truly separate module doesn't see those. Tried that day, with the
compilers in the cloud session:

| Language | Learner's code as its own file | Result |
|---|---|---|
| C++ | `solution.cpp`, pulled in with `#include "solution.cpp"` after the harness's includes | `solution.cpp:3:12` with its `3 \|` excerpt, under "In file included from main.cpp:4:". Harness lines are named `main.cpp`, with a note pointing back at `solution.cpp:1:33`. The code still sees the includes. |
| C++ | `solution.cpp` as a separate translation unit, linked | Fails: `'vector' does not name a type`, because the includes aren't visible. It would also need a declaration in the harness that matches the learner's exact signature, or the link fails. **Not recommended.** |
| Java | `Solution.java`, compiled with `javac Main.java Solution.java` | `Solution.java:4` for a compile error, and `at Solution.twoSum(Solution.java:4)` in a stack trace. The learner's own `import`s go in their file. |
| Python | `solution.py`, run with `runpy.run_path("solution.py", init_globals={"sys": sys, "json": json}, run_name="__main__")` (<https://docs.python.org/3/library/runpy.html#runpy.run_path>) | `File "solution.py", line 3` for runtime and syntax errors. It returns the module's globals, from which the harness takes the function. This is the standard library's tool for running a file as a module. It replaces L3 (a)'s `exec`, keeping `sys`, `json` and `__name__ == '__main__'` as today. |
| D | `solution.d` as a separate module (`import solution;`) | Fails for code that works today: `writeln is not defined, perhaps import std.stdio; is needed?`. Every D file is a module (<https://dlang.org/spec/module.html>), and a module doesn't see another's imports. |
| D | 1b (chosen first, **dropped**): `solution.d` mixed into `main.d`: `mixin("#line 1 \"solution.d\"\n" ~ import("solution.d"))`, compiled with `-J/work` | `solution.d(3)` for a compile error, and an exception's `file`/`line` say `solution.d:3`. Without the `#line` it says `main.d-mixin-3(5)`. The code sees the harness's imports. The compiler refuses absolute and `..` paths in `import("…")`, so it reads only the work folder. **But on the owner's Kubuntu, LDC 1.41.0 (DMD 2.111.0 frontend) reported `solution.d(25)` for line 3**; LDC 1.36 (DMD 2.106) here reported line 3. I didn't find the exact cause. Possibly related: <https://github.com/dlang/dmd/issues/20982> (wrong line numbers after a source-location change in the 2.111 era) and <https://github.com/dlang/dmd/issues/20929> (`#line` and `-verrors=context`). |
| D | **2 (chosen, 2026-11-03):** a separate module, with `import judge_prelude;` (which `public import`s the standard modules) put on the same line as the learner's first line | `solution.d(3)`, and `writeln` works. It relies only on how a compiler counts lines in an ordinary file, no `#line` or mixin. Only the columns of line 1 move. `make line-numbers-test`: 25 of 25 with LDC 1.36 (cloud) and with LDC 1.41.0 (owner's Kubuntu, 2026-11-03). The harness calls `solution.<name>`: unqualified, a name `std.algorithm` also has is refused (tested: "`reverse` matches conflicting symbols"). |
| JavaScript | (not needed) | Already right. |

So L1 becomes: C++ `#include "solution.cpp"` (simpler than counting
lines for `#line`), Java `Solution.java`, Python `runpy` with
`solution.py`, D option 2 (a separate module with a prelude import on line 1),
JavaScript unchanged. L4's names
become `solution.cpp`, `Solution.java`, `solution.py` and `solution.d`,
with the harness's own lines named `main.cpp`, `Main.java` and `main.py`.

## Decisions

### L1. How to make compile and syntax errors report the editor's lines

- **(a) Make the compiler or interpreter count from the learner's
  code**, so every message is right without changing it afterwards:
  - **C++:** a `#line 1 "solution.cpp"` directive just before the
    learner's code, and `#line <n> "judge_harness.cpp"` just after. This is
    standard C++ (the `#line` directive,
    <https://en.cppreference.com/w/cpp/preprocessor/line>). Tested with
    g++ 13.3: messages then say `solution.cpp:3:12`, and a harness line
    says `judge_harness.cpp:8:28` followed by a note pointing at
    `solution.cpp:1:33`, the learner's own parameter. GCC prints its
    `3 | …` source excerpt only if a file of that name exists, because it
    reads the excerpt from disk. So the judge also writes the learner's
    code alone as `solution.cpp` in the work folder.
  - **D:** the same, with D's `#line` special token sequence
    (<https://dlang.org/spec/lex.html#special-token-sequence>). Tested
    with LDC 1.36: `solution.d(3): Error: …`.
  - **Java:** Java has no `#line`. But only one line is in front:
    `import java.util.Scanner;`. Writing `java.util.Scanner` in full in
    the harness removes it, so the learner's code starts at line 1. (The
    learner's own `import`s still work, since they come first.)
  - **Python:** Python has no `#line` either. The harness would read the
    learner's code from a separate `solution.py` and run it with
    `exec(compile(source, 'solution.py', 'exec'), namespace)`, so
    tracebacks say `File "solution.py", line 3` (L3 has an alternative).
  - **JavaScript:** already right.
- (b) Rewrite the numbers in the error text afterwards: subtract the
  harness's line count from each `main.cpp:93:`, `main.d(14)`,
  `Main.java:5`, `File "…main.py", line 10`, and GCC's `93 |` excerpts.
  It's one mechanism for every language, but it depends on each
  compiler's exact message format, which changes between versions, and
  on not mistaking other numbers in a message for line numbers.

**Recommendation: (a).** The compilers do the counting themselves, and a
harness line shows up under a name of its own (`judge_harness.cpp`),
which helps with problem 2 above.

### L2. Runtime errors: add the line?

- **(a) Yes, as a second step:** the harness finds the deepest stack frame
  that is in the learner's code and adds "(line N)" to the message:
  - Python: `traceback.extract_tb`, the last frame in `solution.py`;
  - JavaScript: the first `main.js:N` frame in `err.stack`;
  - Java: the first stack trace element that isn't in the harness's
    `Main` class;
  - D: `Throwable` carries `file` and `line` itself
    (<https://dlang.org/phobos/object.html#.Throwable>).
  - **C++ can't:** a `std::exception` carries no location, and a crash
    such as a segfault reports none either. That stays as it is.
- (b) No, not now.

**Recommendation: (a)**, after L1, as its own step and commit.

### L3. Python: how to get the learner's code to line 1

- **(a) `exec` from a separate `solution.py`**, as in L1 (a). The harness
  keeps its memory limit and its `sys`/`json` imports. The learner's code
  runs with `__name__ == '__main__'` as now, so an
  `if __name__ == '__main__':` block behaves the same.
- (b) Move the memory limit into the run command (`ulimit -v`, as program
  judging already does, `runCommand` in `judge/runner.js`), and import
  `sys` and `json` *after* the learner's code. It's simpler, but `sys`
  would no longer be imported for the learner: code that uses
  `sys.setrecursionlimit` without `import sys`, which works today, would
  fail with a `NameError`.

**Recommendation: (a)**, which changes nothing for the learner except the
line numbers and the file name.

### L4. File names in messages

With L1 (a), messages name `solution.cpp`, `solution.py` and
`solution.d` instead of `/work/main.cpp` and so on. Java's stays
`Main.java` (a `public class Main` must be in `Main.java`), and
JavaScript's stays `main.js`.

- **(a) Fine as described.**
- (b) Name them all `main.*`, to match today's names.

**Recommendation: (a).** "solution" says it's your code. A
`judge_harness.*` name says it isn't.

## Steps once decided

1. L1 (and L3, L4): line numbers right for compile and syntax errors in
   every language. A test submits a mistake on a known line in each
   language and checks the number reported, in both judging modes. The
   existing escape test and browser tests must still pass.
2. L2: line numbers for runtime errors, except C++.
3. Possible later step (not planned): make a line number in the console
   clickable, jumping to that line in the editor.

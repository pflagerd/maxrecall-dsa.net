const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cgroups = require('./cgroups');
const { withJudgeSlot } = require('./queue');
const { SUBMISSION_ENV, RUN_LIMITS, CPU_LIMIT_EXIT_CODE, HELPER_DIR, HELPER_SANDBOX_PATH, findOnPath, sandboxStatus, sandboxedRun, spawnSandboxed, prepareWorkDir, assertJudgingAllowed } = require('./sandbox');

/** @typedef {import('./cgroups').SubmissionCgroup} SubmissionCgroup */

/**
 * One test case, from the question file. Function judging uses args,
 * program judging input.
 *
 * @typedef {object} TestCase
 * @property {unknown[]} [args] - Function judging: the arguments to call with.
 * @property {string} [input] - Program judging: the program's standard input.
 * @property {unknown} expected - The expected return value (any JSON value),
 *   or the expected standard output.
 * @property {boolean} [hidden] - Only used by Submit; its details aren't
 *   sent back.
 */

/**
 * A question's "signature" field for one language: the declared types of
 * the function's parameters and return value, which the compiled
 * languages' harnesses need (e.g. { params: ["vector<int>", "int"],
 * returns: "vector<int>" } for C++).
 *
 * @typedef {object} FunctionSignature
 * @property {string[]} [params] - Each parameter's type, as the language writes it.
 * @property {string} [returns] - The return type.
 * @property {string} [customSerializer] - Code in that language spliced into
 *   the harness, to turn a type of the question's own into JSON: e.g. a
 *   buildJson() overload for C++ (singly-linked-list-hello-world.json).
 */

/**
 * What to judge: runSubmission()'s argument.
 *
 * @typedef {object} Submission
 * @property {string} language - javascript, python, cpp, java or d.
 * @property {string} code - The learner's code.
 * @property {string} [functionName] - Function judging: the function to call.
 * @property {TestCase[]} testCases - The cases to judge against.
 * @property {FunctionSignature} [signature] - Function judging, cpp/java/d.
 * @property {string} [judgeMode] - "function" (the default) or "program".
 */

/**
 * One test case's result. Hidden cases carry no input, expected or actual.
 *
 * @typedef {object} TestResult
 * @property {number} index - Its position in testCases, from 0.
 * @property {boolean | undefined} hidden
 * @property {boolean} passed
 * @property {unknown} [input]
 * @property {unknown} [expected]
 * @property {unknown} [actual]
 * @property {string} [error] - The submission's own error text, for this case.
 */

/**
 * The judge's verdict on a submission.
 *
 * @typedef {object} JudgeResult
 * @property {string} status - "Accepted", "Wrong Answer", "Runtime Error",
 *   "Time Limit Exceeded" or "Compile Error".
 * @property {number} passed - Test cases passed.
 * @property {number} total - Test cases.
 * @property {number} runtimeMs - From the start of judging (compiling
 *   included) to the verdict.
 * @property {string} [error] - When judging failed as a whole: why.
 * @property {string} stdout - The submission's own standard output.
 * @property {string} stderr - Its standard error.
 * @property {TestResult[]} results - One per test case, in order.
 */

// Shown when a run is stopped by the CPU-time limit rather than the clock.
const CPU_LIMIT_MESSAGE = `CPU time limit exceeded (${RUN_LIMITS.cpuSoftSeconds} s of CPU time in one process, all its threads together).`;

const TIMEOUT_MS = 5000;
// Program judging runs one process per test case, each allowed TIMEOUT_MS,
// so without a total a question with 20 cases would allow 100 s. This caps
// all of a submission's runs together (not counting compiling). Java starts
// a JVM per case, about 0.3 to 0.7 s each with the sandbox, so 20 s leaves
// room for about 30 cases.
const PROGRAM_TOTAL_RUN_MS = 20000;
const NODE_MEMORY_MB = 128;
const PYTHON_MEMORY_MB = 256;
const CPP_MEMORY_MB = 128;
const CPP_COMPILE_TIMEOUT_MS = 10000;
// Higher than the other languages' caps to absorb the JVM's own baseline
// overhead (class loading, JIT, etc.), which eats into -Xmx the same way
// the Python interpreter's own footprint eats into RLIMIT_AS.
const JAVA_MEMORY_MB = 256;
const JAVA_COMPILE_TIMEOUT_MS = 10000;
// D compiles to a native binary like C++, with no JVM-style baseline
// overhead, so it gets the same cap as C++.
const D_MEMORY_MB = 128;
const D_COMPILE_TIMEOUT_MS = 10000;
// The D compiler: LDC (ldc2) if it's installed, else DMD. LDC is in
// Ubuntu's own archive (package ldc), so scripts/toolchain-deps.sh installs
// it on Kubuntu and the VPS alike; DMD comes from the third-party d-apt
// (docs/d-compiler.md) and stays as the fallback. Both use the DMD
// frontend, so error messages look alike; they accept the same -of=/-od=.
// Chosen once, at startup, like the other toolchains' paths.
const D_COMPILER = findOnPath('ldc2') ? 'ldc2' : 'dmd';
// Caps how much stdout/stderr get buffered, both to bound this server's own
// memory if a submission spams output and to keep the response payload sane.
const MAX_CAPTURED_OUTPUT = 200_000;

// Printed on its own line right before the harness's JSON result, so a
// submission's own stdout debugging (console.log/print/cout) can be told
// apart from the harness's own output: everything before the last
// occurrence of this marker is the user's stdout, everything after is ours.
const RESULT_MARKER = '###JUDGE_RESULT###';

const CPP_DIR = path.join(__dirname, 'cpp');
const CPP_JSON_HELPER = fs.readFileSync(path.join(CPP_DIR, 'judge_json.hpp'), 'utf8');
const CPP_JSON_OBJECT = path.join(CPP_DIR, 'judge_json.o');

// judge_json.cpp rarely changes, so its compiled form is built once (here,
// at module load) and linked into every submission, rather than recompiled
// from source on every single Run/Submit — that was the dominant cost in
// C++ judging time (the submission's own code is typically tiny next to
// ~250 lines of JSON parser/serializer). Rebuilt automatically whenever the
// source is newer than the cached object file, so there's no separate
// build step to remember after an edit to judge_json.cpp.
/**
 * @returns {void}
 * @throws {Error} If g++ fails.
 */
function ensureCppJsonObjectBuilt() {
  const sourceFile = path.join(CPP_DIR, 'judge_json.cpp');
  const sourceMtime = fs.statSync(sourceFile).mtimeMs;
  const objectMtime = fs.existsSync(CPP_JSON_OBJECT) ? fs.statSync(CPP_JSON_OBJECT).mtimeMs : 0;
  if (objectMtime > sourceMtime) return;
  execFileSync('g++', ['-std=c++17', '-O2', '-c', sourceFile, '-o', CPP_JSON_OBJECT]);
}
ensureCppJsonObjectBuilt();

const JAVA_DIR = path.join(__dirname, 'java');

// JudgeJson.java rarely changes, so it's compiled once (here, at module
// load) into JudgeJson.class and put on both javac's and java's classpath
// for every submission, rather than recompiled from source on every single
// Run/Submit — the same role ensureCppJsonObjectBuilt() plays for C++.
/**
 * @returns {void}
 * @throws {Error} If javac fails.
 */
function ensureJudgeJsonClassBuilt() {
  const sourceFile = path.join(JAVA_DIR, 'JudgeJson.java');
  const classFile = path.join(JAVA_DIR, 'JudgeJson.class');
  const sourceMtime = fs.statSync(sourceFile).mtimeMs;
  const classMtime = fs.existsSync(classFile) ? fs.statSync(classFile).mtimeMs : 0;
  if (classMtime > sourceMtime) return;
  execFileSync('javac', ['-d', JAVA_DIR, sourceFile]);
}
ensureJudgeJsonClassBuilt();

// Copies the prebuilt helpers into HELPER_DIR (judge/sandbox.js), which
// every sandbox sees read-only at /judge: cpp/judge_json.o and java/*.class.
// Not bound from the checkout, which the sandbox's user may not be able to
// enter (/root on the VPS). Permissions are set explicitly, because a copy
// can keep a strict mode from the checkout.
/**
 * @returns {void}
 * @throws {Error} If a folder can't be made or a file copied.
 */
function stageHelpers() {
  const cppDir = path.join(HELPER_DIR, 'cpp');
  const javaDir = path.join(HELPER_DIR, 'java');
  for (const dir of [cppDir, javaDir]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755);
  }
  const copy = (/** @type {string} */ from, /** @type {string} */ to) => {
    fs.copyFileSync(from, to);
    fs.chmodSync(to, 0o644);
  };
  copy(CPP_JSON_OBJECT, path.join(cppDir, 'judge_json.o'));
  for (const name of fs.readdirSync(JAVA_DIR).filter((n) => n.endsWith('.class'))) {
    copy(path.join(JAVA_DIR, name), path.join(javaDir, name));
  }
}
stageHelpers();

// Maps a C++ parameter type (as written in a problem's signature.cpp.params)
// to the judge_json.hpp helper that extracts it from a JsonValue.
/** @type {Record<string, string>} */
const CPP_PARAM_EXTRACTORS = {
  int: 'extractInt',
  bool: 'extractBool',
  string: 'extractString',
  'vector<int>': 'extractIntVector',
};

// Maps a Java parameter type (as written in a problem's signature.java.params)
// to the JudgeJson.Value instance method that extracts it.
/** @type {Record<string, string>} */
const JAVA_PARAM_EXTRACTORS = {
  int: 'asInt',
  boolean: 'asBoolean',
  String: 'asString',
  'int[]': 'asIntArray',
};

// Maps a D parameter type (as written in a problem's signature.d.params) to
// the harness's own __judge_extract* helper (defined inline in
// buildDSource — D's std.json is part of Phobos, so there's no need for a
// precompiled JSON helper like judge_json.cpp/JudgeJson.java).
/** @type {Record<string, string>} */
const D_PARAM_EXTRACTORS = {
  int: '__judge_extractInt',
  bool: '__judge_extractBool',
  string: '__judge_extractString',
  'int[]': '__judge_extractIntArray',
};

// The harness: the code that reads the test cases, calls the submitted
// function and prints the results. In function judging the learner's code
// is a file of its own next to it (SOLUTION_FILE_NAMES), so compiler and
// interpreter messages give the line numbers the editor shows (issue #26,
// docs/plans/error-line-numbers.md); JavaScript's harness comes after the
// learner's code in the same file, which numbers them right already.
// Test case args (never the expected answers) are piped in over stdin,
// so the submission isn't handed the expected outputs. Until it's
// sandboxed, though, it can still read them from questions/*.json on disk
// (gap G2 in docs/plans/sandboxing.md).
// A caught exception's message gets "(line N)": the deepest frame of its
// stack that's in the learner's code, which is lines 1 to
// __judge_userLines of main.js (the harness follows). Only the "at ..."
// lines are searched, not the message, which the code controls.
/**
 * @param {string} userCode - The learner's code, which comes first in main.js.
 * @param {string} functionName - The function the harness calls.
 * @returns {string} main.js: the learner's code, then the harness.
 */
function buildJavascriptSource(userCode, functionName) {
  return `${userCode}
const __judge_userLines = ${userCode.split('\n').length};
function __judge_withLine(message, err) {
  const stack = err && typeof err.stack === 'string' ? err.stack : '';
  for (const frame of stack.split('\\n').filter((l) => /^\\s+at /.test(l))) {
    const m = /main\\.js:(\\d+):\\d+/.exec(frame);
    if (m && Number(m[1]) <= __judge_userLines) return \`\${message} (line \${m[1]})\`;
  }
  return message;
}
process.on('unhandledRejection', (__judge_err) => { console.error(__judge_err); process.exit(1); });
let __judge_input = '';
process.stdin.on('data', (chunk) => { __judge_input += chunk; });
process.stdin.on('end', () => {
  const __judge_cases = JSON.parse(__judge_input);
  const __judge_results = __judge_cases.map((tc) => {
    try {
      return { actual: ${functionName}(...tc.args) };
    } catch (err) {
      return { error: __judge_withLine((err && err.message) || String(err), err) };
    }
  });
  process.stdout.write('\\n${RESULT_MARKER}\\n' + JSON.stringify(__judge_results));
});
`;
}

// The learner's code is in solution.py, run with runpy.run_path
// (https://docs.python.org/3/library/runpy.html#runpy.run_path), so
// tracebacks say File ".../solution.py", line N. It's given sys and json,
// which it could use without importing when it was pasted into this file,
// and runs as __main__, as it did then. run_path returns its globals, which
// the functions defined there keep using.
/**
 * @param {string} functionName - The function the harness calls.
 * @returns {string} main.py, the harness; the learner's code is solution.py.
 */
function buildPythonSource(functionName) {
  return `import sys, json, os, runpy, traceback
try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (${PYTHON_MEMORY_MB} * 1024 * 1024, ${PYTHON_MEMORY_MB} * 1024 * 1024))
except Exception:
    pass

__judge_ns = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), '${SOLUTION_FILE_NAMES.python}'),
                            init_globals={'sys': sys, 'json': json}, run_name='__main__')
if '${functionName}' not in __judge_ns:
    raise NameError("name '${functionName}' is not defined")
__judge_fn = __judge_ns['${functionName}']

# A caught exception's message (its type's name if it has none) gets
# "(line N)": the deepest frame of its traceback in solution.py.
def __judge_with_line(err):
    message = str(err) or type(err).__name__
    line = None
    for frame in traceback.extract_tb(err.__traceback__):
        if os.path.basename(frame.filename) == '${SOLUTION_FILE_NAMES.python}':
            line = frame.lineno
    return f'{message} (line {line})' if line else message

__judge_cases = json.loads(sys.stdin.read())
__judge_results = []
for __judge_tc in __judge_cases:
    try:
        __judge_results.append({'actual': __judge_fn(*__judge_tc['args'])})
    except Exception as __judge_err:
        __judge_results.append({'error': __judge_with_line(__judge_err)})
def __judge_default(o):
    # Lets submissions return custom objects (e.g. a linked list node) by
    # serializing their attributes, recursively, instead of requiring JSON-native types.
    if hasattr(o, '__dict__'):
        return o.__dict__
    return str(o)

sys.stdout.write('\\n${RESULT_MARKER}\\n' + json.dumps(__judge_results, default=__judge_default))
`;
}

// C++ is statically typed, so (unlike the JS/Python harnesses) the generated
// main() needs to know each parameter's type to extract it, and the return
// type resolves by overload (buildJson is overloaded per type in
// judge_json.hpp, plus an optional problem-specific overload for custom
// structs spliced in via signature.customSerializer).
// The learner's code is #included from solution.cpp after the harness's
// includes, so it still sees them and `using namespace std;`, and g++
// reports its lines as solution.cpp:N, with the source excerpt (g++ reads
// excerpts from the named file, so it must exist).
/**
 * @param {string} functionName - The function the harness calls.
 * @param {FunctionSignature} signature - Its parameter types.
 * @returns {string} main.cpp, the harness; the learner's code is solution.cpp.
 */
function buildCppSource(functionName, signature) {
  const params = signature.params || [];
  const argExprs = params
    .map((type, i) => {
      const extractor = CPP_PARAM_EXTRACTORS[type];
      if (!extractor) throw new Error(`Unsupported C++ param type: ${type}`);
      return `${extractor}(args[${i}])`;
    })
    .join(', ');

  return `${CPP_JSON_HELPER}
#include <iostream>
#include <algorithm>
#include <unordered_map>
#include <unordered_set>
#include <map>
#include <set>
#include <stack>
#include <queue>
#include <deque>
#include <numeric>
#include <climits>
#include <cmath>
using namespace std;

#include "${SOLUTION_FILE_NAMES.cpp}"

${signature.customSerializer || ''}
int main() {
    string __judge_input((istreambuf_iterator<char>(cin)), istreambuf_iterator<char>());
    JsonValue __judge_cases = parseJson(__judge_input);
    JsonValue __judge_results = JsonValue::array();
    for (size_t __judge_i = 0; __judge_i < __judge_cases.size(); ++__judge_i) {
        const JsonValue& args = __judge_cases[__judge_i].at("args");
        JsonValue __judge_entry = JsonValue::object();
        try {
            auto __judge_result = ${functionName}(${argExprs});
            __judge_entry["actual"] = buildJson(__judge_result);
        } catch (const std::exception& e) {
            __judge_entry = JsonValue::object();
            __judge_entry["error"] = JsonValue(string(e.what()));
        } catch (...) {
            __judge_entry = JsonValue::object();
            __judge_entry["error"] = JsonValue(string("Unknown error"));
        }
        __judge_results.push_back(__judge_entry);
    }
    cout << "\\n${RESULT_MARKER}\\n" << __judge_results.dump();
    return 0;
}
`;
}

// Java is statically typed like C++, so the same param-type-lookup approach
// applies, but the user's code is a method on a class (not a bare function),
// so the harness instantiates a Solution and calls the method on it. Return
// serialization also can't rely on overload resolution picking the right
// buildJson the way C++ does transparently — Java resolves overloads on the
// variable's *declared* type, so __judge_result is declared with exactly
// signature.returns, same as the C++ harness's `auto` relies on the actual
// return type.
// The learner's code is Solution.java, compiled together with this Main.java
// (compileCommand), so javac and stack traces report Solution.java:N.
/**
 * @param {string} functionName - The method the harness calls.
 * @param {FunctionSignature} signature - Its parameter types.
 * @returns {string} Main.java, the harness; the learner's code is Solution.java.
 */
function buildJavaSource(functionName, signature) {
  const params = signature.params || [];
  const argExprs = params
    .map((type, i) => {
      const extractor = JAVA_PARAM_EXTRACTORS[type];
      if (!extractor) throw new Error(`Unsupported Java param type: ${type}`);
      return `__judge_args.get(${i}).${extractor}()`;
    })
    .join(', ');
  const returns = signature.returns || 'void';

  return `import java.util.Scanner;

public class Main {
    // A caught exception's message gets "(line N)": the first (deepest)
    // stack frame in the learner's file.
    static String __judge_withLine(String message, Throwable err) {
        for (StackTraceElement el : err.getStackTrace()) {
            if ("${SOLUTION_FILE_NAMES.java}".equals(el.getFileName()) && el.getLineNumber() > 0) return message + " (line " + el.getLineNumber() + ")";
        }
        return message;
    }
    static JudgeJson.Value toJson(int v) { return JudgeJson.Value.of((long) v); }
    static JudgeJson.Value toJson(boolean v) { return JudgeJson.Value.of(v); }
    static JudgeJson.Value toJson(String v) { return JudgeJson.Value.of(v); }
    static JudgeJson.Value toJson(int[] v) {
        JudgeJson.Value __judge_arr = JudgeJson.Value.array();
        for (int __judge_x : v) __judge_arr.add(toJson(__judge_x));
        return __judge_arr;
    }
${signature.customSerializer || ''}
    public static void main(String[] __judge_cliArgs) throws Exception {
        Scanner __judge_scanner = new Scanner(System.in);
        StringBuilder __judge_inputBuilder = new StringBuilder();
        while (__judge_scanner.hasNextLine()) __judge_inputBuilder.append(__judge_scanner.nextLine()).append('\\n');
        JudgeJson.Value __judge_cases = JudgeJson.parse(__judge_inputBuilder.toString());
        JudgeJson.Value __judge_results = JudgeJson.Value.array();
        Solution __judge_sol = new Solution();
        for (int __judge_i = 0; __judge_i < __judge_cases.size(); __judge_i++) {
            JudgeJson.Value __judge_args = __judge_cases.get(__judge_i).get("args");
            JudgeJson.Value __judge_entry = JudgeJson.Value.object();
            try {
                ${returns} __judge_result = __judge_sol.${functionName}(${argExprs});
                __judge_entry.set("actual", toJson(__judge_result));
            } catch (Throwable __judge_err) {
                __judge_entry = JudgeJson.Value.object();
                String __judge_msg = __judge_err.getMessage();
                __judge_entry.set("error", JudgeJson.Value.of(__judge_withLine(__judge_msg == null ? __judge_err.toString() : __judge_msg, __judge_err)));
            }
            __judge_results.add(__judge_entry);
        }
        System.out.print("\\n${RESULT_MARKER}\\n" + __judge_results.dump());
    }
}
`;
}

// D is statically typed like C++, and (like C++, via `auto`) resolves the
// overloaded __judge_toJson by the submission's actual declared return
// type, so signature.returns isn't functionally needed here — it's kept in
// each problem's signature.d purely for schema consistency with the other
// compiled languages.
// The learner's code is solution.d, a module of its own, compiled with
// this one, which imports it. Every D file is a module, and a module
// doesn't see another's imports (https://dlang.org/spec/module.html), so
// solution.d starts with `import judge_prelude; ` on its first line:
// judge_prelude.d public-imports D_STANDARD_IMPORTS, which the code could use
// without importing when it was pasted into this file. Being on line 1, it
// moves no line numbers (only the columns of line 1).
// Not a mixin of the code with #line in front, tried first: LDC 1.36 (DMD
// 2.106 frontend) then reported the right lines, but LDC 1.41 (DMD 2.111)
// reported line 25 for line 3 (owner's Kubuntu, 2026-11-03).
// The function is called as solution.<name>: it's in another module than
// std.algorithm and the rest, so a name they also have (reverse, find, ...)
// would otherwise be ambiguous.
/**
 * @param {string} functionName - The function the harness calls.
 * @param {FunctionSignature} signature - Its parameter types.
 * @returns {string} main.d, the harness; the learner's code is solution.d.
 */
function buildDSource(functionName, signature) {
  const params = signature.params || [];
  const argExprs = params
    .map((type, i) => {
      const extractor = D_PARAM_EXTRACTORS[type];
      if (!extractor) throw new Error(`Unsupported D param type: ${type}`);
      return `${extractor}(__judge_args[${i}])`;
    })
    .join(', ');

  return `${D_STANDARD_IMPORTS.map((m) => `import ${m};`).join('\n')}
import solution;

// A caught exception's message gets "(line N)": where it was thrown, if
// that's solution.d (an error the learner's line caused, e.g. an index out
// of range), else the first solution.d frame of its stack trace, for an
// exception thrown inside the standard library. Stack traces name files
// and lines only with debug info, so function judging compiles with -g.
string __judge_withLine(string message, Throwable err) {
    import std.path : baseName;
    if (baseName(err.file) == "${SOLUTION_FILE_NAMES.d}") return message ~ " (line " ~ to!string(err.line) ~ ")";
    if (err.info is null) return message;
    foreach (frame; err.info) {
        auto at = frame.indexOf("${SOLUTION_FILE_NAMES.d}:");
        if (at < 0) continue;
        auto digits = frame[at + "${SOLUTION_FILE_NAMES.d}:".length .. $];
        size_t n = 0;
        while (n < digits.length && digits[n] >= '0' && digits[n] <= '9') n++;
        if (n > 0) return message ~ " (line " ~ digits[0 .. n].idup ~ ")";
    }
    return message;
}

JSONValue __judge_toJson(int v) { return JSONValue(v); }
JSONValue __judge_toJson(bool v) { return JSONValue(v); }
JSONValue __judge_toJson(string v) { return JSONValue(v); }
JSONValue __judge_toJson(int[] v) {
    JSONValue[] __judge_arr;
    foreach (__judge_x; v) __judge_arr ~= __judge_toJson(__judge_x);
    return JSONValue(__judge_arr);
}
${signature.customSerializer || ''}
int __judge_extractInt(JSONValue v) { return cast(int) v.integer; }
bool __judge_extractBool(JSONValue v) { return v.boolean; }
string __judge_extractString(JSONValue v) { return v.str; }
int[] __judge_extractIntArray(JSONValue v) {
    int[] __judge_result;
    foreach (__judge_x; v.array) __judge_result ~= cast(int) __judge_x.integer;
    return __judge_result;
}

void main() {
    string __judge_input;
    foreach (__judge_line; stdin.byLineCopy) __judge_input ~= __judge_line ~ "\\n";
    JSONValue __judge_cases = parseJSON(__judge_input);
    JSONValue[] __judge_results;
    foreach (__judge_case; __judge_cases.array) {
        JSONValue __judge_args = __judge_case["args"];
        JSONValue __judge_entry;
        try {
            auto __judge_result = solution.${functionName}(${argExprs});
            __judge_entry = JSONValue(["actual": __judge_toJson(__judge_result)]);
        } catch (Throwable __judge_err) {
            __judge_entry = JSONValue(["error": __judge_toJson(__judge_withLine(__judge_err.msg, __judge_err))]);
        }
        __judge_results ~= __judge_entry;
    }
    write("\\n${RESULT_MARKER}\\n" ~ JSONValue(__judge_results).toString());
}
`;
}

// For a submission that fails before/without producing any usable output at
// all (compile error, timeout, no valid JSON produced): every test case
// fails identically, so only the first gets input/error attached — the
// client only displays that first entry and stops, rather than repeating
// the same error for every case. Error text isn't test-specific (it doesn't
// depend on which input was used), so it's attached even if the first case
// happens to be hidden; input itself still follows the usual hidden-case
// privacy rule.
/**
 * @param {TestCase[]} testCases - The cases being judged.
 * @param {string} errorText - What went wrong, for the first case.
 * @param {(tc: TestCase) => unknown} [getInput] - The input to show for the
 *   first case: its args by default; program judging passes its input.
 * @returns {TestResult[]} Every case failed, the first with the error.
 */
function buildFailureResults(testCases, errorText, getInput = (tc) => tc.args) {
  return testCases.map((tc, index) => {
    if (index !== 0) return { index, hidden: tc.hidden, passed: false };
    return tc.hidden
      ? { index, hidden: true, passed: false, error: errorText }
      : { index, hidden: false, passed: false, input: getInput(tc), error: errorText };
  });
}

/**
 * Whether two JSON values are equal: the same primitive, or arrays or
 * objects with equal members.
 *
 * @param {unknown} a - Any JSON value (an expected answer, say).
 * @param {unknown} b - Another (what the submission returned).
 * @returns {boolean} Whether they're equal.
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    // Both are objects here (checked just above), so they can be read by key.
    return aKeys.every((k) => deepEqual(/** @type {Record<string, unknown>} */ (a)[k], /** @type {Record<string, unknown>} */ (b)[k]));
  }
  return false;
}

// Each submission gets its own folder (fs.mkdtempSync, owner-only), with
// fixed file names inside. javac needs the public class's file to be named
// after it (Main.java); the rest just keep the same shape.
/** @type {Record<string, string>} */
const SOURCE_FILE_NAMES = { javascript: 'main.js', python: 'main.py', cpp: 'main.cpp', java: 'Main.java', d: 'main.d' };
// Function judging: the learner's code, in a file of its own next to the
// harness (see the build*Source functions). JavaScript has none: its
// harness follows the learner's code in main.js.
/** @type {Record<string, string>} */
const SOLUTION_FILE_NAMES = { python: 'solution.py', cpp: 'solution.cpp', java: 'Solution.java', d: 'solution.d' };
// What D's harness imports, and judge_prelude.d passes on to solution.d.
const D_STANDARD_IMPORTS = ['std.json', 'std.stdio', 'std.algorithm', 'std.array', 'std.container', 'std.conv', 'std.math', 'std.range', 'std.string', 'std.typecons'];
const D_PRELUDE_FILE_NAME = 'judge_prelude.d';

/**
 * The files function judging writes for the learner's code.
 *
 * @param {string} language - The language.
 * @param {string} code - The learner's code.
 * @returns {Record<string, string>} Each file's text, by name; none for
 *   JavaScript, whose harness and code share main.js.
 */
function solutionFiles(language, code) {
  if (language === 'd') {
    return {
      [SOLUTION_FILE_NAMES.d]: `import judge_prelude; ${code}`,
      [D_PRELUDE_FILE_NAME]: `module judge_prelude;\n${D_STANDARD_IMPORTS.map((m) => `public import ${m};`).join('\n')}\n`,
    };
  }
  return SOLUTION_FILE_NAMES[language] ? { [SOLUTION_FILE_NAMES[language]]: code } : {};
}
const BINARY_FILE_NAME = 'main';

/**
 * @returns {string} A new, empty work folder for one submission, usable by
 *   the sandbox's user.
 */
function makeWorkDir() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-'));
  prepareWorkDir(workDir);
  return workDir;
}

// Where the submission's folder and the judge's helpers appear to the
// compiler and the running submission: fixed paths inside the sandbox, or
// their real paths when judging without one (MAXRECALL_UNSANDBOXED=1).
// Inside, the helpers are read-only, and /work is writable only while
// compiling (sandboxedArgs).
const SANDBOX_PATHS = Object.freeze({
  work: '/work',
  javaHelpers: path.posix.join(HELPER_SANDBOX_PATH, 'java'),
  cppHelperObject: path.posix.join(HELPER_SANDBOX_PATH, 'cpp', 'judge_json.o'),
});
/**
 * Where things are, as the compiler and the submission see them.
 *
 * @typedef {{ work: string, javaHelpers: string, cppHelperObject: string }} JudgePaths
 */

/**
 * @param {string} workDir - The submission's work folder, on the host.
 * @returns {JudgePaths} The paths inside the sandbox, or the real ones
 *   when judging without it.
 */
function judgePaths(workDir) {
  return sandboxStatus.ok
    ? SANDBOX_PATHS
    : { work: workDir, javaHelpers: JAVA_DIR, cppHelperObject: CPP_JSON_OBJECT };
}

// Memory caps for compilers, which had none (a 257-byte C++ source of
// exponential templates took cc1plus to 2 GB in 20 s). g++ and the D compiler get an
// address-space cap (RLIMIT_AS), which their child processes (cc1plus, as,
// ld) inherit; the harness compiles fine under 512 MB (measured), so 1 GB
// leaves room. javac is a JVM, which reserves more address space than it
// uses, so like java at run time it gets a heap cap (-J passes -Xmx to the
// JVM running javac) instead.
const COMPILER_ADDRESS_SPACE_BYTES = 1024 * 1024 * 1024;
const JAVAC_HEAP_MB = 256;

// How to compile a submission: { argv, timeoutMs, addressSpaceBytes }, in
// the paths the compiler sees, or null for interpreted languages. Function
// judging also compiles the learner's own files (Java, D); program judging
// has just the one file.
/**
 * @typedef {{ argv: string[], timeoutMs: number, addressSpaceBytes?: number }} CompileCommand
 */

/**
 * @param {string} language - The language.
 * @param {JudgePaths} paths - From judgePaths().
 * @param {string} [judgeMode='function'] - "function" or "program".
 * @returns {CompileCommand | null} The compiler command line, its timeout
 *   and its memory cap, or null for interpreted languages.
 */
function compileCommand(language, paths, judgeMode = 'function') {
  const file = (/** @type {string} */ name) => path.posix.join(paths.work, name);
  const functionJudging = judgeMode === 'function';
  switch (language) {
    case 'cpp':
      // judge_json.o is the precompiled JSON helper (ensureCppJsonObjectBuilt).
      return {
        argv: ['g++', '-std=c++17', '-O2', '-o', file(BINARY_FILE_NAME), file(SOURCE_FILE_NAMES.cpp), paths.cppHelperObject],
        timeoutMs: CPP_COMPILE_TIMEOUT_MS,
        addressSpaceBytes: COMPILER_ADDRESS_SPACE_BYTES,
      };
    case 'java':
      // Writes Main.class, Solution.class and any other top-level classes
      // into the work folder; JudgeJson.class is found on the classpath.
      return {
        argv: ['javac', `-J-Xmx${JAVAC_HEAP_MB}m`, '-cp', paths.javaHelpers, '-d', paths.work, file(SOURCE_FILE_NAMES.java),
          ...(functionJudging ? [file(SOLUTION_FILE_NAMES.java)] : [])],
        timeoutMs: JAVA_COMPILE_TIMEOUT_MS,
      };
    case 'd':
      // -of names the binary; -od puts the object files the compiler leaves
      // behind in the work folder too; -g (function judging) adds the debug
      // info that lets stack traces name solution.d's lines, for the
      // harness's "(line N)". ldc2 and dmd take the same flags.
      return {
        argv: [D_COMPILER, `-of=${file(BINARY_FILE_NAME)}`, `-od=${paths.work}`, ...(functionJudging ? ['-g'] : []), file(SOURCE_FILE_NAMES.d),
          ...(functionJudging ? [file(SOLUTION_FILE_NAMES.d), file(D_PRELUDE_FILE_NAME)] : [])],
        timeoutMs: D_COMPILE_TIMEOUT_MS,
        addressSpaceBytes: COMPILER_ADDRESS_SPACE_BYTES,
      };
    default:
      return null;
  }
}

// What to spawn for a compiler or a submission: inside the sandbox when it
// works, with workDir at /work (writable only for compiling), the helpers
// read-only, and RUN_LIMITS; otherwise the command itself, started in
// workDir. Killing the result kills bwrap, and with it everything inside.
// With a submission cgroup (cg, judge/cgroups.js), the command starts inside
// it, so its limits cover everything the sandbox runs.
/**
 * What to start, and how.
 *
 * @typedef {object} ProcessSpec
 * @property {string} command
 * @property {string[]} args
 * @property {string} [cwd] - Without the sandbox: the work folder.
 * @property {boolean} sandboxed - Whether it's inside the sandbox.
 */

/**
 * @param {string[]} argv - The command line, as [command, ...args].
 * @param {string} workDir - The submission's work folder, on the host.
 * @param {{ writableWork?: boolean, addressSpaceBytes?: number, cg?: SubmissionCgroup | null }} [options] -
 *   writableWork: /work writable (compiling only; default false);
 *   addressSpaceBytes: an RLIMIT_AS cap; cg: the submission's cgroup.
 * @returns {ProcessSpec} What to pass to startProcess().
 */
function sandboxedArgs([command, ...args], workDir, { writableWork = false, addressSpaceBytes, cg = null } = {}) {
  if (!sandboxStatus.ok) return { command, args, cwd: workDir, sandboxed: false };
  const proc = sandboxedRun(command, args, {
    binds: [
      { hostPath: workDir, sandboxPath: SANDBOX_PATHS.work, writable: writableWork },
      { hostPath: HELPER_DIR, sandboxPath: HELPER_SANDBOX_PATH },
    ],
    cwd: SANDBOX_PATHS.work,
    addressSpaceBytes,
  });
  return { ...(cg ? cgroups.wrap(proc, cg, SUBMISSION_ENV) : proc), sandboxed: true };
}

// The command line ([command, ...args]) that runs a submission, in the
// paths it sees (judgePaths).
/**
 * @param {string} language - The language.
 * @param {string} judgeMode - "function" or "program".
 * @param {JudgePaths} paths - From judgePaths().
 * @returns {string[]} The command line.
 * @throws {Error} For an unknown language.
 */
function runCommand(language, judgeMode, paths) {
  const file = (/** @type {string} */ name) => path.posix.join(paths.work, name);
  switch (language) {
    case 'javascript':
      return ['node', `--max-old-space-size=${NODE_MEMORY_MB}`, file(SOURCE_FILE_NAMES.javascript)];
    case 'python':
      // Function judging's harness caps its own memory (resource.setrlimit,
      // in buildPythonSource). Program judging has no harness, so the cap is
      // applied the way the compiled languages' is: ulimit, then exec.
      return judgeMode === 'program'
        ? ['bash', '-c', `ulimit -v ${PYTHON_MEMORY_MB * 1024}; exec python3 "$0"`, file(SOURCE_FILE_NAMES.python)]
        : ['python3', file(SOURCE_FILE_NAMES.python)];
    case 'cpp':
    case 'd': {
      // Cap the compiled binary's address space (RLIMIT_AS, in KB) the same
      // way the Python harness caps its own interpreter via resource.setrlimit.
      const memoryMb = language === 'cpp' ? CPP_MEMORY_MB : D_MEMORY_MB;
      return ['bash', '-c', `ulimit -v ${memoryMb * 1024}; exec "$0"`, file(BINARY_FILE_NAME)];
    }
    case 'java':
      // Function judging's generated Main uses JudgeJson; program judging's
      // Main is the submission's own, so only its folder is on the classpath.
      return ['java', `-Xmx${JAVA_MEMORY_MB}m`, '-cp', judgeMode === 'program' ? paths.work : `${paths.work}${path.delimiter}${paths.javaHelpers}`, 'Main'];
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
}

// Starts what sandboxedArgs returned: through spawnSandboxed (which hands
// bwrap the seccomp filter) when it's sandboxed, else a plain spawn.
/**
 * @param {ProcessSpec} proc - From sandboxedArgs().
 * @param {import('child_process').SpawnOptions} options - As spawn() takes them.
 * @returns {import('child_process').ChildProcess} The running process, with
 *   its standard streams piped (the default).
 */
function startProcess(proc, options) {
  return proc.sandboxed
    ? spawnSandboxed(spawn, proc.command, proc.args, options)
    : spawn(proc.command, proc.args, options);
}

// Compiles the submission in workDir, for compiled languages, with its own
// timeout (compiling can legitimately take longer than running trivial test
// cases). Resolves to { success, stderr, timedOut }, or null for interpreted
// languages. Hitting the CPU-time limit counts as timing out. Since the
// compiler runs inside the sandbox, killing it on timeout kills all of it:
// g++'s child cc1plus used to survive and hold the judge's pipe open.
// memoryExceeded: the cgroup's OOM killer ended a process meanwhile.
/**
 * @typedef {object} CompileOutcome
 * @property {boolean} success - Compiled, in time, within its memory.
 * @property {string} stderr - The compiler's messages (or why it couldn't start).
 * @property {boolean} timedOut - Killed by its timeout or the CPU limit.
 * @property {boolean} memoryExceeded - The cgroup's OOM killer ended a process.
 * @property {boolean} memoryLimitHit - The cgroup's memory limit was reached.
 */

/**
 * @param {string} language - The language.
 * @param {string} workDir - The submission's work folder, with its sources.
 * @param {SubmissionCgroup | null} [cg=null] - The submission's cgroup, if any.
 * @param {string} [judgeMode='function'] - "function" or "program".
 * @returns {Promise<CompileOutcome | null>} How compiling went, or null for
 *   interpreted languages. Never rejects.
 */
function compileSubmission(language, workDir, cg = null, judgeMode = 'function') {
  const compile = compileCommand(language, judgePaths(workDir), judgeMode);
  if (!compile) return Promise.resolve(null);
  const proc = sandboxedArgs(compile.argv, workDir, { writableWork: true, addressSpaceBytes: compile.addressSpaceBytes, cg });
  const before = cg ? cg.memory() : null;
  return new Promise((resolve) => {
    const child = startProcess(proc, {
      env: SUBMISSION_ENV,
      cwd: proc.cwd,
      timeout: compile.timeoutMs,
      killSignal: 'SIGKILL',
    });

    let stderr = '';
    let timedOut = false;

    // The streams are pipes (startProcess's default), so they exist.
    /** @type {import('stream').Readable} */ (child.stderr).on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURED_OUTPUT) stderr += chunk;
    });
    child.on('error', (err) => {
      resolve({ success: false, stderr: String(err.message || err), timedOut, memoryExceeded: false, memoryLimitHit: false });
    });
    child.on('close', (code, signal) => {
      const after = cg ? cg.memory() : null;
      // With a cgroup (the Boolean(cg) first), before and after were both read.
      const memoryExceeded = Boolean(cg) && /** @type {MemoryCounters} */ (after).oomKills > /** @type {MemoryCounters} */ (before).oomKills;
      const memoryLimitHit = Boolean(cg) && /** @type {MemoryCounters} */ (after).limitHits > /** @type {MemoryCounters} */ (before).limitHits;
      if (!memoryExceeded && (signal === 'SIGKILL' || signal === 'SIGTERM' || code === CPU_LIMIT_EXIT_CODE)) timedOut = true;
      resolve({ success: code === 0 && !timedOut && !memoryExceeded, stderr, timedOut, memoryExceeded, memoryLimitHit });
    });
  });
}

// Runs one submission process: inside the sandbox when it works, with its
// folder read-only at /work (sandboxedArgs), and inside the submission's
// cgroup when there is one. memoryExceeded: its OOM killer ended a process.
/** @typedef {ReturnType<SubmissionCgroup['memory']>} MemoryCounters */

/**
 * @typedef {object} RunOutcome
 * @property {string} stdout - Up to MAX_CAPTURED_OUTPUT characters.
 * @property {string} stderr - Likewise (or why it couldn't start).
 * @property {boolean} timedOut - Killed by its timeout.
 * @property {number | null} exitCode - null if killed by a signal or not started.
 * @property {boolean} memoryExceeded - The cgroup's OOM killer ended a process.
 * @property {boolean} memoryLimitHit - The cgroup's memory limit was reached.
 */

/**
 * @param {string[]} argv - The command line, from runCommand().
 * @param {string} stdinPayload - Written to its standard input, which is then closed.
 * @param {string} workDir - The submission's work folder, on the host.
 * @param {number} [timeoutMs=TIMEOUT_MS] - Its wall-clock limit.
 * @param {SubmissionCgroup | null} [cg=null] - The submission's cgroup, if any.
 * @returns {Promise<RunOutcome>} How it ended, and its output. Never rejects.
 */
function spawnJudged(argv, stdinPayload, workDir, timeoutMs = TIMEOUT_MS, cg = null) {
  const proc = sandboxedArgs(argv, workDir, { cg });
  const before = cg ? cg.memory() : null;
  return new Promise((resolve) => {
    const child = startProcess(proc, {
      env: SUBMISSION_ENV,
      cwd: proc.cwd,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // The streams are pipes (startProcess's default), so they exist.
    /** @type {import('stream').Readable} */ (child.stdout).on('data', (chunk) => {
      if (stdout.length < MAX_CAPTURED_OUTPUT) stdout += chunk;
    });
    /** @type {import('stream').Readable} */ (child.stderr).on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURED_OUTPUT) stderr += chunk;
    });

    child.on('error', (err) => {
      resolve({ stdout, stderr: String(err.message || err), timedOut, exitCode: null, memoryExceeded: false, memoryLimitHit: false });
    });

    child.on('close', (code, signal) => {
      const after = cg ? cg.memory() : null;
      // With a cgroup (the Boolean(cg) first), before and after were both read.
      const memoryExceeded = Boolean(cg) && /** @type {MemoryCounters} */ (after).oomKills > /** @type {MemoryCounters} */ (before).oomKills;
      const memoryLimitHit = Boolean(cg) && /** @type {MemoryCounters} */ (after).limitHits > /** @type {MemoryCounters} */ (before).limitHits;
      if (!memoryExceeded && (signal === 'SIGKILL' || signal === 'SIGTERM')) timedOut = true;
      resolve({ stdout, stderr, timedOut, exitCode: code, memoryExceeded, memoryLimitHit });
    });

    /** @type {import('stream').Writable} */ (child.stdin).write(stdinPayload);
    /** @type {import('stream').Writable} */ (child.stdin).end();
  });
}

// Runs `code` (in `language`) against `testCases` for `functionName`, under
// "function" judging: the submission defines just the one function, which
// the harness wraps with boilerplate that calls it once per test case
// inside a single process. Comparison against `expected` happens here,
// outside the sandboxed process. `signature` is only used by
// compiled/statically-typed languages (cpp, java, d) that need to know
// argument/return types to generate a harness that compiles.
/**
 * @param {Submission} submission - What to judge (judgeMode "function").
 * @returns {Promise<JudgeResult>} The verdict.
 * @throws {Error} For an unknown language (rejects the promise).
 */
async function runFunctionSubmission({ language, code, functionName, testCases, signature }) {
  const started = Date.now();

  // Function judging always has a functionName (server.js takes it from the
  // question file), hence the casts.
  /** @type {Record<string, () => string>} */
  const SOURCE_BUILDERS = {
    javascript: () => buildJavascriptSource(code, /** @type {string} */ (functionName)),
    python: () => buildPythonSource(/** @type {string} */ (functionName)),
    cpp: () => buildCppSource(/** @type {string} */ (functionName), signature || {}),
    java: () => buildJavaSource(/** @type {string} */ (functionName), signature || {}),
    d: () => buildDSource(/** @type {string} */ (functionName), signature || {}),
  };
  if (!SOURCE_BUILDERS[language]) throw new Error(`Unsupported language: ${language}`);
  const source = SOURCE_BUILDERS[language]();

  const workDir = makeWorkDir();
  fs.writeFileSync(path.join(workDir, SOURCE_FILE_NAMES[language]), source);
  for (const [name, text] of Object.entries(solutionFiles(language, code))) fs.writeFileSync(path.join(workDir, name), text);
  // One cgroup for the compile and every run (null without cgroup limits).
  const cg = cgroups.forSubmission();

  try {
    const compileResult = await compileSubmission(language, workDir, cg);
    if (compileResult) {
      if (!compileResult.success) {
        const errorText = (compileResult.memoryExceeded ? cgroups.MEMORY_LIMIT_MESSAGE : compileResult.timedOut
          ? (compileResult.memoryLimitHit ? `Compilation timed out. ${cgroups.MEMORY_LIMIT_SLOWED_MESSAGE}` : 'Compilation timed out.')
          : compileResult.stderr || 'Compilation failed.'
        ).slice(0, 2000);
        return {
          status: 'Compile Error',
          passed: 0,
          total: testCases.length,
          runtimeMs: Date.now() - started,
          error: errorText,
          stdout: '',
          stderr: compileResult.stderr,
          results: buildFailureResults(testCases, errorText),
        };
      }
    }

    const stdinPayload = JSON.stringify(testCases.map((tc) => ({ args: tc.args })));
    const outcome = await spawnJudged(runCommand(language, 'function', judgePaths(workDir)), stdinPayload, workDir, TIMEOUT_MS, cg);
    const runtimeMs = Date.now() - started;

    if (outcome.memoryExceeded) {
      return {
        status: 'Runtime Error',
        passed: 0,
        total: testCases.length,
        runtimeMs,
        error: cgroups.MEMORY_LIMIT_MESSAGE,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        results: buildFailureResults(testCases, cgroups.MEMORY_LIMIT_MESSAGE),
      };
    }

    if (outcome.timedOut || outcome.exitCode === CPU_LIMIT_EXIT_CODE) {
      let errorText = outcome.timedOut ? 'Time limit exceeded.' : CPU_LIMIT_MESSAGE;
      if (outcome.timedOut && outcome.memoryLimitHit) errorText = `Time limit exceeded. ${cgroups.MEMORY_LIMIT_SLOWED_MESSAGE}`;
      return {
        status: 'Time Limit Exceeded',
        passed: 0,
        total: testCases.length,
        runtimeMs,
        error: errorText,
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        results: buildFailureResults(testCases, errorText),
      };
    }

    // Everything before the marker is the submission's own stdout (e.g.
    // console.log/print/cout debugging); everything after is the harness's
    // own JSON result, which the submission's output can't corrupt even if
    // it prints something that happens to look like JSON itself.
    const markerLine = `\n${RESULT_MARKER}\n`;
    const markerIndex = outcome.stdout.lastIndexOf(markerLine);
    const userStdout = markerIndex === -1 ? outcome.stdout : outcome.stdout.slice(0, markerIndex);
    const resultText = markerIndex === -1 ? '' : outcome.stdout.slice(markerIndex + markerLine.length);

    let parsed;
    try {
      parsed = JSON.parse(resultText);
    } catch {
      const errorText = (outcome.stderr || 'The submission did not produce valid output.').slice(0, 2000);
      return {
        status: 'Runtime Error',
        passed: 0,
        total: testCases.length,
        runtimeMs,
        error: errorText,
        stdout: userStdout,
        stderr: outcome.stderr,
        results: buildFailureResults(testCases, errorText),
      };
    }

    let passedCount = 0;
    let hadError = false;
    const results = testCases.map((tc, index) => {
      const entry = parsed[index] || { error: 'No result produced for this test case.' };
      if (entry.error) {
        hadError = true;
        return tc.hidden
          ? { index, hidden: true, passed: false }
          : { index, hidden: false, passed: false, input: tc.args, expected: tc.expected, error: entry.error };
      }
      const passed = deepEqual(entry.actual, tc.expected);
      if (passed) passedCount += 1;
      return tc.hidden
        ? { index, hidden: true, passed }
        : { index, hidden: false, passed, input: tc.args, expected: tc.expected, actual: entry.actual };
    });

    let status;
    if (passedCount === testCases.length) status = 'Accepted';
    else if (hadError) status = 'Runtime Error';
    else status = 'Wrong Answer';

    return {
      status,
      passed: passedCount,
      total: testCases.length,
      runtimeMs,
      stdout: userStdout,
      stderr: outcome.stderr,
      results,
    };
  } finally {
    if (cg) cg.destroy();
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}

// Runs `code` as a complete, self-contained program ("program" judging):
// no boilerplate is injected, so the submission is itself the whole source
// file, responsible for reading any input it needs from stdin and writing
// its answer to stdout. Each test case is its own process invocation —
// unlike function judging's single run covering every case — since a
// program's own entry point only runs through once per invocation. Output
// is compared to `expected` after trimming leading/trailing whitespace,
// the same tolerance most line-based full-program judges use, so a
// trailing newline from println/cout/writeln doesn't cause a false Wrong
// Answer.
/**
 * @param {Submission} submission - What to judge (judgeMode "program"):
 *   language, code and testCases.
 * @returns {Promise<JudgeResult>} The verdict.
 * @throws {Error} For an unknown language (rejects the promise).
 */
async function runProgramSubmission({ language, code, testCases }) {
  const started = Date.now();
  if (!SOURCE_FILE_NAMES[language]) throw new Error(`Unsupported language: ${language}`);

  // Program judging gives the submission full control of its own source
  // file, so for Java (unlike function judging's generated Main) the
  // submission must define `public class Main` itself.
  const workDir = makeWorkDir();
  fs.writeFileSync(path.join(workDir, SOURCE_FILE_NAMES[language]), code);
  // One cgroup for the compile and every test case's run.
  const cg = cgroups.forSubmission();

  try {
    const compileResult = await compileSubmission(language, workDir, cg, 'program');
    if (compileResult) {
      if (!compileResult.success) {
        const errorText = (compileResult.memoryExceeded ? cgroups.MEMORY_LIMIT_MESSAGE : compileResult.timedOut
          ? (compileResult.memoryLimitHit ? `Compilation timed out. ${cgroups.MEMORY_LIMIT_SLOWED_MESSAGE}` : 'Compilation timed out.')
          : compileResult.stderr || 'Compilation failed.'
        ).slice(0, 2000);
        return {
          status: 'Compile Error',
          passed: 0,
          total: testCases.length,
          runtimeMs: Date.now() - started,
          error: errorText,
          stdout: '',
          stderr: compileResult.stderr,
          results: buildFailureResults(testCases, errorText, (tc) => tc.input),
        };
      }
    }
    const command = runCommand(language, 'program', judgePaths(workDir));

    let passedCount = 0;
    let anyTimedOut = false;
    let anyCrashed = false;
    /** @type {TestResult[]} */
    const results = [];

    const runsStarted = Date.now();
    for (let index = 0; index < testCases.length; index++) {
      const tc = testCases[index];
      // Each case gets TIMEOUT_MS, or what's left of the total if less.
      // Cases still waiting when the total is used up aren't run.
      const remainingMs = PROGRAM_TOTAL_RUN_MS - (Date.now() - runsStarted);
      if (remainingMs <= 0) {
        anyTimedOut = true;
        results.push(tc.hidden
          ? { index, hidden: true, passed: false }
          : { index, hidden: false, passed: false, input: tc.input, error: `Not run: all test cases together may take at most ${PROGRAM_TOTAL_RUN_MS / 1000} s, and that time was used up.` });
        continue;
      }
      const timeoutMs = Math.min(TIMEOUT_MS, remainingMs);
      const outcome = await spawnJudged(command, tc.input || '', workDir, timeoutMs, cg);

      if (outcome.memoryExceeded) {
        anyCrashed = true;
        results.push(tc.hidden
          ? { index, hidden: true, passed: false }
          : { index, hidden: false, passed: false, input: tc.input, expected: tc.expected, error: cgroups.MEMORY_LIMIT_MESSAGE });
        continue;
      }

      if (outcome.timedOut || outcome.exitCode === CPU_LIMIT_EXIT_CODE) {
        anyTimedOut = true;
        let errorText = outcome.timedOut ? 'Time limit exceeded.' : CPU_LIMIT_MESSAGE;
        if (outcome.timedOut && timeoutMs < TIMEOUT_MS) {
          errorText = `Time limit exceeded: all test cases together may take at most ${PROGRAM_TOTAL_RUN_MS / 1000} s.`;
        }
        if (outcome.timedOut && outcome.memoryLimitHit) errorText = `${errorText} ${cgroups.MEMORY_LIMIT_SLOWED_MESSAGE}`;
        results.push(tc.hidden
          ? { index, hidden: true, passed: false }
          : { index, hidden: false, passed: false, input: tc.input, error: errorText });
        continue;
      }
      if (outcome.exitCode !== 0) {
        anyCrashed = true;
        const errorText = (outcome.stderr || 'The program exited with an error.').slice(0, 2000);
        results.push(tc.hidden
          ? { index, hidden: true, passed: false }
          : { index, hidden: false, passed: false, input: tc.input, expected: tc.expected, error: errorText });
        continue;
      }

      const actual = outcome.stdout.trim();
      const expected = String(tc.expected).trim();
      const passed = actual === expected;
      if (passed) passedCount += 1;
      results.push(tc.hidden
        ? { index, hidden: true, passed }
        : { index, hidden: false, passed, input: tc.input, expected: tc.expected, actual });
    }

    let status;
    if (passedCount === testCases.length) status = 'Accepted';
    else if (anyTimedOut) status = 'Time Limit Exceeded';
    else if (anyCrashed) status = 'Runtime Error';
    else status = 'Wrong Answer';

    return {
      status,
      passed: passedCount,
      total: testCases.length,
      runtimeMs: Date.now() - started,
      stdout: '',
      stderr: '',
      results,
    };
  } finally {
    if (cg) cg.destroy();
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}

// Dispatches to function or program judging. judgeMode defaults to
// 'function' so existing problems (which predate this option, and so have
// no judgeMode field at all) keep behaving exactly as before.
// Throws SandboxUnavailableError (err.code 'SANDBOX_UNAVAILABLE') first if
// the sandbox isn't working and MAXRECALL_UNSANDBOXED=1 isn't set.
// Then it waits for a slot in the judge's queue (judge/queue.js), and
// rejects with JudgeBusyError (err.code 'JUDGE_BUSY') if the queue is full.
// The judging's own clock starts once it has a slot.
/**
 * @param {Submission} submission - What to judge.
 * @returns {Promise<JudgeResult>} The verdict.
 * @throws {Error} SandboxUnavailableError, straight away; and, by rejecting
 *   the promise, JudgeBusyError when the queue is full, or an Error for an
 *   unknown language.
 */
function runSubmission({ language, code, functionName, testCases, signature, judgeMode }) {
  assertJudgingAllowed();
  return withJudgeSlot(() => (judgeMode === 'program'
    ? runProgramSubmission({ language, code, testCases })
    : runFunctionSubmission({ language, code, functionName, testCases, signature })));
}

module.exports = { runSubmission, TIMEOUT_MS, CPP_COMPILE_TIMEOUT_MS, D_COMPILER };

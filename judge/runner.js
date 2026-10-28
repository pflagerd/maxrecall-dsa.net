const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TIMEOUT_MS = 5000;
const NODE_MEMORY_MB = 128;
const PYTHON_MEMORY_MB = 256;
const CPP_MEMORY_MB = 128;
const CPP_COMPILE_TIMEOUT_MS = 10000;
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
function ensureCppJsonObjectBuilt() {
  const sourceFile = path.join(CPP_DIR, 'judge_json.cpp');
  const sourceMtime = fs.statSync(sourceFile).mtimeMs;
  const objectMtime = fs.existsSync(CPP_JSON_OBJECT) ? fs.statSync(CPP_JSON_OBJECT).mtimeMs : 0;
  if (objectMtime > sourceMtime) return;
  execFileSync('g++', ['-std=c++17', '-O2', '-c', sourceFile, '-o', CPP_JSON_OBJECT]);
}
ensureCppJsonObjectBuilt();

// Maps a C++ parameter type (as written in a problem's signature.cpp.params)
// to the judge_json.hpp helper that extracts it from a JsonValue.
const CPP_PARAM_EXTRACTORS = {
  int: 'extractInt',
  bool: 'extractBool',
  string: 'extractString',
  'vector<int>': 'extractIntVector',
};

// Harness code appended after the user's submitted function definition.
// Test case args (never the expected answers) are piped in over stdin,
// so the sandboxed process never sees expected outputs.
function buildJavascriptSource(userCode, functionName) {
  return `${userCode}
process.on('unhandledRejection', (__judge_err) => { console.error(__judge_err); process.exit(1); });
let __judge_input = '';
process.stdin.on('data', (chunk) => { __judge_input += chunk; });
process.stdin.on('end', () => {
  const __judge_cases = JSON.parse(__judge_input);
  const __judge_results = __judge_cases.map((tc) => {
    try {
      return { actual: ${functionName}(...tc.args) };
    } catch (err) {
      return { error: (err && err.message) || String(err) };
    }
  });
  process.stdout.write('\\n${RESULT_MARKER}\\n' + JSON.stringify(__judge_results));
});
`;
}

function buildPythonSource(userCode, functionName) {
  return `import sys, json
try:
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (${PYTHON_MEMORY_MB} * 1024 * 1024, ${PYTHON_MEMORY_MB} * 1024 * 1024))
except Exception:
    pass

${userCode}

__judge_cases = json.loads(sys.stdin.read())
__judge_results = []
for __judge_tc in __judge_cases:
    try:
        __judge_results.append({'actual': ${functionName}(*__judge_tc['args'])})
    except Exception as __judge_err:
        __judge_results.append({'error': str(__judge_err)})
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
function buildCppSource(userCode, functionName, signature) {
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

${userCode}

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

// Compiles a .cpp file to a binary with its own timeout, separate from the
// run timeout below (compilation can legitimately take longer than running
// trivial test cases, especially for templates).
function compileCpp(sourceFile, binaryFile) {
  return new Promise((resolve) => {
    const child = spawn('g++', ['-std=c++17', '-O2', '-o', binaryFile, sourceFile, CPP_JSON_OBJECT], {
      timeout: CPP_COMPILE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    let stderr = '';
    let timedOut = false;

    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURED_OUTPUT) stderr += chunk;
    });
    child.on('error', (err) => {
      resolve({ success: false, stderr: String(err.message || err), timedOut });
    });
    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL' || signal === 'SIGTERM') timedOut = true;
      resolve({ success: code === 0 && !timedOut, stderr, timedOut });
    });
  });
}

// For a submission that fails before/without producing any usable output at
// all (compile error, timeout, no valid JSON produced): every test case
// fails identically, so only the first gets input/error attached — the
// client only displays that first entry and stops, rather than repeating
// the same error for every case. Error text isn't test-specific (it doesn't
// depend on which input was used), so it's attached even if the first case
// happens to be hidden; input itself still follows the usual hidden-case
// privacy rule.
function buildFailureResults(testCases, errorText) {
  return testCases.map((tc, index) => {
    if (index !== 0) return { index, hidden: tc.hidden, passed: false };
    return tc.hidden
      ? { index, hidden: true, passed: false, error: errorText }
      : { index, hidden: false, passed: false, input: tc.args, error: errorText };
  });
}

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
    return aKeys.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function spawnJudged(command, args, stdinPayload) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_CAPTURED_OUTPUT) stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURED_OUTPUT) stderr += chunk;
    });

    child.on('error', (err) => {
      resolve({ stdout, stderr: String(err.message || err), timedOut, exitCode: null });
    });

    child.on('close', (code, signal) => {
      if (signal === 'SIGKILL' || signal === 'SIGTERM') timedOut = true;
      resolve({ stdout, stderr, timedOut, exitCode: code });
    });

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}

// Runs `code` (in `language`) against `testCases` for `functionName`.
// Comparison against `expected` happens here, outside the sandboxed process.
// `signature` is only used by compiled/statically-typed languages (cpp) that
// need to know argument/return types to generate a harness that compiles.
async function runSubmission({ language, code, functionName, testCases, signature }) {
  const id = crypto.randomUUID();
  const started = Date.now();

  let source;
  let command;
  let args;
  let tmpFile;
  let tmpBinary;

  if (language === 'javascript') {
    source = buildJavascriptSource(code, functionName);
    tmpFile = path.join(os.tmpdir(), `judge-${id}.js`);
    command = 'node';
    args = [`--max-old-space-size=${NODE_MEMORY_MB}`, tmpFile];
  } else if (language === 'python') {
    source = buildPythonSource(code, functionName);
    tmpFile = path.join(os.tmpdir(), `judge-${id}.py`);
    command = 'python3';
    args = [tmpFile];
  } else if (language === 'cpp') {
    source = buildCppSource(code, functionName, signature || {});
    tmpFile = path.join(os.tmpdir(), `judge-${id}.cpp`);
    tmpBinary = path.join(os.tmpdir(), `judge-${id}`);
  } else {
    throw new Error(`Unsupported language: ${language}`);
  }

  fs.writeFileSync(tmpFile, source);

  try {
    if (language === 'cpp') {
      const compileResult = await compileCpp(tmpFile, tmpBinary);
      if (!compileResult.success) {
        const errorText = (compileResult.timedOut
          ? 'Compilation timed out.'
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
      // Cap the compiled binary's address space (RLIMIT_AS, in KB) the same
      // way the Python harness caps its own interpreter via resource.setrlimit.
      command = 'bash';
      args = ['-c', `ulimit -v ${CPP_MEMORY_MB * 1024}; exec "$0"`, tmpBinary];
    }

    const stdinPayload = JSON.stringify(testCases.map((tc) => ({ args: tc.args })));
    const outcome = await spawnJudged(command, args, stdinPayload);
    const runtimeMs = Date.now() - started;

    if (outcome.timedOut) {
      const errorText = 'Time limit exceeded.';
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
    fs.unlink(tmpFile, () => {});
    if (tmpBinary) fs.unlink(tmpBinary, () => {});
  }
}

module.exports = { runSubmission };

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
// Higher than the other languages' caps to absorb the JVM's own baseline
// overhead (class loading, JIT, etc.), which eats into -Xmx the same way
// the Python interpreter's own footprint eats into RLIMIT_AS.
const JAVA_MEMORY_MB = 256;
const JAVA_COMPILE_TIMEOUT_MS = 10000;
// D compiles to a native binary like C++, with no JVM-style baseline
// overhead, so it gets the same cap as C++.
const D_MEMORY_MB = 128;
const D_COMPILE_TIMEOUT_MS = 10000;
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

const JAVA_DIR = path.join(__dirname, 'java');

// JudgeJson.java rarely changes, so it's compiled once (here, at module
// load) into JudgeJson.class and put on both javac's and java's classpath
// for every submission, rather than recompiled from source on every single
// Run/Submit — the same role ensureCppJsonObjectBuilt() plays for C++.
function ensureJudgeJsonClassBuilt() {
  const sourceFile = path.join(JAVA_DIR, 'JudgeJson.java');
  const classFile = path.join(JAVA_DIR, 'JudgeJson.class');
  const sourceMtime = fs.statSync(sourceFile).mtimeMs;
  const classMtime = fs.existsSync(classFile) ? fs.statSync(classFile).mtimeMs : 0;
  if (classMtime > sourceMtime) return;
  execFileSync('javac', ['-d', JAVA_DIR, sourceFile]);
}
ensureJudgeJsonClassBuilt();

// Maps a C++ parameter type (as written in a problem's signature.cpp.params)
// to the judge_json.hpp helper that extracts it from a JsonValue.
const CPP_PARAM_EXTRACTORS = {
  int: 'extractInt',
  bool: 'extractBool',
  string: 'extractString',
  'vector<int>': 'extractIntVector',
};

// Maps a Java parameter type (as written in a problem's signature.java.params)
// to the JudgeJson.Value instance method that extracts it.
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
const D_PARAM_EXTRACTORS = {
  int: '__judge_extractInt',
  bool: '__judge_extractBool',
  string: '__judge_extractString',
  'int[]': '__judge_extractIntArray',
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

// Java is statically typed like C++, so the same param-type-lookup approach
// applies, but the user's code is a method on a class (not a bare function),
// so the harness instantiates a Solution and calls the method on it. Return
// serialization also can't rely on overload resolution picking the right
// buildJson the way C++ does transparently — Java resolves overloads on the
// variable's *declared* type, so __judge_result is declared with exactly
// signature.returns, same as the C++ harness's `auto` relies on the actual
// return type.
function buildJavaSource(userCode, functionName, signature) {
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

${userCode}

public class Main {
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
                __judge_entry.set("error", JudgeJson.Value.of(__judge_msg == null ? __judge_err.toString() : __judge_msg));
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
function buildDSource(userCode, functionName, signature) {
  const params = signature.params || [];
  const argExprs = params
    .map((type, i) => {
      const extractor = D_PARAM_EXTRACTORS[type];
      if (!extractor) throw new Error(`Unsupported D param type: ${type}`);
      return `${extractor}(__judge_args[${i}])`;
    })
    .join(', ');

  return `import std.json;
import std.stdio;
import std.algorithm;
import std.array;
import std.container;
import std.conv;
import std.math;
import std.range;
import std.string;
import std.typecons;

${userCode}

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
            auto __judge_result = ${functionName}(${argExprs});
            __judge_entry = JSONValue(["actual": __judge_toJson(__judge_result)]);
        } catch (Throwable __judge_err) {
            __judge_entry = JSONValue(["error": __judge_toJson(__judge_err.msg)]);
        }
        __judge_results ~= __judge_entry;
    }
    write("\\n${RESULT_MARKER}\\n" ~ JSONValue(__judge_results).toString());
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

// Compiles Main.java to outDir/Main.class (plus Solution.class and any other
// top-level classes spliced into the same file), with JudgeJson.class found
// on the classpath rather than recompiled alongside it.
function compileJava(sourceFile, outDir) {
  return new Promise((resolve) => {
    const child = spawn('javac', ['-cp', JAVA_DIR, '-d', outDir, sourceFile], {
      timeout: JAVA_COMPILE_TIMEOUT_MS,
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

// Compiles main.d to a binary in its own tmpDir (given its own directory,
// like Java, so the stray .o object file dmd leaves alongside -of lands
// somewhere that gets cleaned up automatically rather than littering the
// system tmp dir).
function compileD(sourceFile, binaryFile, outDir) {
  return new Promise((resolve) => {
    const child = spawn('dmd', [`-of=${binaryFile}`, `-od=${outDir}`, sourceFile], {
      timeout: D_COMPILE_TIMEOUT_MS,
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
// `signature` is only used by compiled/statically-typed languages (cpp,
// java, d) that need to know argument/return types to generate a harness
// that compiles.
async function runSubmission({ language, code, functionName, testCases, signature }) {
  const id = crypto.randomUUID();
  const started = Date.now();

  let source;
  let command;
  let args;
  let tmpFile;
  let tmpBinary;
  let tmpDir;

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
  } else if (language === 'java') {
    source = buildJavaSource(code, functionName, signature || {});
    // Unlike the other languages, javac requires the file holding a public
    // class to be named exactly after that class (Main.java), so this needs
    // its own per-submission directory rather than a uniquely-named temp file.
    tmpDir = path.join(os.tmpdir(), `judge-${id}`);
    fs.mkdirSync(tmpDir);
    tmpFile = path.join(tmpDir, 'Main.java');
  } else if (language === 'd') {
    source = buildDSource(code, functionName, signature || {});
    tmpDir = path.join(os.tmpdir(), `judge-${id}`);
    fs.mkdirSync(tmpDir);
    tmpFile = path.join(tmpDir, 'main.d');
    tmpBinary = path.join(tmpDir, 'main');
  } else {
    throw new Error(`Unsupported language: ${language}`);
  }

  fs.writeFileSync(tmpFile, source);

  try {
    if (language === 'cpp' || language === 'java' || language === 'd') {
      const compileResult = language === 'cpp'
        ? await compileCpp(tmpFile, tmpBinary)
        : language === 'java'
          ? await compileJava(tmpFile, tmpDir)
          : await compileD(tmpFile, tmpBinary, tmpDir);
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
      if (language === 'cpp' || language === 'd') {
        // Cap the compiled binary's address space (RLIMIT_AS, in KB) the same
        // way the Python harness caps its own interpreter via resource.setrlimit.
        const memoryMb = language === 'cpp' ? CPP_MEMORY_MB : D_MEMORY_MB;
        command = 'bash';
        args = ['-c', `ulimit -v ${memoryMb * 1024}; exec "$0"`, tmpBinary];
      } else {
        command = 'java';
        args = [`-Xmx${JAVA_MEMORY_MB}m`, '-cp', `${tmpDir}${path.delimiter}${JAVA_DIR}`, 'Main'];
      }
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
    if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }, () => {});
    else fs.unlink(tmpFile, () => {});
    if (tmpBinary) fs.unlink(tmpBinary, () => {});
  }
}

module.exports = { runSubmission };

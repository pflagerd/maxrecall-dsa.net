const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TIMEOUT_MS = 5000;
const NODE_MEMORY_MB = 128;
const PYTHON_MEMORY_MB = 256;

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
  process.stdout.write(JSON.stringify(__judge_results));
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

sys.stdout.write(json.dumps(__judge_results, default=__judge_default))
`;
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

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

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
async function runSubmission({ language, code, functionName, testCases }) {
  const id = crypto.randomUUID();
  const started = Date.now();

  let source;
  let command;
  let args;
  let tmpFile;

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
  } else {
    throw new Error(`Unsupported language: ${language}`);
  }

  fs.writeFileSync(tmpFile, source);

  let outcome;
  try {
    const stdinPayload = JSON.stringify(testCases.map((tc) => ({ args: tc.args })));
    outcome = await spawnJudged(command, args, stdinPayload);
  } finally {
    fs.unlink(tmpFile, () => {});
  }

  const runtimeMs = Date.now() - started;

  if (outcome.timedOut) {
    return {
      status: 'Time Limit Exceeded',
      passed: 0,
      total: testCases.length,
      runtimeMs,
      results: testCases.map((tc, index) => ({ index, hidden: tc.hidden, passed: false })),
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(outcome.stdout);
  } catch {
    return {
      status: 'Runtime Error',
      passed: 0,
      total: testCases.length,
      runtimeMs,
      error: (outcome.stderr || 'The submission did not produce valid output.').slice(0, 2000),
      results: testCases.map((tc, index) => ({ index, hidden: tc.hidden, passed: false })),
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

  return { status, passed: passedCount, total: testCases.length, runtimeMs, results };
}

module.exports = { runSubmission };

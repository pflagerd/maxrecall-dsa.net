'use strict';

// A prototype, not part of the app (#174, Kind A; docs/plans/
// unit-test-questions.md): judges a Python submission against unit tests
// written with unittest, inside the real sandbox, and prints what a learner
// would be shown and what the judge keeps back. Its findings are in this
// folder's README.md.
//
// Usage: node docs/plans/prototypes/unit-test-questions-python/run.js
//          [--per-test] [probe.py ...]
//   --per-test: one sandboxed process per test, instead of one for all.
//   probe.py:   probes/ files to judge; all of them if none is named.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { SUBMISSION_ENV, sandboxedRun, spawnSandboxed, prepareWorkDir, sandboxStatus } = require('../../../../judge/sandbox');
const { TIMEOUT_MS } = require('../../../../judge/runner');

const HERE = __dirname;
const MARKER = '###UNIT_TEST_REPORT###';
// What judge/runner.js keeps of a run's output (MAX_CAPTURED_OUTPUT).
const MAX_CAPTURED_OUTPUT = 200000;
const QUESTION_FILES = ['visible_tests.py', 'hidden_tests.py'];

/**
 * Which one test a run is to run.
 *
 * @typedef {{ visibility: 'visible' | 'hidden', index: number }} Selection
 */

/**
 * One line of the harness's report (harness.py says which events there are).
 *
 * @typedef {object} ReportRecord
 * @property {string} event - "solution-loaded", "solution-failed",
 *   "tests-failed", "list", "test" or "done".
 * @property {string} [visibility] - "visible" or "hidden".
 * @property {number} [index] - A test's place in its file, from 0.
 * @property {string} [name] - A visible test's method name.
 * @property {string} [outcome] - "pass", "fail" or (visible only) "error".
 * @property {string} [message] - A visible test's failure, or why the
 *   solution or the tests couldn't load.
 * @property {string} [output] - What the learner's code printed.
 * @property {string[]} [visible] - "list": the visible tests' names.
 * @property {number} [hidden] - "list": how many hidden tests there are.
 * @property {number} [ms] - How long the test took, inside the harness.
 */

/**
 * How one sandboxed run went.
 *
 * @typedef {object} RunResult
 * @property {ReportRecord[]} records - The report lines that carried this
 *   run's nonce, in order.
 * @property {string} unreported - The rest of standard output: never shown.
 * @property {string} stderr - Standard error: never shown.
 * @property {boolean} timedOut - Killed at TIMEOUT_MS.
 * @property {number | null} exitCode - null if killed by a signal.
 * @property {number} ms - Wall-clock time, sandbox start-up included.
 */

/**
 * What the judge makes of a submission.
 *
 * @typedef {object} Verdict
 * @property {string} status - "Accepted", "Wrong Answer", "Error",
 *   "Time Limit Exceeded" or "Couldn't judge".
 * @property {string[]} shown - The lines a learner would be shown.
 * @property {string[]} withheld - What the judge saw and keeps back.
 * @property {number} runs - How many sandboxed processes it took.
 * @property {number} ms - Their wall-clock time, added up.
 */

/**
 * Runs harness.py once, in the sandbox, against a submission.
 *
 * @param {string} solutionSource - The submitted solution.py.
 * @param {Selection | null} select - The one test to run, or null for all.
 * @returns {Promise<RunResult>} What it reported, and what else it wrote.
 *   Never rejects once started.
 * @throws {Error} If the sandbox doesn't work here: the prototype only
 *   judges inside it (make sandbox-deps installs it).
 */
async function runOnce(solutionSource, select) {
  if (!sandboxStatus.ok) throw new Error(`The sandbox doesn't work here (${sandboxStatus.reason}); run make sandbox-deps.`);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-test-prototype-'));
  try {
    fs.copyFileSync(path.join(HERE, 'harness.py'), path.join(workDir, 'harness.py'));
    for (const name of QUESTION_FILES) fs.copyFileSync(path.join(HERE, 'question', name), path.join(workDir, name));
    fs.writeFileSync(path.join(workDir, 'solution.py'), solutionSource);
    prepareWorkDir(workDir);
    const nonce = crypto.randomBytes(16).toString('hex');
    // /work read-only, as judge/runner.js runs a submission (sandboxedArgs).
    const { command, args } = sandboxedRun('python3', ['/work/harness.py'], {
      binds: [{ hostPath: workDir, sandboxPath: '/work' }],
      cwd: '/work',
    });
    const started = performance.now();
    const child = spawnSandboxed(spawn, command, args, { env: SUBMISSION_ENV, timeout: TIMEOUT_MS, killSignal: 'SIGKILL' });
    let stdout = '';
    let stderr = '';
    // The streams are pipes (spawnSandboxed's default stdio), so they exist.
    /** @type {import('stream').Readable} */ (child.stdout).on(
      'data',
      /**
       * Keeps standard output, up to MAX_CAPTURED_OUTPUT.
       *
       * @param {Buffer} chunk - The next piece.
       * @returns {void}
       */
      (chunk) => {
        if (stdout.length < MAX_CAPTURED_OUTPUT) stdout += chunk;
      },
    );
    /** @type {import('stream').Readable} */ (child.stderr).on(
      'data',
      /**
       * Keeps standard error, up to MAX_CAPTURED_OUTPUT.
       *
       * @param {Buffer} chunk - The next piece.
       * @returns {void}
       */
      (chunk) => {
        if (stderr.length < MAX_CAPTURED_OUTPUT) stderr += chunk;
      },
    );
    const { code, signal } = await new Promise(
      /**
       * Waits for the run to end.
       *
       * @param {(end: { code: number | null, signal: NodeJS.Signals | null }) => void} resolve -
       *   Called once, with how it ended.
       * @returns {void}
       */
      (resolve) => {
        child.on('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
        /** @type {import('stream').Writable} */ (child.stdin).end(`${JSON.stringify({ nonce, select })}\n`);
      },
    );
    const ms = Math.round(performance.now() - started);
    return { ...parseReport(stdout, nonce), stderr, timedOut: signal === 'SIGKILL', exitCode: code, ms };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Splits a run's standard output into its report and everything else.
 *
 * @param {string} stdout - All the run wrote to standard output.
 * @param {string} nonce - This run's nonce: a line counts as report only
 *   if it starts with the marker and then this.
 * @returns {{ records: ReportRecord[], unreported: string }} The report's
 *   lines, parsed (one that isn't JSON is left out), and the other lines.
 */
function parseReport(stdout, nonce) {
  const prefix = `${MARKER} ${nonce} `;
  /** @type {ReportRecord[]} */
  const records = [];
  const other = [];
  for (const line of stdout.split('\n')) {
    if (!line.startsWith(prefix)) {
      if (line) other.push(line);
      continue;
    }
    try {
      records.push(JSON.parse(line.slice(prefix.length)));
    } catch {
      other.push(line);
    }
  }
  return { records, unreported: other.join('\n') };
}

/**
 * The question's tests, listed by running them against the author's
 * reference solution, never the learner's: so a submission can't make
 * itself look as though it has fewer tests to pass.
 *
 * @returns {Promise<{ visible: string[], hidden: number }>} The visible
 *   tests' names, and how many hidden ones there are.
 * @throws {Error} If the reference solution doesn't list them: the
 *   question is broken.
 */
async function listTests() {
  const reference = fs.readFileSync(path.join(HERE, 'question', 'solution.py'), 'utf8');
  const run = await runOnce(reference, { visibility: 'visible', index: -1 });
  const list = run.records.find((r) => r.event === 'list');
  if (!list || !list.visible || list.hidden === undefined) throw new Error(`The reference solution didn't list the tests: ${run.stderr}`);
  return { visible: list.visible, hidden: list.hidden };
}

/**
 * Judges a submission and says what a learner would see.
 *
 * @param {string} solutionSource - The submitted solution.py.
 * @param {{ visible: string[], hidden: number }} tests - From listTests().
 * @param {boolean} perTest - One process per test, rather than one for all.
 * @returns {Promise<Verdict>} The verdict, what's shown, and what's kept back.
 */
async function judge(solutionSource, tests, perTest) {
  /** @type {Selection[]} */
  const expected = [
    ...tests.visible.map((_, index) => /** @type {Selection} */ ({ visibility: 'visible', index })),
    ...Array.from({ length: tests.hidden }, (_, index) => /** @type {Selection} */ ({ visibility: 'hidden', index })),
  ];
  // One after another, so the times measured aren't runs competing for the
  // CPU (the server's queue, judge/queue.js, limits how many run at once).
  /** @type {RunResult[]} */
  const runs = [];
  for (const one of perTest ? expected : [null]) runs.push(await runOnce(solutionSource, one));
  const ms = runs.reduce((sum, run) => sum + run.ms, 0);
  /** @type {string[]} */
  const shown = [];
  /** @type {string[]} */
  const withheld = [];
  for (const [i, run] of runs.entries()) {
    const label = runs.length > 1 ? `run ${i + 1}: ` : '';
    if (run.unreported) withheld.push(`${label}standard output outside the report:\n${indent(run.unreported)}`);
    if (run.stderr) withheld.push(`${label}standard error:\n${indent(run.stderr)}`);
  }
  /**
   * The verdict, with what's been gathered so far.
   *
   * @param {string} status - The verdict's status.
   * @returns {Verdict} It.
   */
  const verdict = (status) => ({ status, shown, withheld, runs: runs.length, ms });

  // The learner's code loads once per run; its import-time output and any
  // load failure are the same each time, so the first run's are shown.
  const first = runs[0].records;
  const failed = first.find((r) => r.event === 'solution-failed' || r.event === 'tests-failed');
  if (failed) {
    shown.push(failed.event === 'solution-failed' ? 'Your code didn\'t load:' : `The ${failed.visibility} tests didn't load:`, indent(failed.message || ''));
    return verdict('Error');
  }
  const loaded = first.find((r) => r.event === 'solution-loaded');
  if (loaded && loaded.output) shown.push('Printed while your code loaded:', indent(loaded.output));

  let anyFailed = false;
  let anyTimedOut = false;
  for (const one of expected) {
    const run = perTest ? runs[expected.indexOf(one)] : runs[0];
    const matches = run.records.filter((r) => r.event === 'test' && r.visibility === one.visibility && r.index === one.index);
    const label = one.visibility === 'visible' ? `visible ${tests.visible[one.index]}` : `hidden test ${one.index + 1}`;
    if (matches.length > 1) {
      withheld.push(`${label}: reported ${matches.length} times`);
      return verdict('Couldn\'t judge');
    }
    if (matches.length === 0) {
      anyTimedOut = anyTimedOut || run.timedOut;
      shown.push(`${label}: ${run.timedOut ? 'not finished in time' : 'no result'}`);
      continue;
    }
    const [r] = matches;
    if (r.outcome !== 'pass') anyFailed = true;
    shown.push(`${label}: ${r.outcome}`);
    if (one.visibility === 'visible') {
      if (r.message) shown.push(indent(r.message));
      if (r.output) shown.push('  printed:', indent(r.output, 4));
    }
  }
  if (anyTimedOut) return verdict('Time Limit Exceeded');
  if (shown.some((line) => line.endsWith('no result'))) return verdict('Couldn\'t judge');
  return verdict(anyFailed ? 'Wrong Answer' : 'Accepted');
}

/**
 * Indents every line of a text.
 *
 * @param {string} text - The text.
 * @param {number} [spaces=2] - How far.
 * @returns {string} It, indented, without a trailing newline.
 */
function indent(text, spaces = 2) {
  return text.replace(/\n$/, '').split('\n').map((line) => ' '.repeat(spaces) + line).join('\n');
}

/**
 * Judges each probe named on the command line (all of probes/ if none)
 * and prints what a learner would see and what the judge keeps back.
 *
 * @returns {Promise<void>} Resolves when every probe is judged.
 */
async function main() {
  const argv = process.argv.slice(2);
  const perTest = argv.includes('--per-test');
  const named = argv.filter((a) => a !== '--per-test');
  const probes = named.length ? named : fs.readdirSync(path.join(HERE, 'probes')).filter((f) => f.endsWith('.py')).sort();
  const tests = await listTests();
  console.log(`Tests (from the reference solution): visible ${tests.visible.join(', ')}; ${tests.hidden} hidden. Mode: ${perTest ? 'one process per test' : 'one process for all'}.\n`);
  for (const probe of probes) {
    const source = fs.readFileSync(path.join(HERE, 'probes', probe), 'utf8');
    const v = await judge(source, tests, perTest);
    console.log(`== ${probe}: ${v.status} (${v.runs} run${v.runs > 1 ? 's' : ''}, ${v.ms} ms in all)`);
    console.log('Learner sees:');
    console.log(indent(v.shown.join('\n') || '(nothing)'));
    if (v.withheld.length) {
      console.log('Withheld:');
      console.log(indent(v.withheld.join('\n')));
    }
    console.log('');
  }
}

main().catch(
  /**
   * Reports a failure of the prototype itself and exits with status 1.
   *
   * @param {Error} err - What went wrong.
   * @returns {void}
   */
  (err) => {
    console.error(err.message);
    process.exitCode = 1;
  },
);

#!/usr/bin/env node
// Escape test for the judge: step 0 of docs/plans/sandboxing.md.
//
// Submits deliberately hostile code through the real judge (runSubmission)
// and reports, for each gap G1–G8 in the plan, whether the submission was
// "contained" or "ESCAPED". Before the sandbox exists most probes escape;
// each later step should turn some of them into "contained".
//
// It never touches real secrets or the internet's content. Instead it plants
// canaries: an environment variable (in its starting environment, see
// ENV_CANARY below), a private file (with a C++ header next
// to it), and a TCP listener on 127.0.0.1 standing in for the VPS's trusted
// port. A probe "escapes" if it can see or reach one.
//
// Run: node judge/sandbox-selftest.js   (or: make sandbox-test)
// Exit status: 0 if every probe was contained or skipped, 1 otherwise.
//
// Verdicts: "contained" (the limit held), "ESCAPED" (it didn't),
// "skipped" (this machine can't test it: G6d on 1-2 cores, G10 where GCC
// gives up before the time limit), "inconclusive" (the probe didn't run as
// intended, e.g. the judge failed; that fails too, so a broken judge can't
// pass).

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { runSubmission, TIMEOUT_MS, CPP_COMPILE_TIMEOUT_MS } = require('./runner');
const { sandboxStatus, describeSandbox, RUN_LIMITS } = require('./sandbox');
const cgroupsModule = require('./cgroups');
const queue = require('./queue');
const { cgroupStatus, MEMORY_LIMIT_MB } = cgroupsModule;

// For G12's report: the last submission cgroup's memory figures (peak,
// times the limit was reached, OOM kills), read just before the runner
// removes it. Only this test wraps forSubmission; the server doesn't.
/** @typedef {ReturnType<import('./cgroups').SubmissionCgroup['memory']>} MemoryCounters */
/** @type {MemoryCounters | null} */
let lastCgroupMemory = null;
const originalForSubmission = cgroupsModule.forSubmission;
cgroupsModule.forSubmission = () => {
  const cg = originalForSubmission();
  if (cg) {
    const destroy = cg.destroy.bind(cg);
    cg.destroy = () => {
      lastCgroupMemory = cg.memory();
      destroy();
    };
  }
  return cg;
};

const REPO_DIR = path.join(__dirname, '..');
const TOKEN = `maxrecall-selftest-${crypto.randomBytes(8).toString('hex')}`;

// The G1 canary must be in this process's *starting* environment, like a
// MAXRECALL_PASSWORD that systemd's EnvironmentFile= gives the VPS service:
// /proc/<pid>/environ shows only the environment a process was started
// with, not variables set later (process.env.X = ..., or .env files read by
// process.loadEnvFile). So without it, this script runs itself again once,
// with the canary set.
const ENV_CANARY_NAME = 'MAXRECALL_SELFTEST_CANARY';
const ENV_CANARY = process.env[ENV_CANARY_NAME];
if (!ENV_CANARY) {
  const rerun = spawnSync(process.execPath, [__filename], {
    stdio: 'inherit',
    env: { ...process.env, [ENV_CANARY_NAME]: TOKEN },
  });
  process.exit(rerun.status === null ? 2 : rerun.status);
}

// Function-mode Python probes return one string starting with "ESCAPED:" or
// "contained:". One visible test case, so the judge echoes `actual` back.
const PYTHON_CASE = [{ args: [], expected: 'unused', hidden: false }];

// Python string literals for paths and tokens: JSON string syntax is a
// subset of Python's for these ASCII values.
/**
 * @param {string | number} value - A path, token or number.
 * @returns {string} It as a Python literal.
 */
const py = (value) => JSON.stringify(value);

/**
 * One function-mode Python probe.
 *
 * @typedef {object} Probe
 * @property {string} id - e.g. "G1", as in docs/plans/sandboxing.md section 1.
 * @property {string} what - What it tries, for the report.
 * @property {string} code - The Python source, defining probe().
 * @property {string} [preamble] - Source put before code.
 * @property {'after-return' | 'after-timeout'} [checkOrphan] - Whether the
 *   verdict comes from outside, by looking for a leftover process after the
 *   probe returned or after it timed out.
 */

/**
 * The outcome of one probe.
 *
 * @typedef {object} ProbeOutcome
 * @property {string} verdict - "contained", "ESCAPED", "skipped" or "inconclusive".
 * @property {string} detail - What was seen.
 * @property {number} runtimeMs - How long the judge took.
 */

/**
 * @param {{ canaryDir: string, secretFile: string, listenerPort: number }} canaries -
 *   The private folder and file, and the port of the listener on 127.0.0.1.
 * @returns {Probe[]} The probes that try to reach them, and the rest of the
 *   Python probes.
 */
function pythonProbes({ canaryDir, secretFile, listenerPort }) {
  // ENV_CANARY is set by now: without it, this script restarted itself
  // with it (at the top), which the checker can't see from in here.
  return [
    {
      id: 'G1',
      what: 'see the server environment (canary env var)',
      code: `
import os
def probe():
    if os.environ.get(${py(ENV_CANARY_NAME)}) == ${py(/** @type {string} */ (ENV_CANARY))}:
        return 'ESCAPED: canary is in os.environ (%d variables in all)' % len(os.environ)
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        try:
            with open('/proc/%s/environ' % pid, 'rb') as f:
                if ${py(/** @type {string} */ (ENV_CANARY))}.encode() in f.read():
                    return 'ESCAPED: own env is clean (%s), but the canary is readable in /proc/%s/environ' % (sorted(os.environ), pid)
        except OSError:
            pass
    return 'contained: canary not in own env or any readable /proc/*/environ; env has %s' % sorted(os.environ)
`,
    },
    {
      id: 'G2',
      what: 'read question files (hidden expected answers)',
      code: `
def probe():
    path = ${py(path.join(REPO_DIR, 'questions', 'two-sum.json'))}
    try:
        with open(path) as f:
            text = f.read()
    except OSError as e:
        return 'contained: %s' % e.strerror
    return 'ESCAPED: read %d bytes of %s (hidden test cases included: %s)' % (len(text), path, '"hidden": true' in text)
`,
    },
    {
      id: 'G3',
      what: "read and write the server's private files",
      code: `
import os
def probe():
    found = []
    read_err = 'read, but no canary inside'
    try:
        with open(${py(secretFile)}) as f:
            if ${py(TOKEN)} in f.read():
                found.append('read the private canary file')
    except OSError as e:
        read_err = e.strerror
    try:
        with open(os.path.join(${py(canaryDir)}, 'written-by-submission'), 'w') as f:
            f.write('x')
        found.append('wrote a file next to it')
    except OSError:
        pass
    if found:
        return 'ESCAPED: ' + ' and '.join(found)
    return 'contained: canary file not readable (%s), folder not writable' % read_err
`,
    },
    {
      id: 'G4',
      what: 'connect to a host loopback port (stands in for trusted port 3001)',
      code: `
import socket
def probe():
    try:
        s = socket.create_connection(('127.0.0.1', ${listenerPort}), timeout=3)
        s.sendall(b'hello from a submission')
        s.close()
        return 'ESCAPED: connected to 127.0.0.1:${listenerPort}'
    except OSError as e:
        return 'contained: %s' % (e.strerror or e)
`,
    },
    {
      id: 'G5a',
      what: 'leave a process running after the judge finishes',
      code: orphanProbe('after-return', false),
      checkOrphan: 'after-return',
    },
    {
      id: 'G5b',
      what: 'leave a process running after the timeout kill (takes ~5 s)',
      code: orphanProbe('after-timeout', true),
      checkOrphan: 'after-timeout',
    },
    {
      id: 'G6a',
      what: 'start 300 processes (no process-count limit)',
      code: `
import os, time
def probe():
    children = []
    err = None
    for i in range(300):
        try:
            pid = os.fork()
        except OSError as e:
            err = e.strerror
            break
        if pid == 0:
            time.sleep(2)
            os._exit(0)
        children.append(pid)
    for pid in children:
        os.waitpid(pid, 0)
    if err is None:
        return 'ESCAPED: started all 300'
    return 'contained: stopped after %d (%s)' % (len(children), err)
`,
    },
    {
      id: 'G6b',
      what: 'write a 100 MB file to /tmp (no file-size limit)',
      code: `
import os
def probe():
    path = '/tmp/' + ${py(TOKEN)} + '-big'
    written = 0
    chunk = b'\\0' * (1024 * 1024)
    try:
        with open(path, 'wb') as f:
            for i in range(100):
                f.write(chunk)
                f.flush()
                written += 1
        result = 'ESCAPED: wrote 100 MB'
    except OSError as e:
        result = 'contained: stopped at %d MB (%s)' % (written, e.strerror)
    try:
        os.unlink(path)
    except OSError:
        pass
    return result
`,
      // RLIMIT_FSIZE ends the process with SIGXFSZ unless it's ignored.
      preamble: 'import signal\nsignal.signal(signal.SIGXFSZ, signal.SIG_IGN)\n',
    },
    {
      id: 'G6c',
      what: 'allocate 1 GB of memory (an existing limit, checked for regressions)',
      code: `
def probe():
    try:
        b = bytearray(1024 * 1024 * 1024)
        return 'ESCAPED: allocated 1 GB'
    except MemoryError:
        return 'contained: MemoryError'
`,
    },
    {
      id: 'G11',
      what: 'make system calls a seccomp filter should refuse (io_uring, ptrace, keyctl, kcmp)',
      // Four calls that succeed for an ordinary user without a filter
      // (checked 2026-11-02 as nobody, outside any sandbox), so a refusal
      // shows the filter rather than missing privileges. Calls such as bpf
      // would prove nothing: Ubuntu already refuses them to ordinary users.
      // Numbers from the kernel's syscall tables: x86-64 (asm/unistd_64.h)
      // and ARM64 (asm-generic/unistd.h).
      code: `
import ctypes, os, platform
NUMBERS = {
    'x86_64':  {'io_uring_setup': 425, 'ptrace': 101, 'keyctl': 250, 'kcmp': 312},
    'aarch64': {'io_uring_setup': 425, 'ptrace': 117, 'keyctl': 219, 'kcmp': 272},
}
def probe():
    nr = NUMBERS.get(platform.machine())
    if nr is None:
        return 'inconclusive: no syscall numbers for ' + platform.machine()
    libc = ctypes.CDLL(None, use_errno=True)
    def call(n, *args):
        r = libc.syscall(n, *[ctypes.c_long(a) for a in args])
        return r, ctypes.get_errno()
    with open('/proc/self/status') as f:
        mode = [l.split()[1] for l in f if l.startswith('Seccomp:')][0]
    params = ctypes.create_string_buffer(120)
    results = {}
    results['io_uring_setup'] = call(nr['io_uring_setup'], 1, ctypes.addressof(params))
    results['keyctl'] = call(nr['keyctl'], 0, -3, 0)   # KEYCTL_GET_KEYRING_ID, session keyring
    pid = os.getpid()
    results['kcmp'] = call(nr['kcmp'], pid, pid, 0, 0, 0)  # KCMP_FILE: fd 0 against itself
    r, w = os.pipe()
    child = os.fork()
    if child == 0:
        rc, err = call(nr['ptrace'], 0, 0, 0, 0)  # PTRACE_TRACEME
        os.write(w, ('%d %d' % (rc, err)).encode())
        os._exit(0)
    os.waitpid(child, 0)
    rc, err = os.read(r, 64).decode().split()
    results['ptrace'] = (int(rc), int(err))
    allowed = sorted(k for k, (rc, err) in results.items() if rc >= 0)
    refused = ', '.join('%s %s' % (k, os.strerror(err)) for k, (rc, err) in sorted(results.items()) if rc < 0)
    if allowed:
        return 'ESCAPED: seccomp mode %s; allowed: %s%s' % (mode, ', '.join(allowed), ('; refused: ' + refused) if refused else '')
    if mode != '2':
        return 'inconclusive: all refused, but no seccomp filter (mode %s): %s' % (mode, refused)
    return 'contained: seccomp filter active (mode 2); refused: ' + refused
`,
    },
    {
      id: 'G8',
      what: 'have a network interface other than loopback',
      code: `
import socket
def probe():
    names = [name for _, name in socket.if_nameindex()]
    try:
        socket.create_connection(('1.1.1.1', 443), timeout=3).close()
        direct = 'direct connect to 1.1.1.1:443 worked'
    except OSError as e:
        direct = 'direct connect to 1.1.1.1:443 failed: %s' % (e.strerror or e)
    if [n for n in names if n != 'lo']:
        return 'ESCAPED: interfaces %s; %s' % (names, direct)
    return 'contained: interfaces %s; %s' % (names, direct)
`,
    },
  ];
}

// A Python probe that starts a detached grandchild (new session, output to
// /dev/null so it doesn't hold the judge's pipes open), then either returns
// or loops until the judge's timeout kills it. The grandchild runs a shell
// whose command line carries TOKEN, so this script can look for it in /proc
// from outside afterwards.
/**
 * @param {string} label - Added to TOKEN on the grandchild's command line.
 * @param {boolean} loopForever - Whether probe() loops until killed instead
 *   of returning.
 * @returns {string} The probe's Python source.
 */
function orphanProbe(label, loopForever) {
  return `
import os
def probe():
    if os.fork() == 0:
        os.setsid()
        devnull = os.open('/dev/null', os.O_RDWR)
        for fd in (0, 1, 2):
            os.dup2(devnull, fd)
        os.execv('/bin/sh', ['sh', '-c', 'sleep 30; : ' + ${py(TOKEN)} + '-${label}'])
    ${loopForever ? 'while True: pass' : "return 'started an orphan; checked from outside'"}
`;
}

// Command lines of every process on the machine that carry `marker`. The
// sandbox's PID namespace hides the host from a submission, not the other
// way round, so this sees sandboxed processes too.
/**
 * @param {string} marker - Text to look for in each command line.
 * @returns {number[]} The PIDs of those processes, other than this one.
 */
function findProcesses(marker) {
  /** @type {number[]} */
  const pids = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
    try {
      const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8');
      if (cmdline.includes(marker)) pids.push(Number(entry));
    } catch {
      // The process exited, or isn't ours to read.
    }
  }
  return pids;
}

/**
 * Sends SIGKILL to each process, ignoring ones already gone.
 *
 * @param {number[]} pids - The processes.
 * @returns {void}
 */
function killAll(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

/**
 * @param {number} ms - How long to wait.
 * @returns {Promise<void>} Resolves after that long.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Turns a judge result into one probe outcome. A probe that didn't get as
// far as returning its string is "inconclusive", never "contained", so a
// broken probe can't pass by accident.
/**
 * @param {import('./runner').JudgeResult} result - A probe's verdict from the judge.
 * @returns {{ verdict: string, detail: string }} The probe's own verdict,
 *   or "inconclusive".
 */
function readVerdict(result) {
  const actual = result.results && result.results[0] && result.results[0].actual;
  if (typeof actual === 'string' && /^(ESCAPED|contained|inconclusive):/.test(actual)) {
    const [verdict, ...rest] = actual.split(':');
    return { verdict, detail: rest.join(':').trim() };
  }
  const why = (result.error || result.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || '';
  return { verdict: 'inconclusive', detail: `judge said ${result.status}${why ? `: ${why}` : ''}` };
}

/**
 * @param {Probe} probe - The probe to run.
 * @returns {Promise<ProbeOutcome>} Its outcome.
 */
async function runPythonProbe(probe) {
  const code = `${probe.preamble || ''}${probe.code}`;
  const result = await runSubmission({
    language: 'python',
    code,
    functionName: 'probe',
    testCases: PYTHON_CASE,
    judgeMode: 'function',
  });

  if (!probe.checkOrphan) return { ...readVerdict(result), runtimeMs: result.runtimeMs };

  // Orphan probes: the verdict comes from outside, but only if the
  // submission really ran: no orphan is left behind by a submission that
  // never started (on the VPS on 2026-11-02, bwrap failed every run and
  // these probes wrongly said "contained"). After-return needs the probe's
  // own return value back; after-timeout needs Time Limit Exceeded.
  const ran = probe.checkOrphan === 'after-return'
    // test() turns a value that isn't a string into text, as before.
    ? /^started an orphan/.test(/** @type {string} */ ((result.results && result.results[0] && result.results[0].actual) || ''))
    : result.status === 'Time Limit Exceeded';
  if (!ran) {
    killAll(findProcesses(`${TOKEN}-${probe.checkOrphan}`));
    return { ...readVerdict(result), verdict: 'inconclusive', runtimeMs: result.runtimeMs };
  }
  // Give the judge's own cleanup (and the sandbox's teardown) a moment.
  await sleep(1500);
  const leftovers = findProcesses(`${TOKEN}-${probe.checkOrphan}`);
  killAll(leftovers);
  return leftovers.length
    ? { verdict: 'ESCAPED', detail: `${leftovers.length} process(es) still running 1.5 s after the judge returned ${result.status} (pid ${leftovers.join(', ')}; now killed)`, runtimeMs: result.runtimeMs }
    : { verdict: 'contained', detail: `nothing left running after the judge returned ${result.status}`, runtimeMs: result.runtimeMs };
}

// G7: the compile step. The C++ submission #includes the canary header by
// absolute path. If it compiles, the compiler could read a file outside its
// sandbox; if the compiler reports it missing, it couldn't.
/**
 * @param {string} canaryHeader - The owner-only header's path.
 * @returns {Promise<ProbeOutcome>} G7's outcome.
 */
async function runCompileProbe(canaryHeader) {
  const result = await runSubmission({
    language: 'cpp',
    code: `#include ${JSON.stringify(canaryHeader)}\nint probe(int x) { return SELFTEST_CANARY + x; }\n`,
    functionName: 'probe',
    testCases: [{ args: [0], expected: 1, hidden: false }],
    signature: { params: ['int'], returns: 'int' },
    judgeMode: 'function',
  });
  if (result.status === 'Accepted') {
    return { verdict: 'ESCAPED', detail: `compiled with ${canaryHeader} included`, runtimeMs: result.runtimeMs };
  }
  // Only the compiler's own complaint about the canary header counts, not
  // any failure: on the VPS on 2026-11-02 bwrap's "Permission denied" was
  // taken for the compiler's, and this probe wrongly said "contained".
  const error = result.error || '';
  if (result.status === 'Compile Error' && !/^bwrap:/m.test(error) && /canary\.h/.test(error) && /No such file|cannot open|Permission denied/.test(error)) {
    return { verdict: 'contained', detail: 'compiler could not open the canary header', runtimeMs: result.runtimeMs };
  }
  return { verdict: 'inconclusive', detail: `judge said ${result.status}: ${(result.error || '').split('\n')[0]}`, runtimeMs: result.runtimeMs };
}

// G6d: one process keeping several cores busy. The wall-clock timeout
// alone allows 5 s x cores of CPU time; the CPU-time limit should stop it
// sooner. One busy worker thread per core (at least 4), plus the main one.
/** @returns {Promise<ProbeOutcome>} G6d's outcome. */
async function runCpuProbe() {
  const cores = os.cpus().length;
  const result = await runSubmission({
    language: 'javascript',
    code: `function probe() {
  const { Worker } = require('worker_threads');
  const threads = Math.max(4, require('os').cpus().length);
  for (let i = 0; i < threads; i++) new Worker('for (;;) {}', { eval: true });
  for (;;) {}
}`,
    functionName: 'probe',
    testCases: PYTHON_CASE,
    judgeMode: 'function',
  });
  const error = result.error || '';
  if (/CPU time limit/.test(error)) {
    return { verdict: 'contained', detail: `stopped by the CPU-time limit after ${result.runtimeMs} ms of wall-clock time`, runtimeMs: result.runtimeMs };
  }
  // On few cores the wall-clock timeout allows no more CPU time than the
  // CPU limit, so it always stops this first: nothing to test here (the
  // VPS has 2 cores: 2 x 5 s = 10 s, the CPU limit itself).
  const maxCpuSeconds = cores * (TIMEOUT_MS / 1000);
  if (result.status === 'Time Limit Exceeded' && /^Time limit exceeded/.test(error)) {
    return maxCpuSeconds <= RUN_LIMITS.cpuSoftSeconds
      ? { verdict: 'skipped', detail: `on ${cores} core(s) the ${TIMEOUT_MS / 1000} s wall-clock limit allows at most ${maxCpuSeconds} s of CPU time, no more than the ${RUN_LIMITS.cpuSoftSeconds} s CPU limit, so it can't be tested here (stopped by the clock)`, runtimeMs: result.runtimeMs }
      : { verdict: 'ESCAPED', detail: `ran until the wall-clock timeout with every core busy (${cores} cores): about ${maxCpuSeconds} s of CPU time`, runtimeMs: result.runtimeMs };
  }
  return { verdict: 'inconclusive', detail: `judge said ${result.status} on ${cores} core(s): ${error.split('\n')[0]}`, runtimeMs: result.runtimeMs };
}

// G12: memory used by several processes together, each staying under the
// per-process caps (Python's 256 MB address-space limit): 4 x 200 MB, over
// the submission cgroup's 768 MB. Only cgroups cap that (sandboxing step 7).
// Pages are written to, not just reserved, so they really count. Where
// cgroups aren't in use (anywhere but the VPS service) it's skipped and
// allocates nothing. Until 2026-11-02 each child slept 2 s holding its
// memory, which used up most of the 5 s time limit before any limit could
// act (G12 timed out on the VPS at a 521 MB peak); now they hold it only
// until all four have it.
const MEMORY_PROBE = `
import os
def probe():
    n = 200 * 1024 * 1024
    # Each child reports on "ready" once its 200 MB is written, then holds
    # it until the parent closes "go". The parent counts reports until EOF
    # on "ready": every child has reported and closed its end, or died. So
    # a child killed for using too much memory can't leave the others
    # waiting, and no fixed sleep uses up the time limit.
    ready_r, ready_w = os.pipe()
    go_r, go_w = os.pipe()
    children = []
    for i in range(4):
        pid = os.fork()
        if pid == 0:
            os.close(ready_r)
            os.close(go_w)
            b = bytearray(n)
            b[::4096] = b'\\x01' * len(range(0, n, 4096))
            os.write(ready_w, b'x')
            os.close(ready_w)
            os.read(go_r, 1)
            os._exit(0)
        children.append(pid)
    os.close(ready_w)
    os.close(go_r)
    ready = 0
    while os.read(ready_r, 1):
        ready += 1
    os.close(go_w)
    statuses = [os.waitpid(pid, 0)[1] for pid in children]
    killed = sum(1 for st in statuses if os.WIFSIGNALED(st))
    if killed:
        return 'contained: %d of 4 processes were killed, %d had their 200 MB' % (killed, ready)
    return 'ESCAPED: 4 processes held 800 MB together'
`;

/** @returns {Promise<ProbeOutcome>} G12's outcome. */
async function runMemoryProbe() {
  if (!cgroupStatus.ok) {
    return { verdict: 'skipped', detail: "cgroup limits aren't in use here (only in the VPS service, MAXRECALL_REQUIRE_CGROUPS=1); per-process memory caps still apply", runtimeMs: 0 };
  }
  lastCgroupMemory = null;
  const result = await runSubmission({ language: 'python', code: MEMORY_PROBE, functionName: 'probe', testCases: PYTHON_CASE, judgeMode: 'function' });
  // Set meanwhile by the wrapped destroy() above, which the checker can't see.
  const m = /** @type {MemoryCounters | null} */ (lastCgroupMemory);
  const figures = m ? ` [cgroup: peak ${m.peakMb} MB, limit reached ${m.limitHits} time(s), ${m.oomKills} OOM kill(s)]` : '';
  // Contained either way the limit shows: an OOM kill ("exceeded"), or
  // crawling at the limit until the time ran out ("reached").
  if (/Memory limit (exceeded|reached)/.test(result.error || '')) {
    return { verdict: 'contained', detail: `the submission's cgroup stopped it: ${result.error}${figures}`, runtimeMs: result.runtimeMs };
  }
  const verdict = readVerdict(result);
  return { ...verdict, detail: `${verdict.detail}${figures}`, runtimeMs: result.runtimeMs };
}

// G10: a compile that takes longer than the compile timeout. g++ is only a
// driver; the compiler proper is its child, cc1plus. Killing the driver on
// timeout used to leave cc1plus running, holding the judge's pipe open, so
// the judge didn't answer until it finished (measured 2026-11-02: 137 s
// with a 1 s timeout). The source is small, like a real submission: 8
// constexpr evaluations, each stopped by GCC's own operation limit after
// about 5 s, at a few hundred MB. A watchdog stops this probe from waiting
// that long: if the judge hasn't answered 4 s after the compile timeout,
// it's ESCAPED, and the leftover compiler is killed here.
const SLOW_CPP = `constexpr long spin(long k) { long s = k; for (long i = 0; i < 200000; i++) for (long j = 0; j < 200000; j++) s += i ^ j ^ k; return s; }
constexpr long a = spin(1), b = spin(2), c = spin(3), d = spin(4), e = spin(5), f = spin(6), g = spin(7), h = spin(8);
int probe(int x) { return (int)((a + b + c + d + e + f + g + h) & 1) + x; }
`;

/** @returns {number[]} The PIDs of every cc1plus (g++'s compiler proper) running. */
function compilerPids() {
  /** @type {number[]} */
  const pids = [];
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (fs.readFileSync(`/proc/${entry}/comm`, 'utf8').trim() === 'cc1plus') pids.push(Number(entry));
    } catch {
      // Gone, or not ours.
    }
  }
  return pids;
}

// How many processes this one has as direct children right now. Each
// judging has exactly one at a time (its compiler or its run: bwrap, or the
// cgroup wrapper or setpriv in front of it, which exec into it).
/** @returns {number} This process's direct children now. */
function countChildren() {
  let count = 0;
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // /proc/<pid>/stat: "pid (comm) state ppid ...". comm may contain
      // spaces, so read after its closing parenthesis.
      const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8');
      if (Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) === process.pid) count += 1;
    } catch {
      // Gone already.
    }
  }
  return count;
}

// G9: many judgings at once. 20 start together, each sleeping 0.5 s: at
// most MAX_RUNNING may run at the same moment, MAX_WAITING more wait, and
// the rest must be refused with "busy" straight away (judge/queue.js). How
// many really run together is measured from outside the queue, by sampling
// this process's children every 50 ms, so a bypassed queue shows as
// ESCAPED rather than relying on the queue's own count.
/** @returns {Promise<ProbeOutcome>} G9's outcome. */
async function runConcurrencyProbe() {
  const total = 20;
  queue.resetPeak();
  const started = Date.now();
  let observedPeak = 0;
  const sampler = setInterval(() => { observedPeak = Math.max(observedPeak, countChildren()); }, 50);
  const outcomes = await Promise.allSettled(Array.from({ length: total }, () => runSubmission({
    language: 'python',
    code: 'import time\ndef probe():\n    time.sleep(0.5)\n    return "ok"\n',
    functionName: 'probe',
    testCases: [{ args: [], expected: 'ok', hidden: false }],
    judgeMode: 'function',
  })));
  clearInterval(sampler);
  const { maxRunning, maxWaiting, peakRunning } = queue.queueStats();
  const busy = outcomes.filter((o) => o.status === 'rejected' && o.reason && o.reason.code === 'JUDGE_BUSY').length;
  const accepted = outcomes.filter((o) => o.status === 'fulfilled' && o.value.status === 'Accepted').length;
  const other = total - busy - accepted;
  const expectedBusy = Math.max(0, total - maxRunning - maxWaiting);
  const detail = `${total} at once: at most ${observedPeak} ran together (limit ${maxRunning}; the queue counted ${peakRunning}), ${accepted} judged, ${busy} refused as busy (expected ${expectedBusy})${other ? `, ${other} other` : ''}`;
  const runtimeMs = Date.now() - started;
  if (observedPeak > maxRunning) return { verdict: 'ESCAPED', detail, runtimeMs };
  if (observedPeak === 0) return { verdict: 'inconclusive', detail: `${detail}; no judgings were seen running`, runtimeMs };
  if (busy !== expectedBusy || other) return { verdict: 'inconclusive', detail, runtimeMs };
  return { verdict: 'contained', detail, runtimeMs };
}

/** @returns {Promise<ProbeOutcome>} G10's outcome. */
async function runSlowCompileProbe() {
  const before = new Set(compilerPids());
  const newCompilers = () => compilerPids().filter((pid) => !before.has(pid));
  const started = Date.now();
  const deadlineMs = CPP_COMPILE_TIMEOUT_MS + 4000;
  const judged = runSubmission({
    language: 'cpp',
    code: SLOW_CPP,
    functionName: 'probe',
    testCases: [{ args: [0], expected: 0, hidden: false }],
    signature: { params: ['int'], returns: 'int' },
    judgeMode: 'function',
  });
  const answer = await Promise.race([judged.then((result) => ({ result })), sleep(deadlineMs).then(() => null)]);
  const elapsed = Date.now() - started;
  if (!answer) {
    const leftovers = newCompilers();
    killAll(leftovers);
    await judged;
    return { verdict: 'ESCAPED', detail: `no answer ${deadlineMs / 1000} s after submitting (compile limit ${CPP_COMPILE_TIMEOUT_MS / 1000} s); ${leftovers.length} compiler process(es) still running, now killed`, runtimeMs: elapsed };
  }
  const { result } = answer;
  if (result.status === 'Compile Error' && /timed out/.test(result.error || '')) {
    await sleep(1000);
    const leftovers = newCompilers();
    killAll(leftovers);
    return leftovers.length
      ? { verdict: 'ESCAPED', detail: `judge said the compile timed out, but ${leftovers.length} compiler process(es) kept running (now killed)`, runtimeMs: elapsed }
      : { verdict: 'contained', detail: 'compile stopped at the time limit, nothing left running', runtimeMs: elapsed };
  }
  const why = (result.error || '').split('\n').filter(Boolean)[0] || '';
  if (/^bwrap:/.test(why)) {
    return { verdict: 'inconclusive', detail: `judge said ${result.status}: ${why}`, runtimeMs: elapsed };
  }
  // GCC's own constexpr limit ended the compile before ours: the probe ran,
  // but this machine is too fast to test the time limit with it.
  if (result.status === 'Compile Error' && /constexpr/.test(result.error || '')) {
    return { verdict: 'skipped', detail: `GCC finished the compile itself in ${elapsed} ms (its constexpr limit), before the ${CPP_COMPILE_TIMEOUT_MS / 1000} s limit: too fast here to test it`, runtimeMs: elapsed };
  }
  return { verdict: 'inconclusive', detail: `judge said ${result.status} after ${elapsed} ms: ${why}`, runtimeMs: elapsed };
}

/**
 * Plants the canaries, runs every probe, prints the report, and sets the
 * exit code: 0 if every probe was contained or skipped, 1 if not, 2 if the
 * judge refuses to run anything.
 *
 * @returns {Promise<void>}
 */
async function main() {
  console.log(`Sandbox: ${describeSandbox()}\n`);
  if (!sandboxStatus.ok && !sandboxStatus.unsandboxedOverride) {
    console.log('The judge refuses to run anything, so there is nothing to probe. To see what an');
    console.log('unsandboxed judge lets through, run: MAXRECALL_UNSANDBOXED=1 make sandbox-test');
    process.exitCode = 2;
    return;
  }
  // Canaries. The private folder and file are owner-only, like auth/.
  const canaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxrecall-selftest-'));
  fs.chmodSync(canaryDir, 0o700);
  const secretFile = path.join(canaryDir, 'secret');
  fs.writeFileSync(secretFile, `${TOKEN}\n`, { mode: 0o600 });
  const canaryHeader = path.join(canaryDir, 'canary.h');
  fs.writeFileSync(canaryHeader, '#define SELFTEST_CANARY 1\n', { mode: 0o600 });

  const listener = net.createServer((socket) => socket.destroy());
  await /** @type {Promise<void>} */ (new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve)));
  // Listening on TCP, address() is an AddressInfo, not a path or null.
  const listenerPort = /** @type {import('net').AddressInfo} */ (listener.address()).port;

  /** @type {(ProbeOutcome & { id: string, what: string })[]} */
  const outcomes = [];
  try {
    for (const probe of pythonProbes({ canaryDir, secretFile, listenerPort })) {
      process.stdout.write(`${probe.id} ... `);
      const outcome = await runPythonProbe(probe);
      process.stdout.write(`${outcome.verdict}\n`);
      outcomes.push({ id: probe.id, what: probe.what, ...outcome });
    }
    process.stdout.write('G6d ... ');
    const cpuOutcome = await runCpuProbe();
    process.stdout.write(`${cpuOutcome.verdict}\n`);
    outcomes.push({ id: 'G6d', what: 'keep every core busy from one process (takes up to 5 s)', ...cpuOutcome });
    process.stdout.write('G12 ... ');
    const memoryOutcome = await runMemoryProbe();
    process.stdout.write(`${memoryOutcome.verdict}\n`);
    outcomes.push({ id: 'G12', what: `use more than ${MEMORY_LIMIT_MB} MB in several processes together (cgroup limit)`, ...memoryOutcome });
    process.stdout.write('G7 ... ');
    const compileOutcome = await runCompileProbe(canaryHeader);
    process.stdout.write(`${compileOutcome.verdict}\n`);
    outcomes.push({ id: 'G7', what: 'read a host file at compile time (C++ #include)', ...compileOutcome });
    process.stdout.write('G9 ... ');
    const concurrencyOutcome = await runConcurrencyProbe();
    process.stdout.write(`${concurrencyOutcome.verdict}\n`);
    outcomes.push({ id: 'G9', what: 'have many submissions judged at once (judge queue)', ...concurrencyOutcome });
    process.stdout.write('G10 ... ');
    const slowCompileOutcome = await runSlowCompileProbe();
    process.stdout.write(`${slowCompileOutcome.verdict}\n`);
    outcomes.push({ id: 'G10', what: 'compile for longer than the compile time limit (takes up to 14 s)', ...slowCompileOutcome });
  } finally {
    listener.close();
    killAll(findProcesses(TOKEN));
    fs.rmSync(canaryDir, { recursive: true, force: true });
  }

  outcomes.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  console.log('\nCan a submission ...');
  for (const o of outcomes) {
    console.log(`\n${o.id.padEnd(4)} ${o.verdict.toUpperCase() === 'ESCAPED' ? 'ESCAPED  ' : o.verdict.padEnd(9)} ${o.what}`);
    console.log(`     ${o.detail} [${o.runtimeMs} ms]`);
  }
  const counts = outcomes.reduce((acc, o) => ({ ...acc, [o.verdict]: (acc[o.verdict] || 0) + 1 }), /** @type {Record<string, number>} */ ({}));
  console.log(`\n${outcomes.length} probes: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  process.exitCode = outcomes.every((o) => o.verdict === 'contained' || o.verdict === 'skipped') ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});

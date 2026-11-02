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
// Exit status: 0 if every probe was contained, 1 otherwise.

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { runSubmission } = require('./runner');
const { sandboxStatus, describeSandbox } = require('./sandbox');

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
const py = (value) => JSON.stringify(value);

function pythonProbes({ canaryDir, secretFile, listenerPort }) {
  return [
    {
      id: 'G1',
      what: 'see the server environment (canary env var)',
      code: `
import os
def probe():
    if os.environ.get(${py(ENV_CANARY_NAME)}) == ${py(ENV_CANARY)}:
        return 'ESCAPED: canary is in os.environ (%d variables in all)' % len(os.environ)
    for pid in os.listdir('/proc'):
        if not pid.isdigit():
            continue
        try:
            with open('/proc/%s/environ' % pid, 'rb') as f:
                if ${py(ENV_CANARY)}.encode() in f.read():
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
function findProcesses(marker) {
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

function killAll(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Turns a judge result into one probe outcome. A probe that didn't get as
// far as returning its string is "inconclusive", never "contained", so a
// broken probe can't pass by accident.
function readVerdict(result) {
  const actual = result.results && result.results[0] && result.results[0].actual;
  if (typeof actual === 'string' && /^(ESCAPED|contained):/.test(actual)) {
    const [verdict, ...rest] = actual.split(':');
    return { verdict, detail: rest.join(':').trim() };
  }
  const why = (result.error || result.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || '';
  return { verdict: 'inconclusive', detail: `judge said ${result.status}${why ? `: ${why}` : ''}` };
}

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

  // Orphan probes: the verdict comes from outside. Give the judge's own
  // cleanup (and, later, the sandbox's teardown) a moment first.
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
  if (result.status === 'Compile Error' && /No such file|cannot open|Permission denied/.test(result.error || '')) {
    return { verdict: 'contained', detail: 'compiler could not open the canary header', runtimeMs: result.runtimeMs };
  }
  return { verdict: 'inconclusive', detail: `judge said ${result.status}: ${(result.error || '').split('\n')[0]}`, runtimeMs: result.runtimeMs };
}

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
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const listenerPort = listener.address().port;

  const outcomes = [];
  try {
    for (const probe of pythonProbes({ canaryDir, secretFile, listenerPort })) {
      process.stdout.write(`${probe.id} ... `);
      const outcome = await runPythonProbe(probe);
      process.stdout.write(`${outcome.verdict}\n`);
      outcomes.push({ id: probe.id, what: probe.what, ...outcome });
    }
    process.stdout.write('G7 ... ');
    const compileOutcome = await runCompileProbe(canaryHeader);
    process.stdout.write(`${compileOutcome.verdict}\n`);
    outcomes.push({ id: 'G7', what: 'read a host file at compile time (C++ #include)', ...compileOutcome });
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
  const counts = outcomes.reduce((acc, o) => ({ ...acc, [o.verdict]: (acc[o.verdict] || 0) + 1 }), {});
  console.log(`\n${outcomes.length} probes: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  console.log('G9 (concurrent Runs) is not probed here; see docs/plans/sandboxing.md step 8.');
  process.exitCode = outcomes.every((o) => o.verdict === 'contained') ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});

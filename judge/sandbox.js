// The judge's sandbox: builds bubblewrap (bwrap) command lines, checks at
// startup that bwrap really works here, and refuses judging when it doesn't
// ("fail closed"). Steps 2 onwards of docs/plans/sandboxing.md.
//
// bubblewrap is "not a complete, ready-made sandbox with a specific security
// policy" (its README): the policy is the argument list built below, so
// every flag is explained where it's added. Reference: bwrap(1), and
// `bwrap --help`.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// The whole environment compilers and submissions get, instead of a copy of
// the server's (spawn's default), which can hold secrets such as
// MAXRECALL_PASSWORD. PATH is how they find node/python3/g++/java/dmd. LANG
// makes text output UTF-8 everywhere: without it, Java falls back to ASCII
// and prints "café" as "caf?" (Python coerces the C locale to UTF-8 on its
// own, PEP 538). C.UTF-8 is built into glibc, so it exists on every machine.
//
// bwrap itself must be started with this too, not only told --clearenv:
// bwrap's own process 1 inside the sandbox keeps the environment it was
// started with, and a submission can read it from /proc/1/environ.
const SUBMISSION_ENV = Object.freeze({ PATH: process.env.PATH, LANG: 'C.UTF-8' });

// Set MAXRECALL_UNSANDBOXED=1 to allow judging when the sandbox is missing
// or broken, e.g. on your own machine while setting it up. It never turns a
// working sandbox off.
const UNSANDBOXED_OVERRIDE = process.env.MAXRECALL_UNSANDBOXED === '1';

// Size of each sandbox's private /tmp (a tmpfs, so it's memory).
const TMPFS_BYTES = 64 * 1024 * 1024;

// Limits for a submission's run, set with prlimit INSIDE the sandbox. Inside
// matters: since Linux 5.14 RLIMIT_NPROC is counted per user namespace, so
// inside the sandbox it counts only the sandbox's own processes and threads.
// Set outside, it would count every process the server's user owns (all of
// a desktop session), and the sandbox wouldn't even start. Measured
// 2026-11-02: with 150 processes outside, --nproc=64 outside made bwrap
// fail; inside it stopped a fork loop at 62. Threads count too, and the JVM
// starts more of them on more cores, hence the headroom. fsize caps any one
// file (in /tmp); core=0 means no core dumps.
//
// cpu is CPU time per process, all its threads added up (RLIMIT_CPU), a
// backstop to the judge's wall-clock timeout: 5 s of wall-clock time can be
// 5 s x cores of CPU. At the soft limit the kernel sends SIGXCPU, at the
// hard one SIGKILL (getrlimit(2)). The soft limit is below the hard one so
// the judge can tell this kill from others: bwrap reports a child killed by
// a signal as exit code 128 + the signal, measured 2026-11-02: SIGXCPU (24)
// gives 152; equal soft and hard limits gave SIGKILL, 137, like any kill.
// It's per process, so a submission that forks gets this much per process:
// cgroups (sandboxing step 7) give one budget for the whole sandbox.
const RUN_LIMITS = Object.freeze({ nproc: 128, fsizeBytes: 16 * 1024 * 1024, cpuSoftSeconds: 10, cpuHardSeconds: 11 });
const SIGXCPU = 24;
const CPU_LIMIT_EXIT_CODE = 128 + SIGXCPU;

// Root is exempt from RLIMIT_NPROC (measured: 300 forks under a 64 limit),
// and submissions shouldn't run as root anyway. So when the server is root
// (the cloud sessions), sandboxes run as nobody instead, via setpriv. On
// Kubuntu and the VPS the server isn't root, and sandboxes run as its user.
const RUNNING_AS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const NOBODY_UID = 65534;

// Toolchains the judge runs. Any that live outside /usr (Node is
// /opt/node22 in the cloud) get their install folder bound in read-only.
const TOOLCHAIN_COMMANDS = ['node', 'python3', 'g++', 'javac', 'java', 'dmd'];

const REPO_DIR = path.join(__dirname, '..');

function findOnPath(command) {
  for (const dir of (SUBMISSION_ENV.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Not in this folder.
    }
  }
  return null;
}

// The top-level folders that hold programs and libraries (/bin, /lib, ...)
// are copied into the sandbox the way they are on this machine: as symlinks
// into /usr on systems with a merged /usr (Ubuntu), or as read-only binds
// where they're real folders.
function systemDirArgs() {
  const args = [];
  for (const dir of ['/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32']) {
    let stat;
    try {
      stat = fs.lstatSync(dir);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) args.push('--symlink', fs.readlinkSync(dir), dir);
    else if (stat.isDirectory()) args.push('--ro-bind', dir, dir);
  }
  return args;
}

// The few files under /etc the toolchains need, and nothing else from /etc
// (no /etc/passwd, no machine configuration). /etc/alternatives holds the
// symlinks behind python3, java and others; java needs /etc/java-<n>-openjdk;
// dmd needs /etc/dmd.conf; ld.so.cache only makes library lookups faster.
function etcArgs() {
  const args = ['--ro-bind-try', '/etc/alternatives', '/etc/alternatives', '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache', '--ro-bind-try', '/etc/dmd.conf', '/etc/dmd.conf'];
  let entries = [];
  try {
    entries = fs.readdirSync('/etc');
  } catch {
    // No /etc to look in.
  }
  for (const name of entries.filter((n) => /^java-\d+-openjdk$/.test(n))) {
    args.push('--ro-bind', `/etc/${name}`, `/etc/${name}`);
  }
  return args;
}

// Install folders of toolchains outside /usr, bound read-only at the same
// path so PATH finds them inside too. For /opt/node22/bin/node that's
// /opt/node22. Never a top-level folder like / or /opt itself.
function toolchainArgs() {
  const roots = new Set();
  for (const command of TOOLCHAIN_COMMANDS) {
    const found = findOnPath(command);
    if (!found) continue;
    for (const file of new Set([found, fs.realpathSync(found)])) {
      if (file.startsWith('/usr/')) continue;
      const root = path.dirname(path.dirname(file));
      if (root.split('/').filter(Boolean).length >= 2) roots.add(root);
    }
  }
  return [...roots].sort().flatMap((root) => ['--ro-bind', root, root]);
}

// Computed once: the toolchains don't move while the server runs.
const BASE_ARGS = Object.freeze([
  // New user, PID, network, IPC, UTS (hostname) and cgroup namespaces. The
  // explicit --unshare-user makes a missing user namespace an error rather
  // than silently skipped, and is required by --disable-userns, which stops
  // the submission creating namespaces of its own.
  '--unshare-all', '--unshare-user', '--disable-userns',
  // If the judge (bwrap's parent) dies, everything in the sandbox dies too.
  '--die-with-parent',
  // A new session: no way to type into a terminal outside (CVE-2017-5226).
  '--new-session',
  // Only SUBMISSION_ENV inside.
  '--clearenv', ...Object.entries(SUBMISSION_ENV).flatMap(([name, value]) => ['--setenv', name, value]),
  // Programs and libraries, read-only.
  '--ro-bind', '/usr', '/usr', ...systemDirArgs(), ...etcArgs(), ...toolchainArgs(),
  // The sandbox's own /proc (its PID namespace only, not the server's
  // processes) and a minimal /dev (null, zero, random, urandom, tty...).
  '--proc', '/proc', '--dev', '/dev',
  // A private, size-capped /tmp. --size applies to the --tmpfs after it.
  '--size', String(TMPFS_BYTES), '--tmpfs', '/tmp',
  // No capabilities, even inside the sandbox's own user namespace.
  '--cap-drop', 'ALL',
]);

// Returns { command, args } that runs `command args` inside the sandbox.
// `binds` adds host folders or files: [{ hostPath, sandboxPath, writable }].
// The caller passes { env: SUBMISSION_ENV } to spawn (see SUBMISSION_ENV).
function sandboxedCommand(command, args, { binds = [], cwd = '/' } = {}) {
  const bindArgs = binds.flatMap(({ hostPath, sandboxPath, writable }) => [writable ? '--bind' : '--ro-bind', hostPath, sandboxPath || hostPath]);
  const bwrapArgs = [...BASE_ARGS, ...bindArgs, '--chdir', cwd, '--', command, ...args];
  if (!RUNNING_AS_ROOT) return { command: 'bwrap', args: bwrapArgs };
  // setpriv (util-linux) changes user, then execs bwrap.
  return {
    command: 'setpriv',
    args: [`--reuid=${NOBODY_UID}`, `--regid=${NOBODY_UID}`, '--clear-groups', 'bwrap', ...bwrapArgs],
  };
}

// sandboxedCommand plus RUN_LIMITS, for running a submission.
function sandboxedRun(command, args, options) {
  const limits = [`--nproc=${RUN_LIMITS.nproc}`, `--fsize=${RUN_LIMITS.fsizeBytes}`, `--cpu=${RUN_LIMITS.cpuSoftSeconds}:${RUN_LIMITS.cpuHardSeconds}`, '--core=0'];
  return sandboxedCommand('prlimit', [...limits, '--', command, ...args], options);
}

// Makes a submission's work folder usable from inside the sandbox. When the
// server is root, sandboxes run as nobody, so the folder (made 0700 by
// mkdtemp) must let others through. 0711 lets them open files whose names
// they know, without listing the folder.
function prepareWorkDir(dir) {
  if (RUNNING_AS_ROOT) fs.chmodSync(dir, 0o711);
}

// Run inside the sandbox once at startup. It fails, printing why, if the
// sandbox can see the repository (so the filesystem isn't isolated), has a
// network interface besides loopback, or if bwrap's own process 1 carries
// anything but SUBMISSION_ENV; or if a toolchain found outside can't be
// found inside. "$1" is the repo folder; the rest are toolchain commands.
const SELF_TEST_SCRIPT = `
repo=$1; shift
if [ -e "$repo" ]; then echo "the sandbox can see $repo"; exit 1; fi
if [ "$(grep -c : /proc/net/dev)" != 1 ]; then echo "the sandbox has a network interface besides loopback"; exit 1; fi
extra=$(tr '\\0' '\\n' < /proc/1/environ | grep -v -e '^PATH=' -e '^LANG=')
if [ -n "$extra" ]; then echo "bwrap's process 1 has environment variables besides PATH and LANG"; exit 1; fi
for c in "$@"; do
  command -v "$c" >/dev/null || { echo "$c is installed but not visible inside the sandbox"; exit 1; }
done
echo ok
`;

function runSelfTest() {
  const bwrap = findOnPath('bwrap');
  if (!bwrap) return { ok: false, reason: 'bubblewrap is not installed: no executable bwrap on PATH' };

  const version = spawnSync(bwrap, ['--version'], { env: SUBMISSION_ENV, encoding: 'utf8', timeout: 5000 });
  const versionText = (version.stdout || '').trim() || 'bubblewrap, version unknown';

  const toolchains = TOOLCHAIN_COMMANDS.filter((c) => findOnPath(c));
  const { command, args } = sandboxedCommand('/bin/sh', ['-c', SELF_TEST_SCRIPT, 'sh', REPO_DIR, ...toolchains]);
  const result = spawnSync(command, args, { env: SUBMISSION_ENV, encoding: 'utf8', timeout: 10000 });
  if (result.error) return { ok: false, version: versionText, reason: `couldn't run bwrap: ${result.error.message}` };
  if (result.status !== 0 || result.stdout.trim() !== 'ok') {
    // bwrap's own errors (e.g. AppArmor's user-namespace restriction on
    // Ubuntu 24.04) are on stderr; the script's are on stdout.
    const why = `${result.stderr || ''}\n${result.stdout || ''}`.trim().split('\n').filter(Boolean).slice(-1)[0];
    return { ok: false, version: versionText, reason: `self-test failed: ${why || `exit status ${result.status}`}` };
  }
  return { ok: true, version: versionText };
}

const status = Object.freeze({ ...runSelfTest(), unsandboxedOverride: UNSANDBOXED_OVERRIDE });

// One line for the server's startup log.
function describeSandbox() {
  if (status.ok) {
    const who = RUNNING_AS_ROOT ? ', as nobody because the server is root' : '';
    return `${status.version} works (self-test passed); submissions run inside it${who}. Compilers don't yet (sandboxing step 4)`;
  }
  if (status.unsandboxedOverride) {
    return `UNAVAILABLE (${status.reason}), but MAXRECALL_UNSANDBOXED=1, so judging is allowed WITHOUT a sandbox`;
  }
  return `UNAVAILABLE (${status.reason}), so Run and Submit are refused. Fix it (docs/plans/sandboxing.md), or set MAXRECALL_UNSANDBOXED=1 to judge without a sandbox`;
}

class SandboxUnavailableError extends Error {
  constructor() {
    super(`Judging is turned off on this server because its sandbox isn't working: ${status.reason}. The server's startup log says more.`);
    this.code = 'SANDBOX_UNAVAILABLE';
  }
}

// Throws SandboxUnavailableError unless judging is allowed: the sandbox
// works, or MAXRECALL_UNSANDBOXED=1 says to judge without one.
function assertJudgingAllowed() {
  if (!status.ok && !status.unsandboxedOverride) throw new SandboxUnavailableError();
}

module.exports = { SUBMISSION_ENV, RUN_LIMITS, CPU_LIMIT_EXIT_CODE, sandboxedCommand, sandboxedRun, prepareWorkDir, sandboxStatus: status, describeSandbox, assertJudgingAllowed };

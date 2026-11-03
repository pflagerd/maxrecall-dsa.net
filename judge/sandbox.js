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
const os = require('os');
const path = require('path');
const cgroups = require('./cgroups');

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
const TOOLCHAIN_COMMANDS = ['node', 'python3', 'g++', 'javac', 'java', 'ldc2', 'dmd'];

const REPO_DIR = path.join(__dirname, '..');

// The judge's prebuilt helpers (judge_json.o, the JudgeJson classes) are
// copied here at startup (judge/runner.js, stageHelpers) and bound into
// every sandbox read-only at HELPER_SANDBOX_PATH, rather than bound from
// the checkout. The checkout may be somewhere the sandbox's user can't
// enter: on the VPS on 2026-11-02 it was /root/maxrecall-dsa.net, run by
// root, so sandboxes ran as nobody and every run failed with "Can't find
// source path /root/maxrecall-dsa.net/judge/java: Permission denied".
// mkdtemp makes it owner-only, so when root (sandboxes as nobody) it's
// opened up for reading; the helpers aren't secret, they're in the repo.
// Removed when the server exits normally. Node doesn't run 'exit' handlers
// when it's killed by a signal, which is how systemd (SIGTERM), Ctrl-C
// (SIGINT) and nodemon stop it, so the folder's name carries the server's
// process ID, and each start removes folders whose process is gone
// (removeStaleHelperDirs). Found 2026-11-02: folders left in /tmp by
// stopped servers.
const HELPER_DIR_PREFIX = 'judge-helpers-';

/**
 * Removes helper folders left by servers that are no longer running: named
 * judge-helpers-<pid>-..., owned by this user, and no process <pid>.
 * process.kill(pid, 0) sends no signal; it fails with ESRCH if there's no
 * such process (EPERM means there is one, owned by someone else). Folders
 * from before this naming (no pid) are left alone.
 *
 * @returns {void}
 */
function removeStaleHelperDirs() {
  const myUid = typeof process.getuid === 'function' ? process.getuid() : null;
  /** @type {string[]} */
  let entries = [];
  try {
    entries = fs.readdirSync(os.tmpdir());
  } catch {
    return;
  }
  for (const name of entries) {
    const match = name.match(/^judge-helpers-(\d+)-/);
    if (!match) continue;
    const dir = path.join(os.tmpdir(), name);
    try {
      if (myUid !== null && fs.statSync(dir).uid !== myUid) continue;
      process.kill(Number(match[1]), 0);
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ESRCH') fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
removeStaleHelperDirs();

const HELPER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), `${HELPER_DIR_PREFIX}${process.pid}-`));
const HELPER_SANDBOX_PATH = '/judge';
if (RUNNING_AS_ROOT) fs.chmodSync(HELPER_DIR, 0o755);
process.on('exit', () => fs.rmSync(HELPER_DIR, { recursive: true, force: true }));

/**
 * Where a command is on SUBMISSION_ENV's PATH, as the sandbox will find it.
 *
 * @param {string} command - e.g. "g++".
 * @returns {string | null} The first executable file of that name in a PATH
 *   folder, or null if there's none.
 */
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
/** @returns {string[]} bwrap arguments: --symlink or --ro-bind for each. */
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
// ldc2 needs /etc/ldc2.conf and dmd /etc/dmd.conf; ld.so.cache only makes
// library lookups faster.
/** @returns {string[]} bwrap arguments binding those files read-only. */
function etcArgs() {
  const args = ['--ro-bind-try', '/etc/alternatives', '/etc/alternatives', '--ro-bind-try', '/etc/ld.so.cache', '/etc/ld.so.cache', '--ro-bind-try', '/etc/ldc2.conf', '/etc/ldc2.conf', '--ro-bind-try', '/etc/dmd.conf', '/etc/dmd.conf'];
  /** @type {string[]} */
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
/**
 * @returns {Map<string, Set<string>>} Each install folder, with the
 *   TOOLCHAIN_COMMANDS found in it.
 */
function toolchainRoots() {
  /** @type {Map<string, Set<string>>} */
  const roots = new Map();
  for (const command of TOOLCHAIN_COMMANDS) {
    const found = findOnPath(command);
    if (!found) continue;
    for (const file of new Set([found, fs.realpathSync(found)])) {
      if (file.startsWith('/usr/')) continue;
      const root = path.dirname(path.dirname(file));
      if (root.split('/').filter(Boolean).length < 2) continue;
      if (!roots.has(root)) roots.set(root, new Set());
      /** @type {Set<string>} */ (roots.get(root)).add(command); // set just above if missing
    }
  }
  return roots;
}

// Whether the user sandboxes run as can open folder `dir`: search (x) on
// every folder on the way, and read and search (r-x) on dir itself. When
// the server is root that user is nobody, which owns nothing and is in no
// groups (setpriv --clear-groups), so only the "others" permission bits
// count. They're read from the mode; ACLs aren't considered. Otherwise it's
// the server's own user, which fs.accessSync checks directly.
// Found on the VPS on 2026-11-02: root ran the server with DMD and Node in
// /root/.local/share, which nobody can't enter (/root is private), and
// bwrap failed with "Can't find source path …: Permission denied".
/**
 * @param {string} dir - An absolute folder path.
 * @returns {boolean} Whether the sandbox's user can open it.
 */
function sandboxUserCanReach(dir) {
  if (!RUNNING_AS_ROOT) {
    try {
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const parts = dir.split('/').filter(Boolean);
  let current = '/';
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let mode;
    try {
      mode = fs.statSync(current).mode;
    } catch {
      return false;
    }
    const needed = i === parts.length - 1 ? 0o005 : 0o001;
    if ((mode & needed) !== needed) return false;
  }
  return true;
}

// Toolchain install folders, split into those the sandbox can use (bound in
// read-only, at the same path) and those it can't reach. The self-test
// fails on the latter with a reason that names them (runSelfTest).
const TOOLCHAIN_ROOTS = toolchainRoots();
const REACHABLE_TOOLCHAIN_ROOTS = [...TOOLCHAIN_ROOTS.keys()].filter(sandboxUserCanReach).sort();
const UNREACHABLE_TOOLCHAIN_ROOTS = [...TOOLCHAIN_ROOTS.keys()].filter((root) => !sandboxUserCanReach(root)).sort();

/** @returns {string[]} bwrap arguments binding the reachable toolchain folders read-only. */
function toolchainArgs() {
  return REACHABLE_TOOLCHAIN_ROOTS.flatMap((root) => ['--ro-bind', root, root]);
}

// --- Seccomp (sandboxing step 6) -------------------------------------------
// System calls every sandbox is refused, with EPERM ("Operation not
// permitted"): a denylist (decision D4). The filter doesn't replace any wall;
// it shrinks how much of the host kernel a submission can reach, since most
// kernel escapes go through rarely used calls like these. Grouped by why.
// Left out on purpose, although Docker restricts them: adjtimex (also used
// just to read the clock) and the NUMA calls (mbind, get_mempolicy, ...),
// which language runtimes may make.
const SECCOMP_DENYLIST = Object.freeze([
  // Kernel interfaces with a long history of privilege-escalation bugs,
  // which a judged program never needs.
  'bpf', 'perf_event_open', 'userfaultfd', 'io_uring_setup', 'io_uring_enter', 'io_uring_register',
  'keyctl', 'add_key', 'request_key',
  // Looking into or controlling other processes.
  'ptrace', 'process_vm_readv', 'process_vm_writev', 'kcmp', 'pidfd_getfd',
  // Namespaces and mounts. --disable-userns and the missing capabilities
  // refuse these already; this is a second wall.
  'unshare', 'setns', 'mount', 'umount2', 'pivot_root', 'chroot',
  'move_mount', 'open_tree', 'fsopen', 'fsconfig', 'fsmount', 'fspick', 'mount_setattr',
  // Opening files by handle instead of by path (a known container escape).
  'name_to_handle_at', 'open_by_handle_at',
  // Machine-wide: kernel modules, kexec, reboot, swap, the clock, the host
  // name, process accounting, quotas, the kernel log, I/O ports.
  'init_module', 'finit_module', 'delete_module', 'kexec_load', 'kexec_file_load', 'reboot',
  'swapon', 'swapoff', 'settimeofday', 'clock_settime', 'clock_adjtime', 'sethostname', 'setdomainname',
  'acct', 'quotactl', 'syslog', 'iopl', 'ioperm', 'lookup_dcookie', 'vhangup',
]);

// The filter, built at startup into the helper folder by compiling
// judge/seccomp/gen.cpp (with libseccomp, from libseccomp-dev) and running
// it with the denylist. Besides the denylist, gen.cpp makes clone3 fail
// with ENOSYS (so the C library falls back to clone) and refuses clone with
// namespace flags. null when built; otherwise why not, which fails the
// self-test, so the server refuses to judge rather than run unfiltered.
const SECCOMP_FILTER = path.join(HELPER_DIR, 'seccomp.bpf');
/** @returns {string | null} null when built; otherwise why not. */
function buildSeccompFilter() {
  const gxx = findOnPath('g++');
  if (!gxx) return "g++ isn't installed, so the seccomp filter can't be built";
  const generator = path.join(HELPER_DIR, 'seccomp-gen');
  // The compiler's first error line says what's wrong ("fatal error:
  // seccomp.h: No such file or directory"); its last is often just
  // "compilation terminated.".
  const errorLine = (/** @type {string | undefined} */ text) => {
    const lines = (text || '').trim().split('\n').filter(Boolean);
    return lines.find((line) => /error/i.test(line)) || lines.slice(-1)[0] || '';
  };
  const compile = spawnSync(gxx, ['-O2', '-o', generator, path.join(__dirname, 'seccomp', 'gen.cpp'), '-lseccomp'], { env: SUBMISSION_ENV, encoding: 'utf8', timeout: 60000 });
  if (compile.status !== 0) {
    return `couldn't build the seccomp filter generator (is libseccomp-dev installed? scripts/sandbox-deps.sh installs it): ${errorLine(compile.stderr) || compile.error || `exit status ${compile.status}`}`;
  }
  const run = spawnSync(generator, [SECCOMP_FILTER, ...SECCOMP_DENYLIST], { env: SUBMISSION_ENV, encoding: 'utf8', timeout: 10000 });
  if (run.status !== 0) return `couldn't write the seccomp filter: ${errorLine(run.stderr) || `exit status ${run.status}`}`;
  return null;
}
const SECCOMP_BUILD_ERROR = buildSeccompFilter();

// Computed once: the toolchains don't move while the server runs. The cast:
// SUBMISSION_ENV.PATH is undefined if the server itself has no PATH, and
// then the --setenv below would pass undefined, which spawn() refuses. A
// server always has a PATH in practice, so this assumes one.
const BASE_ARGS = Object.freeze(/** @type {string[]} */ ([
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
  // The seccomp filter, read from file descriptor 3, which spawnSandboxed
  // opens. bwrap installs it just before running the command, so it holds
  // for the command and everything it starts, but not for bwrap's setup.
  '--seccomp', '3',
]));

/**
 * A host folder or file to make visible inside the sandbox.
 *
 * @typedef {object} Bind
 * @property {string} hostPath - Where it is outside.
 * @property {string} [sandboxPath] - Where it appears inside; hostPath if not given.
 * @property {boolean} [writable] - true for --bind, otherwise --ro-bind (read-only).
 */

/**
 * A command line, as spawn() takes it.
 *
 * @typedef {{ command: string, args: string[] }} CommandLine
 */

/**
 * The command line that runs `command args` inside the sandbox. The caller
 * passes { env: SUBMISSION_ENV } to spawn (see SUBMISSION_ENV).
 *
 * @param {string} command - The program to run inside.
 * @param {string[]} args - Its arguments.
 * @param {{ binds?: Bind[], cwd?: string }} [options] - binds: host folders
 *   or files to add (default none); cwd: the folder to start in, inside
 *   (default "/").
 * @returns {CommandLine} bwrap (or setpriv, then bwrap, when the server is
 *   root) with its arguments.
 */
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

// Starts a command from sandboxedCommand or sandboxedRun, with the seccomp
// filter open as file descriptor 3 (in Node, stdio[3] becomes the child's
// fd 3). It's opened for each start because bwrap reads it to the end, and
// the parent's copy is closed straight after: the child has its own.
// spawnFn is child_process.spawn or spawnSync. Two signatures, one for each:
/**
 * @overload
 * @param {typeof import('child_process').spawnSync} spawnFn - spawnSync: runs it to the end.
 * @param {string} command - From sandboxedCommand or sandboxedRun.
 * @param {string[]} args - Likewise.
 * @param {import('child_process').SpawnSyncOptionsWithStringEncoding} options -
 *   With an encoding, so its output is text.
 * @returns {import('child_process').SpawnSyncReturns<string>} How it ended, and its output.
 */
/**
 * @overload
 * @param {typeof import('child_process').spawn} spawnFn - spawn: starts it.
 * @param {string} command - From sandboxedCommand or sandboxedRun.
 * @param {string[]} args - Likewise.
 * @param {import('child_process').SpawnOptions} [options] - As spawn takes them.
 * @returns {import('child_process').ChildProcess} The running process.
 */
/**
 * @param {Function} spawnFn - spawn or spawnSync.
 * @param {string} command - From sandboxedCommand or sandboxedRun.
 * @param {string[]} args - Likewise.
 * @param {{ stdio?: unknown }} [options] - As spawnFn takes them; stdio[3]
 *   is set to the filter.
 * @returns {unknown} What spawnFn returns.
 */
function spawnSandboxed(spawnFn, command, args, options = {}) {
  const fd = fs.openSync(SECCOMP_FILTER, 'r');
  try {
    /** @type {unknown[]} */
    const stdio = Array.isArray(options.stdio) ? [...options.stdio] : ['pipe', 'pipe', 'pipe'];
    stdio[3] = fd;
    return spawnFn(command, args, { ...options, stdio });
  } finally {
    fs.closeSync(fd);
  }
}

// sandboxedCommand plus RUN_LIMITS, for running a submission or compiling
// it. addressSpaceBytes adds an RLIMIT_AS cap (prlimit --as), which children
// inherit: used for compilers, whose memory is otherwise unlimited.
/**
 * @param {string} command - The program to run inside.
 * @param {string[]} args - Its arguments.
 * @param {{ addressSpaceBytes?: number, binds?: Bind[], cwd?: string }} [options] -
 *   addressSpaceBytes: the RLIMIT_AS cap, if any; the rest as for
 *   sandboxedCommand.
 * @returns {CommandLine} The sandboxed command line, with prlimit inside.
 */
function sandboxedRun(command, args, { addressSpaceBytes, ...options } = {}) {
  const limits = [`--nproc=${RUN_LIMITS.nproc}`, `--fsize=${RUN_LIMITS.fsizeBytes}`, `--cpu=${RUN_LIMITS.cpuSoftSeconds}:${RUN_LIMITS.cpuHardSeconds}`, '--core=0'];
  if (addressSpaceBytes) limits.push(`--as=${addressSpaceBytes}`);
  return sandboxedCommand('prlimit', [...limits, '--', command, ...args], options);
}

// Makes a submission's work folder usable from inside the sandbox. When the
// server is root, sandboxes run as nobody, and the compiler (writing the
// binary or classes) must be able to write to it, so it's handed to nobody.
// root, the server, can still read and delete it. Otherwise it stays as
// mkdtemp made it: the server's user's, 0700.
/**
 * @param {string} dir - The work folder, made by mkdtemp.
 * @returns {void}
 */
function prepareWorkDir(dir) {
  if (RUNNING_AS_ROOT) fs.chownSync(dir, NOBODY_UID, NOBODY_UID);
}

// Run inside the sandbox once at startup. It fails, printing why, if the
// sandbox can see the repository (so the filesystem isn't isolated), has a
// network interface besides loopback, or if bwrap's own process 1 carries
// anything but SUBMISSION_ENV; if it isn't under a seccomp filter (mode 2
// in /proc/self/status); or if a toolchain found outside can't be found
// inside. "$1" is the repo folder; the rest are toolchain commands.
const SELF_TEST_SCRIPT = `
repo=$1; shift
mode=$(awk '/^Seccomp:/ { print $2 }' /proc/self/status)
if [ "$mode" != 2 ]; then echo "the sandbox isn't under a seccomp filter (Seccomp: $mode)"; exit 1; fi
if [ -e "$repo" ]; then echo "the sandbox can see $repo"; exit 1; fi
if [ "$(grep -c : /proc/net/dev)" != 1 ]; then echo "the sandbox has a network interface besides loopback"; exit 1; fi
extra=$(tr '\\0' '\\n' < /proc/1/environ | grep -v -e '^PATH=' -e '^LANG=')
if [ -n "$extra" ]; then echo "bwrap's process 1 has environment variables besides PATH and LANG"; exit 1; fi
for c in "$@"; do
  command -v "$c" >/dev/null || { echo "$c is installed but not visible inside the sandbox"; exit 1; }
done
echo ok
`;

/**
 * What the self-test found.
 *
 * @typedef {object} SelfTestResult
 * @property {boolean} ok - Whether the sandbox works.
 * @property {string} [version] - bwrap's version, once it's found.
 * @property {string} [reason] - When not ok: why not.
 */

/**
 * Checks once, at startup, that the sandbox really works here.
 *
 * @returns {SelfTestResult} ok, or why not.
 */
function runSelfTest() {
  const bwrap = findOnPath('bwrap');
  if (!bwrap) return { ok: false, reason: 'bubblewrap is not installed: no executable bwrap on PATH' };

  const version = spawnSync(bwrap, ['--version'], { env: SUBMISSION_ENV, encoding: 'utf8', timeout: 5000 });
  const versionText = (version.stdout || '').trim() || 'bubblewrap, version unknown';

  if (SECCOMP_BUILD_ERROR) return { ok: false, version: versionText, reason: SECCOMP_BUILD_ERROR };

  if (UNREACHABLE_TOOLCHAIN_ROOTS.length) {
    const who = RUNNING_AS_ROOT ? 'nobody (sandboxes run as nobody when the server is root)' : "the server's user";
    // Every unreachable root is one of TOOLCHAIN_ROOTS' keys.
    const which = UNREACHABLE_TOOLCHAIN_ROOTS.map((root) => `${[.../** @type {Set<string>} */ (TOOLCHAIN_ROOTS.get(root))].join(', ')} in ${root}`).join('; ');
    return {
      ok: false,
      version: versionText,
      reason: `toolchains the sandbox can't reach: ${which}. ${who} can't read that folder. Install them system-wide (world-readable, e.g. under /usr/local or /opt), or take them off PATH`,
    };
  }

  const toolchains = TOOLCHAIN_COMMANDS.filter((c) => findOnPath(c));
  // cgroup limits (sandboxing step 7), when the unit requires them: the
  // self-test runs inside a test cgroup like a submission's, and its
  // memory.peak afterwards shows it really was counted there.
  if (cgroups.cgroupStatus.required && !cgroups.cgroupStatus.ok) {
    return { ok: false, version: versionText, reason: `cgroup limits are required (MAXRECALL_REQUIRE_CGROUPS=1) but unavailable: ${cgroups.cgroupStatus.reason}` };
  }
  /** @type {import('./cgroups').SubmissionCgroup | null} */
  let testCgroup = null;
  try {
    testCgroup = cgroups.forSubmission();
  } catch (err) {
    return { ok: false, version: versionText, reason: `couldn't create a submission cgroup: ${/** @type {Error} */ (err).message}` };
  }

  // Binds the helper folder the way every run does, so a folder the
  // sandbox's user can't reach fails here, at startup, not on every Run.
  let proc = sandboxedCommand('/bin/sh', ['-c', SELF_TEST_SCRIPT, 'sh', REPO_DIR, ...toolchains], {
    binds: [{ hostPath: HELPER_DIR, sandboxPath: HELPER_SANDBOX_PATH }],
  });
  if (testCgroup) proc = cgroups.wrap(proc, testCgroup, SUBMISSION_ENV);
  const { command, args } = proc;
  const result = spawnSandboxed(spawnSync, command, args, { env: SUBMISSION_ENV, encoding: 'utf8', timeout: 10000 });
  let cgroupProblem = null;
  if (testCgroup) {
    try {
      const peak = Number(fs.readFileSync(path.join(testCgroup.dir, 'memory.peak'), 'utf8'));
      if (!(peak > 0)) cgroupProblem = `the self-test's processes weren't counted in its cgroup (memory.peak ${peak})`;
    } catch {
      // memory.peak needs Linux 5.19; without it, the placement isn't checked.
    }
    testCgroup.destroy();
  }
  if (result.error) return { ok: false, version: versionText, reason: `couldn't run bwrap: ${result.error.message}` };
  if (result.status !== 0 || result.stdout.trim() !== 'ok') {
    // bwrap's own errors (e.g. AppArmor's user-namespace restriction on
    // Ubuntu 24.04) are on stderr; the script's are on stdout.
    const why = `${result.stderr || ''}\n${result.stdout || ''}`.trim().split('\n').filter(Boolean).slice(-1)[0];
    return { ok: false, version: versionText, reason: `self-test failed: ${why || `exit status ${result.status}`}` };
  }
  if (cgroupProblem) return { ok: false, version: versionText, reason: cgroupProblem };
  return { ok: true, version: versionText };
}

const status = Object.freeze({ ...runSelfTest(), unsandboxedOverride: UNSANDBOXED_OVERRIDE });

/**
 * One line for the server's startup log.
 *
 * @returns {string} Whether the sandbox works, and what that means for judging.
 */
function describeSandbox() {
  if (status.ok) {
    const who = RUNNING_AS_ROOT ? ', as nobody because the server is root' : '';
    const limits = cgroups.cgroupStatus.ok
      ? `; cgroup limits per submission: ${cgroups.MEMORY_LIMIT_MB} MB, no swap, ${cgroups.CGROUP_LIMITS['pids.max']} tasks, 1 CPU`
      : '; no cgroup limits (MAXRECALL_REQUIRE_CGROUPS isn\'t set)';
    return `${status.version} works (self-test passed); compilers and submissions run inside it${who}${limits}`;
  }
  if (status.unsandboxedOverride) {
    return `UNAVAILABLE (${status.reason}), but MAXRECALL_UNSANDBOXED=1, so judging is allowed WITHOUT a sandbox`;
  }
  return `UNAVAILABLE (${status.reason}), so Run and Submit are refused. Fix it (docs/plans/sandboxing.md), or set MAXRECALL_UNSANDBOXED=1 to judge without a sandbox`;
}

/**
 * Thrown by assertJudgingAllowed(). server.js answers it with 503.
 */
class SandboxUnavailableError extends Error {
  /** Says why, from the self-test. */
  constructor() {
    super(`Judging is turned off on this server because its sandbox isn't working: ${status.reason}. The server's startup log says more.`);
    this.code = 'SANDBOX_UNAVAILABLE';
  }
}

/**
 * Throws SandboxUnavailableError unless judging is allowed: the sandbox
 * works, or MAXRECALL_UNSANDBOXED=1 says to judge without one.
 *
 * @returns {void}
 * @throws {SandboxUnavailableError} If judging isn't allowed.
 */
function assertJudgingAllowed() {
  if (!status.ok && !status.unsandboxedOverride) throw new SandboxUnavailableError();
}

module.exports = { SUBMISSION_ENV, RUN_LIMITS, CPU_LIMIT_EXIT_CODE, HELPER_DIR, HELPER_SANDBOX_PATH, SECCOMP_DENYLIST, findOnPath, sandboxedCommand, sandboxedRun, spawnSandboxed, prepareWorkDir, sandboxStatus: status, describeSandbox, assertJudgingAllowed };

// Per-submission cgroup limits: sandboxing step 7 (docs/plans/sandboxing.md).
//
// The limits in judge/sandbox.js (prlimit) are per process. A cgroup (Linux
// control group, version 2) caps a whole group of processes together: here,
// everything one submission starts, compile and runs alike. Each submission
// gets its own cgroup with the limits in CGROUP_LIMITS; afterwards it's
// killed (cgroup.kill) and removed.
//
// Only used when MAXRECALL_REQUIRE_CGROUPS=1, which the VPS's systemd unit
// sets together with Delegate=yes and DelegateSubgroup=server. With those,
// systemd hands the unit's cgroup over to the service and starts the server
// in a "server" subgroup of it, so the server may create sibling
// "judge-XXXXXX" cgroups next to its own (systemd.resource-control(5),
// Delegate=). It never touches cgroups otherwise: on a desktop, the
// server's cgroup is inside the session tree that systemd's user manager
// owns. If required but not possible, the sandbox self-test fails and the
// server refuses to judge.
//
// The kernel's interface: https://docs.kernel.org/admin-guide/cgroup-v2.html

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CGROUP_FS = '/sys/fs/cgroup';
const REQUIRED = process.env.MAXRECALL_REQUIRE_CGROUPS === '1';

// For each submission, compile and runs together:
// - memory.max: 768 MiB of memory, counting page cache and the sandbox's
//   tmpfs /tmp. Past it, the kernel's OOM killer ends a process in the
//   cgroup.
// - memory.swap.max: no swap, so memory can't be pushed out instead.
// - pids.max: 128 processes and threads together.
// - cpu.max: "quota period" in microseconds: 100000 of every 100000, one
//   CPU's worth, however many cores the machine has.
const CGROUP_LIMITS = Object.freeze({
  'memory.max': String(768 * 1024 * 1024),
  'memory.swap.max': '0',
  'pids.max': '128',
  'cpu.max': '100000 100000',
});
const CONTROLLERS = ['memory', 'pids', 'cpu'];
const MEMORY_LIMIT_MB = 768;
const MEMORY_LIMIT_MESSAGE = `Memory limit exceeded (${MEMORY_LIMIT_MB} MB for the whole submission, compiling and running together).`;
// At memory.max the kernel first reclaims memory and kills only if that
// fails, so a submission can also crawl at the limit until it runs out of
// time (first seen on the VPS on 2026-11-02, probe G12: 4 x 200 MB timed
// out instead of being killed). memory.events' "max" counter shows the
// limit was reached.
const MEMORY_LIMIT_SLOWED_MESSAGE = `Memory limit reached (${MEMORY_LIMIT_MB} MB for the whole submission, compiling and running together), which slowed it down until it ran out of time.`;

/**
 * The cgroup systemd delegated to the unit: the parent of the server's own
 * cgroup, which must be named "server" (DelegateSubgroup=server). Read from
 * /proc/self/cgroup, whose cgroup-v2 line is "0::/path".
 *
 * @returns {{ dir: string, error?: undefined } | { error: string, dir?: undefined }}
 *   The delegated cgroup's folder under /sys/fs/cgroup, or why there isn't
 *   one.
 */
function findDelegatedCgroup() {
  let self;
  try {
    self = fs.readFileSync('/proc/self/cgroup', 'utf8').split('\n').find((line) => line.startsWith('0::'));
  } catch (err) {
    return { error: `can't read /proc/self/cgroup: ${/** @type {Error} */ (err).message}` };
  }
  if (!self) return { error: 'no cgroup v2 entry in /proc/self/cgroup' };
  const own = self.slice(3);
  if (path.basename(own) !== 'server') {
    return { error: `the server runs in ${own}, not in a "server" subgroup (the unit needs Delegate=yes and DelegateSubgroup=server)` };
  }
  return { dir: path.join(CGROUP_FS, path.dirname(own)) };
}

// Prepares a delegated cgroup folder for submission cgroups: it must have
// the controllers, and they're switched on for its children
// (cgroup.subtree_control).
/**
 * @param {string} dir - The delegated cgroup's folder.
 * @returns {string | null} null if it worked, else why not.
 */
function prepareParent(dir) {
  try {
    const available = fs.readFileSync(path.join(dir, 'cgroup.controllers'), 'utf8').split(/\s+/);
    const missing = CONTROLLERS.filter((c) => !available.includes(c));
    if (missing.length) return `the ${missing.join(', ')} controller(s) aren't available in ${dir}`;
    fs.writeFileSync(path.join(dir, 'cgroup.subtree_control'), CONTROLLERS.map((c) => `+${c}`).join(' '));
    return null;
  } catch (err) {
    return `can't set up ${dir}: ${/** @type {Error} */ (err).message}`;
  }
}

/**
 * One submission's cgroup, as createSubmissionCgroup() returns it.
 *
 * @typedef {object} SubmissionCgroup
 * @property {string} dir - Its folder under /sys/fs/cgroup.
 * @property {string} procs - Its cgroup.procs, which wrap() writes the first
 *   process into.
 * @property {() => { limitHits: number, oomKills: number, peakMb: number }} memory -
 *   memory.events' counters and memory.peak, 0 where unreadable.
 * @property {() => number} oomKills - How many processes the kernel's OOM
 *   killer has ended in it.
 * @property {() => void} destroy - Kills anything left (cgroup.kill) and
 *   removes it.
 */

/**
 * Makes one submission's cgroup under parentDir and applies CGROUP_LIMITS.
 *
 * @param {string} parentDir - The delegated cgroup's folder, prepared by
 *   prepareParent().
 * @returns {SubmissionCgroup} The new cgroup.
 * @throws {Error} If the folder can't be made or a limit can't be written
 *   (the folder is removed again in the second case).
 */
function createSubmissionCgroup(parentDir) {
  const dir = path.join(parentDir, `judge-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(dir);
  try {
    for (const [file, value] of Object.entries(CGROUP_LIMITS)) fs.writeFileSync(path.join(dir, file), value);
  } catch (err) {
    fs.rmdirSync(dir);
    throw err;
  }
  return {
    dir,
    procs: path.join(dir, 'cgroup.procs'),
    // Counters from memory.events: limitHits ("max": times usage was about
    // to go over memory.max) and oomKills ("oom_kill": processes the OOM
    // killer ended); peakMb from memory.peak (Linux 5.19+). 0 if unreadable.
    /** @returns {{ limitHits: number, oomKills: number, peakMb: number }} */
    memory() {
      /**
       * One of the cgroup's files, as text.
       *
       * @param {string} file - Its name, e.g. "memory.events".
       * @returns {string} Its contents, or "" if it can't be read.
       */
      const read = (file) => {
        try {
          return fs.readFileSync(path.join(dir, file), 'utf8');
        } catch {
          return '';
        }
      };
      /** memory.events' counters, by name. @type {Record<string, number>} */
      const events = Object.fromEntries(read('memory.events').split('\n').filter(Boolean).map(
        /**
         * Turns one line of memory.events, e.g. "oom_kill 1", into a [name, count] entry.
         *
         * @param {string} line - The line.
         * @returns {[string, number]} The counter's name and value.
         */
        (line) => {
          const [name, value] = line.split(' ');
          return [name, Number(value)];
        },
      ));
      return {
        limitHits: events.max || 0,
        oomKills: events.oom_kill || 0,
        peakMb: Math.round(Number(read('memory.peak')) / (1024 * 1024)) || 0,
      };
    },
    /** @returns {number} Processes the OOM killer has ended in it. */
    oomKills() {
      return this.memory().oomKills;
    },
    /** @returns {void} */
    destroy() {
      try {
        fs.writeFileSync(path.join(dir, 'cgroup.kill'), '1');
      } catch {
        // Empty already, or a kernel without cgroup.kill (before 5.14).
      }
      // rmdir succeeds only once the cgroup is empty; killed processes take
      // a moment to go.
      for (let i = 0; i < 50; i++) {
        try {
          fs.rmdirSync(dir);
          return;
        } catch (err) {
          if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        }
      }
    },
  };
}

// Wraps a command ({ command, args }) so it starts inside cgroup cg: a
// shell, outside the sandbox, writes its own PID into the cgroup's
// cgroup.procs, then execs the command, which inherits the cgroup along
// with everything it starts. Open file descriptors (the seccomp filter on
// fd 3) pass through exec unchanged.
// The command is started through env -i with exactly `env` (the caller's
// SUBMISSION_ENV): the shell, dash, exports PWD to what it execs, and bwrap
// must start with nothing but SUBMISSION_ENV (its process 1 keeps its
// starting environment, readable from /proc/1/environ; the sandbox
// self-test checks). Found 2026-11-02 when the self-test failed with the
// wrapper in place.
/**
 * @template {{ command: string, args: string[] }} C
 * @param {C} spec - The command, and anything else the caller keeps with it
 *   (passed through unchanged). (C is a type parameter: the result keeps
 *   spec's other fields and their types.)
 * @param {SubmissionCgroup} cg - The cgroup to start it in.
 * @param {Readonly<Record<string, string | undefined>>} env - The whole
 *   environment to start the command with (SUBMISSION_ENV, whose PATH is
 *   undefined if the server's is).
 * @returns {Omit<C, 'command' | 'args'> & { command: string, args: string[] }}
 *   The same, but starting /bin/sh, which joins the cgroup and then execs
 *   the command.
 */
function wrap({ command, args, ...rest }, cg, env) {
  const assignments = Object.entries(env).map(([name, value]) => `${name}=${value}`);
  return {
    ...rest,
    command: '/bin/sh',
    args: ['-c', 'echo $$ > "$0" && exec "$@"', cg.procs, '/usr/bin/env', '-i', ...assignments, command, ...args],
  };
}

/**
 * Whether cgroups are in use, as found at startup.
 *
 * @typedef {object} CgroupStatus
 * @property {boolean} required - MAXRECALL_REQUIRE_CGROUPS=1.
 * @property {boolean} ok - Required and ready.
 * @property {string} [parent] - When ok: the delegated cgroup's folder.
 * @property {string} [reason] - When required but not ok: why not.
 */

/**
 * Set up once at startup when required.
 *
 * @returns {CgroupStatus} Not required: { required: false, ok: false }.
 */
function setUp() {
  if (!REQUIRED) return { required: false, ok: false };
  const found = findDelegatedCgroup();
  if (found.error) return { required: true, ok: false, reason: found.error };
  // No error means dir is set. (The truthiness test above can't narrow
  // the union for the checker: error could in principle be "".)
  const problem = prepareParent(/** @type {string} */ (found.dir));
  if (problem) return { required: true, ok: false, reason: problem };
  return { required: true, ok: true, parent: found.dir };
}
const status = Object.freeze(setUp());

/**
 * A cgroup for one submission, or null when cgroups aren't in use.
 *
 * @returns {SubmissionCgroup | null} The new cgroup, or null.
 * @throws {Error} If cgroups are in use but it can't be made.
 */
function forSubmission() {
  // ok means setUp() found a parent.
  return status.ok ? createSubmissionCgroup(/** @type {string} */ (status.parent)) : null;
}

module.exports = { CGROUP_LIMITS, MEMORY_LIMIT_MB, MEMORY_LIMIT_MESSAGE, MEMORY_LIMIT_SLOWED_MESSAGE, cgroupStatus: status, prepareParent, createSubmissionCgroup, forSubmission, wrap };

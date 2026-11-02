# Plan: sandbox submitted code

Status: **D1–D6 decided 2026-11-02 (owner: all as recommended). Steps 0–4
done 2026-11-02, plus a CPU-time limit and a total time budget for program
mode. Next: step 5 (VPS and Kubuntu on real AppArmor), then 6–8.** The VPS part of step 5 (AppArmor) moved
into step 2; see “Step 2 notes”.
Linked from `readme.html` → Decisions & plans.

## 1. The problem today

`spawnJudged` in `judge/runner.js` runs every submission as a plain child
process of the server (`child_process.spawn`). Compiling (`compileCpp`,
`compileJava`, `compileD`) works the same way. The only limits are a timeout
and a per-language memory cap (`ulimit -v`, `-Xmx`, `--max-old-space-size`).
`readme.html` §10 says so (“Submitted code is not sandboxed”).

On the VPS, `deploy/maxrecall-dsa.test.service` adds systemd **containment**:
the dedicated `maxrecall` user, `IPAddressDeny=any` + `IPAddressAllow=localhost`,
`ProtectSystem=strict`, `PrivateTmp=` and so on. That protects the *VPS from
the service*. It does not protect the *service from a submission*, because
every submission runs inside the service, as the service.

### What a submission can do today

I checked these in a cloud session on 2026-11-02. “Measured” means I ran it.

| # | What it can do | How sure | Why |
|---|---|---|---|
| G1 | Read the server's environment, including `MAXRECALL_PASSWORD` | From the code | `server.js` loads `.env` into `process.env` (`process.loadEnvFile`). The VPS also gets it from `EnvironmentFile=`. `spawn()` passes `process.env` on unless told otherwise ([Node docs, `options.env`](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)). Even with a cleared env, `/proc/<server pid>/environ` is readable by the same user ([proc_pid_environ(5)](https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html)). |
| G2 | Read every question file, **including hidden test cases' expected answers** | From the code | The submission's working directory is the repo, and `questions/*.json` is readable by the server's user. The comment above `buildJavascriptSource` (“the sandboxed process never sees expected outputs”) is wrong: nothing is sandboxed, so expected outputs are one `open()` away. |
| G3 | Read and write saved submissions and `auth/` (password hashes, session files) | From the code | Same user as the server. On the VPS, `ReadWritePaths=/srv/maxrecall/data` includes both. |
| G4 | Act as the owner on the VPS by connecting to `127.0.0.1:3001` | Stated in `docs/deploy-vps.md` | `IPAddressAllow=localhost` lets the service, and so submissions, reach loopback. |
| G5 | **Outlive the timeout** | **Measured** | The timeout `SIGKILL`s only the direct child. A Python submission that `fork()`ed and `setsid()`ed kept running after the judge gave up, and wrote a file 8 s later. The judge reported *Time Limit Exceeded* at **8042 ms**, not 5000, because the orphan held the stdout pipe open. If the orphan closes its stdout, it can run indefinitely. |
| G6 | Fork bomb, or fill `/tmp` and the disk | From the code | There's no process-count or disk limit. `ulimit -v` limits address space only. |
| G7 | Run code **at compile time** | Well known | `#include "/etc/passwd"` in C++ prints the file's first line in the compile error. The compilers run unsandboxed too. |
| G8 | Reach the internet (Kubuntu, cloud) | From the code | There's no network isolation outside the VPS. |
| G9 | Saturate the CPU with concurrent Runs | From the code | `handleExecution` has no limit on how many judgings run at once. A sandbox doesn't fix this; it needs a queue (step 8). |

**Corrections to earlier work** (the owner asked to be told):

- `docs/deploy-vps.md` §4 says the password file is read by root “so the
  app's user never needs to read it directly”. That's true, but the password
  then sits in the service's environment, and every submission inherits it
  (G1). It's low impact while the owner is the only user, and it gets fixed
  here.
- `readme.html` §6 says “Every run is killed with `SIGKILL` after 5 s”. That
  is true only of the direct child (G5). This commit adds the finding to
  Known gaps.
- The earlier session's finding that user, PID and network namespaces work
  in the cloud container is confirmed, and also works **unprivileged**: I ran
  it as `nobody` via `setpriv`. But **the cloud container has no AppArmor**,
  and the VPS (Ubuntu 24.04) does. So a sandbox that works in the cloud is
  *not* evidence that it works on the VPS (see §4).

## 2. What “sandboxed” should mean here

Threat model: **a learner who can sign in submits hostile code.** Today
that's only the owner. This plan is about getting ready for other people.

Each submission (compile and run) should get:

1. **Its own filesystem view.** It sees only the toolchain, read-only (`/usr`
   plus the few `/etc` files the toolchains need), the judge helpers
   (`judge_json.o`, `JudgeJson.class`), read-only, and its own work folder.
   No repo, no `questions/`, no `users/`, no `auth/`, no `/proc` of the
   host. That closes G2, G3 and G7.
2. **No network at all.** This includes host loopback. That closes G4 and G8.
3. **An empty environment** (plus `PATH`), both for bwrap itself and for
   what it runs. That closes G1. Step 0 showed that `--clearenv` alone
   isn't enough (§5).
4. **Its own PID namespace,** killed as a whole. When the judge kills the
   sandbox, every process in it dies. That closes G5.
5. **No privileges:** no capabilities, `no_new_privs`, no nested user
   namespaces, and a seccomp filter shrinking the kernel attack surface.
6. **Resource limits:** time, memory, process count, file size and tmpfs
   size. On the VPS, cgroup v2 limits as well. That closes G6.

The systemd containment on the VPS stays as an **outer layer**. That's
defence in depth: if the sandbox fails, the old containment still holds.

## 3. Options

Facts I checked on 2026-11-02 against Ubuntu 24.04 (noble) archives from
the cloud session (`apt-cache policy`):

- `bubblewrap` 0.9.0-1ubuntu0.3 is in **main**, which Canonical
  security-supports.
- `firejail` 0.9.72-2ubuntu3 is in **universe**, which is community-supported.
- `nsjail` is **not packaged**.

| Option | What it is | For | Against |
|---|---|---|---|
| **A. bubblewrap** (`bwrap`) | A small tool (72 KB binary) that sets up namespaces, bind mounts, a tmpfs, a clean env, a seccomp filter from a file descriptor, then execs. It's the sandbox under Flatpak. [README](https://github.com/containers/bubblewrap). | In main. Not setuid: it runs on unprivileged user namespaces only, because “setuid mode … has been removed” (README). **Measured working** in the cloud for python3, node, g++, javac/java, as `nobody`: about **7 ms** per sandbox (20 runs in 0.146 s). One command line, easy to read and teach. | “bubblewrap is not a complete, ready-made sandbox with a specific security policy… the level of protection… is entirely determined by the arguments passed” (README). We write the policy. **No cgroups** (separate step). Seccomp needs a *compiled* BPF program. Needs an AppArmor allowance on Ubuntu 24.04 (§4). |
| **B. nsjail** | Google's jail: “namespaces, cgroups, rlimits and seccomp-bpf syscall filters, leveraging the Kafel BPF language” ([README](https://github.com/google/nsjail)). Used for CTF hosting. | The most complete in one tool. Seccomp policies are readable text (Kafel), with no BPF compiler of our own. Has cgroup limits built in. | **Not in Ubuntu's archive.** You'd build it from source (protobuf, libnl) on three machines and track its security updates yourself. Unprivileged use still needs user namespaces, so the same AppArmor issue applies. A large config surface to learn. |
| **C. firejail** | A setuid-root sandbox aimed at desktop apps, with a profile per app. | Packaged. Many ready profiles. | **Setuid root by design**, so every bug in it is a potential local root. It has a history of exactly that, e.g. [CVE-2022-31214](https://security-tracker.debian.org/tracker/CVE-2022-31214) (root via its `--join` logic). In universe, so it's not Canonical security-supported. Its profiles target desktop programs, not judges. **Not recommended.** |
| **D. Hand-rolled:** `unshare` + `setpriv` + own seccomp | Do what bwrap does ourselves, with util-linux tools or a small C helper. | Teaches every moving part. No extra package. | We'd reimplement mount setup, `pivot_root` order, `/proc`, and reaping, which bwrap already does and has had audited. Easy to get subtly wrong. Good for **learning**, bad for production. |
| **E. systemd-run per submission** | Each submission becomes a transient unit with `DynamicUser=`, `PrivateNetwork=`, `SystemCallFilter=`, `MemoryMax=`, `TasksMax=`, `RuntimeMaxSec=`. | Declarative, and gives cgroup v2 and seccomp for free. The same vocabulary as our service file. | Needs systemd as PID 1. **The cloud container's PID 1 is `process_api`, not systemd** (checked). An unprivileged service that may start system units can start *any* unit, including as root (polkit `manage-units`), which is root-equivalent unless it goes through a fixed sudo wrapper. Not portable to the cloud. |
| **F. Containers** (Docker, rootless Podman) | A container per submission. | Images pin toolchains, so the same compiler runs everywhere, a real plus later. | Docker's socket is root-equivalent ([Docker docs](https://docs.docker.com/engine/security/#docker-daemon-attack-surface)). Rootless Podman needs subuid ranges and also user namespaces (the AppArmor issue again). Startup is much slower than bwrap. I'm guessing hundreds of ms, which I didn't measure. Heavy for this stage. |
| **G. isolate** | “A sandbox built to safely run untrusted executables, like programs submitted by competitors in a programming contest” ([README](https://github.com/ioi/isolate)). Used by contest systems. | Purpose-built for exactly this job. | Not in Ubuntu's archive. It's setuid root. Recent versions use a cgroup keeper service (`isolate-cg-keeper`, per its README). **It can't be tested in the cloud container, whose `/sys/fs/cgroup` is cgroup v1/hybrid** (`stat -fc %T` → `tmpfs`, confirmed). |
| **H. gVisor / microVMs** | A user-space kernel (`runsc`), or a VM per run. | The strongest isolation: submissions don't talk to the host kernel directly. | Big, not in the archive, slower. Worth revisiting **if strangers are ever allowed in** (see §7, residual risk). |

### Recommendation (D1): **A, bubblewrap**, plus rlimits now, plus seccomp and cgroups as later steps

Why:

- It's the only option that is in Ubuntu **main**, isn't setuid, runs in
  all three places (measured in the cloud, the VPS after §4, and Kubuntu, to
  be checked), and starts fast enough to run once per test case in program
  mode.
- It does exactly one job, and its whole policy is one argument list we can
  read line by line. That fits CLAUDE.md's “teach while working”.
- What it lacks (cgroups, a seccomp compiler) we can add in separate
  checkable steps, without changing the core.

The runner-up is **nsjail**, if the owner prefers one tool doing everything
and is willing to build and update it by hand.

## 4. The Ubuntu 24.04 AppArmor catch (the VPS)

Ubuntu 24.04's `apparmor` package
(`4.0.1really4.0.1-0ubuntu0.24.04.9`, which I unpacked and read) ships
`/usr/lib/sysctl.d/10-apparmor.conf`:

```
kernel.apparmor_restrict_unprivileged_userns = 1
```

With that on, “all other applications (whether confined by AppArmor or not)
will be denied the use of unprivileged user namespaces”, unless their
profile has the `userns` permission (that file's own comment). In practice,
a process that creates one is moved into the `unprivileged_userns` profile,
which begins `audit deny capability,` (from `/etc/apparmor.d/unprivileged_userns`
in the same package). bwrap needs capabilities *inside* its new namespace to
mount things, so **I expect bwrap to fail on the VPS as is**. This is a
hypothesis from those files, not tested: the cloud has no AppArmor. Ubuntu's
overview: [Understanding AppArmor user namespace restriction](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007).
Upstream wiki, as linked from the sysctl file: [unprivileged_userns_restriction](https://gitlab.com/apparmor/apparmor/-/wikis/unprivileged_userns_restriction).

Choices (D3):

| | How | Who gets user namespaces | Notes |
|---|---|---|---|
| **3a (recommended)** | Install `apparmor-profiles`, copy Ubuntu's `/usr/share/apparmor/extra-profiles/bwrap-userns-restrict` into `/etc/apparmor.d/`, load it with `apparmor_parser -r`. | Anything run through `/usr/bin/bwrap` | Written and maintained by Ubuntu/AppArmor. Programs bwrap starts are stacked with `unpriv_bwrap`, which has `audit deny capability`, an **extra** layer on top of our `--cap-drop ALL`. On a VPS where root and `maxrecall` are the only users, “anyone running bwrap” is narrow enough. |
| 3b | Our own profile for the service in Ubuntu's own style, e.g. `profile maxrecall-judge flags=(unconfined) { userns, }` (the shape of `/etc/apparmor.d/chrome` in the same package), attached with systemd's `AppArmorProfile=maxrecall-judge` ([systemd.exec(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#AppArmorProfile=): “The process executed by the unit will switch to this profile when started”). | Only the service's processes | Narrower, but **untested**: I *think* exec'd children (bwrap) keep the profile, but I haven't verified it. We'd maintain the profile. |
| 3c | `kernel.apparmor_restrict_unprivileged_userns=0` via `/etc/sysctl.d/20-apparmor.conf`, as that sysctl file suggests | Everyone | Simplest, and turns off a system-wide hardening Ubuntu chose on purpose. Not recommended. |

Qualys has published bypasses of this restriction (reported via
[a secondary summary](https://www.ampcuscyber.com/shadowopsintel/three-new-security-bypasses-discovered-in-ubuntus-unprivileged-user-namespace-restrictions/);
I haven't read Qualys's primary advisory). It's a hardening layer, not a
boundary, so none of 3a–3c is a big loss.

**Kubuntu 26.04:** a third-party tracker claims 26.04 loads
`bwrap-userns-restrict` by default. **Unverified.** Step 5 checks it.

## 5. Design sketch

A new module, `judge/sandbox.js`, builds the bwrap argument list. The
runner calls it for **both compile and run**, so `spawnJudged`,
`compileCpp`, `compileJava` and `compileD` all go through one function.
This is roughly what I tested (as `nobody`, in the cloud):

```
bwrap
  --unshare-all --unshare-user --disable-userns   # new user/pid/net/ipc/uts/cgroup ns; no nested userns
  --die-with-parent --new-session                 # die if the judge dies; no TIOCSTI (CVE-2017-5226)
  --clearenv --setenv PATH /usr/bin:/bin          # empty environment (G1)
  --ro-bind /usr /usr                             # toolchains, read-only
  --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64
  --ro-bind-try /etc/alternatives /etc/alternatives   # python3, java and others are alternatives symlinks
  --ro-bind-try /etc/ld.so.cache /etc/ld.so.cache
  --ro-bind-try /etc/java-21-openjdk /etc/java-21-openjdk   # java needs it (measured)
  --ro-bind-try /etc/dmd.conf /etc/dmd.conf       # dmd's config (guess: not tested, no dmd at the time)
  --ro-bind <node install dir> <same path>        # cloud: /opt/node22; VPS: /usr/local is under /usr already
  --ro-bind judge/cpp/judge_json.o …  /  judge/java …   # helpers only, never the repo
  --bind <per-submission work dir> /work          # read-write while compiling, --ro-bind while running
  --proc /proc --dev /dev                         # the sandbox's own /proc: it can't see the server's
  --size 67108864 --tmpfs /tmp                    # 64 MB private /tmp
  --chdir /work --cap-drop ALL
  [--seccomp 3]                                   # step 6
  -- <command>
```

Each flag is described in `bwrap --help` and
[bwrap(1)](https://manpages.ubuntu.com/manpages/noble/en/man1/bwrap.1.html).
Notes:

- **What I measured** with that shape: `/etc/passwd`, `/root` and the repo
  were *not found*; connecting to 1.1.1.1 gave “Network is unreachable”; the
  only interface was `lo`; `/usr` was read-only; `env` showed only `PATH`;
  `#include "/etc/passwd"` failed to compile with “No such file”;
  `unshare --user` inside failed; and **killing the outer bwrap killed an
  orphaned, `setsid()`ed child within about a second** (G5 fixed).
- **`--clearenv` doesn't hide bwrap's own environment.** It clears only the
  environment of the program bwrap finally runs. bwrap's own PID 1 inside
  the sandbox, the helper that reaps exited processes, keeps the environment
  Node started bwrap with. A submission running as the same uid can read it
  from `/proc/1/environ` ([proc_pid_environ(5)](https://man7.org/linux/man-pages/man5/proc_pid_environ.5.html)
  shows a process's *starting* environment). Step 0's trial measured this:
  G1 still escaped through `/proc/1/environ`. So the judge must call
  `spawn('bwrap', …, { env: { PATH } })` as well as passing `--clearenv`.
  That makes step 1 a requirement, not only a quick win.
- **Limits** are set with `prlimit` (util-linux). **Correction (step 3): inside
  bwrap, not before it.** See “Step 3 notes”. I measured these:
  - `--nproc=50` stopped a fork loop at 47 children.
  - `--as=256M` refused a 400 MB allocation.
  - `--fsize=10M` stopped a file at exactly 10 MB in the tmpfs.

  One caution: unprivileged bwrap can only map the **caller's own uid**, so
  outside the sandbox all submissions are the server's user, and
  `RLIMIT_NPROC` counts *that user's* processes and threads, including the
  Node server's own threads and other concurrent sandboxes. The numbers need
  headroom. cgroups (step 7) are the proper fix.
- **Paths differ per machine** (`node` is `/opt/node22` in the cloud,
  `/usr/local/bin` on the VPS, and unknown on Kubuntu). So the module works
  out bind paths at startup from the real paths of `node`, `python3`,
  `java` and `dmd`, the way `ensureCppJsonObjectBuilt` already runs at
  startup.
- **If bwrap is missing or fails its startup self-test** (D2): I recommend
  **fail closed**. The server refuses Run/Submit with a clear message, unless
  `MAXRECALL_UNSANDBOXED=1` is set, which the owner can use on Kubuntu while
  developing.
- **Seccomp (step 6):** bwrap takes a compiled BPF program on a file
  descriptor. Node can hand one over through `spawn`'s `stdio` array
  (`['pipe','pipe','pipe', fd]` → `--seccomp 3`). We'd generate it at startup
  from a small C program using libseccomp (`libseccomp-dev`, universe), the
  same build-once pattern as `judge_json.o`. The alternative is
  `python3-seccomp` (also universe). For the policy (D4), I recommend a
  **denylist** first, modelled on Docker's default profile
  ([moby `profiles/seccomp/default.json`](https://github.com/moby/moby/blob/master/profiles/seccomp/default.json)):
  `bpf`, `perf_event_open`, `keyctl`, `add_key`, `request_key`, `ptrace`,
  `process_vm_*`, `userfaultfd`, `io_uring_*`, `kexec_*`, `personality`
  and so on. An allowlist is stronger but brittle across the JVM, V8 and
  CPython.
- **cgroups (step 7, VPS and Kubuntu only):** the VPS should be cgroup v2
  (Ubuntu's default since 21.10; I believe this, but check with
  `stat -fc %T /sys/fs/cgroup`, which should print `cgroup2fs`). systemd's
  `Delegate=` “Turns on delegation of further resource control partitioning
  to processes of the unit” and, with `User=`, makes the unit's cgroup
  accessible to that user.
  [systemd.resource-control(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html#Delegate=)
  says “no processes should live in inner nodes”, so the server itself must
  sit in a sub-group: `DelegateSubgroup=` (systemd ≥ 254; noble has 255).
  Each submission then gets `judge-<id>/` with `memory.max`,
  `memory.swap.max=0`, `pids.max` and `cpu.max`, and is ended with
  `cgroup.kill`. tmpfs pages are charged to the writer's cgroup, so
  `memory.max` also bounds `/tmp`. In the cloud (cgroup v1 here), this step
  is skipped and rlimits remain. (I couldn't fetch freedesktop.org from this
  session; those quotes are from the
  [systemd source of the same pages](https://github.com/systemd/systemd/blob/main/man/systemd.resource-control.xml).)

## 6. Steps (each small and checkable)

| Step | What | Check |
|---|---|---|
| 0 | **Done 2026-11-02.** An escape test: `judge/sandbox-selftest.js` (`make sandbox-test`) runs hostile submissions through `runSubmission` and reports each of G1–G8 as *contained* or *ESCAPED*. Run it after each step. | Cloud, 2026-11-02: 10 ESCAPED, 1 contained (G6c, the existing memory cap). See “Step 0 results” below. |
| 1 | **Done 2026-11-02.** Every `spawn` in the runner gets `env: SUBMISSION_ENV` (`PATH`, `LANG=C.UTF-8`). It's needed for bwrap too (§5). | G1 now says “own env is clean (['LANG', 'PATH']), but the canary is readable in /proc/<pid>/environ”: still ESCAPED, as expected, until step 3. See “Step 1 notes”. |
| 2 | **Done 2026-11-02.** `judge/sandbox.js` with startup self-test and fail-closed (D2). `bwrap` added to the cloud SessionStart hook, and to `docs/deploy-vps.md` as new §1a with the AppArmor profile (moved here from step 5). | The self-test passes in the cloud, as root and as `nobody`. With bwrap unusable, the server logs UNAVAILABLE and Run gets 503; with `MAXRECALL_UNSANDBOXED=1` it judges. |
| 3 | **Done 2026-11-02.** Run step under bwrap, all five languages, both judge modes. Per-submission work dirs. | Escape test: 10 of 11 contained (G7 left for step 4), as root and as `nobody`. Correct answers Accepted in every language and mode; starter-code verdicts unchanged in all 65 runs. See “Step 3 notes”. |
| 4 | **Done 2026-11-02.** Compile step under bwrap, plus compiler memory caps (added: none existed). | G7 and G10 contained; all 13 probes contained, as root and as `nobody`. C++/Java/D still compile and pass. See “Step 4 notes”. |
| 5 | VPS: follow §1a (written in step 2), read the `Sandbox:` log line, adjust the service file if its containment gets in the way. Kubuntu: `sudo apt install bubblewrap`, check `ls /etc/apparmor.d \| grep -i bwrap`, and run the selftest. | Selftest on the VPS, including G4 (port 3001) contained. |
| 6 | Seccomp denylist (D4). | Selftest's seccomp probes are refused; all questions still pass. |
| 7 | cgroup v2 on the VPS (D5). | A fork bomb and a 1 GB allocation are contained; `systemd-cgls` shows `judge-<id>` groups appear and vanish. |
| 8 | A concurrency limit in `handleExecution` (a queue of N judgings) (G9). | 20 parallel Runs don't starve the server. |

Each step updates `readme.html` (Judging, Known gaps, Environments,
Decisions) in the same commit.

### Step 0 results (cloud session, 2026-11-02)

The probes and what they plant are described at the top of
`judge/sandbox-selftest.js`. Unsandboxed, as the judge is today:

| Probe | Result | Detail |
|---|---|---|
| G1 env | ESCAPED | canary in `os.environ` (175 variables) |
| G2 questions | ESCAPED | read `questions/two-sum.json`, hidden cases included |
| G3 private files | ESCAPED | read the owner-only canary file and wrote next to it |
| G4 loopback port | ESCAPED | connected to the test's `127.0.0.1` listener |
| G5a orphan after return | ESCAPED | still running 1.5 s later |
| G5b orphan after timeout | ESCAPED | still running 1.5 s after *Time Limit Exceeded* |
| G6a 300 processes | ESCAPED | all 300 started |
| G6b 100 MB file | ESCAPED | written |
| G6c 1 GB allocation | contained | `MemoryError` (the existing `RLIMIT_AS` cap) |
| G7 compile-time read | ESCAPED | C++ compiled with the canary header `#include`d |
| G8 network | ESCAPED | interfaces `lo`, `ifb0`, `ifb1`, `eth0`; direct connect to 1.1.1.1:443 worked |

**Check on the test itself.** A throwaway wrapper, not committed, routed
the Python run step through bwrap and `prlimit --nproc=64 --fsize=10M`, as
`nobody`. Then 9 of 11 were contained. G7 still escaped, as expected,
because the compiler wasn't wrapped. G1 still escaped through
`/proc/1/environ`, the finding in §5. So the probes can report both
outcomes, and they caught a gap in the design.

### Step 1 notes (2026-11-02)

- **Why `LANG=C.UTF-8`, not just `PATH`.** With no `LANG`, Java's
  `stdout.encoding` was `ANSI_X3.4-1968` (ASCII) and it printed `café` as
  `caf?`. With `LANG=C.UTF-8` it was `UTF-8` (measured). The cloud server
  has no `LANG`, so Java printed `?` there before this step too. Python
  printed UTF-8 either way, because it coerces the C locale to UTF-8
  ([PEP 538](https://peps.python.org/pep-0538/)).
- **Regression check.** Every question's starter code, in all five
  languages (D via the SessionStart hook's DMD 2.113.0), got the same
  verdict before and after. The only difference: cloud Java compile errors
  no longer start with `Picked up JAVA_TOOL_OPTIONS: …`, the cloud's proxy
  settings, which had been the first line a learner saw. A correct `café`
  program was Accepted in every language.
- **Correction to the escape test.** At first G1 said *contained* after this
  step, not the ESCAPED I'd predicted. The test set its canary with
  `process.env.X = …` after starting, and `/proc/<pid>/environ` shows only
  a process's **starting** environment, so the canary never appeared there.
  The test now runs itself again with the canary in its starting
  environment. That's how the VPS gets `MAXRECALL_PASSWORD` (systemd
  `EnvironmentFile=`), so it's the case that matters. The other way round,
  a password read from `.env` by `process.loadEnvFile` at runtime is *not*
  visible in `/proc/<pid>/environ`. That's a narrower exposure than §1's G1
  row suggests: the leak there was through inheritance, which this step
  ends.

### Step 2 notes (2026-11-02)

- **What the startup self-test checks.** It runs `/bin/sh` once, inside a
  sandbox built by the same `sandboxedCommand` the judge will use, and fails
  if:
  - the repo folder is visible (filesystem not isolated);
  - `/proc/net/dev` lists anything but `lo` (no network namespace);
  - `/proc/1/environ` holds anything but `PATH` and `LANG` (§5's finding);
  - a toolchain found on `PATH` outside can't be found inside (a missing
    bind).
- **The self-test fails when it should.** I fed the same script four
  deliberately broken sandboxes: the repo bound in, the network namespace
  left out, bwrap started with the server's environment, and Node's
  `/opt/node22` not bound. Each was reported with its own message.
- **Failure cases tried.**
  - bwrap not executable: `UNAVAILABLE (bubblewrap is not installed: …)`.
  - User namespaces blocked, simulated by running the server inside an
    outer `bwrap --disable-userns` because the container doesn't allow
    changing the `sysctl`: `UNAVAILABLE (self-test failed: bwrap: Creating
    new namespace failed: … (ENOSPC))`.

  In both, Run gets HTTP 503 and the page shows the reason. With
  `MAXRECALL_UNSANDBOXED=1`, the log says “judging is allowed WITHOUT a
  sandbox” and Run works.
- **Why the AppArmor step moved here.** Once the server refuses to judge
  without a working bwrap, pulling this version onto the VPS without the
  AppArmor profile would stop it judging. So `docs/deploy-vps.md` §1a has
  the steps now. They're **untested**; the VPS's `Sandbox:` log line is the
  test. Step 5 is now “follow §1a and adjust if the systemd containment gets
  in the way”.
- **Bind paths are found at startup.** `/usr` is read-only. `/bin`, `/lib`
  and the rest are copied as they are on the machine: symlinks on Ubuntu's
  merged `/usr`. Only these `/etc` entries are visible: `alternatives`,
  `ld.so.cache`, `dmd.conf` and `java-<n>-openjdk`. Install folders of
  toolchains outside `/usr` are bound too: `/opt/node22` in the cloud. So
  no paths are hard-coded per machine.

### Step 2b: `make` installs the dependencies (2026-11-02, owner's choice)

The owner chose option (c): `make run` and `make dev` install what the
sandbox needs, rather than leaving it to an explicit target. Both depend on
`build`, which now depends on `sandbox-deps` (`scripts/sandbox-deps.sh`). The
cloud SessionStart hook calls the same script, so there's one copy of the
install logic.

1. **Check first** with the server's own self-test, without root (about
   0.1 s). If it passes, the script does nothing more.
2. **bubblewrap missing:** `apt-get install bubblewrap`, through `sudo`
   unless already root, refreshing package lists only if apt doesn't know
   the package.
3. **Still failing:** a minimal `bwrap … true` tells whether namespaces
   themselves are refused. Only if they are, *and*
   `kernel.apparmor_restrict_unprivileged_userns` is `1`, it installs
   `apparmor-profiles` if needed, copies `bwrap-userns-restrict` into
   `/etc/apparmor.d/`, and loads it with `apparmor_parser -r`. Then it
   re-tests.
4. **Can't fix it** (no sudo rights, a cancelled password prompt, a failure
   that isn't AppArmor's): it prints `Sandbox: UNAVAILABLE (reason)` and exits
   0, so the server starts and refuses to judge on its own.

**Checked:** in the cloud, as root, both bwrap present and bwrap missing
with empty package lists. The AppArmor branch was checked only with
stand-ins, run as `nobody` so everything went through `sudo`. Logging fakes
of `sudo`, `apt-get` and `apparmor_parser`, and a `bwrap` that fails until
the “profile” is loaded, showed:
- the right commands, in order, each through `sudo`;
- nothing done on a second run;
- AppArmor left alone when it isn't the cause;
- a warning, not a failed `make`, when `sudo` is refused.

**Untested:** real AppArmor, on Kubuntu 26.04 and on the VPS.

**Caution:** run it as the user the server runs as. Root may create user
namespaces even where AppArmor stops everyone else, so a check run as root
can pass while the server's user fails. The VPS service doesn't use `make`,
so `docs/deploy-vps.md` §1a stays the VPS procedure.

### Step 3 notes (2026-11-02)

- **Where the process limit has to go (measured).** The plan's §5 said to
  run `prlimit` *before* bwrap. That was wrong. With 150 processes of the
  same user already running:
  - `prlimit --nproc=64` **outside** bwrap made bwrap itself fail
    (`Creating new namespace failed: Resource temporarily unavailable`),
    because it counted all 150;
  - **inside** bwrap, the same limit stopped a fork loop at 62.

  Since Linux 5.14, RLIMIT_NPROC is counted per user namespace (the kernel's
  “ucounts”). Inside, it counts only the sandbox. Outside, a new namespace's
  ceiling is the creator's limit, which is checked against *everything* that
  user owns. A Kubuntu desktop session would fail every Run. So
  `sandboxedRun` puts `prlimit` inside: `bwrap … -- prlimit --nproc=128
  --fsize=16M --core=0 -- <command>`. (The kernel mechanism is from my
  reading of `kernel/ucount.c`, not re-checked this session; the
  measurement is what the code relies on.)
- **Root ignores it.** As root, the same limit allowed all 300 forks. The
  kernel exempts the root user, and root inside a user namespace started by
  root is still that user. So when the server runs as root (the cloud),
  `sandboxedCommand` prefixes `setpriv --reuid=65534 --regid=65534
  --clear-groups` and runs sandboxes as `nobody`. The work folder is then
  made `0711` (`prepareWorkDir`), so `nobody` can open the files without
  listing the folder. On Kubuntu and the VPS the server isn't root and none
  of this applies. This wasn't in the plan; it's how the cloud tests the
  same thing as the other machines.
- **128 processes.** Threads count, and the JVM's thread count grows with
  cores. 128 ran Java fine on the cloud's 4 cores. A many-core Kubuntu
  machine *might* need more; that's a guess. A Java submission failing with
  “unable to create native thread” would be the sign.
- **Work folders.** One `mkdtemp` folder per submission, with fixed names
  (`main.js`, `main.py`, `main.cpp`, `Main.java`, `main.d`, binary `main`),
  read-only at `/work` while running; Java helpers at `/judge/java`.
  Compiling still happens in it on the host (step 4). Without a working
  sandbox, but with `MAXRECALL_UNSANDBOXED=1`, runs use the real paths and
  start in that folder, otherwise as before (`runPaths`).
- **Checked:**
  - the escape test, as root (sandboxes as `nobody`) and as `nobody` (bwrap
    directly): 10 of 11 contained both times;
  - correct Two Sum (function mode, hidden tests included) and Hello World
    (program mode): Accepted in all five languages, sandboxed both ways and
    with the override;
  - starter code: the same verdicts in all 65 runs;
  - no `judge-*` folders left in `/tmp`.

### Time limits (2026-11-02, added after step 3 when the owner asked)

- **What there was:** only wall-clock timers, through Node's `spawn`
  `timeout`: 5 s per run process and 10 s per compile, ended with `SIGKILL`.
  Since step 3, killing a run kills its whole sandbox (G5b).
- **Added:** `--cpu=10:11` in `RUN_LIMITS`: 10 s of CPU time per process,
  all threads together. That's a backstop, since 5 s of wall-clock time is
  5 s × cores of CPU. The soft limit is below the hard one because bwrap
  reports a child killed by a signal as exit code 128 + signal (measured):
  `SIGXCPU` gives 152, which the runner reports as *Time Limit Exceeded* /
  “CPU time limit exceeded”. Equal limits would give `SIGKILL`, 137, which
  can't be told apart from other kills.
- **New probe G6d:** a JavaScript submission with one busy worker thread per
  core, at least 4. Contained: stopped after 2570 ms on 4 cores. With `--cpu`
  removed for a moment, it ran the full 5 s (5020 ms, wall-clock timeout).
  So the probe can fail.
- **Found: the C++ compile timeout doesn't work (new probe G10).** Killing
  the `g++` driver leaves its child `cc1plus` running, with parent PID 1,
  and holding the judge's stderr pipe. `compileCpp` resolves on `close`,
  which waits for that pipe. With a 1 s timeout, the judge answered after
  137 s, when I killed `cc1plus` by hand. G10 submits 299 bytes: 8
  `constexpr` evaluations, each stopped by GCC's own limit of 2^25
  operations. Measured: 6 of them took 27 s at 454 MB. G10 has a watchdog at
  compile limit + 4 s, so the escape test doesn't hang. It's ESCAPED until
  step 4.
- **Found: compilers have no memory limit.** 257 bytes of exponential
  templates (2^N distinct instantiations, which GCC can't cache) made
  `cc1plus` reach 2 GB in 20 s, still growing. Timings: N=14 0.5 s, N=16
  2.7 s, N=18 14.7 s. There's deliberately no probe for this: before the
  fix, it would push the machine toward gigabytes of RAM on every run of the
  escape test. Step 4 adds a cap and checks it by hand.
- **Done after step 4:** program mode's runs together may take at most
  20 s (`PROGRAM_TOTAL_RUN_MS`, not counting compiling). Each case gets
  `min(5 s, what's left)`, and cases still waiting when it's used up are
  marked failed, “Not run”, without running. Checked with ten 3 s cases: 6
  passed, the 7th was cut off, the last 3 weren't run; 20.0 s in all
  instead of 50 s.
- **Still open:**
  - `runtimeMs` includes compiling and sandbox start-up (separate, since it
    changes saved records);
  - the CPU limit is per process (cgroups, step 7).

### Step 4 notes (2026-11-02)

- **One compile path.** `compileCommand(language, paths)` gives the
  compiler's command line, timeout and memory cap. `compileSubmission` runs
  it through `sandboxedArgs`, which `spawnJudged` uses too. That replaced
  three near-identical functions (`compileCpp`, `compileJava`, `compileD`).
- **What the compiler sees.** `/work` writable, so it can write `main`,
  `*.class` and `main.o`. `/judge/cpp/judge_json.o` and `/judge/java`
  read-only. The same read-only system view, empty environment, no network
  and limits as a run.
- **Memory caps (added).** RLIMIT_AS 1 GB for `g++` and `dmd`, inherited by
  `cc1plus`, `as` and `ld`. Real harness compiles fit in 512 MB (measured).
  `javac -J-Xmx256m`, because RLIMIT_AS doesn't suit a JVM. The 257-byte
  template source that reached 2 GB before now ends after 6.6 s with
  “virtual memory exhausted”, as a Compile Error.
- **A CPU-limit kill counts as a compile timeout** (exit code 152).
- **Root.** The compiler must write to the work folder, so when the server
  is root (sandboxes run as `nobody`), `prepareWorkDir` now hands the folder
  to `nobody` (`chown`) instead of `chmod 0711`.
- **Checked:**
  - escape test 13/13 contained, as root and as `nobody`, with no compiler
    processes left behind (G10 now answers at the 10 s limit);
  - correct Two Sum and Hello World Accepted in all five languages:
    sandboxed as root, as `nobody`, and with bubblewrap broken plus
    `MAXRECALL_UNSANDBOXED=1`;
  - starter-code verdicts identical in all 65 runs; compile errors now say
    `/work/Main.java:6: …`;
  - no `judge-*` folders left in `/tmp`.

### Step 5, Kubuntu part (2026-11-02, owner's run)

- `make sandbox-test` on Kubuntu 26.04: bubblewrap **0.11.1**, the startup
  self-test passed, and **13 of 13 probes were contained**.
- G6d was stopped by the CPU limit after 1008 ms, against 2570 ms in the
  cloud on 4 cores: 10 s of CPU in 1 s means about 10 cores were busy.
- **Not known yet:**
  - Did `scripts/sandbox-deps.sh` install bubblewrap or load
    `bwrap-userns-restrict`, or did 26.04 already allow bubblewrap? Its notes
    go to stderr, which wasn't in the saved output. Checks:
    `sysctl kernel.apparmor_restrict_unprivileged_userns` and
    `ls /etc/apparmor.d | grep -i bwrap`.
  - Does Java fit within the 128-thread limit on that many cores? The escape
    test never runs Java. Run a Java question on Kubuntu to check.

### Step 5, VPS part: first run (2026-11-02, owner's run)

The owner ran `make sandbox-test |& tee output.lst` as **root** in
`/root/maxrecall-dsa.net`. That's not the service's checkout or user
(`/srv/maxrecall/maxrecall-dsa.net`, `maxrecall`).

- `scripts/sandbox-deps.sh` installed bubblewrap 0.9.0. The self-test then
  failed: `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`.
  **Confirmed as AppArmor** by the kernel log (`journalctl -k -b`):
  - `apparmor="AUDIT" operation="userns_create" … comm="bwrap" …
    target="unprivileged_userns"`: bwrap was moved into the restricted
    profile;
  - `apparmor="DENIED" operation="capable" … profile="unprivileged_userns"
    comm="bwrap"` for `capname="net_admin"` (the loopback address) and
    `capname="setpcap"`.
  My earlier guess at the message (“uid map” / “Failed to make / slave”)
  was wrong; `docs/deploy-vps.md` §1a now quotes the real one.
- **Bug in the script, fixed.** As root, the self-test runs sandboxes as
  `nobody` (like `judge/sandbox.js`), but `minimal_bwrap`, the “is it
  AppArmor?” check, ran bwrap as root, which the restriction exempts. It
  passed, so the script gave up instead of loading the profile. It now runs
  the check as `nobody` too (`as_sandbox_user`). Reproduced in the cloud
  with stand-ins (a `bwrap` that works for root and fails with the VPS's
  message for anyone else, until a fake `apparmor_parser` “loads” the
  profile): the old script prints the VPS's exact line, and the fixed one
  loads the profile and reports `works`.
- **Not sandbox problems, but they stop the VPS judging:**
  - `javac` wasn't found. The runner compiles `JudgeJson.java` when it
    loads, so it threw.
  - root's `node` was v18.17.0. `server.js` calls `process.loadEnvFile`
    (Node 20.12+/21.7+), so the server couldn't start under it.
    `docs/deploy-vps.md` §2 installs Node 22 to `/usr/local/bin`; something
    else comes first on root's `PATH`.
- **The VPS's setup doesn't match `docs/deploy-vps.md` §1–§2** (owner's
  output):
  - the only `node` is `/root/.local/share/node-v18.17.0-linux-x64/bin/node`,
    and there's no `/usr/local/bin/node`, so §2 wasn't done;
  - there's no `javac`, so §1's JDK isn't installed.

  Ubuntu 24.04's `default-jdk-headless` is 2:1.21-75+exp1, which depends on
  `openjdk-21-jdk-headless` (checked with `apt-cache` in the cloud).
  command-not-found on the VPS suggested `default-jdk` “version 2:1.17-75”.
  My guess is its database is stale; `javac -version` after installing
  settles it.
- Next on the VPS: install the JDK (§1) and Node 22 (§2), take Node 18 off
  root's `PATH`, pull, then `make sandbox-test |& tee output.lst`.

### Step 5, VPS part: second run (2026-11-02, owner's run)

- The AppArmor fix worked as intended. `sandbox-deps.sh` logged the
  restriction, installed `apparmor-profiles` (apt upgraded `apparmor` and
  `libapparmor1` from …24.04.3 to …24.04.9 alongside, because the package
  needs the matching version), and loaded `bwrap-userns-restrict`. The
  `net_admin` failure was gone. (Reloading printed `rc.apparmor.functions:
  line 148: [: yes: integer expression expected`; I'm guessing that's a
  harmless quirk of Ubuntu's reload script, and the load succeeded.
  `aa-status | grep bwrap` would confirm it.)
- **Next failure:** `bwrap: Can't find source path
  /root/.local/share/dmd2/linux: Permission denied`. `toolchainArgs` binds
  the install folder of every toolchain outside `/usr` that's on `PATH`.
  Root's `PATH` has a DMD and a Node 18 under `/root/.local/share`. Since
  the server (here `make`) ran as root, sandboxes run as `nobody`, which
  can't enter `/root` (`drwx------`).
- **Changed:** `sandboxUserCanReach` checks each toolchain folder before
  binding it. As root, it checks the “others” permission bits along the
  path, since that's what `nobody` gets; otherwise `fs.accessSync` checks
  the server's own user. Folders that can't be reached aren't bound, and the
  self-test fails with `toolchains the sandbox can't reach: dmd in <folder>
  … Install them system-wide (world-readable, e.g. under /usr/local or
  /opt), or take them off PATH`. The check stays strict, rather than leaving
  that language broken inside the sandbox: otherwise the sandbox could find a
  *different* copy than the server did, or none. Tested with a fake `dmd` in
  `/root/.local/share`: as root, that reason; as `nobody`, which can't see
  it at all, the system DMD is used and it works; moved to `/opt`, it's
  bound and works.
- Still to do on the VPS: the JDK, Node 22, and fixing root's `PATH`.


## 7. Decisions (made 2026-11-02, owner: all as recommended)

- **D1.** Which tool? I recommend **bubblewrap** (§3).
- **D2.** If the sandbox is unavailable: fail closed, with
  `MAXRECALL_UNSANDBOXED=1` as an explicit opt-out? I recommend **yes**.
- **D3.** VPS AppArmor: I recommend **3a**, Ubuntu's `bwrap-userns-restrict`
  (§4).
- **D4.** Seccomp: a denylist generated by a small libseccomp C helper? I
  recommend **yes**, and an allowlist only later, if ever.
- **D5.** cgroups: as step 7, VPS-only, or skip until there are other
  users? I recommend **step 7**, since it's the real memory and fork-bomb
  fix.
- **D6.** Accept that all sandboxes share the server's uid outside? They
  can't see each other's PIDs or files (separate namespaces), so I
  recommend **yes for now**. Separate uids need a privileged helper.

## 8. What this leaves open (residual risk)

- **The kernel is shared.** Namespaces plus seccomp reduce, but don't
  remove, exposure to kernel bugs reachable from inside a user namespace,
  which is exactly why Ubuntu restricts them. For untrusted strangers at
  scale, gVisor or a VM per run (option H) is the next level.
- **Toolchains are the host's.** A compiler bug is reachable through
  submissions. Containers (option F) would pin toolchains; that's a separate
  decision.
- **Covert misuse within limits.** For example, mining for 5 s per Run.
  Rate limits per user (not planned yet) would cover that.

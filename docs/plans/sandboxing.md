# Plan: sandbox submitted code

Status: **proposed 2026-11-02. Nothing is built yet, and no option is chosen.**
The owner decides D1–D6 below before any code changes.
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
3. **An empty environment** (plus `PATH`). That closes G1.
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
- **Limits** are set with `prlimit` (util-linux) before bwrap, or in a tiny
  wrapper. I measured these:
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
| 0 | **An escape test first:** `judge/sandbox-selftest.js` (or `make sandbox-test`) runs hostile submissions through `runSubmission` and reports each of G1–G8 as *contained* or *ESCAPED*. Run it now to see the gaps, then after each step. | Today: most lines say ESCAPED. |
| 1 | Quick win: pass `env: { PATH }` to every `spawn` in the runner. | The G1 env test is contained. `/proc/<ppid>/environ` is still readable until step 3. |
| 2 | `judge/sandbox.js` with startup self-test and fail-closed (D2). `bwrap` added to `docs/deploy-vps.md` §1 and the cloud SessionStart hook. | The self-test passes in the cloud. The server refuses to judge if bwrap is removed. |
| 3 | Run step under bwrap, all five languages, both judge modes. Per-submission work dirs. | Every existing question still passes its starter solution; selftest G2–G6, G8 contained. |
| 4 | Compile step under bwrap. | G7 contained; C++/Java/D still compile. |
| 5 | VPS: AppArmor (D3), service file and guide updated. Kubuntu: check `ls /etc/apparmor.d \| grep -i bwrap` and run the selftest. | Selftest on the VPS, including G4 (port 3001) contained. |
| 6 | Seccomp denylist (D4). | Selftest's seccomp probes are refused; all questions still pass. |
| 7 | cgroup v2 on the VPS (D5). | A fork bomb and a 1 GB allocation are contained; `systemd-cgls` shows `judge-<id>` groups appear and vanish. |
| 8 | A concurrency limit in `handleExecution` (a queue of N judgings) (G9). | 20 parallel Runs don't starve the server. |

Each step updates `readme.html` (Judging, Known gaps, Environments,
Decisions) in the same commit.

## 7. Decisions needed from the owner

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

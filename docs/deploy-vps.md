# Running MaxRecall DSA on the VPS (Ubuntu 24.04)

Written 2026-10-29; sign-in added 2026-10-30. This is option A from the
2026-10-29 discussion: the app listens only on the VPS's own loopback address
(`127.0.0.1`), and you reach it through an SSH tunnel. **Since 2026-11-05
(§13, limited-live step 3) nginx also serves it at
<https://maxrecallcode.net>**, behind the app's own sign-in (and, until
2026-11-06, a shared Basic auth login in front of it: §13, step 8), and
only to port 3000. Until §13 is done, nothing is exposed to
the internet.

It listens on two ports, both on `127.0.0.1`:

- **3001, the trusted port.** The SSH tunnel connects here. Every request is
  you (`MAXRECALL_USER`), with no sign-in.
- **3000, the normal port.** It requires signing in. Nothing uses it yet. It's
  what a reverse proxy would point at, if the app is ever made public, and it
  must never point at 3001.

**Why it's set up this way.** Since 2026-11-02 (sandboxing step 3),
submitted code is compiled and run inside the judge's own bubblewrap
sandbox (`readme.html` §6; compilers since step 4), under a seccomp filter
(step 6), with cgroup limits per submission in this service (step 7,
`Delegate=yes` in the unit, which therefore leaves out
`ProtectControlGroups=`). As an outer layer, the server:

- runs as its own unprivileged user, `maxrecall`;
- is reachable only through your SSH login;
- runs under systemd containment (`deploy/maxrecallcode.service`): no
  network except the VPS itself, a read-only file system apart from three
  folders, and a private `/tmp`.

Before step 3, that containment was all there was. A submission could
read world-readable files on the VPS and connect to `127.0.0.1:3001`, and
so act as you. It could also read the service's starting environment from
`/proc/<pid>/environ`, including `MAXRECALL_PASSWORD` if `test.env` sets it.
Inside the sandbox, a running submission sees none of that: it has its own
network (loopback only), its own process list and its own file view. It
still uses CPU and memory within its limits. The compilers run in the same
kind of sandbox.

Commands marked **[VPS]** run on the VPS. Commands marked **[Kubuntu]** run on
your machine. The VPS's DNS name is `srv702017.hstgr.cloud` (Hostinger's
name for it; the Makefile's `VPS_HOST`, for `make open-ssh-3005`, is the
same), and the commands below use it. On the VPS itself that name resolves
to `127.0.1.1` (`/etc/hosts`), so a check of reaching the VPS from outside
must be run on Kubuntu (§12).

## The quick way: `make deploy-server` [VPS]

Added 2026-11-02. Everything below, §1 to §6 and §8, is done by one command,
run as root (or with `sudo`) in **any** checkout of the repo on the VPS:

```bash
apt install -y git make
```
- Needed once, to clone the repo and run `make`.

```bash
git clone https://github.com/pflagerd/maxrecall-dsa.net.git
```
- Any folder will do, e.g. root's home. The service gets a clone of its own
  in `/srv/maxrecall`.

```bash
cd maxrecall-dsa.net
```

```bash
make deploy-server
```
- **`toolchain-deps`** (§1, §2): installs `g++`, the JDK, `python3`, LDC,
  `curl`, `xz-utils`, and Node 22.23.4 into `/usr/local`, checked against
  two hashes. Only what's missing.
- **`sandbox-deps`** (§1a): installs bubblewrap, and loads Ubuntu's
  `bwrap-userns-restrict` AppArmor profile if the restriction blocks it.
- **`scripts/deploy-server.sh`**:
  - creates the `maxrecall` user (§3);
  - clones `master` into `/srv/maxrecall/maxrecall-dsa.net`, runs
    `npm install --omit=dev`, and creates the data folder (§4);
  - installs, enables and starts the service (§5);
  - checks it: it waits for it to answer, shows its startup lines, **fails
    if the `Sandbox:` line says `UNAVAILABLE`**, and checks that ports 3000
    and 3001 listen on `127.0.0.1` only (§6).
- **The first run asks** `Set up the maxrecall service on this machine?
  [y/N]`, because the trusted port makes anyone on the machine the owner. A
  desktop is the wrong place for it. `DEPLOY_CONFIRM=yes make deploy-server`
  skips the question.
- **Run it again to update** (§8): `git pull --ff-only`, `npm install`, the
  unit file re-copied only if it changed, then a restart and the same checks.
- **`DEPLOY_EXPECT=<full commit id> make deploy-server`** deploys only if
  `master` on GitHub is exactly that commit, and refuses otherwise with
  nothing changed (since 2026-11-08). It fetches once, compares what it
  got, and merges that id instead of pulling, so nothing merged after the
  check can go live. The guarded deploy below sets it; without it, the
  script deploys whatever the tip is.
- **Its `PATH` is systemd's own**
  (`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin`, plus `/sbin:/bin`)
  for all of this, so toolchains in root's home folder can't interfere.
  That's the `PATH` the service gets, which systemd.exec(5) documents.
- **Not done for you:** invites (§4), which are for people you choose.
  The SSH tunnel (§7) is on Kubuntu.

Tested 2026-11-02 in a cloud session, which has no systemd, so `systemctl`
and `journalctl` were stand-ins that started the server as the unit file
says (as `maxrecall`, with only its `Environment=` lines). Everything else
was real:
- declining the question changed nothing;
- the confirmed first install took 6.5 s;
- the server ran with `Sandbox: … works`, judged all five languages, and the
  escape test as `maxrecall` gave 13 of 13 contained;
- a second run took the update path;
- with bubblewrap broken, it failed on the `UNAVAILABLE` line.

**On the VPS** (2026-11-02), the first real run installed everything, then
stopped on `Sandbox: UNAVAILABLE (… bwrap: Can't mount proc on /newroot/proc:
Operation not permitted)`. The unit's `ProtectKernelTunables=yes` was the
cause, and it has been removed (see §5).

### Updating: the guarded deploy [VPS]

Written 2026-11-08 (infrastructure and security; the VPS operator's
request). The operator first ran it to deploy `38b6af3` (its handoff
`docs/session-handoff/vps-operator/20261107T092844-0800.md`), and has
deployed with it since: `64a2da8`, `c7fbafb`, and §16's `2651a33`
(`20261107T210036-0800.md`). **This is
how an update is deployed**: the owner says yes to one commit, and the
deploy puts exactly that commit live, or stops.

**Why it's needed.** `make deploy-server` deploys whatever the tip of
`master` is when it runs (owner, 2026-11-07: no pinning to a named
commit; §15). If `master` moves between the owner's yes and the deploy
(another pull request merged, a handoff pushed), a plain
`git pull && make deploy-server` would put live commits nobody looked
at. The guard deploys only if the tip is still the commit the owner
approved.

**The gap, closed by `DEPLOY_EXPECT`** (2026-11-08). The guard checks
`master` in root's checkout. Then `scripts/deploy-server.sh`, after
`toolchain-deps` and `sandbox-deps` (seconds), fetches `master` again
into the service's checkout, `/srv/maxrecall/maxrecall-dsa.net`. Before
`DEPLOY_EXPECT`, it deployed what it got, so a merge in those seconds
went live too: the time between a check and the use of what was checked
("TOCTOU"). Now step 4 passes the approved id, and the script compares
its own fetch with it and merges exactly that id, or stops. Step 5
checks again afterwards.

Same rules as §14: **[VPS]** steps are for the owner or the VPS
operator, one yes from the owner per change. Each step says read-only or
change. Stop at anything unexpected and report it.

**1. What the update brings [read-only].** On the VPS, what runs now:

```bash
runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net log --oneline -1
```
- `runuser -u maxrecall --`: run as the service's user, who owns that
  checkout ([runuser(1)](https://man7.org/linux/man-pages/man1/runuser.1.html)).
  `env HOME=/srv/maxrecall`: that user's home, as the script sets it.
  `git -C <folder>`: run in that folder. `log --oneline -1`: the newest
  commit, on one line.
- Call it `<deployed>`. It fetches nothing.

Then, **in any checkout fetched since the merge** (Kubuntu, a cloud
session; on the VPS, a `git fetch` in root's checkout needs the owner's
yes until #119, `docs/roles/vps-operator.md`). The operator may ask a
cloud session for this survey (`CLAUDE.md`, "Requests between
sessions"), giving it `<deployed>`. `<commit>` is the commit
to deploy, usually the tip of `master`:

```bash
git log --oneline <deployed>..<commit>
```
```bash
git diff --stat <deployed> <commit>
```
- `A..B`: the commits in `B` that aren't in `A`, i.e. what the deploy
  adds ([gitrevisions(7)](https://git-scm.com/docs/gitrevisions#_dotted_range_notations)).
  `diff --stat`: just the files, and how much changed in each.
- **Read every handoff in that range in full** (`docs/session-handoff/`)
  before asking the owner: one may bear on the deploy (owner,
  2026-11-07, in the operator's `20261107T210036-0800.md`).
- **Stop, and ask infrastructure and security first**, if `--stat`
  shows:
  - **a renamed unit file** under `deploy/` (a rename shows with `=>`):
    it needs a procedure of its own, like §16;
  - **a change to what's stored on disk** (anything the readme's "Where
    data lives" describes, such as a `schemaVersion`, or a rename of the
    files under `users/` or `auth/`);
  - **a renamed or deleted question** (`questions/<name>.json` with
    `=>`, or with only `-` signs): learners' files then need §8's step,
    with the server stopped, and `make deploy-server` doesn't do it. A
    fill-in-the-blank question's judge, `questions/<name>.judge.js`,
    moves or goes with it (`make rename-question`, `make
    delete-question`); a judge renamed or deleted on its own fails
    `make test` (below).
- `package.json` or `deploy/maxrecallcode.service` changed: nothing to
  do, since the script runs `npm install` and copies a changed unit file.

**Three more checks, for code that runs as the server** (owner,
2026-11-09, option A). A fill-in-the-blank question's judge,
`questions/*.judge.js`, runs **inside the server process**, with the
server's access, not in the sandbox (`docs/roles/questions.md`, "Judge
files"). The server loads it at its first Check and keeps it
(`require`), so a deploy, which restarts the service, puts a changed
judge live at once. And nothing on GitHub runs the tests on a pull
request, nor does `make deploy-server` (#213 proposes GitHub Actions for
it). So, in the same checkout:

```bash
git log --first-parent --no-merges --format='%h %s' <deployed>..<commit> -- . ':(exclude)docs/session-handoff'
```
- **Anything that reached `master` without a pull request**, other than
  a handoff. Pull requests here merge as merge commits; only handoffs
  may be pushed straight to `master` (`CLAUDE.md`, "Roles"), so on
  `master`'s own line of history every other commit is a merge.
  `--first-parent` follows that line only, not into the merged
  branches; `--no-merges` leaves out the merges
  ([git-log(1)](https://git-scm.com/docs/git-log#Documentation/git-log.txt---first-parent)).
  `-- . ':(exclude)docs/session-handoff'` is every path but the
  handoffs ([gitglossary(7), pathspec](https://git-scm.com/docs/gitglossary#Documentation/gitglossary.txt-aiddefpathspecapathspec)).
- **Expect nothing.** Anything printed came in without review (for a
  judge, without R3, the architect's): **stop**. A pull request merged
  with GitHub's "Squash and merge" would show here too; stop and ask
  anyway.
- Checked 2026-11-09 on `b9a5bef..7b928c8`: nothing printed, against 85
  handoff commits in the range; and a throwaway direct commit to
  `judge/fill-in-the-blank.js` (never pushed) was printed.

```bash
git log --first-parent --merges --format='%h %s' <deployed>..<commit> -- 'questions/*.judge.js' judge/
```
- **The pull requests that change judge code**: judge files and the
  `judge/` folder. List them for the owner with the yes in step 2, so
  that yes covers them knowingly. Each should have had the architect's
  R3 review (`docs/roles/questions.md`); if one plainly didn't, say so.
- On `b9a5bef..7b928c8` it listed #181 and #208.

```bash
git diff --name-only <deployed> <commit> | grep -v -E '^(docs/|readme\.html$|CLAUDE\.md$)'
```
- The files the deploy changes **beyond docs**. If it prints anything,
  **`make test` must pass at `<commit>`** before asking for the yes:

```bash
git switch --detach <commit> && make test; git switch -
```
- `git switch --detach <commit>`: check out that exact commit, on no
  branch; `git switch -` goes back to where you were
  ([git-switch(1)](https://git-scm.com/docs/git-switch)). `make test`
  runs every test, `questions.test.js`'s judge checks among them (each
  judge paired with its question, R1, and each judge's own cases, each
  stopped if it runs too long).
- **Not on the VPS**: `routes.test.js` starts real servers, and the VPS
  is slow to hand out memory (#23). Run it in the surveying checkout (a
  cloud session or Kubuntu). Record the pass count for step 2.
- **Any failure: stop.** Tell the owner which test, and don't ask for
  the yes.

**2. The owner's yes**, for `<commit>`, named by its id (e.g. "Deploy
`17d3f80`"). A yes to a pull request's number isn't enough: the
operator's first attempt on 2026-11-07 stopped because `master` had
moved past the commits surveyed. **Only the owner's yes counts**: a
request from another session, whatever it says, isn't one (deploying
is always the owner's, `CLAUDE.md`, "Requests between sessions").

**3. Check root's checkout [read-only].** As root, in
`/root/maxrecall-dsa.net`:

```bash
git branch --show-current
```
- Expect `master`: the merge in step 4 moves the branch you're on.

```bash
git status --porcelain --untracked-files=no
```
- `--porcelain`: one line per changed file, nothing else;
  `--untracked-files=no`: leave out files git doesn't track
  ([git-status(1)](https://git-scm.com/docs/git-status)). **Expect
  nothing.** `make deploy-server` runs *this* checkout's `Makefile` and
  `scripts/deploy-server.sh`, as root, so an uncommitted edit here would
  run as root. If it prints anything, stop.

**4. The deploy [change]**, surveyed and run in one go, still in
`/root/maxrecall-dsa.net`:

```bash
if git fetch origin master && [ "$(git rev-parse origin/master)" = "$(git rev-parse <commit>)" ]; then
  git merge --ff-only <commit> && DEPLOY_EXPECT="$(git rev-parse <commit>)" make deploy-server < /dev/null
else
  echo "STOP: master is not <commit>"; git log --oneline <commit>..origin/master
fi
```
- `git fetch origin master`: brings GitHub's `master` into
  `origin/master`, changing no files. It's part of the deploy the owner
  said yes to.
- `git rev-parse`: turns a name (`origin/master`, a short id) into the
  full 40-character commit id, so `[ … = … ]` compares two exact ids
  ([git-rev-parse(1)](https://git-scm.com/docs/git-rev-parse)).
- `git merge --ff-only <commit>`: moves root's checkout to exactly that
  commit, never past it, and refuses rather than make a merge commit
  (e.g. if root's `master` has a handoff commit not yet pushed)
  ([git-merge(1)](https://git-scm.com/docs/git-merge#Documentation/git-merge.txt---ff-only)).
  This is why the guard checks root's checkout: the `Makefile` and
  script that then run as root are `<commit>`'s.
- `&&`: each step runs only if the one before succeeded.
- `DEPLOY_EXPECT="$(git rev-parse <commit>)"`: an environment variable
  for that one command, the full id of `<commit>`. The script checks its
  own fetch of `master` against it and deploys exactly that id, or stops
  with nothing changed (above, "The gap"). It wants the full 40
  characters, so a short id is refused rather than guessed at.
- `< /dev/null`: the script gets no input. On an update it asks
  nothing; if it ever asks its first-run question (`Set up the maxrecall
  service on this machine?`), something is wrong, and with no input
  `read` fails and the script stops before changing anything (it runs
  under `set -euo pipefail`). The operator ran §16 this way.
- `else`: `master` has moved on (or the fetch failed: git says so above
  the `STOP` line). Nothing changed but `origin/master`; the `git log`
  lists what's new. Survey it as step 1 does, reading every new handoff
  in full, then ask the owner again, with advice: what each new commit
  says, what bears on the deploy, go ahead or wait (owner, 2026-11-07).
- **Expect**, among the script's lines: `deploy-server: updating
  /srv/maxrecall/maxrecall-dsa.net to <full id> (master on GitHub, as
  DEPLOY_EXPECT says) with git merge --ff-only.`, `deploy-server: at
  <commit> …`, and last `Deployed: maxrecallcode.service at <commit> …,
  running.`
- **If it says** `master on GitHub is …, not DEPLOY_EXPECT …: it moved
  after the owner's yes. Nothing changed`: a merge landed in the seconds
  between the guard's fetch and the script's. The service still runs
  what it ran. As the `else` above: survey, read the new handoffs, and
  ask the owner again.
- **If it fails** (a line `deploy-server: …` and no `Deployed:`): stop.
  Copy its last lines into the handoff and don't run it again without
  the owner's yes. Going back: §15.

**5. Check it [read-only].** First, that the service's checkout got
`<commit>` and nothing newer. With `DEPLOY_EXPECT` it always should;
this is a second look, from outside the script:

```bash
runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net rev-parse HEAD
```
```bash
git rev-parse <commit>
```
- The second runs in root's checkout. **Expect the same id twice.**
- **If they differ**, commits the owner didn't approve are live (with
  `DEPLOY_EXPECT`, a bug in the script: report it to infrastructure and
  security). List them in the service's
  checkout:
  `runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net log --oneline <commit>..HEAD`.
  Tell the owner, who either says yes to them now or has them taken
  out with §15 A (revert, then deploy).

Then the service itself, as §15 B step 7:

```bash
systemctl is-active maxrecallcode.service
```
- Expect `active`.

```bash
journalctl -u maxrecallcode.service --since "5 min ago" --no-pager | grep -v 'Queues:'
```
- Expect `Server listening on 127.0.0.1:3000 only` and `Trusted
  listener on 127.0.0.1:3001 only`. `grep -v 'Queues:'` leaves out the
  lines that name learners.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://maxrecallcode.net/login.html
```
- `-s`: no progress bar; `-o /dev/null`: throw the page away; `-w
  '%{http_code}\n'`: print only the status code
  ([curl(1)](https://curl.se/docs/manpage.html)). Expect `200`. nginx
  answers `502` when the app is down.

**6. Record it** in the operator's handoff: `<deployed>` and `<commit>`,
what step 1's `--stat` listed, each change with its time (UTC), and
step 5's results. **To undo**: §15.

The sections below are what it does, step by step, with each command
explained.

## 1. Packages [VPS]

**Shortcut (since 2026-11-02):** once `git` and `make` are installed and the
repo is cloned, `make toolchain-deps` in the checkout does §1 and §2 for
you: the packages below, and Node 22.23.4 into `/usr/local` with both
checksum checks. It does this only for what's missing, and runs as root, or
asks for `sudo`. It stops with an explanation if an older `node` is still
first on your `PATH` (`scripts/toolchain-deps.sh`). The manual steps stay
here, explained, because they're what the script does.

```bash
sudo apt update
```
Refreshes the list of available packages.

```bash
sudo apt install -y git make g++ default-jdk-headless python3 ldc curl xz-utils
```
- `-y` answers "yes" to the confirmation prompt.
- `g++` 13.2 compiles C++ submissions.
- `ldc` (LDC 1.36.0, the LLVM-based D compiler, in Ubuntu's universe
  section) compiles D submissions with `ldc2`. Added 2026-11-02.
- `default-jdk-headless` (OpenJDK 21) compiles and runs Java. "Headless"
  means no desktop GUI libraries.
- `xz-utils` unpacks the Node download.

These versions were checked against Ubuntu 24.04's repositories on 2026-10-29.

**D** is covered by `ldc` above: since 2026-11-02 the judge uses `ldc2` when
it's installed, and `dmd` otherwise. Ubuntu has no `dmd` package; the cloud
sessions get DMD from d-apt (`docs/d-compiler.md`).

## 1a. The judge's sandbox: bubblewrap and AppArmor [VPS]

Added 2026-11-02 (sandboxing step 2, `docs/plans/sandboxing.md`). The
server checks at startup that bubblewrap works. If it doesn't, the server
**refuses Run and Submit** (HTTP 503) until it's fixed. Since step 3 every
submission is compiled and run inside bubblewrap. The cloud sessions have no
AppArmor, so this section was first tested on this VPS, on 2026-11-02: the
real error and the fix are below. The server's startup log (step 5 below)
says whether it worked.

```bash
sudo apt install -y bubblewrap libseccomp-dev apparmor-profiles
```
- `bubblewrap` provides `bwrap`, the sandbox. It's in Ubuntu's main
  archive, which gets security updates from Canonical.
- `libseccomp-dev` is libseccomp's header and library. The server compiles
  the sandbox's seccomp filter with it at startup (since 2026-11-02),
  and refuses to judge without it.
- `apparmor-profiles` holds extra AppArmor profiles that aren't loaded by
  default, including the one below.

**Why AppArmor is involved.** Ubuntu 24.04 sets
`kernel.apparmor_restrict_unprivileged_userns = 1`
(`/usr/lib/sysctl.d/10-apparmor.conf`, in the `apparmor` package). An
unprivileged program may then create a *user namespace* (bubblewrap's
starting point) only if an AppArmor profile allows it. Without one, the
kernel lets it create the namespace but takes away the capabilities inside
it that bubblewrap needs. Ubuntu's background page:
[Understanding AppArmor user namespace restriction](https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007).
Ubuntu ships a profile for bubblewrap, but doesn't load it:

```bash
sudo cp /usr/share/apparmor/extra-profiles/bwrap-userns-restrict /etc/apparmor.d/
sudo apparmor_parser -r /etc/apparmor.d/bwrap-userns-restrict
```
- `cp` into `/etc/apparmor.d/` makes AppArmor load it at every boot.
- `apparmor_parser -r` loads it into the kernel now. `-r` replaces it if
  it's already loaded. See
  [apparmor_parser(8)](https://manpages.ubuntu.com/manpages/noble/en/man8/apparmor_parser.8.html).

What it does: it allows `/usr/bin/bwrap` to create user namespaces.
Everything bubblewrap then starts runs under the profile's `unpriv_bwrap`
part, which denies all capabilities. That's an extra layer on top of the
judge's own `--cap-drop ALL`. It applies to anyone running `bwrap` on the
VPS, which here is only you and the `maxrecall` user.

Check it:
```bash
sysctl kernel.apparmor_restrict_unprivileged_userns
```
`sysctl NAME` prints a kernel setting. It should print `= 1`. If it prints
`= 0`, the restriction is off and bubblewrap needs no profile.

```bash
sudo aa-status | grep -E 'bwrap'
```
`aa-status` lists loaded AppArmor profiles. It should list `bwrap` and
`unpriv_bwrap`. See [aa-status(8)](https://manpages.ubuntu.com/manpages/noble/en/man8/aa-status.8.html).

```bash
sudo -u maxrecall bwrap --unshare-all --unshare-user --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 -- true && echo sandbox ok
```
Tries a minimal sandbox as the service's user. It should print
`sandbox ok`.
- `--unshare-all --unshare-user` asks for new namespaces, including a user
  namespace.
- `--ro-bind /usr /usr` and the `--symlink`s give it the programs.
- `true` is a command that does nothing and succeeds.

If AppArmor is still in the way, the error is (seen on this VPS on
2026-11-02, before the profile was loaded):
`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. bubblewrap
creates the namespaces, but the capability it needs to set up the sandbox's
loopback network has been taken away. (Before that run I had guessed a
different message, `setting up uid map` or `Failed to make / slave`; this is
the real one.) From the checkout, `make sandbox-deps` recognises this and
loads the profile itself, asking for `sudo` if you're not root.

To see AppArmor's side of it:
```bash
journalctl -k -b | grep -iE 'apparmor.*(bwrap|unprivileged_userns)' | tail -5
```
- `-k` shows kernel messages only, and `-b` only this boot. See
  [journalctl(1)](https://www.freedesktop.org/software/systemd/man/latest/journalctl.html).
- `grep -iE` matches, ignoring case, lines about AppArmor and bwrap.
- `tail -5` keeps the last five.

On this VPS on 2026-11-02 it showed `apparmor="AUDIT"
operation="userns_create" … comm="bwrap" … target="unprivileged_userns"`,
where bwrap was moved into the restricted profile. Then came
`apparmor="DENIED" operation="capable" … profile="unprivileged_userns"
comm="bwrap"` for `capname="net_admin"` (the loopback setup) and
`capname="setpcap"`.

**Toolchains must be system-wide.** Sandboxes run as the service's user
(`maxrecall`), or as `nobody` if you run the server or `make` as root. They
can only use compilers and interpreters that user can read. One installed
in a home folder, such as `/root/.local/share/...`, can't be used. Then the
`Sandbox:` line says `toolchains the sandbox can't reach: … in <folder>`.
Install them as §1 and §2 do (`apt`, and Node in `/usr/local`), and take
the private copy off `PATH`. Seen on this VPS on 2026-11-02 with a DMD and a
Node 18 in `/root/.local/share`.

If the profile route fails, the fallbacks (plan §4) are a profile of our
own for the service, or turning the restriction off. **Don't** turn it off
without deciding to: it's machine-wide.

## 2. Node 22 [VPS]

Ubuntu 24.04's own `nodejs` package is 18.19, which is past end-of-life. The
app is developed and tested on Node 22. Install Node's official build:

```bash
uname -m
```
Prints `x86_64` (use `linux-x64` below) or `aarch64` (use `linux-arm64`).

```bash
cd /tmp
curl -fsSLO https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz
curl -fsSLO https://nodejs.org/dist/v22.23.4/SHASUMS256.txt
```
- `-f` fails on HTTP errors rather than saving an error page.
- `-sS` hides the progress output but still shows errors.
- `-L` follows redirects.
- `-O` saves under the file's own name.

See [curl(1)](https://curl.se/docs/manpage.html).

```bash
grep ' node-v22.23.4-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c -
```
Checks the download against the published checksum, and should print `OK`.
`sha256sum -c -` reads the expected hash from standard input.

As a second, independent check, the x64 hash should be
`1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce`. For arm64
it should be `6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b`.
Both were read from nodejs.org on 2026-10-29.

```bash
sudo tar -xJf node-v22.23.4-linux-x64.tar.xz -C /usr/local --strip-components=1 --no-same-owner
```
- `-x` extracts.
- `-J` handles the `.xz` compression.
- `-f` names the archive.
- `-C /usr/local` extracts there.
- `--strip-components=1` drops the archive's top folder, so `node` lands in
  `/usr/local/bin`.
- `--no-same-owner` makes the files owned by root rather than by whoever built
  the archive.

```bash
node --version
```
Should print `v22.23.4`.

v22.23.4 was the newest Node 22 release on 2026-10-29, and a security release.
Newer ones are listed at <https://nodejs.org/en/download>.

## 3. A user for the service [VPS]

```bash
sudo adduser --system --group --home /srv/maxrecall --shell /usr/sbin/nologin maxrecall
```
- `--system` makes a system account with no password and no login.
- `--group` gives it a group of the same name.
- `--home` sets its home folder, which `adduser` creates.
- `--shell /usr/sbin/nologin` stops anyone logging in as it.

See [adduser(8)](https://manpages.ubuntu.com/manpages/noble/en/man8/adduser.8.html).

## 4. The code and the data folder [VPS]

```bash
sudo -u maxrecall git clone https://github.com/pflagerd/maxrecall-dsa.net.git /srv/maxrecall/maxrecall-dsa.net
```
`sudo -u maxrecall` runs the command as that user, so it owns the files.

```bash
cd /srv/maxrecall/maxrecall-dsa.net
sudo -u maxrecall npm install --omit=dev
```
`--omit=dev` skips development-only packages (nodemon), which the server
doesn't need. See [npm install](https://docs.npmjs.com/cli/v10/commands/npm-install).

```bash
sudo -u maxrecall mkdir -p /srv/maxrecall/data/users
```
Submissions are saved here, **outside the checkout**
(`MAXRECALL_USERS_DIR` in the service file). That way a later `git pull` never
collides with records written on the VPS. `-p` creates any missing parent
folders. The folder must exist before the service starts, because systemd's
`ReadWritePaths` refuses a missing path. Accounts and sessions go next to it,
in `/srv/maxrecall/data/auth`, which the server creates itself.

**Optional: invites, to register on port 3000.** You don't need one to use
the app through the tunnel. Registering needs an invite code (since
2026-11-04; `docs/plans/limited-live.md`, step 1), one per person, including
you if you want an account for the login page:
```bash
cd /srv/maxrecall/maxrecall-dsa.net
sudo -u maxrecall env MAXRECALL_AUTH_DIR=/srv/maxrecall/data/auth make invite EMAIL=learner@example.com
```
- `sudo -u maxrecall` runs it as the service's user, so the server can read
  the invite file (owner-only, mode 600). Run as root, it refuses, saying
  whose folder it is.
- `env MAXRECALL_AUTH_DIR=…` points it at the service's sign-in folder (the
  unit file sets the same). Without it, the invite would go into the
  checkout's own `auth/`, which the service never reads. The first line it
  prints names the folder, so check it.
- `EMAIL=` is who to invite. It prints a code that works once, for that
  email, for 7 days. Send it to them; it isn't stored, only its hash.
- The server needn't be stopped.

They then open the login page, choose **Register**, and enter the email, the
code and a password of their own (at least 12 characters).

**Updating from a version before invites:** `/etc/maxrecall-dsa/test.env`
(`MAXRECALL_PASSWORD`) is no longer used, and the unit file no longer reads
it. Delete it:
```bash
sudo rm -r /etc/maxrecall-dsa
```
- `rm -r` removes the folder and the file in it. Existing accounts are
  untouched: logging in checks `auth/accounts/`, not this file.

## 5. Install and start the service [VPS]

```bash
sudo cp deploy/maxrecallcode.service /etc/systemd/system/
```
Copies the unit file to where systemd looks for local services. If you want a
different `MAXRECALL_USER`, edit the copy with `sudo vi
/etc/systemd/system/maxrecallcode.service`.

```bash
sudo systemctl daemon-reload
```
Makes systemd re-read its unit files.

The service is called `maxrecallcode.service` (since 2026-11-08, #123).
The commands below always give that full name.

It had two earlier names: `maxrecall-dsa.test.service` until 2026-11-08,
and `maxrecall-dsa.service` until 2026-10-29. `make deploy-server` removes
either if it finds it (§16 is the deploy that did the latest rename). By
hand, remove one first so the two don't both try to use ports 3000 and
3001; for the newer earlier name:
```bash
sudo systemctl disable --now maxrecall-dsa.test.service
sudo rm /etc/systemd/system/maxrecall-dsa.test.service
sudo systemctl daemon-reload
```
- `disable --now` stops it and stops it starting at boot.
- `rm` deletes its unit file.
- `daemon-reload` makes systemd forget it.
- The same three with `maxrecall-dsa.service`, if that one is there.

The journal keeps each entry under the name the unit had then (the
`_SYSTEMD_UNIT` field,
[systemd.journal-fields(7)](https://www.freedesktop.org/software/systemd/man/latest/systemd.journal-fields.html)),
so the log from before 2026-11-08 is `journalctl -u maxrecall-dsa.test.service`.

```bash
sudo systemctl enable --now maxrecallcode.service
```
- `enable` starts the service at every boot.
- `--now` also starts it immediately.

See [systemctl(1)](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html).

```bash
systemctl status maxrecallcode.service
```
Should say `active (running)`.

```bash
journalctl -u maxrecallcode.service -n 20
```
Shows the service's last 20 log lines (`-u` selects the unit, `-n` sets how
many lines). The latest start should show four lines:
`Server listening on 127.0.0.1:3000 only, … (submissions in /srv/maxrecall/data/users)`,
`Sign-in data in /srv/maxrecall/data/auth; registration by invite only …`,
`Sandbox: bubblewrap 0.9.0 works (self-test passed); …`, and
`Trusted listener on 127.0.0.1:3001 only: every request there is …`.

If the `Sandbox:` line says `UNAVAILABLE (…)`, Run and Submit are refused.
The text in brackets is the reason, often bwrap's own error. Go back to §1a.
**The unit's containment and bubblewrap.** On 2026-11-02 the service's
sandbox failed with `bwrap: Can't mount proc on /newroot/proc: Operation not
permitted`. Each sandbox mounts a fresh `/proc`, and the kernel refuses that
in a user namespace when parts of the existing `/proc` are covered by other
mounts (“Mount too revealing”: `mnt_already_visible` in
[fs/namespace.c](https://github.com/torvalds/linux/blob/master/fs/namespace.c)).
`ProtectKernelTunables=yes` mounts over `/proc/sys`, `/proc/kcore` and others
([systemd.exec(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#ProtectKernelTunables=)).

Two `systemd-run` tests confirmed it, each running the server's sandbox check
as `maxrecall` with the unit's settings:
- with every setting: `UNAVAILABLE`, the same error;
- the same without `ProtectKernelTunables=yes`: `works`.

So the unit no longer sets it (owner's decision). The service runs as an
unprivileged user with `NoNewPrivileges=yes`, so it couldn't write kernel
tunables anyway. Every other setting in the unit was in that test and works
with bubblewrap, except the `IPAddress…` rules, which filter network traffic
and weren't part of it.

To repeat the test, as root:
```bash
systemd-run --wait --pipe --quiet -p User=maxrecall -p WorkingDirectory=/srv/maxrecall/maxrecall-dsa.net -p ProtectSystem=strict -p ProtectHome=yes -p PrivateTmp=yes -p PrivateDevices=yes -p NoNewPrivileges=yes -p RestrictSUIDSGID=yes -p ProtectKernelModules=yes -p ProtectControlGroups=yes -p LockPersonality=yes /usr/local/bin/node -e 'console.log(require("./judge/sandbox").describeSandbox())'
```
- `systemd-run` starts a temporary unit; `--wait` waits for it and `--pipe`
  shows its output here ([systemd-run(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html)).
- `--quiet` hides systemd's own messages.
- Each `-p NAME=VALUE` sets one unit property: here, the unit file's settings.
- It prints the server's `Sandbox:` description. Add
  `-p ProtectKernelTunables=yes` to see the failure.

## 6. Check it's private and contained [VPS, then Kubuntu]

**[VPS]**
```bash
ss -tlnp | grep -E ':300[01]'
```
- `ss` lists sockets: `-t` TCP, `-l` listening, `-n` numeric addresses, `-p`
  the owning process.
- `grep -E ':300[01]'` keeps lines for ports 3000 and 3001.
- It should show `127.0.0.1:3000` and `127.0.0.1:3001`, **not** `0.0.0.0:…` or
  `*:…`.

**[Kubuntu]**
```bash
curl --max-time 5 http://srv702017.hstgr.cloud:3000/
curl --max-time 5 http://srv702017.hstgr.cloud:3001/
```
Both should **fail** (timeout or connection refused). If either returns
anything, stop the service and recheck the service file.

**[VPS]**
```bash
sudo systemd-analyze security maxrecallcode.service
```
Lists the containment settings and an overall exposure score, where lower is
better. See [systemd-analyze(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-analyze.html).

Once the tunnel works (step 7), you can test the network block from the app.
Open **Hello World**, choose **Python**, and **Run** (not Submit):
```python
import urllib.request
print(urllib.request.urlopen("https://example.com", timeout=5).status)
```
It should fail with a network error rather than print `200`. I'm guessing
it will say something like "Operation not permitted" or "Network is
unreachable"; I couldn't test the exact message from the cloud sandbox.

## 7. Use it: the SSH tunnel [Kubuntu]

```bash
ssh -N -L 3000:127.0.0.1:3001 root@srv702017.hstgr.cloud
```
- `-L 3000:127.0.0.1:3001` forwards port 3000 on your machine to
  `127.0.0.1:3001` *as seen from the VPS*, that is, to the trusted port.
- `-N` runs no remote command; the connection exists only to carry the tunnel.
- Leave it running, and press Ctrl-C to close the tunnel.

See [ssh(1)](https://man.openbsd.org/ssh#L).

Then open <http://localhost:3000>. There's no login page. The header shows
your email and a yellow **trusted (SSH tunnel)** marker.

If `make dev` is already using port 3000 on Kubuntu, use another local port,
e.g. `-L 3005:127.0.0.1:3001`, then open <http://localhost:3005>.

**To try the login page as well,** also forward the normal port by adding
`-L 3006:127.0.0.1:3000` to the same command, then open
<http://localhost:3006>. Registering there needs an invite code from
step 4. Browsers keep cookies per host name, not per port, so all these
`localhost` addresses share one sign-in cookie. That's harmless here: the
trusted port ignores it.

## 8. Updating to the latest code [VPS]

**Normally, deploy an update with the guarded deploy** ("The quick
way", "Updating: the guarded deploy"), which does what follows and
checks it's the commit the owner approved. This section is what it does,
by hand.

```bash
cd /srv/maxrecall/maxrecall-dsa.net
sudo -u maxrecall git pull --ff-only
```
`--ff-only` refuses to create a merge. The VPS checkout should only ever
follow GitHub, never have commits of its own.

```bash
sudo -u maxrecall npm install --omit=dev
sudo systemctl restart maxrecallcode.service
```
Picks up any dependency changes, then restarts the server so it runs the new
code.

If `deploy/maxrecallcode.service` itself changed, copy it again (step 5) and
run `sudo systemctl daemon-reload` before restarting.

**If the pull renamed or deleted a question** (its commit says "Rename
question …" or "Delete question …"; `git diff --stat ORIG_HEAD` shows it),
the users' files on the VPS still name the old question: `git pull` changes
the checkout, not `/srv/maxrecall/data/users`. Update them with the server
stopped, before the restart above (spaced-repetition plan, step 11):

```bash
sudo systemctl stop maxrecallcode.service
```
Stops the server: the command refuses while one answers, since both rewrite
`order.json`.

```bash
sudo -u maxrecall env MAXRECALL_USERS_DIR=/srv/maxrecall/data/users DRY_RUN=1 make rename-question FROM=old-name TO=new-name
```
- `sudo -u maxrecall`: as the service's user, so the files keep their owner.
- `env MAXRECALL_USERS_DIR=…`: the users folder the service uses (its unit
  file sets the same).
- `DRY_RUN=1`: prints what would change, and changes nothing. Run it again
  without `DRY_RUN=1` to do it.
- `FROM` and `TO`: the old and new names. The file was already renamed by the
  pull, so it says "already renamed (e.g. by git pull): only the references".

For a deleted question, `make delete-question SLUG=its-name` the same way.
Then `sudo systemctl start maxrecallcode.service`, and check the
`Consistency:` lines with `journalctl` (step 5).

**Updating to a version with the sandbox check (2026-11-02 or later)** for the
first time: do §1a before restarting, or Run and Submit will be refused.
Check the `Sandbox:` line with `journalctl` (step 5).

## 9. Copying VPS submissions to Kubuntu (optional) [Kubuntu]

The VPS has no GitHub credentials, and it doesn't need any. `users/` is
gitignored (since 2026-10-30), so submissions aren't committed anywhere. If you
want the VPS's records on Kubuntu too, copy them into your checkout:

```bash
cd ~/path/to/maxrecall-dsa.net
rsync -av --ignore-existing root@srv702017.hstgr.cloud:/srv/maxrecall/data/users/ users/
```
- `-a` (archive) copies folders recursively and keeps file times.
- `-v` lists what's copied.
- `--ignore-existing` never overwrites a file you already have. Submission
  names are timestamps, so the VPS's and Kubuntu's records don't clash.
- The trailing `/` on the source means "the contents of this folder".

See [rsync(1)](https://download.samba.org/pub/rsync/rsync.1).

If you log in as a user other than root, `/srv/maxrecall` may not be readable
by you, since `adduser` makes home folders private by default (my guess for
24.04's defaults). In that case add `--rsync-path="sudo rsync"`, which needs
`sudo` to work without a password prompt over SSH.

## 10. Starting over with a chosen backlog [VPS, then Kubuntu]

Added 2026-11-04 (spaced-repetition plan, step 13, detail 6). This puts
your records aside, not deleting them, and starts you with no records, only
Hello World in your backlog, and only Python turned on. From then on, the
server adds nothing to your backlog by itself: you choose what comes next
with `make backlog-add`. It needs the step 13 code on the VPS: once its
pull request is merged, update first ("The quick way", or §8).

All commands are run as root on the VPS.

```bash
systemctl stop maxrecallcode.service
```
- Stops the server: `make backlog-add` refuses while one answers, since a
  Submit rewrites `backlog.json` too.

```bash
install -d -o maxrecall -g maxrecall -m 750 /srv/maxrecall/data/archive
```
- Creates the folder your old records go to. `-d` creates a directory,
  `-o`/`-g` set its owner and group, `-m 750` lets only `maxrecall` (and
  its group) in. See [install(1)](https://www.gnu.org/software/coreutils/manual/html_node/install-invocation.html).
- It must be **outside** `users/`: the server counts any folder there whose
  name looks like an email (`users.js`, `EMAIL_PATTERN`) as a user, and
  `daniel.pflager@gmail.com.old` matches that pattern.

```bash
mv /srv/maxrecall/data/users/daniel.pflager@gmail.com /srv/maxrecall/data/archive/daniel.pflager@gmail.com.$(date -u +%Y%m%dT%H%M%SZ)
```
- Moves your whole folder (records, `profile.json`, `order.json`,
  `backlog.json`) aside, named with the UTC time. `date -u +FORMAT` prints
  the time in UTC in that format ([date(1)](https://www.gnu.org/software/coreutils/manual/html_node/date-invocation.html)).
  If it says "No such file or directory", you had nothing there yet:
  carry on. To undo, stop the server and move it back.
- Your sign-in account, in `/srv/maxrecall/data/auth`, isn't touched.

```bash
sudo -u maxrecall mkdir /srv/maxrecall/data/users/daniel.pflager@gmail.com
```
- `sudo -u maxrecall` runs it as the service's user, so the folder is
  its own ([sudo(8)](https://www.sudo.ws/docs/man/sudo.man/)).

```bash
sudo -u maxrecall vi /srv/maxrecall/data/users/daniel.pflager@gmail.com/profile.json
```
Put this in it:
```json
{
  "schemaVersion": 1,
  "preferred": { "languages": ["python"] },
  "backlog": "chosen"
}
```
- `preferred.languages`: only Python turned on. It's what the language
  menu on the problem page changes, so you can turn others back on there.
  For a lock the menu can't undo, use `"allowed": { "languages":
  ["python"] }` instead.
- `"backlog": "chosen"`: the server adds nothing to your backlog by
  itself.
- A mistake (an unknown field, `"choosen"`) makes the server refuse your
  Run and Submit and log why, rather than guess.

```bash
cd /srv/maxrecall/maxrecall-dsa.net
```

```bash
sudo -u maxrecall env MAXRECALL_USERS_DIR=/srv/maxrecall/data/users make backlog-show EMAIL=daniel.pflager@gmail.com
```
- `env MAXRECALL_USERS_DIR=…`: the users folder the service uses (its unit
  file sets the same); without it, the script would look in the checkout.
  See [env(1)](https://www.gnu.org/software/coreutils/manual/html_node/env-invocation.html).
- `EMAIL`: whose backlog. Only reads. The first line should say
  `backlog "chosen"; languages turned on: python`, then an empty queue and
  backlog, then every question with `python: not chosen`.

```bash
sudo -u maxrecall env MAXRECALL_USERS_DIR=/srv/maxrecall/data/users make backlog-add EMAIL=daniel.pflager@gmail.com SLUGS=hello-world DRY_RUN=1
```
- `SLUGS`: the questions to add, by file name without `.json`, separated
  by spaces (quote them: `SLUGS="hello-world two-sum"`), in the order you
  want them. Each is added in every language you have turned on.
- `DRY_RUN=1`: shows `Backlog after (1): 1. hello-world in python` and
  writes nothing. Run it again without `DRY_RUN=1` to write it.

```bash
systemctl start maxrecallcode.service
```

```bash
journalctl -u maxrecallcode.service -n 20 --no-pager | grep -E 'Queues|Consistency'
```
Should show `Queues: daniel.pflager@gmail.com: 0 in order.json, 1 in
backlog.json (0 added)` and `Consistency: … nothing found`. `(0 added)` is
the chosen backlog working.

**[Kubuntu]** Open the tunnel (§7) and <http://localhost:3000>. The list
should hold one row, Hello World in Python, marked **new**. (Until
2026-11-04, opening a problem page could copy language choices kept in the
browser from before 2026-11-03 into your profile, once. That copy has been
removed, so the profile is the only place they're kept.)

**Adding questions later.** The same three steps each time: stop the
server, `make backlog-add` (with `AT=1` to put them at the front instead of
the end), start it. `make backlog-remove … SLUGS="…"` takes them out of
the backlog again. What you add comes into your queue at your **next Submit
or Skip**, not at once: with only Hello World in the queue, Next is Hello
World once more, and the new ones come in after that Submit.

## 11. Setting up a new tester before inviting them [VPS, then Kubuntu]

Added 2026-11-04 (the owner's answer to Q3 in `docs/plans/limited-live.md`:
option (b), each tester set up by hand, as §10 set up the owner; since
2026-11-05, option (c): one command, `make learner-create`, does it). Without
this, a tester gets no `profile.json`, so `"backlog": "all"`: every
question in all five languages waiting for them. With it, they start with
the languages and questions you choose.

**Before anyone else, try it on a second email address of your own**
(limited-live step 5): testers can't reach the VPS until limited-live
steps 2–4 (firewall, nginx, certificate) are done, but you can, through
the tunnel to port 3000 (§7). It needs invites, so the VPS must have
limited-live step 1 (pull request #52, 2026-11-04) or later: §8, or "The
quick way".

In the commands below, replace `tester@example.com` with their email. Run
them as root on the VPS. `docs/how-to-add-a-new-user.html` (2026-11-05)
walks through the same steps, with what to send a tester and what to do
later (more questions, a forgotten password, taking someone off).

**1. Their folder, languages and questions: `make learner-create`**
(since 2026-11-05, spaced-repetition step 14; it replaces making the
folder, writing `profile.json` in vi and `make backlog-add` by hand). The
server keeps running.

```bash
cd /srv/maxrecall/maxrecall-dsa.net
```

```bash
sudo -u maxrecall env MAXRECALL_USERS_DIR=/srv/maxrecall/data/users make learner-create EMAIL=tester@example.com LANGUAGES=python SLUGS="hello-world two-sum" DRY_RUN=1
```
- `sudo -u maxrecall`: as the service's user, so the folder and files are
  its own.
- `MAXRECALL_USERS_DIR`: the service's users folder (its unit file sets
  the same); without it the files would go into the checkout's own
  `users/`, which the service never reads.
- `EMAIL`: who. It's lower-cased, as registering makes it (`auth.js`,
  `normalizeEmail`), so their work goes to this folder; the first line
  printed says so if it changed anything.
- `LANGUAGES`: the languages they may use, the first being their default
  (`LANGUAGES="python java"` for two). They become `allowed.languages`,
  not `preferred` as in §10: the tester can't turn on another language, or
  turn Python off. With a chosen backlog that matters: if every chosen
  question's language were turned off, Next would have nothing to give
  them.
- `SLUGS`: their questions, in the order they'll get them, each in every
  one of their languages it has. `make backlog-show EMAIL=<anyone>` lists
  every question. Give several now: what's added later only comes in at
  their next Submit or Skip (§10, "Adding questions later").
- `DRY_RUN=1`: shows the `profile.json` and backlog it would write, and
  writes nothing. If they're right, run it again without `DRY_RUN=1`.

It writes `profile.json` (with `"backlog": "chosen"`: the server adds
nothing to their backlog by itself), an empty `order.json` and
`backlog.json`, all appearing at once. It refuses, changing nothing, if
their folder exists already: they're set up, or have used the app.
`make backlog-show EMAIL=…` then shows what's there, and `make backlog-add`
and `backlog-remove` (server stopped) change it. The other `allowed`
settings (`canChooseLanguages`, `canSwitchLanguage`,
`canSetDefaultLanguage`) are left at their default, true; see
readme.html, "Where data lives".

**2. Check it:**

```bash
sudo -u maxrecall env MAXRECALL_USERS_DIR=/srv/maxrecall/data/users make backlog-show EMAIL=tester@example.com
```
- The first line should say `backlog "chosen"; languages turned on:
  python`, then an empty queue and their questions in the backlog. No
  restart is needed: the server reads a learner's files at each request.
  The next start logs them as `Queues: tester@example.com: 0 in
  order.json, 2 in backlog.json (0 added)`.

**3. The invite.** The server keeps running.

```bash
sudo -u maxrecall env MAXRECALL_AUTH_DIR=/srv/maxrecall/data/auth make invite EMAIL=tester@example.com
```
- `MAXRECALL_AUTH_DIR` (sign-in data), not `MAXRECALL_USERS_DIR`
  (learning data): §4 explains each part. It prints a code that works
  once, for this email, for 7 days. Send them the code and the address,
  and tell them to register with exactly this email.
- If the code runs out, run it again: a new invite replaces the old one.
  Their folder and backlog don't change.

**4. Check it as them [Kubuntu].** For your own second email: open the
tunnel with port 3000 forwarded as well (§7,
`ssh -N -L 3000:127.0.0.1:3001 -L 3006:127.0.0.1:3000 root@srv702017.hstgr.cloud`), then
open <http://localhost:3006/login.html#register> in a **private window**.
Browsers keep cookies per host name, not per port, so in a normal window
the new sign-in would replace yours (§7). Register with the email, the
code and a password of at least 12 characters. The header should show the
tester's email (no trusted marker), and the list their chosen questions in
Python, marked **new**. The language menu shows only Python.

**By design:** a chosen backlog limits what Next and the list offer, not
what can be opened. A tester who types another question's address
(`problem.html?slug=…`) can do it, and a Submit or Skip then puts it in
their queue: a feature (owner, 2026-11-06; readme, Decisions), described
in `docs/how-to-put-a-question-directly-into-my-queue-by-slug.html`.
Their profile still limits the languages (403 for the others).

**What this doesn't do:**
- Each later change to a backlog (`make backlog-add`, `backlog-remove`)
  stops the site for everyone for a few seconds (limited-live plan, "What
  spaced-repetition step 13 changes here"). Setting a learner up with
  `make learner-create` doesn't.
- A setup that's never used stays: the folder counts as a user at every
  start and in `make consistency-check`. To remove it, stop the server and
  move the folder to `/srv/maxrecall/data/archive/`, as in §10.

## 12. The firewall: only SSH in [VPS, then Kubuntu]

Added 2026-11-04: step 2 of `docs/plans/limited-live.md` (numbered 12
because pull request #54 added §11, setting up a new tester). It turns on
Ubuntu's firewall, `ufw` ("uncomplicated firewall"), so that nothing but
SSH can be reached from outside. Today the app's ports already listen on
`127.0.0.1` only, so this is a second layer: anything that starts listening
on a public address later (by mistake, or a package's default) stays
unreachable. Ports 80 and 443 are opened in step 3, together with nginx,
when something answers on them.

**What doesn't change.** Your SSH tunnel keeps working: it reaches
`127.0.0.1:3001` over the loopback interface, `lo`, and `ufw` accepts
everything there before its own rules (`/usr/share/ufw/iptables/before.rules`,
lines 20–22, `-A ufw-before-input -i lo -j ACCEPT`, read from Ubuntu
24.04's `ufw` 0.36.2-6 package on 2026-11-04). It's separate from the
service's own `IPAddressDeny=`/`IPAddressAllow=` (§5): that limits what
the server's processes may talk to; `ufw` limits what may reach the
machine. Outgoing traffic (`apt`, `git pull`) stays allowed.

**The risk is locking yourself out of SSH.** The steps below allow SSH
before turning the firewall on, check it from a fresh connection, and keep
a second session open meanwhile. All commands are run as root.

```bash
ufw status verbose
```
- Shows whether `ufw` is on and its rules. Expect `Status: inactive` if
  nobody has turned it on. If it's already active with rules, stop here and
  paste the output into a session, rather than adding to rules nobody has
  looked at. See [ufw(8)](https://manpages.ubuntu.com/manpages/noble/en/man8/ufw.8.html).
- `ufw` is part of Ubuntu's standard install. If the command isn't found:
  `apt install -y ufw`.

```bash
ss -tlnp
```
- Lists every listening TCP socket: `-t` TCP, `-l` listening, `-n`
  numbers rather than names, `-p` the process
  ([ss(8)](https://manpages.ubuntu.com/manpages/noble/man8/ss.8.html)).
- Find SSH's port: usually `0.0.0.0:22` and `[::]:22`. On 24.04 the
  process column may say `systemd` rather than `sshd`, if SSH is started
  by systemd's `ssh.socket` (my understanding of 24.04's default; either
  way the port is what matters).
- Note anything else listening on `0.0.0.0`, `[::]` or the VPS's own
  address. Once the firewall is on, those are unreachable from outside.
  `127.0.0.1:3000` and `127.0.0.1:3001` are the app and aren't affected.

**Before going on, open a second SSH session to the VPS** and leave it
alone. `ufw` lets connections that already exist carry on whatever the
rules say (`before.rules` line 25, `--ctstate RELATED,ESTABLISHED -j
ACCEPT`, in the same package), so if the new rules are wrong you can still
type `ufw disable` there.

```bash
ufw default deny incoming
ufw default allow outgoing
```
- New connections from outside are refused unless a rule allows them;
  connections this machine makes are allowed. These are already `ufw`'s
  defaults (`/etc/default/ufw`: `DEFAULT_INPUT_POLICY="DROP"`,
  `DEFAULT_OUTPUT_POLICY="ACCEPT"`); setting them says so explicitly.

```bash
ufw allow 22/tcp comment 'SSH'
```
- Allows new connections to port 22, for IPv4 and IPv6 (`IPV6=yes` is the
  default in `/etc/default/ufw`). If `ss` showed SSH on another port, use
  that number instead.
- `comment` is a label shown by `ufw status`.
- **`allow`, not `limit`.** `ufw limit` denies an address that "attempts to
  initiate 6 or more connections within 30 seconds" (ufw(8)). That would
  stop password guessing, but also you: `rsync` and `git` over SSH each open
  a connection, and fetching a git repository per user (plan, D5) opens one
  per user. Key-only SSH logins are the better protection against guessing
  (plan, "Also worth doing").

```bash
ufw show added
```
- Lists the rules added so far, before anything is turned on (`added` is
  one of `ufw show`'s reports, `ufw/frontend.py` line 65). It should
  show `ufw allow 22/tcp comment 'SSH'` (or your port).

```bash
ufw enable
```
- Turns the firewall on now and at every boot. It warns `Command may
  disrupt existing ssh connections.` (`ufw/frontend.py`, line 912, in the
  same package) and asks whether to go on; answer `y`.

```bash
ufw status verbose
```
- Should say `Status: active`, `Default: deny (incoming), allow (outgoing)`,
  and `22/tcp ALLOW IN Anywhere` and `22/tcp (v6) ALLOW IN Anywhere (v6)`.

**[Kubuntu] Check it from a fresh connection,** in a new terminal, while
both VPS sessions stay open:

```bash
ssh root@srv702017.hstgr.cloud true && echo "ssh ok"
```
- Opens a new SSH connection, runs `true` (which does nothing and
  succeeds) and prints `ssh ok`. That's the proof that new connections get
  through, not just the ones already open.
- **Run it on Kubuntu, not on the VPS.** On the VPS its own name resolves
  to `127.0.1.1` (`/etc/hosts`), so the connection goes over loopback,
  which `ufw` always accepts, and tests nothing (seen 2026-11-05).

Then open the tunnel (§7) and <http://localhost:3000>: the app should work
as before.

```bash
curl --max-time 5 http://srv702017.hstgr.cloud:3000/
```
- Should still fail, as in §6, and now it should **time out**
  (`curl: (28) Connection timed out`) rather than be refused: `ufw` drops
  the packet without answering (`DEFAULT_INPUT_POLICY="DROP"`), where
  before the VPS answered "nothing listens here". Seen on 2026-11-05.

**If the fresh connection fails,** go back to the second VPS session and
run `ufw disable`, which turns the firewall off and keeps its rules for
later; then look at what `ss` said about SSH's port. If you've lost every
session, Hostinger's control panel may have a browser console for the VPS
(I haven't checked).

**Hostinger may also have a firewall of its own,** in its control panel,
in front of the VPS (not checked). If it's configured, a port must be
allowed in both. For step 3, 80 and 443 then need opening there too.

## 13. HTTPS for the world: nginx and a certificate [VPS, then Kubuntu]

Added 2026-11-05: step 3 of `docs/plans/limited-live.md`. It puts nginx in
front of the app, so the site is at **<https://maxrecallcode.net>**, with
`maxrecallcode.com` and `maxrecallcode.org` redirecting there (owner,
2026-11-05; no `www`). Visitors get the app's own sign-in (an invite,
§11). Until 2026-11-06 a shared Basic auth login came first (plan, D3);
an installation that has it removes it with **step 8**. The
configuration is `deploy/nginx-maxrecallcode.conf`; read its comments for
what each part does, including the sign-in limits: 10 attempts a minute
per visitor (an IPv6 /64 counting as one, approximately) and 30 a
minute for the whole site.

**What doesn't change:** the app still listens on `127.0.0.1` only, nginx
connects to it there, and only to port 3000, which needs signing in. The
trusted port, 3001, stays reachable only through your SSH tunnel (§7). The
service's own network filter (`IPAddressAllow=localhost`, §5) is untouched:
nginx talks to it over loopback.

**Tested in a cloud session, 2026-11-05**, with Ubuntu 24.04's nginx 1.24.0
(certbot 2.9.0's options, messages and timer read from its package),
a self-signed certificate in the certbot path, and the app behind it:
- the redirects (`http://…`, and `https://` for `.com` and `.org`) keep the
  path and query;
- the Basic auth: 401 without it or with a wrong password;
- HSTS on every answer, a 401 included;
- HTTP/2, TLS 1.2 and 1.3;
- TLS 1.1 refused by the server;
- the app saw `X-Forwarded-Proto: https` and nginx's own `X-Forwarded-For`,
  not the fake ones sent, and no `Authorization`;
- registering through nginx set the session cookie with `Secure`, and
  `trusted` was false;
- 30 quick `/api/auth/me` all 200, while quick logins got 429 after the
  burst.

Not testable there: the `listen [::]` lines (the cloud has no IPv6; the VPS
has), and Let's Encrypt itself.

**Tested again in a cloud session, 2026-11-06**, after removing Basic auth
(nginx 1.24.0, the real file with only its `listen`, certificate and
`proxy_pass` lines changed, `nginx -t` passing):
- a page loads with no login prompt, HSTS still set, and an
  `Authorization` header sent by the visitor doesn't reach the app;
- one visitor's 16 quick logins: 6 answered (1 plus the burst of 5), then
  429;
- 20 visitors' one login each: 11 answered (1 plus the site-wide burst of
  10), then 429; `/api/auth/me` straight after: 30 of 30 answered;
- the per-visitor key, checked on 8,000 random IPv6 addresses written as
  nginx writes `$remote_addr` (a port of `ngx_inet6_ntop`, nginx's
  `src/core/ngx_inet.c`): no key empty, no key standing for two /64s, at
  most 2 keys for one /64. Without the map's middle line, 5 keys stood
  for several /64s each, so the check finds that mistake. The cloud has
  no IPv6, so the map was given the addresses as a query parameter
  rather than as real connections.

**Before you start:**
- This section's pull request is merged (the configuration file comes from
  the repo).
- DNS for all three names (checked by the owner, 2026-11-05). On Kubuntu:
  ```bash
  for d in maxrecallcode.net maxrecallcode.com maxrecallcode.org; do echo "$d: $(dig @1.1.1.1 +short $d A) $(dig @1.1.1.1 +short $d AAAA)"; done
  ```
  - Each line should show both of the VPS's addresses. `@1.1.1.1` asks a
    public DNS server rather than your own (cached) one.
- If Hostinger's control panel has a firewall for the VPS, allow 80 and 443
  there too (not checked whether it has one).

All commands below are run as root on the VPS.

### 1. The code and the packages

```bash
git -C /root/maxrecall-dsa.net pull --ff-only
```
- Updates the checkout you run `make` from, so it has the configuration
  file. `-C` runs git in that folder; `--ff-only` only ever moves forward
  to match GitHub.

```bash
apt install -y nginx certbot
```
- nginx 1.24 is in Ubuntu's **main** archive (Canonical's security
  updates); certbot 2.9.0 is in universe and only runs to get or renew the
  certificate (plan, D1). `-y` answers yes.
- nginx starts at once with Ubuntu's welcome page on port 80. Nobody can
  see it yet: the firewall still blocks 80 (§12).

```bash
rm /etc/nginx/sites-enabled/default
```
- Turns the welcome page off. (`sites-available/default` stays, unused.)

### 2. Open ports 80 and 443

```bash
ufw allow 80/tcp comment 'HTTP (nginx: redirect, certbot)'
```
```bash
ufw allow 443/tcp comment 'HTTPS (nginx)'
```
- Port 80 is needed even though the site is HTTPS only: browsers start
  there when someone types the bare name, and Let's Encrypt checks the
  domain over it, now and at every renewal.

```bash
ufw status
```
- Should list 22, 80 and 443, each for IPv4 and v6.

### 3. A temporary site, for the first certificate

nginx won't load the real configuration until the certificate it names
exists, so first a small site that only answers Let's Encrypt's check.

```bash
install -d /var/www/letsencrypt/.well-known/acme-challenge
```
- `install -d` creates the folders (all of them, like `mkdir -p`). certbot
  puts its one-time check files in the last one, and nginx serves them.

```bash
cat > /etc/nginx/sites-available/acme-bootstrap.conf <<'END'
server {
    listen 80;
    listen [::]:80;
    server_name maxrecallcode.net maxrecallcode.com maxrecallcode.org;
    location /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 404; }
}
END
```
- `cat > FILE <<'END' … END` writes the lines between into the file (a
  *here-document*; the quotes around `END` keep `$` and the like as they
  are).

```bash
ln -s /etc/nginx/sites-available/acme-bootstrap.conf /etc/nginx/sites-enabled/
```
- nginx reads `sites-enabled/` (`/etc/nginx/nginx.conf`, line 60); a
  symbolic link there turns a site on.

```bash
nginx -t && systemctl reload nginx
```
- `nginx -t` checks the configuration without changing anything; `&&`
  reloads only if it passed. A reload keeps nginx running.

```bash
echo ping > /var/www/letsencrypt/.well-known/acme-challenge/ping
```

**[Kubuntu]**, the same check Let's Encrypt will make:
```bash
for d in maxrecallcode.net maxrecallcode.com maxrecallcode.org; do echo "$d: $(curl -sS --max-time 10 http://$d/.well-known/acme-challenge/ping)"; done
```
- Each should print `ping`. A timeout means a firewall (ufw, or
  Hostinger's) still blocks port 80.

### 4. The certificate

```bash
certbot certonly --webroot -w /var/www/letsencrypt --cert-name maxrecallcode.net -d maxrecallcode.net -d maxrecallcode.com -d maxrecallcode.org --dry-run
```
- A **trial against Let's Encrypt's staging server** (`--dry-run`), which
  saves nothing. Let's Encrypt limits how many real certificates a domain
  can get, so try here first.
- `certonly`: only get the certificate; certbot doesn't touch nginx's
  configuration (that's the repo's file).
- `--webroot -w /var/www/letsencrypt`: certbot proves you control the names
  by writing a file there, which Let's Encrypt fetches over port 80.
- `--cert-name maxrecallcode.net`: the certificate's name, so it lands in
  `/etc/letsencrypt/live/maxrecallcode.net/`, where the configuration looks.
- One `-d` per name: one certificate covers all three.
- The first run asks for an email address (for notices about the
  certificate) and to agree to Let's Encrypt's terms.

It should end with `The dry run was successful.` Then for real:

```bash
certbot certonly --webroot -w /var/www/letsencrypt --cert-name maxrecallcode.net -d maxrecallcode.net -d maxrecallcode.com -d maxrecallcode.org --deploy-hook 'systemctl reload nginx'
```
- `--deploy-hook`: after each successful renewal, reload nginx so it uses
  the new certificate. certbot saves it in
  `/etc/letsencrypt/renewal/maxrecallcode.net.conf` (as `renew_hook`), so
  it applies to every renewal, not just this run.
- It should say `Successfully received certificate.` and name the files in
  `/etc/letsencrypt/live/maxrecallcode.net/`.

Renewal is automatic: the package's `certbot.timer` runs `certbot -q renew`
twice a day (`/usr/lib/systemd/system/certbot.timer`), which renews when
the certificate has 30 days or fewer left (`"renew_before_expiry": "30
days"`, certbot 2.9.0's `_internal/constants.py`, line 160).

### 5. (No longer done) The testers' shared login

Until 2026-11-06 this step made `/etc/nginx/maxrecall.htpasswd`, a shared
Basic auth login nginx asked for before the app (plan, D3). The
configuration no longer reads it, so a new installation skips this step;
an existing one deletes the file in step 8. Kept so the steps keep their
numbers.

### 6. The real site

```bash
cp /root/maxrecall-dsa.net/deploy/nginx-maxrecallcode.conf /etc/nginx/sites-available/maxrecallcode.conf
```
```bash
ln -s /etc/nginx/sites-available/maxrecallcode.conf /etc/nginx/sites-enabled/
```
```bash
rm /etc/nginx/sites-enabled/acme-bootstrap.conf
```
- The real configuration answers Let's Encrypt's checks on port 80 itself,
  so the temporary site goes (two sites for the same names on port 80
  would make nginx warn and use only one).

```bash
nginx -t && systemctl reload nginx
```

```bash
certbot renew --dry-run
```
- Rehearses a renewal against the staging server, through the real
  configuration. Should end `Congratulations, all simulated renewals
  succeeded`.

**Updating the configuration later:** copy the file again, then
`nginx -t && systemctl reload nginx`. If the change gives an existing
`limit_req_zone` a different key, use `systemctl restart nginx`
instead: a reload refuses it, logs an `[emerg]` line in
`/var/log/nginx/error.log`, and keeps the old configuration (step 8).
After any reload, `tail -n 3 /var/log/nginx/error.log` shows whether it
took.

### 7. Check it [Kubuntu]

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' 'http://maxrecallcode.com/problem.html?slug=x'
```
- `-o /dev/null` throws the page away; `-w` prints the status and where it
  redirects. Should print `301 https://maxrecallcode.net/problem.html?slug=x`.

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://maxrecallcode.org/
```
- Should print `301 https://maxrecallcode.net/`, with no certificate error.

```bash
curl -sSI https://maxrecallcode.net/
```
- `-I` shows only the headers. Should be `HTTP/2 302` with
  `location: /login.html?next=%2F` (the app's gate) and
  `strict-transport-security: max-age=86400`, and no `www-authenticate`
  line. (Until step 8, it was `HTTP/2 401` with
  `www-authenticate: Basic realm="MaxRecall testing"`.)

```bash
curl --max-time 5 http://maxrecallcode.net:3000/
```
- Should still time out: only 80 and 443 are open (§12).

**In a browser**, open <https://maxrecallcode.net> in a private window:
the app's login page appears, with nothing asked before it. The padlock
should name Let's Encrypt.

**Your own account.** Through the tunnel you never needed one, so you may
not have one on the VPS (registration was closed there before invites):
```bash
cd /srv/maxrecall/maxrecall-dsa.net
```
```bash
sudo -u maxrecall env MAXRECALL_AUTH_DIR=/srv/maxrecall/data/auth make invite EMAIL=daniel.pflager@gmail.com
```
- Then register on <https://maxrecallcode.net/login.html#register> with that
  email, the code and a password of your own. Your records are already in
  `users/` under that email, so they're yours as soon as you sign in.

**To take the site offline again:** `rm /etc/nginx/sites-enabled/maxrecallcode.conf`,
then `systemctl reload nginx`. The tunnel keeps working.

### 8. Removing the shared login (2026-11-06, plan D3 revised) [VPS, then Kubuntu]

For an installation made before 2026-11-06, which has the shared Basic
auth login. Two pull requests come first, both merged: #80 (`auth.js`
and `server.js`: what Basic auth was hiding from strangers) and the one
that removes `auth_basic` from the configuration. The app is deployed
before nginx changes, so the fixes are running before strangers can
reach them. All commands as root on the VPS until "On Kubuntu".

```bash
git -C /root/maxrecall-dsa.net pull --ff-only
```
- Updates the checkout you run `make` from (step 1).

```bash
cd /root/maxrecall-dsa.net
```
```bash
make deploy-server
```
- Deploys `master` to the service ("The quick way", above): the fixes
  from #80, and the service file's new `NODE_ENV=production`, which the
  script installs because the file changed. Should end with `Deployed:`.

```bash
systemctl show -p Environment maxrecallcode.service
```
- `show -p` prints one of the unit's properties
  ([systemctl](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)).
  The line should include `NODE_ENV=production`.

```bash
cp /root/maxrecall-dsa.net/deploy/nginx-maxrecallcode.conf /etc/nginx/sites-available/maxrecallcode.conf
```
```bash
nginx -t
```
- Checks the configuration on disk. Should end `test is successful`.

```bash
systemctl restart nginx
```
- **A restart, not a reload, for this change.** The per-visitor zone,
  `maxrecall_signin`, now has a different key (`$maxrecall_visitor`
  rather than `$binary_remote_addr`), and a reload refuses to change an
  existing zone's key: it logs `[emerg] limit_req "maxrecall_signin" uses
  the "$maxrecall_visitor" key while previously it used the
  "$binary_remote_addr" key` and keeps the old configuration running
  ([`ngx_http_limit_req_module.c`](https://github.com/nginx/nginx/blob/release-1.24.0/src/http/modules/ngx_http_limit_req_module.c),
  lines 713–719). `nginx -t` can't see this: it doesn't compare with the
  running nginx's zones. A restart starts with new zones. The site is
  down for about a second; the tunnel to 3001 doesn't go through nginx.
  From here the site has no shared login.
- **What happened when the owner ran it (2026-11-06 UTC):** this step was
  `nginx -t && systemctl reload nginx`, the check that followed still got
  `HTTP/2 401` with `www-authenticate: Basic`, and
  `grep emerg /var/log/nginx/error.log` showed the line above. A restart
  fixed it. Not found in the cloud tests, which always started nginx
  fresh with the new file rather than reloading from the old one.

**On Kubuntu**, before deleting anything:

```bash
curl -sSI https://maxrecallcode.net/
```
- Should be `HTTP/2 302`, `location: /login.html?next=%2F`, HSTS, and no
  `www-authenticate` line (step 7).

```bash
for i in $(seq 8); do curl -s -o /dev/null -w '%{http_code} ' -X POST -H 'Content-Type: application/json' -d '{}' https://maxrecallcode.net/api/auth/login; done; echo
```
- Eight logins at once with an empty body. `-X POST` and `-H` make each a
  JSON POST, `-d '{}'` its body, and `-w '%{http_code} '` prints only the
  status. Should print `400 400 400 400 400 400 429 429`: the app refuses
  the first six itself (no email or password, so no scrypt), and nginx
  refuses the rest. Your address can sign in again a few seconds later.

```bash
curl -6 -sSI https://maxrecallcode.net/
```
- `-6` uses IPv6 only. The same `HTTP/2 302` as before. If it fails
  within a few milliseconds (`Could not connect to server`), check
  whether Kubuntu has IPv6 at all: `ip -6 route show default` printing
  nothing means it doesn't, and this check can't be done from there. A
  failure on the VPS's side would take a round trip or a timeout. On the
  VPS, `ss -ltn 'sport = :443'` should list `[::]:443`, and
  `ufw status verbose` a `443 (v6)` rule.
- 2026-11-06 UTC: Kubuntu had no IPv6 route (failed after 2 ms), so the
  site over IPv6 is still untested end to end. The VPS's side checked:
  `ss` listed `[::]:443` and `ufw` a `443/tcp (v6)` rule.

**In a private window**, <https://maxrecallcode.net> shows the app's login
page with nothing asked first; sign in with your own account.

**Then, on the VPS**, the shared login's file, which nothing reads now:

```bash
grep -rn maxrecall.htpasswd /etc/nginx/
```
- Should print nothing: no configuration still refers to the file.

```bash
rm /etc/nginx/maxrecall.htpasswd
```

**To put the shared login back** before that `rm` (the file is still
there): the configuration as it was at `b832ad3`, then a restart (going
back changes the zone's key back, which a reload refuses too):

```bash
git -C /root/maxrecall-dsa.net show b832ad3:deploy/nginx-maxrecallcode.conf > /etc/nginx/sites-available/maxrecallcode.conf
```
```bash
nginx -t && systemctl restart nginx
```
- After the `rm`, step 5's old commands would be needed first; they're
  in `git log -p docs/deploy-vps.md`.

## 14. Root's GitHub key: a deploy key for this repository only (#119) [VPS, then GitHub]

Written 2026-11-07 (infrastructure and security; issue #119). **Not yet
run.** Root on the VPS pushes from its own checkout,
`/root/maxrecall-dsa.net` (`origin` is
`git@github.com:pflagerd/maxrecall-dsa.net`), with an SSH key that is
**the owner's own key**: it can push to every repository on the owner's
account. This section gives root a **deploy key**: a key GitHub attaches
to one repository rather than to an account: "an SSH key that grants
access to a single repository" ([GitHub, deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys#deploy-keys)).
It can push to this repository only, though still to any branch of it,
`master` included: "Deploy keys with write access can perform the same
actions as … a collaborator on a personal repository" (same page).
Then it deletes the old key, from GitHub and from the VPS.

Who does what: **[VPS]** steps are for the owner or the VPS operator
(`docs/roles/vps-operator.md`), **one yes from the owner per change**.
Each step says whether it is read-only or a change, and how to undo a
change. **[GitHub]** steps are the owner's, in the browser. Stop at
anything unexpected and report it; don't improvise.

Before starting:

- **Never print a private key.** Only files ending `.pub`, and
  fingerprints, may be shown. A command below that uses a private key
  (`ssh -i`) reads it, but doesn't print it.
- **Don't touch `/root/.ssh/authorized_keys`.** It decides who may log
  in to the VPS, which this section doesn't change.
- Nothing else is affected. The service's checkout,
  `/srv/maxrecall/maxrecall-dsa.net`, pulls over HTTPS (§4, §8), and so
  does `make deploy-server`. `gh` uses its own token (#97). The owner
  says the old key is used nowhere else (#119).
- Checked against GitHub's docs (2026-11-07): where the setting is
  (step 3). **Two details are expectations, not stated there**: the
  greeting a deploy key gets (step 4; GitHub documents only `Hi
  USERNAME! …`,
  [testing your SSH connection](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/testing-your-ssh-connection)),
  and the error a read-only key gets (step 6). Record what GitHub
  actually shows, so this section can be corrected.
- The OpenSSH and git behaviour relied on is from the man pages and
  source of the versions Ubuntu 24.04 ships (OpenSSH 9.6p1, git 2.43.0),
  cited where used.

### 1. Look first [VPS, read-only]

```bash
ls -l /root/.ssh/
```
- Lists the folder's file names, sizes and modes, without reading any of
  them. Note the old key's file name. It's most likely `id_ed25519` or
  `id_rsa`, each with a `.pub` beside it. Below it's `<old key>`. If
  there is more than one key pair, or none, stop and report it.
- There must be no file called `maxrecall-dsa-deploy` yet (step 2's
  name). If there is, stop.

```bash
git -C /root/maxrecall-dsa.net remote -v
```
- `-C <dir>` runs git in that folder; `remote -v` lists the remotes'
  URLs. Expect `git@github.com:pflagerd/maxrecall-dsa.net` twice (fetch,
  push).

```bash
git -C /root/maxrecall-dsa.net config --show-origin --get core.sshCommand
```
- Prints the setting and the file it came from, if it's set. Expect
  nothing (exit code 1, "not set"). If it prints something, stop.

```bash
printenv GIT_SSH_COMMAND
```
- Expect nothing. If it's set, it overrides step 5's setting
  (git-config(1), `core.sshCommand`). Stop.

**The owner, or the operator with the owner's explicit yes for this
one line** (the operator's role forbids reading in `/root/.ssh/` by
default, and this reads a public file there):

```bash
ssh-keygen -l -f /root/.ssh/<old key>.pub
```
- `-l` "Show fingerprint of specified public key file", `-f` names it
  (ssh-keygen(1)). Prints a line like `256 SHA256:… comment (ED25519)`.
  The fingerprint isn't secret. The owner uses it in step 7 to pick the
  right key on GitHub. **It must be the `.pub` file.**

### 2. Make the new key [VPS, change]

```bash
ssh-keygen -t ed25519 -N '' -C 'root@srv702017 deploy key, pflagerd/maxrecall-dsa.net' -f /root/.ssh/maxrecall-dsa-deploy
```
- `-t ed25519`: the type of key to create. `-N ''`: an empty passphrase.
  `-C`: a comment, stored in the `.pub` file and shown on GitHub. `-f`:
  where to write. It writes two files: the private key and `.pub`
  beside it (ssh-keygen(1)).
- **Why no passphrase:** the operator pushes without anyone there to
  type one. The private key is protected by its mode (`600`, root only)
  instead. Anything running as root can use it, as with the old key, but
  now only for this repository.
- It prints the new fingerprint and a picture of it ("randomart"), not
  the key.
- **Undo:** `rm /root/.ssh/maxrecall-dsa-deploy /root/.ssh/maxrecall-dsa-deploy.pub`

```bash
ls -l /root/.ssh/maxrecall-dsa-deploy /root/.ssh/maxrecall-dsa-deploy.pub
```
- Expect `-rw-------` for the first and `-rw-r--r--` for `.pub`, both
  owned by root.

```bash
cat /root/.ssh/maxrecall-dsa-deploy.pub
```
- **The `.pub` file only.** One line, `ssh-ed25519 AAAA… root@srv702017
  deploy key, …`: the public key, for the owner to paste in step 3. It's
  safe to show.

### 3. Add it to the repository [GitHub, owner]

- The repository's **Settings**, then "In the sidebar, click **Deploy
  Keys**", then **Add deploy key**
  ([GitHub, set up deploy keys](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys#set-up-deploy-keys)).
  Title: `srv702017 root`. Key: step 2's line. **Tick "Allow write
  access"**: the operator pushes its handoffs. ("Deploy keys are
  read-only by default", same page.)
- Nothing changes on the VPS. **Undo:** delete the deploy key on the same
  page.

### 4. Check the new key on its own [VPS, read-only]

```bash
ssh -F /dev/null -i /root/.ssh/maxrecall-dsa-deploy -o IdentitiesOnly=yes -T git@github.com
```
- `-T`: no terminal (GitHub gives no shell anyway). `-i`: the key to
  use. **This offers that key and no other**:
  - Given `-i`, ssh doesn't add its default keys (`~/.ssh/id_ed25519`
    and the rest). In OpenSSH 9.6p1's `readconf.c`, line 2702, they're
    added only `if (options->num_identity_files == 0)`.
  - `-o IdentitiesOnly=yes` leaves out any keys an agent offers
    (ssh_config(5)).
  - `-F /dev/null` reads no configuration file. An `IdentityFile` line
    in root's `~/.ssh/config` would otherwise add to the keys tried
    (ssh_config(5): "Multiple IdentityFile directives will add to the
    list"), and the operator doesn't read that file. Known hosts are
    still `~/.ssh/known_hosts`, which already has GitHub's host key.
- **Expect** (an expectation, as above) a greeting that names **the
  repository**, not the owner: `Hi pflagerd/maxrecall-dsa.net! You've
  successfully authenticated, but GitHub does not provide shell access.`
  Exit code 1 is normal: GitHub closes the connection.
  - `Hi pflagerd!` means the owner's key was used, not the deploy key:
    stop.
  - `Permission denied (publickey)` means step 3 isn't done, or the wrong
    line was pasted: stop.
  - A question about the host's authenticity means GitHub's host key
    isn't known: stop (unexpected).
- Record the greeting exactly.

### 5. Make the checkout use it [VPS, change]

```bash
git -C /root/maxrecall-dsa.net config core.sshCommand 'ssh -F /dev/null -i /root/.ssh/maxrecall-dsa-deploy -o IdentitiesOnly=yes'
```
- With this set, "`git fetch` and `git push` will use the specified
  command instead of `ssh`" (git-config(1), `core.sshCommand`): the same
  command as step 4. With no `--global` or `--system`, git writes it to
  this checkout's `.git/config` only (git-config(1), `--local`, "the
  default behavior"). No other repository and no other user is affected.
- **Undo:** `git -C /root/maxrecall-dsa.net config --unset core.sshCommand`

```bash
git -C /root/maxrecall-dsa.net config --show-origin --get core.sshCommand
```
- Expect `file:.git/config` and the command above.

### 6. Check reading and pushing through git [VPS, read-only]

```bash
git -C /root/maxrecall-dsa.net ls-remote origin HEAD
```
- Asks GitHub for `master`'s commit, through step 5's command. Expect one
  line: a commit id and `HEAD`.

```bash
git -C /root/maxrecall-dsa.net push --dry-run origin HEAD:refs/heads/deploy-key-check
```
- `--dry-run`: "Do everything except actually send the updates"
  (git-push(1)), so no branch is created. It still connects to GitHub's
  push service. Expect `* [new branch] HEAD -> deploy-key-check`.
- An error naming a read-only key means "Allow write access" wasn't
  ticked (an expectation, as above): fix step 3 and run this again.
- The real test is the operator's next handoff push. Note whether it
  worked.

### 7. Delete the old key from the account [GitHub, owner]

- Only after steps 4–6 passed. **Settings → SSH and GPG keys** (the
  account's, not the repository's): delete the key whose fingerprint is
  step 1's. The owner says the key is used nowhere else, so this revokes
  it completely.
- **Undo:** none needed. If something turns out to depend on the old key
  after all, it gets a new key of its own: don't bring this one back.

### 8. Check the old key is refused [VPS, read-only]

```bash
ssh -F /dev/null -i /root/.ssh/<old key> -o IdentitiesOnly=yes -T git@github.com
```
- The same as step 4, with the old key. It reads the key but doesn't
  print it. Expect `Permission denied (publickey)`. If it greets
  anyone, step 7 isn't done: stop.

```bash
git -C /root/maxrecall-dsa.net ls-remote origin HEAD
```
- Still works, now with the deploy key alone.

### 9. Remove the old key from the VPS [VPS, change]

```bash
rm /root/.ssh/<old key> /root/.ssh/<old key>.pub
```
- Only the two files step 1 named. **Not** `authorized_keys`,
  `known_hosts` or `config`.
- **Undo:** none, and none needed: the key is already revoked (step 8).

```bash
ls -l /root/.ssh/
```
- Expect `maxrecall-dsa-deploy` and its `.pub`, plus whatever else step 1
  listed, minus the old pair.

### 10. Record it

The operator's handoff (or the owner's note, for infrastructure and
security) says what was run and when (UTC), step 4's greeting, step 6's
output, step 8's refusal, and whether a real push has worked since. It
also lists anything GitHub showed differently from the expectations
above, so this section can be corrected. Then #119 can be closed.

**What this doesn't fix.** Anything running as root on the VPS can still
push to this repository, to any branch: there's no branch protection,
and roles push handoffs straight to `master`. #96 (a user of its own for
the operator) would move the key off root. #97 (the `gh` token) is
separate.

## 15. Going back to the previous version [GitHub, then VPS]

Written 2026-11-07 (infrastructure and security; the VPS operator's
request, `docs/session-handoff/vps-operator/20261106T172702-0800.md`).
**Not yet used.** For when a deploy made things worse.

`make deploy-server` always deploys the tip of `master` (`git pull
--ff-only`, "The quick way"), and it stays that way (owner, 2026-11-07).
So you can't go back by deploying an older commit: the next deploy would
pull `master` again. Instead:

- **The normal way, A: undo the change on GitHub, then deploy as
  usual.** Use it whenever the site can wait the minutes this takes.
- **The emergency way, B: put the VPS's checkout back by hand, then do
  A anyway.** Only when the site is broken, and the owner says it can't
  wait. Until A is done, `master` still has the bad change, and **the
  next `make deploy-server` brings it back.**

Same rules as §14: **[VPS]** steps are for the owner or the VPS operator,
one yes from the owner per change. Each step says read-only or change,
and how to undo a change. Stop at anything unexpected and report it.

### A. Revert the pull request, then deploy [GitHub, owner; then VPS]

1. **On GitHub**: open the merged pull request that caused it, and near
   the bottom click **Revert**. "Reverting a merged pull request creates
   a new pull request that reverts the original merge commit"
   ([GitHub, reverting a pull request](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/reverting-a-pull-request)).
   If GitHub can't (a conflict), stop: the role that owns the files
   writes the revert by hand.
2. **Merge that pull request**, as any other. The checks run as usual.
3. **Deploy as usual** ("The quick way"). Look at the commit
   `make deploy-server` reports (`deploy-server: at <commit> …`): it
   must be the revert's merge, or later.

**To bring the change back later**, revert the revert: the same
**Revert** button, on the revert's pull request. Merging the old branch
again brings nothing back: "Reverting a merge commit declares that you
will never want the tree changes brought in by the merge. As a result,
later merges will only bring in tree changes introduced by commits that
are not ancestors of the previously reverted merge" (git-revert(1),
`--mainline`).

### B. The emergency way, by hand [VPS]

All as root on the VPS, for `/srv/maxrecall/maxrecall-dsa.net`, the
service's checkout (not root's own `/root/maxrecall-dsa.net`). It does
by hand what `scripts/deploy-server.sh` does on an update, in the same
way:

- **Git and npm run as `maxrecall`**, so the files stay its own. That's
  `runuser -u maxrecall -- env HOME=/srv/maxrecall PATH=…`, the
  script's `as_service_user`.
- **With systemd's `PATH`**, as the script runs:
  `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`. Root's
  own `PATH` puts a Node 18 first (infrastructure and security's
  handoff `20261106T163918-0800.md`; not yet fixed), and its `npm` would
  be the wrong one.
- **The checkout stays on branch `master`**, moved back with
  `git reset --hard`. The script refuses a checkout on any other branch,
  so a detached checkout would break the next deploy.

**1. Find the two commits [read-only].**

```bash
runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net reflog -n 5
```
- `reflog` lists where `HEAD` has been, newest first (git-reflog(1));
  `-n 5`: the last five. The top line, `HEAD@{0}`, is what's deployed
  now: call it `<bad>`. The second, `HEAD@{1}`, is what ran before the
  last pull: call it `<previous>`. The VPS operator's last deploy
  handoff names both ("Deployed X over Y"); they must agree. If they
  don't, or the top line isn't a `pull`, stop.

```bash
runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net status --porcelain
```
- Expect nothing: the checkout has no changes of its own. If it prints
  anything, stop: step 3 would throw them away.

**2. See what going back changes [read-only].**

```bash
runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net diff --stat <previous> <bad>
```
- `--stat`: just the files, and how much changed in each. Note three
  things:
  - `package.json`: if it's listed, step 4 is needed.
  - `deploy/maxrecallcode.service`: if it's listed, step 5 is
    needed.
  - **A renamed unit file** (`--stat` shows a rename with `=>`, e.g.
    #123's `deploy/{maxrecall-dsa.test.service => maxrecallcode.service}`,
    the start of a long path cut to `...` to fit the terminal):
    **stop.** Steps 5 to 7 name one unit, and going back across a rename
    means swapping two. For #123's rename, §16's undo does it; for any
    other, infrastructure and security writes the steps first.
  - **A change to what's stored on disk** (anything the readme's "Where
    data lives" describes, such as a `schemaVersion`, or a rename of the
    files under `users/` or `auth/`): **stop.** Files the newer version
    wrote may not be readable by the older one. Going back then needs
    infrastructure and security first, not this procedure.

**3. Move the checkout back [change].**

```bash
runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net reset --hard <previous>
```
- `--hard` moves the branch, `master`, and the files to `<previous>`
  (git-reset(1)). Step 1 showed there was nothing else to lose. The
  running server doesn't notice until step 6.
- **Undo:** the same command with `<bad>`.

**4. Only if step 2 listed `package.json`: its packages [change].**

```bash
cd /srv/maxrecall/maxrecall-dsa.net
```
```bash
runuser -u maxrecall -- env HOME=/srv/maxrecall PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin npm install --omit=dev --no-audit --no-fund
```
- The script's own command (`--omit=dev`: no development packages;
  the other two flags only skip messages).
- **Undo:** after step 3's undo, run it again.

**5. Only if step 2 listed the unit file: install it [change].**

```bash
install -m 0644 /srv/maxrecall/maxrecall-dsa.net/deploy/maxrecallcode.service /etc/systemd/system/maxrecallcode.service
```
```bash
systemctl daemon-reload
```
- The script's own two commands. `install -m 0644` copies the file with
  that mode; `daemon-reload` makes systemd read it again.
- **Undo:** after step 3's undo, run both again.

**6. Restart the service [change].** The site is down for a second or
two.

```bash
systemctl restart maxrecallcode.service
```
- **Undo:** step 3's undo (with 4 and 5 again, if they were needed),
  then this again.

**7. Check it [read-only].**

```bash
systemctl is-active maxrecallcode.service
```
- Expect `active`.

```bash
journalctl -u maxrecallcode.service --since "5 min ago" --no-pager | grep -v 'Queues:'
```
- The service's log for the last five minutes ("5 min ago": a relative
  time, systemd.time(7)). `grep -v 'Queues:'`
  leaves out the lines that name learners. Expect `Server listening on
  127.0.0.1:3000 only` and `Trusted listener on 127.0.0.1:3001 only`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://maxrecallcode.net/login.html
```
- Expect `200`, from the app itself. nginx answers `502` when the app
  is down.

**8. Then A, at once.** Until `master` has the revert, **don't run
`make deploy-server`**: it would deploy `<bad>` again. Once the revert is
merged, a normal deploy fast-forwards the checkout from `<previous>` to
the revert, and the VPS and `master` agree again.

**Record it** in the operator's handoff: both commits, what step 2
listed, each change with its time (UTC), and step 7's results.

## 16. Renaming the service to `maxrecallcode.service` (#123) [VPS]

Written 2026-11-08 (infrastructure and security; owner's choice of the
name). **Run 2026-11-08 at 04:56 UTC**, deploying `2651a33`, down about
1.2 s, as step 2 expects (the VPS operator's
`docs/session-handoff/vps-operator/20261107T210036-0800.md`); kept for
its undo. A one-time deploy: the first after the pull
request that renames `deploy/maxrecall-dsa.test.service` to
`deploy/maxrecallcode.service` (call its merge commit `<commit>`; the
owner names it). After it, deploys are as usual.

`make deploy-server` does the rename itself (`scripts/deploy-server.sh`,
`OLD_UNITS`): it copies in `maxrecallcode.service`, then stops, disables
and deletes `maxrecall-dsa.test.service`, then enables and starts the new
one. The site is down from the old one's stop to the new one's start
(a guess: a second or two, like a restart). Tested in a cloud session
with stand-ins for `systemctl`, `journalctl` and `ss` (no systemd
there): the rename, a second run (no rename), a first run (asks), and
the script refusing, with nothing changed, an `OLD_UNITS` that lists the
new name.

Same rules as §14: one yes from the owner per change; each step says
read-only or change, and how to undo it. Stop at anything unexpected and
report it.

**1. Before [read-only].**

```bash
systemctl is-active maxrecall-dsa.test.service
```
- Expect `active`: the service under its current name.

```bash
ls /etc/systemd/system/ | grep -F maxrecall
```
- `grep -F`: the pattern is plain text. Expect exactly one line,
  `maxrecall-dsa.test.service`. If `maxrecallcode.service` is already
  there, or a folder ending `.service.d` (a drop-in, which would be left
  behind), stop.

```bash
systemctl show maxrecall-dsa.test.service -p DropInPaths
```
- `systemctl show -p`: one of the unit's properties
  ([systemctl(1)](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html)).
  `DropInPaths` lists its drop-in files. Expect `DropInPaths=`, empty;
  anything after the `=` is a drop-in: stop. (Until 2026-11-08 this was
  `systemctl cat … | grep '^# /'`, which also matched the unit file's
  own comments that begin `# /etc/…` and `# /sys/…`, so it said "stop"
  with no drop-in: the operator's finding, `20261107T210036-0800.md`.)

**2. The deploy [change]**, only of `<commit>`, surveyed and run in one
go: the guarded deploy ("The quick way", "Updating: the guarded
deploy"; do its steps 1 to 3 first), as root in
`/root/maxrecall-dsa.net`:

```bash
if git fetch origin master && [ "$(git rev-parse origin/master)" = "$(git rev-parse <commit>)" ]; then
  git merge --ff-only <commit> && make deploy-server
else
  echo "STOP: master is not <commit>"; git log --oneline <commit>..origin/master
fi
```
- `git rev-parse` turns a name into its full commit id, so the two can be
  compared; `git merge --ff-only <commit>` moves root's checkout to
  exactly that commit, never past it. If `master` has moved on, it stops
  and lists what's new: ask the owner again.
- `make deploy-server` then pulls `master` into the service's own
  checkout itself, so step 3 reads which commit that got.
- **Expect these lines**, in this order:
  `installing /etc/systemd/system/maxrecallcode.service.`,
  `removing the old maxrecall-dsa.test.service (renamed maxrecallcode.service).`,
  `enabling maxrecallcode.service and (re)starting it.`, and last
  `Deployed: maxrecallcode.service at <commit> …`.
- **Not expected: the question** `Set up the maxrecall service on this
  machine? [y/N]`. It means the script found no unit file under any
  name. Answer `N` (nothing changes) and stop.
- **Undo:** "Undo", below.

**3. After [read-only].**

```bash
systemctl is-active maxrecallcode.service
```
```bash
systemctl is-enabled maxrecallcode.service
```
- Expect `active`, then `enabled` (starts at boot).

```bash
ls /etc/systemd/system/ /etc/systemd/system/multi-user.target.wants/ | grep -F maxrecall
```
- Expect `maxrecallcode.service` once in each folder, and no
  `maxrecall-dsa.test.service`: the old unit file and its boot link
  (`multi-user.target.wants/`, made by `enable`) are both gone.

```bash
runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net log --oneline -1
```
- Expect `<commit>`: what the service's checkout runs.

```bash
journalctl -u maxrecallcode.service --since "5 min ago" --no-pager | grep -v 'Queues:'
```
- As §15 B step 7: expect `Server listening on 127.0.0.1:3000 only` and
  `Trusted listener on 127.0.0.1:3001 only`. `grep -v 'Queues:'` leaves
  out the lines that name learners.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://maxrecallcode.net/login.html
```
- Expect `200`. The uptime check (`.github/workflows/uptime.yml`, the
  Actions tab) should stay green at its next run.

**4. Afterwards.**
- The log from before is `journalctl -u maxrecall-dsa.test.service`
  (§5).
- Root's `~/.claude/settings.json` on the VPS (not in the repo) may
  have rules naming the old unit, such as `systemctl show
  maxrecall-dsa.test.service *`: the owner changes them.
- Record it in the operator's handoff: `<commit>`, the lines step 2
  printed, each change with its time (UTC), and step 3's results.

### Undo: back to `maxrecall-dsa.test.service` [VPS, change]

Only if the new unit won't run and the owner says the site can't wait
for the normal way (§15 A: revert the pull request on GitHub, then
deploy). Like §15 B it's done by hand, then §15 A anyway, and **until
the revert is merged, don't run `make deploy-server`**: it would rename
again. Each command is one change.

1. **Find `<previous>` [read-only]**: as §15 B step 1. The top reflog
   line is the pull to `<commit>`; the second is `<previous>`.
2. **Move the checkout back**: as §15 B step 3, with `<previous>`. Its
   `deploy/` has `maxrecall-dsa.test.service` again.
   ```bash
   runuser -u maxrecall -- env HOME=/srv/maxrecall git -C /srv/maxrecall/maxrecall-dsa.net reset --hard <previous>
   ```
3. **Put the old unit file back**, while the new one still runs:
   ```bash
   install -m 0644 /srv/maxrecall/maxrecall-dsa.net/deploy/maxrecall-dsa.test.service /etc/systemd/system/maxrecall-dsa.test.service
   ```
   ```bash
   systemctl daemon-reload
   ```
4. **Stop the new one** (the site is down from here):
   ```bash
   systemctl disable --now maxrecallcode.service
   ```
5. **Start the old one** (the site is back):
   ```bash
   systemctl enable --now maxrecall-dsa.test.service
   ```
6. **Delete the new unit file**:
   ```bash
   rm /etc/systemd/system/maxrecallcode.service
   ```
   ```bash
   systemctl daemon-reload
   ```
7. **Check [read-only]**: §15 B step 7, with `maxrecall-dsa.test.service`.
8. **Then §15 A**: revert the pull request. Once it's merged, a normal
   deploy fast-forwards the checkout from `<previous>` to the revert,
   whose script and unit file are the old ones, so it renames nothing.

Undoing the undo is step 2 of this section again, once the problem is
fixed in a new pull request.

## 17. Updates, the new kernel and a reboot; `networking.service` disabled [VPS, then Kubuntu]

Written 2026-11-09 (infrastructure and security), for the owner's
choice that day: **disable `networking.service`, together with the
kernel reboot** (option B of four: leave, disable, remove ifupdown, edit
its hook). **Not yet run.** Three changes, then one reboot that tests
them all:

1. **All the waiting updates**, not only the kernel (owner,
   2026-11-09) (178 on 11-09, the VPS operator's handoff
   `docs/session-handoff/vps-operator/20261108T192142-0800.md`), among
   them the kernel `6.8.0-149`. The machine runs `-147`. `-149` isn't
   installed yet, so it needs `apt`, then a reboot. Security updates
   already install themselves daily (`unattended-upgrades`,
   `docs/plans/limited-live.md`, 2026-11-05); these are mostly
   ordinary `noble-updates` fixes. Keeping the kernel patched is the
   condition of letting testers in (limited live plan, D4; #22).
2. **`networking.service` disabled.** It's ifupdown's unit, and
   ifupdown configures nothing here: `/etc/network/interfaces` only
   sources `interfaces.d/`, which is empty. The network is netplan with
   systemd-networkd (`eth0` is `configured` by networkd). The unit
   failed at boot on 11-05 (the boot checked; earlier ones weren't)
   because of a bug in ifupdown's own hook,
   `/etc/network/if-up.d/resolved`: it calls `return` outside a
   function, and `run-parts` runs it as a script, so `dash` exits 2
   (`ifup: failed to bring up lo`). The VPS operator's checks:
   `docs/session-handoff/vps-operator/20261109T140011-0800.md`. Ubuntu
   bug reports with the same message:
   [LP #2004003](https://lists.snapcraft.io/archives/foundations-bugs/2023-January/488881.html),
   [LP #1907878](https://bugs.launchpad.net/ubuntu/+source/ifupdown/+bug/1907878).
   `0.8.41ubuntu1` is the current version for noble, so no update
   fixes it.
3. **One reboot**, for the new kernel. It is also the only real test of
   step 2, since disabling a unit changes only what starts at the next
   boot.

**Why disabling is safe for the network.** Nothing ifupdown did is
needed:
- **`lo` is brought up by systemd itself**, before any unit:
  PID 1 calls `loopback_setup()`
  ([`src/core/main.c`, v255](https://github.com/systemd/systemd/blob/v255/src/core/main.c#L2239)),
  which sets `lo` up and gives it `127.0.0.1/8` and `::1`
  ([`src/shared/loopback-setup.c`](https://github.com/systemd/systemd/blob/v255/src/shared/loopback-setup.c#L51-L109)).
  The app listens only there, and nginx proxies to it.
- **`eth0`, the interface SSH and the site arrive on, is networkd's.**

The risk that remains is that something not seen yet needs the unit.
Step 1's dependency check looks for that, and the reboot shows it.

**Why not leave it.** While any unit is failed, `systemctl
is-system-running` says `degraded`
([systemctl(1)](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html#is-system-running)),
and the unit would fail again at each boot. A permanent false alarm
hides a real one.

Who does what: **[VPS]** steps are for the owner or the VPS operator
(`docs/roles/vps-operator.md`), **one yes from the owner per change**.
Each step says whether it is read-only or a change, and how to undo it.
Stop at anything unexpected and report it; don't improvise.

Before starting:

- **The owner picks the time.** The site is down during the reboot
  (about a minute; a guess, the last reboot's length wasn't recorded).
  Testers in the middle of a question lose nothing saved, but a Submit
  in flight fails.
- **A VPS operator session on the VPS ends at the reboot**: it runs on
  the machine being restarted. Steps 6 and 7 are for the owner, or a new
  operator session started after the reboot.
- **Know the way in that doesn't use the network**, before step 5. If
  SSH doesn't come back, only a console in Hostinger's control panel can
  help, and only one that doesn't use the VPS's network (a VNC or
  serial console, not an SSH terminal in the browser). **The owner says
  hPanel has one** (2026-11-09, answering that question). Before step 5,
  open it and see a login prompt, to know it works today. If it
  doesn't, stop: a failed boot would then need Hostinger's support.
- **Root's commands only.** Nothing here touches `/srv/maxrecall/data`,
  `auth/`, or the service's checkout.

### 1. Look first [VPS, read-only]

```bash
hostname; id -un
```
- Expect `srv702017` and `root`. Anything else: stop.

```bash
systemctl show networking.service -p WantedBy -p RequiredBy -p RequisiteOf -p BoundBy -p UpheldBy -p ConsistsOf
```
- The units that depend on `networking.service` **directly**, one line
  per kind of dependency
  ([systemctl(1)](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html),
  `show`; the properties are the reverse of `Wants=`, `Requires=`,
  `Requisite=`, `BindsTo=`, `Upholds=`, `PartOf=`).
- Expect `WantedBy=` to name only `multi-user.target` and
  `network-online.target`, and every other line empty (`RequiredBy=`
  and so on). **Anything else: stop and report it.**
- **Not** `systemctl list-dependencies --reverse`: it expands targets
  recursively, so it also lists every service that waits for
  `network-online.target` (nginx among them), and those don't depend
  on this unit ("By default, only target units are recursively
  expanded", systemd v255
  [`man/systemctl.xml`](https://github.com/systemd/systemd/blob/v255/man/systemctl.xml#L374-L405)).
  This section's first version used it, and the operator stopped there
  on 11-09.

```bash
systemctl show network-online.target -p Wants; systemctl is-enabled systemd-networkd-wait-online.service; systemctl is-active systemd-networkd-wait-online.service
```
- `network-online.target` is what nginx and others wait for. Its
  `Wants=` should name `networking.service` and
  `systemd-networkd-wait-online.service`, and the second should be
  `enabled` and `active`. Once `networking.service` is disabled, that
  one alone decides when the network counts as up: networkd's `eth0`.
  Not so: stop.

```bash
grep -rn -E '^(Wants|Requires|Requisite|BindsTo|Upholds|PartOf)=.*networking\.service' /etc/systemd/system /usr/lib/systemd/system /run/systemd/system
```
- `systemctl show` sees only units that are loaded now (systemctl(1),
  the same note), so this searches the unit files on disk as well, drop-ins
  included: `-r` every file below each folder, `-n` with line numbers,
  `-E` the pattern as an extended regular expression
  ([grep(1)](https://man7.org/linux/man-pages/man1/grep.1.html)). It
  matches only lines that **pull the unit in**.
- Expect nothing, or only `ifupdown`'s own units (`dpkg -S <file>` says
  which package a file is from). **Any other file: stop and report it**
  with its line.

```bash
grep -rn -E '^(After|Before)=.*networking\.service' /etc/systemd/system /usr/lib/systemd/system /run/systemd/system
```
- For the record only, no stop: lines that only **order** a unit
  against `networking.service` (cloud-init's units may have some, a
  guess). Ordering against a unit that doesn't start pulls nothing in:
  `After=`/`Before=` are "independent of and orthogonal to the
  requirement dependencies"
  ([systemd.unit(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#Before=)).

```bash
dpkg --verify ifupdown
```
- Checks the package's files against what it installed, and prints
  nothing if none has changed
  ([dpkg(1)](https://man7.org/linux/man-pages/man1/dpkg.1.html)). A line
  naming `/etc/network/if-up.d/resolved`: someone edited the hook.
  Report it, then go on.

```bash
systemctl is-system-running; systemctl --failed --no-pager
```
- Expect `degraded`, and `networking.service` as the only failed unit.
  Note any other: step 3's expected result changes.

```bash
networkctl status eth0 --no-pager
```
- Expect `State: routable (configured)`. Anything else: stop.

```bash
uname -r; ls /boot/vmlinuz-*; df -h /boot
```
- Expect `6.8.0-147-generic`. The list shows the kernels that can boot.
  `/boot` needs room for one more kernel and its initrd: at least
  200 MB free (a guess with margin). Less: stop.

```bash
grep -E '^GRUB_(DEFAULT|TIMEOUT|TIMEOUT_STYLE)=' /etc/default/grub /etc/default/grub.d/*.cfg
```
- Records how GRUB, the boot menu, starts. This matters only for the
  kernel's undo (below). With `GRUB_TIMEOUT=0` the menu is hidden.

```bash
apt-mark showhold; dpkg -l needrestart | tail -1
```
- The first lists packages held back on purpose (record them; they stay
  held). The second shows whether `needrestart` is installed (step 2
  tells it not to restart anything).

```bash
systemctl show maxrecallcode.service -p ActiveState -p NRestarts -p MainPID
```
- The service's state before, to compare with step 6.

### 2. The updates [VPS, change]

```bash
apt-get update
```
- **Changes only apt's package lists** (what's available), not what's
  installed. Undo: none needed.

```bash
apt-get -s --with-new-pkgs upgrade | grep -v -E '^(Inst|Conf) '
```
- **Read-only.** `-s` simulates: "No action; perform a simulation"
  ([apt-get(8)](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html)).
  The `grep` drops the per-package lines and leaves the summary: the
  packages to upgrade, the NEW ones, any kept back or "deferred due to
  phasing", and the count line.
- `--with-new-pkgs`: a new kernel is a **new package**
  (`linux-image-6.8.0-149-generic`), and plain `upgrade` never installs
  "packages not already installed" (apt-get(8)), so without it the
  kernel would be held back.
- **Stop if**: no `linux-image-6.8.0-149` among the NEW packages (it may
  be "deferred due to phasing", Ubuntu releasing it to machines in
  stages), or anything listed under "will be REMOVED", or the count
  line differs a lot from about 178 upgraded.
- `apt-get`, not `apt`: apt(8) says its own command line has no stable
  interface for scripts.

```bash
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold --with-new-pkgs upgrade
```
- **The change.** Each part:
  - `DEBIAN_FRONTEND=noninteractive`: debconf asks no questions and
    takes each default
    ([debconf(7)](https://manpages.ubuntu.com/manpages/noble/man7/debconf.7.html)).
    The operator's commands have no terminal to answer in.
  - `NEEDRESTART_MODE=l`: `needrestart` only **lists** the services
    using old libraries; it doesn't restart them
    ([needrestart v3.6, line 230](https://github.com/liske/needrestart/blob/v3.6/needrestart#L230)).
    Step 5's reboot restarts everything.
  - `-y`: yes to apt's own "Do you want to continue?".
  - `--force-confdef --force-confold`: where a package's config file
    (in `/etc`) has changed both here and in the new version, keep
    **ours** without asking. The new one is saved beside it as
    `<file>.dpkg-dist`
    ([dpkg(1)](https://man7.org/linux/man-pages/man1/dpkg.1.html),
    `--force-confdef`, `--force-confold`).
- Some packages restart their own service from their install scripts,
  whatever `needrestart` says. If `nginx` is among them, the site blips;
  if `openssh-server` is, open SSH sessions stay connected (a guess from
  sshd's design, which gives each session its own process).
- **Undo**: there's no single undo for an upgrade. A package can be
  taken back one at a time (`apt-get install <package>=<old version>`)
  while the old version is still in Ubuntu's archive. The old kernel
  stays installed (see the kernel's undo).

```bash
dpkg --audit; find /etc -name '*.dpkg-dist' -mmin -120; ls /var/run/reboot-required*
```
- **Read-only.** `dpkg --audit` prints nothing if every package is
  fully installed. The `find` lists new config files left beside ours in
  the last two hours: **record them**, for infrastructure and security to
  compare (step 2's flags kept ours). The `ls` should show
  `/var/run/reboot-required`.
- Anything from `dpkg --audit`: stop and report it before rebooting.

```bash
ls /boot/vmlinuz-*; systemctl is-active maxrecallcode.service nginx.service
```
- **Read-only.** `vmlinuz-6.8.0-149-generic` is now listed, beside
  `-147`. Both services `active`. Not active: stop.

### 3. Disable `networking.service` [VPS, change]

```bash
systemctl disable networking.service
```
- Removes the links that start it at boot. It's not running now (it
  failed on 11-05), so nothing stops.
- **Undo**: `systemctl enable networking.service`.

```bash
systemctl reset-failed networking.service
```
- Clears its "failed" mark, so `degraded` goes away now rather than at
  the next boot
  ([systemctl(1)](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html), `reset-failed`).
- **Undo**: none needed. It changes no configuration.

```bash
systemctl is-enabled networking.service; systemctl is-system-running
```
- **Read-only.** Expect `disabled`, then `running`, unless step 1 found
  other failed units (then `degraded` still, for those).

### 4. Record before the reboot

Write down, for step 7: step 2's summary and `.dpkg-dist` files, and
step 3's results. A VPS operator session writes its handoff **now** and
pushes it with the owner's yes, since the reboot ends it.

### 5. Reboot [VPS, change]

At the owner's chosen time, with the console from "Before starting" at
hand:

```bash
systemctl reboot
```
- SSH drops. Wait about two minutes before step 6.
- **Undo**: none. If SSH doesn't come back within about five minutes,
  use the console: `systemctl status networking.service systemd-networkd.service --no-pager`
  and `networkctl list`, then the undo below that fits.

### 6. Check it came back [VPS, read-only]

From Kubuntu, `ssh root@srv702017.hstgr.cloud` (a fresh login is
itself the first check), then:

```bash
uname -r
```
- Expect `6.8.0-149-generic`.

```bash
systemctl is-system-running; systemctl --failed --no-pager
```
- Expect `running` and no failed units. Any failed: record it and its
  `journalctl -b -u <unit> --no-pager`.

```bash
systemctl is-enabled networking.service; systemctl is-active networking.service
```
- Expect `disabled`, then `inactive`.

```bash
networkctl list; ip -br addr show lo
```
- Expect `eth0` `routable` `configured`. `lo` shows `UNKNOWN` (loopback
  reports no carrier state) with `127.0.0.1/8` and `::1/128`.
  `-br` is `ip`'s brief, one-line-per-interface output
  ([ip(8)](https://man7.org/linux/man-pages/man8/ip.8.html)).

```bash
systemctl show maxrecallcode.service -p ActiveState -p NRestarts -p MainPID; journalctl -b -u maxrecallcode.service --no-pager | grep -i sandbox
```
- Expect `active`, `NRestarts=0`, a new PID, and `Sandbox: bubblewrap …
  works (self-test passed)` (the AppArmor profile reloads at boot,
  limited live plan, 2026-11-05). No self-test line, or a failed one:
  the service refuses to judge. Stop and report it.

```bash
ufw status; systemctl is-active nginx.service
```
- Expect `Status: active` with 22, 80 and 443, and `active`.

Then on Kubuntu:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://maxrecallcode.net/login.html
```
- `-sS` hides the progress bar but shows errors; `-o /dev/null`
  discards the page; `-w '%{http_code}\n'` prints only the status
  ([curl(1)](https://curl.se/docs/manpage.html)). Expect `200`.

### 7. Record it

In the handoff of whoever ran it: steps 1–6's results, what step 2
installed (`/var/log/apt/history.log`, the last entry), and the
`.dpkg-dist` files. Then infrastructure and security updates this
section's "Not yet run", `readme.html` (Environments, the VPS; Known
gaps, #22) and `docs/plans/limited-live.md` (D4, the kernel).

### Undo

- **`networking.service`**, if something turns out to need it:
  `systemctl enable --now networking.service`. `--now` also starts it,
  which fails as before; the failure itself is harmless (§17's
  introduction).
- **The new kernel**, if the VPS boots but misbehaves on it: `-147` is
  still installed: under "Advanced options for Ubuntu" in GRUB's menu
  at boot, the entry ending `6.8.0-147-generic` (not the one ending
  `(recovery mode)`). Reaching that menu needs the console,
  and a hidden menu (`GRUB_TIMEOUT=0`, step 1) may need a key held
  during boot (a guess: Esc or Shift; not checked on this VPS). Boot
  `-147` once from there, then stop and report: making it the default
  is a change for infrastructure and security to write.
- **A package**: as step 2's undo, one at a time, only if a specific
  package is found to be the problem.

## 18. libvirt disabled, its packages kept [VPS, then Kubuntu]

Written 2026-11-09 (infrastructure and security), for the owner's
choice that day: **disable libvirt but keep its packages** (option B of
three: leave, disable, remove). It isn't used now, but may be later.
**Not yet run.** No reboot needed.

**What's there** (the VPS operator's eight read-only checks, 11-09
~22:35 UTC, sent to this role; recorded in
`docs/session-handoff/infrastructure-and-security/`, the handoff after
`20261109T141856-0800.md`, and to go in the operator's next one): libvirt
`10.0.0-2ubuntu8.19` and `qemu-system-x86` `8.2.2`, **no virtual
machine defined**. libvirt's `default` network **autostarts**: it makes
the bridge `virbr0` (no carrier) and runs `dnsmasq` (a small DNS and
DHCP server) on `192.168.122.1:53` and DHCP on `virbr0`, not on `eth0`.
It also adds firewall rules at runtime (chains `LIBVIRT_FWI`, `_FWO`,
`_FWX`, `_INP`, `_OUT`, `_PRT`) beside `ufw`'s. `libvirtd` itself
starts on demand through its sockets (`libvirtd.socket`, `-ro`,
`-admin`); `virtlogd` and `virtlockd` run all the time.

**Why disable it**: a root daemon, `dnsmasq` and firewall rules, all
unused. Nothing reaches them from outside now (a guess from where
`dnsmasq` listens), but software that isn't needed is still software
whose bugs could matter. Disabling keeps "maybe later" two commands
away; removing would mean reinstalling.

**The order matters**: the `virsh` commands talk to `libvirtd` through
its socket, so the network is stopped **before** the sockets are
disabled.

Who does what: as §17. **[VPS]** steps are for the owner or the VPS
operator, **one yes from the owner per change**; stop at anything
unexpected and report it.

### 1. Look first [VPS, read-only]

```bash
hostname; id -un
```
- Expect `srv702017` and `root`.

```bash
ls /etc/libvirt/qemu/
```
- Expect only `networks`. **Any `*.xml` file there is a virtual
  machine: stop.**

```bash
ufw status verbose
```
- Record it whole, to compare in step 4: this section must leave
  `ufw`'s rules as they are.

```bash
systemctl show maxrecallcode.service -p ActiveState -p NRestarts -p MainPID
```
- Expect `active`; record it, to compare in step 4.

### 2. Stop the network [VPS, change]

```bash
virsh net-autostart default --disable
```
- Stops the `default` network starting at boot: "The *--disable* option
  disable autostarting" (libvirt v10.0.0,
  [`virsh.rst`](https://github.com/libvirt/libvirt/blob/v10.0.0/docs/manpages/virsh.rst),
  `net-autostart`). It removes
  `/etc/libvirt/qemu/networks/autostart/default.xml`, the link.
- `virsh` connects to `libvirtd`, which starts on demand: expected.
- **Undo**: `virsh net-autostart default`.

```bash
virsh net-destroy default
```
- Stops it now: "Destroy (stop) a given transient or persistent virtual
  network … This takes effect immediately" (same page, `net-destroy`).
  The network is persistent (`networks/default.xml`), so its definition
  stays; only the running network goes: `dnsmasq`, `virbr0`, and the
  rules libvirt added for it.
- **Undo**: `virsh net-start default`.

```bash
virsh net-list --all
```
- **Read-only.** Expect `default` with State `inactive` and Autostart
  `no`.

### 3. Disable the daemons [VPS, change]

```bash
systemctl disable --now libvirtd.service libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket libvirt-guests.service virtlogd.service virtlogd.socket virtlogd-admin.socket virtlockd.service virtlockd.socket virtlockd-admin.socket
```
- `disable` removes the links that start each at boot; `--now` also
  stops it ([systemctl(1)](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html),
  `disable`). Stopping the sockets means nothing can start `libvirtd`
  on demand any more. `libvirt-guests` stops guests at shutdown; there
  are none.
- `libvirtd-tcp.socket` and `libvirtd-tls.socket` are already disabled
  (operator, 11-09): not listed.
- **Undo**: `systemctl enable --now libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket virtlogd.socket virtlogd-admin.socket virtlockd.socket virtlockd-admin.socket libvirt-guests.service`,
  then `systemctl enable libvirtd.service virtlogd.service virtlockd.service`,
  then step 2's two undos.

### 4. Check [VPS, read-only]

```bash
systemctl list-units 'libvirt*' 'virt*' --all --no-pager; systemctl list-unit-files 'libvirt*' 'virt*' --no-pager
```
- Expect every unit `inactive` (units shown as `not-found`, such as
  `virtqemud.socket`, are referenced but not installed: expected), and
  every unit file `disabled` (or `static`, `virt-guest-shutdown.target`).

```bash
ps -o pid,user,args -C libvirtd,dnsmasq,virtlogd,virtlockd; ip -br link show type bridge
```
- Expect no processes (only the header line) and no bridge.

```bash
nft list ruleset | grep -c -E 'virbr|192\.168\.122'
```
- Counts firewall rule lines that still mention the bridge or its
  addresses. Expect `0`. libvirt's own `LIBVIRT_*` chains may stay,
  empty, until the next boot (a guess; record what's there:
  `nft list ruleset | grep -c LIBVIRT`).

```bash
ufw status verbose; systemctl show maxrecallcode.service -p ActiveState -p NRestarts -p MainPID
```
- Expect both exactly as in step 1.

Then on Kubuntu:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://maxrecallcode.net/login.html
```
- Expect `200` (§17 step 6 explains the arguments).

### 5. Record it

In the handoff of whoever ran it: steps 1–4's results. **After the next
package upgrade** (§17 step 2, or `unattended-upgrades`), check that
step 4's first command still shows the units `disabled`: Debian's
packaging is meant to keep an admin's `disable` across upgrades (an
expectation, not checked on this VPS). Then infrastructure and security
updates this section's "Not yet run" and `readme.html` (Environments,
the VPS).

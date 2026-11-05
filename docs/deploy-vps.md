# Running MaxRecall DSA on the VPS (Ubuntu 24.04)

Written 2026-10-29; sign-in added 2026-10-30. This is option A from the
2026-10-29 discussion: the app listens only on the VPS's own loopback address
(`127.0.0.1`), and you reach it through an SSH tunnel. **Since 2026-11-05
(§13, limited-live step 3) nginx also serves it at
<https://maxrecallcode.net>**, behind a shared Basic auth login and the app's
own sign-in, and only to port 3000. Until §13 is done, nothing is exposed to
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
- runs under systemd containment (`deploy/maxrecall-dsa.test.service`): no
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
sudo cp deploy/maxrecall-dsa.test.service /etc/systemd/system/
```
Copies the unit file to where systemd looks for local services. If you want a
different `MAXRECALL_USER`, edit the copy with `sudo vi
/etc/systemd/system/maxrecall-dsa.test.service`.

```bash
sudo systemctl daemon-reload
```
Makes systemd re-read its unit files.

The service is called `maxrecall-dsa.test.service`. The commands below always
give that full name. With a dot in the name, a shortened form relies on
systemd guessing the `.service` part.

If you already installed it under its earlier name, `maxrecall-dsa.service`,
remove that one first so the two don't both try to use port 3000:
```bash
sudo systemctl disable --now maxrecall-dsa.service
sudo rm /etc/systemd/system/maxrecall-dsa.service
sudo systemctl daemon-reload
```
- `disable --now` stops it and stops it starting at boot.
- `rm` deletes its unit file.
- `daemon-reload` makes systemd forget it.

```bash
sudo systemctl enable --now maxrecall-dsa.test.service
```
- `enable` starts the service at every boot.
- `--now` also starts it immediately.

See [systemctl(1)](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html).

```bash
systemctl status maxrecall-dsa.test.service
```
Should say `active (running)`.

```bash
journalctl -u maxrecall-dsa.test.service -n 20
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
sudo systemd-analyze security maxrecall-dsa.test.service
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

```bash
cd /srv/maxrecall/maxrecall-dsa.net
sudo -u maxrecall git pull --ff-only
```
`--ff-only` refuses to create a merge. The VPS checkout should only ever
follow GitHub, never have commits of its own.

```bash
sudo -u maxrecall npm install --omit=dev
sudo systemctl restart maxrecall-dsa.test.service
```
Picks up any dependency changes, then restarts the server so it runs the new
code.

If `deploy/maxrecall-dsa.test.service` itself changed, copy it again (step 5) and
run `sudo systemctl daemon-reload` before restarting.

**If the pull renamed or deleted a question** (its commit says "Rename
question …" or "Delete question …"; `git diff --stat ORIG_HEAD` shows it),
the users' files on the VPS still name the old question: `git pull` changes
the checkout, not `/srv/maxrecall/data/users`. Update them with the server
stopped, before the restart above (spaced-repetition plan, step 11):

```bash
sudo systemctl stop maxrecall-dsa.test.service
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
Then `sudo systemctl start maxrecall-dsa.test.service`, and check the
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
systemctl stop maxrecall-dsa.test.service
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
systemctl start maxrecall-dsa.test.service
```

```bash
journalctl -u maxrecall-dsa.test.service -n 20 --no-pager | grep -E 'Queues|Consistency'
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
them as root on the VPS.

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

**What this doesn't do:**
- A chosen backlog limits what Next and the list offer, not what can be
  opened: a tester who types another question's address
  (`problem.html?slug=…`) can do it, and a Submit then puts it in their
  queue. Their profile still limits the languages (403 for the others).
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
2026-11-05; no `www`). Testers first get nginx's shared Basic auth login,
then the app's own sign-in (an invite, §11). The configuration is
`deploy/nginx-maxrecallcode.conf`; read its comments for what each part
does.

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

### 5. The testers' shared login (Basic auth, D3)

```bash
printf 'tester:%s\n' "$(openssl passwd -6)" > /etc/nginx/maxrecall.htpasswd
```
- `openssl passwd -6` asks for the password twice (`Password:`,
  `Verifying - Password:`) without showing it, and prints its SHA-512
  crypt hash; the file stores `tester:` and that hash, never the password.
- `tester` is the username testers type; choose another if you like.
- Give testers the username and password with their invite.

```bash
chown root:www-data /etc/nginx/maxrecall.htpasswd
```
```bash
chmod 640 /etc/nginx/maxrecall.htpasswd
```
- nginx's workers run as `www-data`; this lets them read the file, and
  nobody else.

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
`nginx -t && systemctl reload nginx`.

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
- `-I` shows only the headers. Should be `HTTP/2 401`, with
  `strict-transport-security: max-age=86400` and
  `www-authenticate: Basic realm="MaxRecall testing"`.

```bash
curl --max-time 5 http://maxrecallcode.net:3000/
```
- Should still time out: only 80 and 443 are open (§12).

**In a browser**, open <https://maxrecallcode.net> in a private window:
the browser asks for the Basic auth username and password, then the app's
login page appears. The padlock should name Let's Encrypt.

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

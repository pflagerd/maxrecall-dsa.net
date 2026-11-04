# Running MaxRecall DSA on the VPS (Ubuntu 24.04, SSH tunnel only)

Written 2026-10-29; sign-in added 2026-10-30. This is option A from the
2026-10-29 discussion: the app listens only on the VPS's own loopback address
(`127.0.0.1`), and you reach it through an SSH tunnel. Nothing is exposed to
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
your machine. Replace `VPS_IP` with the VPS's address. Hostinger's panel shows it.

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
curl --max-time 5 http://VPS_IP:3000/
curl --max-time 5 http://VPS_IP:3001/
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
ssh -N -L 3000:127.0.0.1:3001 root@VPS_IP
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
rsync -av --ignore-existing root@VPS_IP:/srv/maxrecall/data/users/ users/
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
should hold one row, Hello World in Python, marked **new**. Open it once,
then check the first line of `make backlog-show` again: **if it no longer
says only `python`**, untick the others in the language menu. (A browser
that still has the language choices from before 2026-11-03 copies them into
your profile once, the first time it opens a problem page:
`problem-page.js`, `migrateLocalStorageChoices`. I can't tell from here
whether yours still has them.)

**Adding questions later.** The same three steps each time: stop the
server, `make backlog-add` (with `AT=1` to put them at the front instead of
the end), start it. `make backlog-remove … SLUGS="…"` takes them out of
the backlog again. What you add comes into your queue at your **next Submit
or Skip**, not at once: with only Hello World in the queue, Next is Hello
World once more, and the new ones come in after that Submit.

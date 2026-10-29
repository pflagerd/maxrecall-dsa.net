# Running MaxRecall DSA on the VPS (Ubuntu 24.04, SSH tunnel only)

Written 2026-10-29. This is option A from that day's discussion: the app
listens only on the VPS's own loopback address (`127.0.0.1`), and you reach it
through an SSH tunnel. Nothing is exposed to the internet.

**Why it's set up this way.** Submitted code isn't sandboxed (`readme.html`
§10). It runs as the server's user. To limit the damage, the server:

- runs as its own unprivileged user, `maxrecall`;
- is reachable only through your SSH login;
- runs under systemd containment (`deploy/maxrecall-dsa.test.service`): no
  network except the VPS itself, a read-only file system apart from three
  folders, and a private `/tmp`.

That's containment, not a real sandbox: a submission can still read
world-readable files on the VPS and use CPU and memory.

Commands marked **[VPS]** run on the VPS. Commands marked **[Kubuntu]** run on
your machine. Replace `VPS_IP` with the VPS's address. Hostinger's panel shows it.

## 1. Packages [VPS]

```bash
sudo apt update
```
Refreshes the list of available packages.

```bash
sudo apt install -y git make g++ default-jdk-headless python3 curl xz-utils
```
- `-y` answers "yes" to the confirmation prompt.
- `g++` 13.2 compiles C++ submissions.
- `default-jdk-headless` (OpenJDK 21) compiles and runs Java. "Headless"
  means no desktop GUI libraries.
- `xz-utils` unpacks the Node download.

These versions were checked against Ubuntu 24.04's repositories on 2026-10-29.

Not covered: **D**. Ubuntu has no `dmd` package, and the judge runs `dmd`
specifically, so D submissions will fail here, as in the cloud sandbox.

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
`ReadWritePaths` refuses a missing path.

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
many lines). The first should read
`Server listening on 127.0.0.1:3000 only, … in /srv/maxrecall/data/users`.

## 6. Check it's private and contained [VPS, then Kubuntu]

**[VPS]**
```bash
ss -tlnp | grep 3000
```
- `ss` lists sockets: `-t` TCP, `-l` listening, `-n` numeric addresses, `-p`
  the owning process.
- It should show `127.0.0.1:3000`, **not** `0.0.0.0:3000` or `*:3000`.

**[Kubuntu]**
```bash
curl --max-time 5 http://VPS_IP:3000/
```
Should **fail** (timeout or connection refused). If it returns a page, stop
the service and recheck the `HOST` line in the service file.

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
ssh -N -L 3000:127.0.0.1:3000 root@VPS_IP
```
- `-L 3000:127.0.0.1:3000` forwards port 3000 on your machine to
  `127.0.0.1:3000` *as seen from the VPS*, that is, to the app.
- `-N` runs no remote command; the connection exists only to carry the tunnel.
- Leave it running, and press Ctrl-C to close the tunnel.

See [ssh(1)](https://man.openbsd.org/ssh#L).

Then open <http://localhost:3000>.

If `make dev` is already using port 3000 on Kubuntu, use another local port:
`-L 3001:127.0.0.1:3000`, then open <http://localhost:3001>.

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

## 9. Bringing VPS submissions into the repo [Kubuntu]

The VPS has no GitHub credentials, and it doesn't need any. Copy its records
into your Kubuntu checkout and commit them there:

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

```bash
git add users
git commit -m "Add submissions from the VPS"
git push
```
Then commit and push as usual. The repo is public, so these records are too.

If you log in as a user other than root, `/srv/maxrecall` may not be readable
by you, since `adduser` makes home folders private by default (my guess for
24.04's defaults). In that case add `--rsync-path="sudo rsync"`, which needs
`sudo` to work without a password prompt over SSH.

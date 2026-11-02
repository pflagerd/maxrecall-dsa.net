# Getting DMD (the D compiler) in a Claude Code cloud session

Written 2026-10-30. The judge compiles D submissions by running `dmd`
(`judge/runner.js`, `compileD`), but the cloud environment doesn't come with
it, so D submissions fail there until it's installed. This note installs it
from **d-apt**, the D community's APT repository on SourceForge.

On Kubuntu you don't need this: use the official downloads at
<https://dlang.org/download.html>. (d-apt may work there too, but that's
untested on 26.04.)

## Why d-apt, and not the official download

Tested from a cloud session on 2026-10-30:

| Route | Result |
|---|---|
| `downloads.dlang.org`, `dlang.org/install.sh` (official) | Blocked by the environment's network policy (proxy answers 403) |
| Ubuntu 24.04's own archive | Has no `dmd` package (only `ldc` and `gdc`, the other two D compilers) |
| d-apt on SourceForge | Reachable; had `dmd-compiler` 2.113.0, signed index |

Two other routes also work but cost more: building DMD from its source on
GitHub (see [Fallbacks](#fallbacks)), or adding `downloads.dlang.org` to the
environment's allowed domains (Network access in the environment's settings;
[steps](https://code.claude.com/docs/en/cloud-environments#network-access)).

## What you're trusting

d-apt's index (`InRelease`) is signed with this key:

```
pub   rsa4096 2021-02-18 [SC]
      552B 99D9 C438 912C 2A97  F8F9 EDC4 FB09 C3AE EDD0
uid                      APT repository for D
```

The key comes from d-apt's own keyring package, downloaded over HTTPS from
SourceForge, so the real root of trust is HTTPS to SourceForge on the day the
fingerprint was first recorded (2026-10-30). The fingerprint above lets every
later session check it's still the same key. It couldn't be cross-checked
against a page on dlang.org, which the cloud sandbox can't reach.

d-apt's own instructions install the keyring package with
`--allow-unauthenticated`. That package puts the key in
`/etc/apt/trusted.gpg.d/`, where apt trusts it for **every** source. The steps
below don't install that package. They take the key out of it, and tell apt to
trust it for d-apt only (`signed-by`).

## Steps

The cloud session runs as root, so there's no `sudo`. On another machine, put
`sudo` in front of steps 3 to 5.

**1. Download the keyring package.**

```bash
curl -fsSL -o /tmp/d-apt-keyring.deb https://sourceforge.net/projects/d-apt/files/pool/main/d/d-apt-keyring/d-apt-keyring_2021.02.18-1_all.deb/download
```

- `-f`: fail on an HTTP error instead of saving the error page.
- `-sS`: no progress bar, but still show errors.
- `-L`: follow redirects. SourceForge redirects each download to a mirror.
- `-o FILE`: save to `FILE`.

Reference: [curl manual](https://curl.se/docs/manpage.html).

**2. Take the key out and check its fingerprint.**

```bash
dpkg-deb -x /tmp/d-apt-keyring.deb /tmp/d-apt-keyring
```

- `-x DEB DIR`: unpack the package's files into `DIR` without installing it.
  Reference: [dpkg-deb(1)](https://manpages.ubuntu.com/manpages/noble/man1/dpkg-deb.1.html).

```bash
gpg --show-keys --with-fingerprint /tmp/d-apt-keyring/etc/apt/trusted.gpg.d/d-apt-keyring.gpg
```

- `--show-keys`: print the keys in a file without importing them anywhere.
- `--with-fingerprint`: include each key's full fingerprint.

Reference: [GnuPG manual, Operational GPG Commands](https://www.gnupg.org/documentation/manuals/gnupg/Operational-GPG-Commands.html).

It must print `552B 99D9 C438 912C 2A97  F8F9 EDC4 FB09 C3AE EDD0`. If it
prints anything else, **stop**: the key has changed, and that needs looking
into before anything is installed.

**3. Install the key where only d-apt will use it.**

```bash
install -D -m 0644 /tmp/d-apt-keyring/etc/apt/trusted.gpg.d/d-apt-keyring.gpg /etc/apt/keyrings/d-apt.gpg
```

- `-D`: create `/etc/apt/keyrings/` first if it doesn't exist.
- `-m 0644`: readable by everyone, writable only by root, which is what apt
  expects for a key file.

Reference: [install(1)](https://manpages.ubuntu.com/manpages/noble/man1/install.1.html).

**4. Add d-apt as a source, signed by that key only.**

```bash
echo 'deb [signed-by=/etc/apt/keyrings/d-apt.gpg] https://downloads.sourceforge.net/project/d-apt/ d-apt main' > /etc/apt/sources.list.d/d-apt.list
```

- `deb`: a source of binary packages.
- `[signed-by=FILE]`: accept this source's index only if `FILE`'s key signed
  it, and don't trust that key for any other source.
- `https://downloads.sourceforge.net/project/d-apt/`: the repository (this is
  the address d-apt's own `d-apt.list` gives).
- `d-apt main`: the suite and component to use.

Reference: [sources.list(5)](https://manpages.ubuntu.com/manpages/noble/man5/sources.list.5.html).

**5. Install DMD.**

```bash
apt-get update && apt-get install -y dmd-compiler
```

- `update`: download every source's index, checking d-apt's signature against
  the key from step 3.
- `install -y dmd-compiler`: install DMD, answering "yes" to the prompt. It
  also pulls in Phobos, D's standard library (`libphobos2-dev`), from d-apt and
  `gcc` and `libc6-dev` (used for linking) from Ubuntu.

Reference: [apt-get(8)](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html).

**6. Check it.**

```bash
dmd --version | head -1
```

On 2026-10-30 this printed `DMD64 D Compiler v2.113.0`. `dmd` is installed as
`/usr/bin/dmd`, which is on the judge's `PATH`, so nothing in the repo needs
changing.

## What it was tested with

With DMD 2.113.0 from d-apt, on 2026-10-30, through the real judge
(`runSubmission`):

- *To Uppercase and Lowercase*: D reference solutions passed 22/22. Each "this
  won't compile" claim in its Learning tab gave that compiler error:
  assigning to `s[0]` of a `string`, `char` arithmetic without a cast, and
  calling `toLower(c)` without `std.ascii.` in front ("matches conflicting
  symbols", because `std.uni`'s `toLower` is visible too).
- *Is Unique I*: the `bool[char]` solution passed 19/19.
- Deliberately wrong solutions failed.

## Fallbacks

- **Build DMD from source.** `git clone` from GitHub works in the cloud
  sandbox. Clone `https://github.com/dlang/dmd.git` and
  `https://github.com/dlang/phobos.git` at the same release tag, side by side
  (`--depth 1 -b v2.111.0`). DMD is written in D, so it needs a D compiler to
  build the first time: `apt-get install -y ldc` gives one. Then run
  `make -j"$(nproc)" HOST_DMD=ldmd2` in `dmd/` and
  `make -j"$(nproc)" DMD=../dmd/generated/linux/release/64/dmd` in `phobos/`,
  and put `dmd/generated/linux/release/64` at the front of `PATH`. That worked
  on 2026-10-30 (DMD 2.111.0, a few minutes), but Claude Code's auto mode
  blocked it the first time it was tried, because it runs build scripts from
  freshly cloned repositories.
- **Use LDC in DMD's place, for a quick check only.** LDC's `ldmd2` accepts
  `dmd`'s options, so a link named `dmd` pointing at `/usr/bin/ldmd2`, put
  first on `PATH`, makes the judge use it. It's a different compiler (LDC 1.36
  is based on DMD's 2.106 front end), so prefer real DMD.

## Later

A cloud session forgets all of this when its container is reclaimed. Steps 1
to 5 could become a SessionStart hook, so every cloud session gets DMD
automatically. That isn't decided yet.

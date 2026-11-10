# The cloud environment gets a setup script, since the SessionStart hook doesn't run with two repositories

2026-11-10 (UTC) · decided by the owner · written by core

**Decided** (owner, 2026-11-10, in core's session): "Option 1", of the
three that infrastructure and security's last handoffs put
(`docs/session-handoff/infrastructure-and-security/20261110T105129-0800.md`,
"Open question with the owner"): a setup script on the cloud
environment; taking `maxrecall.net` off the environment; or leaving it.

**The problem.** The cloud environment named `maxrecall-dsa.net`
(`env_01XRQJd7HCAkgCjQNRvqEgLa`) lists two repositories,
`pflagerd/maxrecall-dsa.net` and `pflagerd/maxrecall.net`. A session on
it starts in `/home/user`, above both checkouts, so this repository's
`.claude/settings.json` isn't the working directory's and its
SessionStart hook doesn't run: the container has no bubblewrap and no
libseccomp-dev, and the server refuses to judge. Seen again in core's
first session, 2026-11-10: `command -v bwrap` printed nothing.

**What was done.** The owner approved this setup script on the
environment (an approval card, 2026-11-10 about 19:10 UTC). It is kept
in the environment's settings on claude.ai, **not in this repository**;
this is its text as first saved, and the settings are what runs:

```bash
#!/bin/bash
# For pflagerd/maxrecall-dsa.net: what its SessionStart hook installs, which
# doesn't run when a session has two repositories. Toolchains (LDC and the
# rest), then the judge's sandbox (bubblewrap, libseccomp-dev).
# pflagerd/maxrecall.net needs no set-up here.
# Always exits 0: a failed step is printed, and the session still starts.
if [ -d maxrecall-dsa.net ]; then
  cd maxrecall-dsa.net
  scripts/toolchain-deps.sh || echo "setup: toolchain-deps failed; run make toolchain-deps"
  scripts/sandbox-deps.sh || echo "setup: sandbox-deps failed; run make sandbox-deps"
fi
exit 0
```

- It runs the same two scripts as the hook and `make`, so there is still
  one definition of what gets installed.
- `[ -d maxrecall-dsa.net ]`: the environment's script runs for every
  session on it, whatever repositories that session has, in the folder
  that holds the checkouts.
- `|| echo …` and `exit 0`: a setup script that fails stops the session
  from starting (the cloud tools' own description of `setup_script`,
  read in the session; not checked against the public documentation),
  and a session without the sandbox is better than none. The hook, by
  contrast, reports a failure and lets the session start.

**Tested** by hand, as root, from `/home/user` in core's session: 12.9 s,
exit 0, libseccomp-dev 2.5.5 installed, `Sandbox: bubblewrap 0.9.0
works`. From a folder without the repository: nothing done, exit 0.
**Not yet seen**: the script running by itself when a fresh container is
built. The first session started on this environment after 2026-11-10
shows it (`command -v bwrap`).

**What it doesn't fix.** `.claude/settings.json`'s three permission
allowances (`make test`, `make typecheck`, `make doc-check`) still don't
load in a two-repository session, by the same reading of where Claude
Code takes settings from: an inference, not tested.

**The hook stays**, for a session with this repository alone.

**Why this option** (core's and infrastructure and security's
recommendation; the owner gave no reason in words): it works wherever
the session starts, and doesn't break when a second repository is
attached, as option 2 would.

Source: `.claude/hooks/session-start.sh`, `scripts/toolchain-deps.sh`,
`scripts/sandbox-deps.sh`; `readme.html`, Environments.

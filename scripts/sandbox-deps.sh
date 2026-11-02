#!/bin/bash
# Installs what the judge's sandbox (judge/sandbox.js) needs, if it's
# missing, then checks that the sandbox works. Run by `make build` (and so
# by `make run` and `make dev`) and by the cloud SessionStart hook.
#
# It asks for root (sudo) only when it has something to install. When
# everything is in place it only checks, which takes a fraction of a second.
#
# What it may do, in order:
# 1. Install bubblewrap from Ubuntu's archive, if `bwrap` isn't on PATH.
# 2. If the sandbox self-test fails because AppArmor blocks bubblewrap's
#    user namespaces (Ubuntu's kernel.apparmor_restrict_unprivileged_userns),
#    load Ubuntu's own bwrap-userns-restrict profile, installing
#    apparmor-profiles for it first if needed. This is a machine-wide change:
#    afterwards any user's bwrap may create user namespaces. Why, and what
#    the profile does: docs/deploy-vps.md §1a, docs/plans/sandboxing.md §4.
#
# It exits 0 even if it can't fix things, so `make dev` still starts: the
# server then refuses Run and Submit on its own, and MAXRECALL_UNSANDBOXED=1
# still lets you judge without a sandbox. One summary line goes to stdout
# (the cloud hook shows it to Claude); everything else goes to stderr.
#
# Root may create user namespaces even where AppArmor stops everyone else.
# So when this script runs as root, both of its checks run bubblewrap as
# nobody, as judge/sandbox.js does when the server is root, and they test
# what an ordinary user (such as the VPS's maxrecall) would get. Before
# 2026-11-02 the second check ran as root and passed on the VPS, so the
# script blamed something other than AppArmor and never loaded the profile.
set -euo pipefail
cd "$(dirname "$0")/.."

PROFILE_SOURCE=/usr/share/apparmor/extra-profiles/bwrap-userns-restrict
PROFILE_TARGET=/etc/apparmor.d/bwrap-userns-restrict
RESTRICT_SYSCTL=/proc/sys/kernel/apparmor_restrict_unprivileged_userns

note() { echo "sandbox-deps: $*" >&2; }

# Runs a command as root: directly if we are root (the cloud), else via sudo,
# saying so first, because sudo may stop to ask for your password.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    note "running as root (sudo may ask for your password): $*"
    sudo "$@"
  fi
}

# apt-get install, refreshing the package lists first if apt doesn't know
# the package yet (they start empty in a new cloud container).
apt_install() {
  local package
  for package in "$@"; do
    if ! apt-cache policy "$package" 2>/dev/null | grep -q 'Candidate: [^(]'; then
      as_root apt-get update -q >&2
      break
    fi
  done
  as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$@" >&2
}

# The server's own startup self-test (judge/sandbox.js). On failure it prints
# the reason to stdout, for the summary line.
self_test() {
  node -e 'const s = require("./judge/sandbox"); if (!s.sandboxStatus.ok) { console.log(s.sandboxStatus.reason); process.exit(1); }'
}

# Runs a command as the user sandboxes run as: nobody if we are root (the
# same switch judge/sandbox.js makes), else ourselves.
as_sandbox_user() {
  if [ "$(id -u)" -eq 0 ]; then
    setpriv --reuid=65534 --regid=65534 --clear-groups "$@"
  else
    "$@"
  fi
}

# The smallest sandbox: tells "AppArmor (or the kernel) won't let bwrap make
# namespaces" apart from other self-test failures, such as a missing bind.
# --unshare-all includes the network namespace, whose loopback setup is
# where AppArmor's restriction showed on the VPS ("loopback: Failed
# RTM_NEWADDR: Operation not permitted").
minimal_bwrap() {
  as_sandbox_user bwrap --unshare-all --unshare-user --ro-bind /usr /usr --symlink usr/bin /bin --symlink usr/lib /lib --symlink usr/lib64 /lib64 -- true 2>/dev/null
}

works() {
  echo "Sandbox: $(bwrap --version) works (scripts/sandbox-deps.sh)."
  exit 0
}

give_up() {
  echo "Sandbox: UNAVAILABLE ($1). Run and Submit will be refused; set MAXRECALL_UNSANDBOXED=1 to judge without a sandbox (scripts/sandbox-deps.sh)."
  exit 0
}

command -v node >/dev/null || give_up "node is not on PATH, so the sandbox can't be checked"

# 1. bubblewrap itself.
if ! command -v bwrap >/dev/null; then
  note "bubblewrap is not installed; installing it from Ubuntu's archive."
  apt_install bubblewrap || give_up "installing bubblewrap failed"
fi

if reason=$(self_test); then works; fi

# 2. AppArmor, only if it's what's in the way.
if minimal_bwrap; then
  give_up "$reason"
fi
if [ "$(cat "$RESTRICT_SYSCTL" 2>/dev/null)" != 1 ]; then
  give_up "bwrap can't create namespaces here, and it isn't Ubuntu's AppArmor restriction: $reason"
fi

note "AppArmor's restriction on user namespaces ($RESTRICT_SYSCTL = 1) is stopping bubblewrap."
note "Loading Ubuntu's bwrap-userns-restrict profile, which allows /usr/bin/bwrap to create them, machine-wide."
if [ ! -f "$PROFILE_SOURCE" ]; then
  apt_install apparmor-profiles || give_up "installing apparmor-profiles failed"
fi
[ -f "$PROFILE_SOURCE" ] || give_up "$PROFILE_SOURCE doesn't exist on this system"
if ! cmp -s "$PROFILE_SOURCE" "$PROFILE_TARGET"; then
  as_root install -m 0644 "$PROFILE_SOURCE" "$PROFILE_TARGET" || give_up "copying the profile failed"
fi
as_root apparmor_parser -r "$PROFILE_TARGET" || give_up "loading the profile failed"

if reason=$(self_test); then works; fi
give_up "still failing after loading the AppArmor profile: $reason"

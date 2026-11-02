#!/bin/bash
# SessionStart hook for Claude Code cloud sessions. It installs:
# - bubblewrap, the judge's sandbox (judge/sandbox.js), from Ubuntu's archive.
#   Without it the server refuses Run and Submit (docs/plans/sandboxing.md).
# - DMD (the D compiler) from d-apt, so the judge can compile D submissions.
#   The steps and the reasons for them are in docs/d-compiler.md.
#
# stdout becomes context for Claude, so installer output goes to stderr and
# only a one-line summary goes to stdout. A non-zero exit doesn't stop the
# session; it shows as a hook error, and D submissions fail until fixed.
set -euo pipefail

# Kubuntu and other local machines install DMD the official way.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# The fingerprint recorded in docs/d-compiler.md. If d-apt's key ever changes,
# install nothing until someone has looked into why.
FINGERPRINT=552B99D9C438912C2A97F8F9EDC4FB09C3AEEDD0
KEYRING_URL=https://sourceforge.net/projects/d-apt/files/pool/main/d/d-apt-keyring/d-apt-keyring_2021.02.18-1_all.deb/download
KEY_FILE=/etc/apt/keyrings/d-apt.gpg
SOURCE_FILE=/etc/apt/sources.list.d/d-apt.list
SOURCE_LINE="deb [signed-by=$KEY_FILE] https://downloads.sourceforge.net/project/d-apt/ d-apt main"

key_fingerprint() {
  gpg --show-keys --with-colons "$1" 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }'
}

report() {
  echo "D compiler: $(dmd --version | head -1), from d-apt (docs/d-compiler.md)."
}

# bubblewrap comes from Ubuntu's own archive (main), so no extra key or
# source is needed. The package lists start empty in a new container, hence
# the update. Done first, so the DMD shortcut below can't skip it.
if ! command -v bwrap >/dev/null; then
  if [ "$(id -u)" -ne 0 ]; then
    echo "session-start: installing bubblewrap needs root; skipped. The judge will refuse Run and Submit." >&2
    exit 1
  fi
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q >&2
  apt-get install -y -q bubblewrap >&2
fi
echo "Sandbox: $(bwrap --version), from Ubuntu's archive (judge/sandbox.js)."

# Already installed by an earlier run in this container: nothing to do.
if dpkg-query -W -f='${Status}' dmd-compiler 2>/dev/null | grep -q '^install ok installed$' \
  && [ -f "$KEY_FILE" ] && [ "$(key_fingerprint "$KEY_FILE")" = "$FINGERPRINT" ] \
  && [ "$(cat "$SOURCE_FILE" 2>/dev/null)" = "$SOURCE_LINE" ]; then
  report
  exit 0
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "session-start: installing DMD needs root; skipped." >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Steps 1 and 2 of docs/d-compiler.md: fetch the keyring package, take the
# key out without installing the package, and check its fingerprint.
curl -fsSL -o "$work/keyring.deb" "$KEYRING_URL" >&2
dpkg-deb -x "$work/keyring.deb" "$work/keyring"
key="$work/keyring/etc/apt/trusted.gpg.d/d-apt-keyring.gpg"
actual=$(key_fingerprint "$key")
if [ "$actual" != "$FINGERPRINT" ]; then
  echo "session-start: d-apt's key fingerprint is $actual, expected $FINGERPRINT. DMD not installed." >&2
  exit 1
fi

# Steps 3 to 5: trust the key for d-apt only, then install DMD.
install -D -m 0644 "$key" "$KEY_FILE"
echo "$SOURCE_LINE" > "$SOURCE_FILE"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q >&2
apt-get install -y -q dmd-compiler >&2

report

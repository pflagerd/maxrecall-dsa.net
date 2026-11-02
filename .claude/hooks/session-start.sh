#!/bin/bash
# SessionStart hook for Claude Code cloud sessions. It runs the same two
# scripts `make` runs, so the cloud gets its tools the same way as Kubuntu
# and the VPS:
# - scripts/toolchain-deps.sh: g++, a JDK, python3, LDC (ldc2, the judge's
#   D compiler) and the rest from Ubuntu's archive, and Node 22 if the one
#   on PATH is older (docs/deploy-vps.md §1–§2);
# - scripts/sandbox-deps.sh: bubblewrap, the judge's sandbox
#   (judge/sandbox.js). Without it the server refuses Run and Submit.
#
# Until 2026-11-02 this hook installed DMD from d-apt instead of LDC
# (docs/d-compiler.md, kept for anyone who wants DMD; the judge falls back
# to dmd when ldc2 isn't installed).
#
# stdout becomes context for Claude, so each script prints one summary line
# there and its installer output on stderr. A non-zero exit doesn't stop the
# session; it shows as a hook error.
set -uo pipefail

# Kubuntu and other local machines get these from `make`.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

scripts="$(dirname "$0")/../../scripts"
status=0

# Toolchains first: the sandbox check runs node. toolchain-deps exits 1 when
# it can't fix something; the sandbox check still runs, and the hook reports
# the failure at the end.
"$scripts/toolchain-deps.sh" || status=1
"$scripts/sandbox-deps.sh" || status=1

exit "$status"

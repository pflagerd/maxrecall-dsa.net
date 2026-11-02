#!/bin/bash
# Installs the toolchains from docs/deploy-vps.md §1–§2, if they're missing:
# g++, a JDK (javac/java), python3, LDC (the D compiler ldc2), curl and
# xz-utils from Ubuntu's archive,
# and Node 22 from nodejs.org into /usr/local. Run by `make` before
# `npm install` and before scripts/sandbox-deps.sh, since both need node.
#
# It asks for root (sudo) only when it has something to install, and says
# what it runs first. When everything is in place it only checks.
#
# Unlike sandbox-deps.sh it stops `make` with an error when it can't fix
# things: without node, g++ or javac the server can't even start (judge/
# runner.js compiles its C++ and Java helpers when it loads, and server.js
# needs a Node with process.loadEnvFile).
#
# D: LDC, from Ubuntu's archive (universe). The judge prefers ldc2 and
# falls back to dmd, which cloud sessions also get from d-apt
# (docs/d-compiler.md, .claude/hooks/session-start.sh).
set -euo pipefail

# Node: the version the guide pins, its two published SHA-256 hashes (read
# from nodejs.org on 2026-10-29 and again on 2026-11-02), where it goes,
# and the oldest major version accepted. 22 because Node 20 reached its end
# of life in April 2026 and the app is developed and tested on 22 (the bare
# technical minimum is 20.12, for process.loadEnvFile).
NODE_VERSION=22.23.4
NODE_SHA256_X64=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce
NODE_SHA256_ARM64=6287aa46b6c375d816e63ae66d024fbbfd70404825aabdfdf898a970871d2f4b
NODE_PREFIX=/usr/local
NODE_MIN_MAJOR=22

# End-of-life dates per Node major version, from the Node.js Release team's
# schedule (https://github.com/nodejs/Release/blob/main/schedule.json, read
# 2026-11-02). Odd majors are "Current" releases that never become LTS and
# end about eight months after they start. Used only to warn, never to stop:
# node_warning. Majors not listed (newer than this table) get no warning.
NODE_END_OF_LIFE=(
  [18]=2025-04-30 [19]=2023-06-01 [20]=2026-04-30 [21]=2024-06-01
  [22]=2027-04-30 [23]=2025-06-01 [24]=2028-04-30 [25]=2026-06-01
  [26]=2029-04-30 [27]=2030-04-30
)
# Warn this many days before a major's end of life.
NODE_EOL_WARNING_DAYS=90

# command -> the Ubuntu package that provides it (docs/deploy-vps.md §1).
# git and make aren't here: you needed them to get this far.
APT_PACKAGES=(
  "g++:g++"
  "javac:default-jdk-headless"
  "python3:python3"
  "ldc2:ldc"
  "curl:curl"
  "xz:xz-utils"
)

note() { echo "toolchain-deps: $*" >&2; }
fail() { echo "toolchain-deps: $*" >&2; exit 1; }

# Runs a command as root: directly if we are root, else via sudo, saying so
# first, because sudo may stop to ask for your password.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    note "running as root (sudo may ask for your password): $*"
    sudo "$@"
  fi
}

# apt-get install, refreshing the package lists first if apt doesn't know
# one of the packages yet (they start empty in a new cloud container).
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

# A warning about a node binary's major version, or nothing: odd-numbered
# (never LTS), past its end of life, or within NODE_EOL_WARNING_DAYS of it.
# Dates compare as text because they're all YYYY-MM-DD.
node_warning() {
  local major end today soon
  major=$(node_major "$1")
  end=${NODE_END_OF_LIFE[$major]:-}
  today=$(date +%F)
  soon=$(date -d "+${NODE_EOL_WARNING_DAYS} days" +%F)
  if [ -n "$end" ] && [[ "$end" < "$today" ]]; then
    echo "node $("$1" --version) reached end of life on $end and gets no security fixes; use an LTS release (even-numbered), e.g. take it off PATH so make installs Node $NODE_VERSION"
  elif [ $((major % 2)) -eq 1 ]; then
    echo "node $("$1" --version) is an odd-numbered release, which never becomes LTS${end:+ and ends on $end}; prefer an even-numbered LTS release"
  elif [ -n "$end" ] && [[ "$end" < "$soon" ]]; then
    echo "node $("$1" --version) reaches end of life on $end; plan a move to a newer LTS release"
  fi
}

# Prints the summary line, with a warning about the node version if there
# is one (on stderr too, so it's seen in a terminal).
report_ok() {
  local warning
  warning=$(node_warning "$1")
  [ -n "$warning" ] && note "warning: $warning."
  echo "Toolchains: g++, javac, python3, ldc2 present; node $("$1" --version) at $1${warning:+ (warning: $warning)} (scripts/toolchain-deps.sh)."
  exit 0
}

# The major version of a node binary (22 for v22.23.4), or 0 if it won't run.
node_major() {
  local version
  version=$("$1" --version 2>/dev/null) || { echo 0; return; }
  version=${version#v}
  echo "${version%%.*}"
}

# 1. Packages from Ubuntu's archive.
missing=()
for entry in "${APT_PACKAGES[@]}"; do
  command -v "${entry%%:*}" >/dev/null || missing+=("${entry#*:}")
done
if [ ${#missing[@]} -gt 0 ]; then
  command -v apt-get >/dev/null || fail "missing ${missing[*]}, and this isn't an apt-based system; install them yourself (docs/deploy-vps.md §1)."
  note "installing from Ubuntu's archive: ${missing[*]}"
  apt_install "${missing[@]}" || fail "installing ${missing[*]} failed."
fi

# 2. Node. Leave any node of NODE_MIN_MAJOR or later that PATH finds first.
current=$(command -v node || true)
if [ -n "$current" ] && [ "$(node_major "$current")" -ge "$NODE_MIN_MAJOR" ]; then
  report_ok "$current"
fi

if [ "$(node_major "$NODE_PREFIX/bin/node")" -lt "$NODE_MIN_MAJOR" ]; then
  case "$(uname -m)" in
    x86_64) arch=x64; expected=$NODE_SHA256_X64 ;;
    aarch64) arch=arm64; expected=$NODE_SHA256_ARM64 ;;
    *) fail "no Node $NODE_VERSION build pinned for $(uname -m); install Node $NODE_MIN_MAJOR yourself." ;;
  esac
  tarball="node-v${NODE_VERSION}-linux-${arch}.tar.xz"
  note "node on PATH is ${current:-missing}${current:+ ($("$current" --version 2>/dev/null || echo 'unknown version'))}; installing Node $NODE_VERSION from nodejs.org into $NODE_PREFIX (docs/deploy-vps.md §2)."
  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  curl -fsSL -o "$work/$tarball" "https://nodejs.org/dist/v${NODE_VERSION}/${tarball}" || fail "downloading $tarball failed."
  curl -fsSL -o "$work/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" || fail "downloading SHASUMS256.txt failed."
  # Two checks: against the list nodejs.org publishes now, and against the
  # hash recorded here, so a changed download and a changed list would both
  # have to match a value written down earlier.
  (cd "$work" && grep " ${tarball}\$" SHASUMS256.txt | sha256sum -c - >&2) || fail "$tarball doesn't match nodejs.org's SHASUMS256.txt; not installed."
  actual=$(sha256sum "$work/$tarball" | cut -d' ' -f1)
  [ "$actual" = "$expected" ] || fail "$tarball has SHA-256 $actual, expected $expected (recorded in this script); not installed."
  as_root tar -xJf "$work/$tarball" -C "$NODE_PREFIX" --strip-components=1 --no-same-owner || fail "unpacking $tarball into $NODE_PREFIX failed."
fi

# The server and make use whichever node PATH finds first.
current=$(command -v node || true)
if [ -n "$current" ] && [ "$(node_major "$current")" -ge "$NODE_MIN_MAJOR" ]; then
  report_ok "$current"
fi
fail "Node $("$NODE_PREFIX/bin/node" --version) is in $NODE_PREFIX/bin, but the node your PATH finds first is ${current:-none}${current:+ ($("$current" --version 2>/dev/null))}. Take that one off PATH (check ~/.bashrc and ~/.profile), start a new shell, and run make again."

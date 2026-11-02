#!/bin/bash
# Installs the toolchains from docs/deploy-vps.md §1–§2, if they're missing:
# g++, a JDK (javac/java), python3, curl and xz-utils from Ubuntu's archive,
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
# Not covered, as in the guide: D. Cloud sessions get DMD from d-apt
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

# command -> the Ubuntu package that provides it (docs/deploy-vps.md §1).
# git and make aren't here: you needed them to get this far.
APT_PACKAGES=(
  "g++:g++"
  "javac:default-jdk-headless"
  "python3:python3"
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
  echo "Toolchains: g++, javac, python3 present; node $("$current" --version) at $current (scripts/toolchain-deps.sh)."
  exit 0
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
  echo "Toolchains: g++, javac, python3 present; node $("$current" --version) at $current (scripts/toolchain-deps.sh)."
  exit 0
fi
fail "Node $("$NODE_PREFIX/bin/node" --version) is in $NODE_PREFIX/bin, but the node your PATH finds first is ${current:-none}${current:+ ($("$current" --version 2>/dev/null))}. Take that one off PATH (check ~/.bashrc and ~/.profile), start a new shell, and run make again."

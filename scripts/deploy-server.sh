#!/bin/bash
# Sets up, or updates, the MaxRecall DSA service on this machine, doing what
# docs/deploy-vps.md §3–§6 and §8 describe. `make deploy-server` runs it
# after scripts/toolchain-deps.sh and scripts/sandbox-deps.sh (§1, §1a, §2).
#
# First run: creates the maxrecall user (§3), clones the repo into
# /srv/maxrecall/maxrecall-dsa.net and installs its packages (§4), installs
# and starts the systemd service (§5), then checks it (§5–§6).
# Later runs: update instead (§8): git pull --ff-only, npm install, re-copy
# the unit file only if it changed, restart.
#
# It needs root; without it, it runs itself again with sudo. The first run
# asks before changing anything, because it puts a "trusted" port on this
# machine where anyone local is the owner without signing in, which belongs
# on the VPS behind SSH, not on a desktop. DEPLOY_CONFIRM=yes skips the
# question. The optional password file (/etc/maxrecall-dsa/test.env, §4) is
# a secret you choose, so it stays manual.
#
# It stops with an error if anything fails, including a "Sandbox:
# UNAVAILABLE" line in the service's log, or the ports listening on more
# than 127.0.0.1.
set -euo pipefail

REPO_URL=${DEPLOY_REPO:-https://github.com/pflagerd/maxrecall-dsa.net.git}
BRANCH=${DEPLOY_BRANCH:-master}
SERVICE_USER=maxrecall
HOME_DIR=/srv/maxrecall
CHECKOUT=$HOME_DIR/maxrecall-dsa.net
DATA_DIR=$HOME_DIR/data
UNIT=maxrecall-dsa.test.service
UNIT_PATH=/etc/systemd/system/$UNIT
OLD_UNIT=maxrecall-dsa.service
# The ports in the unit file: 3000 needs sign-in, 3001 is the trusted port.
PORTS=(3000 3001)

note() { echo "deploy-server: $*" >&2; }
fail() { echo "deploy-server: $*" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
  note "needs root; running again with sudo (it may ask for your password)."
  exec sudo DEPLOY_CONFIRM="${DEPLOY_CONFIRM:-}" DEPLOY_REPO="$REPO_URL" DEPLOY_BRANCH="$BRANCH" PATH="$PATH" "$0" "$@"
fi

command -v systemctl >/dev/null && [ -d /run/systemd/system ] \
  || fail "systemd isn't running this machine (no /run/systemd/system), so the service can't be installed here."

# Runs a command as the service's user, with its own home folder (npm keeps
# its cache there) and this script's PATH (systemd's, from the Makefile).
as_service_user() {
  runuser -u "$SERVICE_USER" -- env HOME="$HOME_DIR" PATH="$PATH" "$@"
}

first_install=no
[ -d "$CHECKOUT/.git" ] && [ -f "$UNIT_PATH" ] || first_install=yes

if [ "$first_install" = yes ] && [ "${DEPLOY_CONFIRM:-}" != yes ]; then
  echo "This installs the MaxRecall DSA server as a systemd service on THIS machine ($(hostname)):"
  echo "  - a system user '$SERVICE_USER' and $HOME_DIR (code, data, accounts);"
  echo "  - $UNIT, started now and at every boot, on 127.0.0.1:3000 (sign-in)"
  echo "    and 127.0.0.1:3001, where anyone on this machine is the owner with no sign-in."
  echo "It's meant for the VPS, reached through an SSH tunnel (docs/deploy-vps.md)."
  read -r -p "Set up the maxrecall service on this machine? [y/N] " answer
  case "$answer" in y|Y|yes|YES) ;; *) fail "nothing changed." ;; esac
fi

# §3. The service's user: a system account with no login and no password.
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  note "creating the system user $SERVICE_USER (home $HOME_DIR)."
  adduser --system --group --home "$HOME_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" >&2
fi

# §4. The code (a clone of its own, owned by the service's user) and the
# data folder outside it. §8 when it's already there.
if [ -d "$CHECKOUT/.git" ]; then
  note "updating $CHECKOUT ($BRANCH) with git pull --ff-only."
  as_service_user git -C "$CHECKOUT" fetch -q origin "$BRANCH"
  current=$(as_service_user git -C "$CHECKOUT" branch --show-current)
  [ "$current" = "$BRANCH" ] || fail "$CHECKOUT is on '$current', not '$BRANCH'; switch it yourself (git -C $CHECKOUT switch $BRANCH) and run this again."
  as_service_user git -C "$CHECKOUT" pull -q --ff-only origin "$BRANCH" \
    || fail "git pull --ff-only failed in $CHECKOUT: it has commits of its own (it should only follow GitHub, §8)."
else
  note "cloning $REPO_URL ($BRANCH) into $CHECKOUT."
  as_service_user git clone -q --branch "$BRANCH" "$REPO_URL" "$CHECKOUT"
fi
note "at $(as_service_user git -C "$CHECKOUT" log --oneline -1)."
note "installing npm packages (npm install --omit=dev)."
(cd "$CHECKOUT" && as_service_user npm install --omit=dev --no-audit --no-fund >&2)
# The unit's ReadWritePaths= refuses a missing folder, so it must exist
# before the service starts. auth/ next to it is made by the server.
as_service_user mkdir -p "$DATA_DIR/users"

# §5. The unit file, copied from the checkout's deploy/ folder. Only when
# it changed, so systemd isn't reloaded for nothing.
if ! cmp -s "$CHECKOUT/deploy/$UNIT" "$UNIT_PATH"; then
  note "installing $UNIT_PATH."
  install -m 0644 "$CHECKOUT/deploy/$UNIT" "$UNIT_PATH"
  systemctl daemon-reload
fi
# The service's earlier name, if it's still around, would also want port 3000.
if [ -f "/etc/systemd/system/$OLD_UNIT" ]; then
  note "removing the old $OLD_UNIT (it was renamed $UNIT)."
  systemctl disable --now "$OLD_UNIT" >&2 || true
  rm -f "/etc/systemd/system/$OLD_UNIT"
  systemctl daemon-reload
fi
note "enabling $UNIT and (re)starting it."
systemctl enable -q "$UNIT"
started=$(date '+%Y-%m-%d %H:%M:%S')
systemctl restart "$UNIT"

# §5–§6 checks. Wait for the trusted port to answer (it's the one that needs
# no sign-in, so any HTTP answer will do), up to 30 s.
for _ in $(seq 60); do
  if curl -s -o /dev/null --max-time 1 "http://127.0.0.1:${PORTS[1]}/"; then break; fi
  systemctl is-active -q "$UNIT" || break
  sleep 0.5
done
systemctl is-active -q "$UNIT" || {
  journalctl -u "$UNIT" --since "$started" --no-pager -n 30 >&2
  fail "$UNIT isn't running; its log is above."
}
curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${PORTS[1]}/" || fail "$UNIT is running but doesn't answer on 127.0.0.1:${PORTS[1]}."

log=$(journalctl -u "$UNIT" --since "$started" --no-pager -o cat)
echo "$log" | grep -E '^(Server listening|Sign-in data|Sandbox:|Trusted listener)' || true
sandbox=$(echo "$log" | grep -m1 '^Sandbox:' || true)
[ -n "$sandbox" ] || fail "no 'Sandbox:' line in the service's log since $started."
case "$sandbox" in *UNAVAILABLE*) fail "the service's sandbox doesn't work, so it refuses Run and Submit. The reason is in the line above (docs/deploy-vps.md §1a)." ;; esac

# Nothing may listen on these ports except 127.0.0.1 (§6).
if command -v ss >/dev/null; then
  for port in "${PORTS[@]}"; do
    addresses=$(ss -tlnH "sport = :$port" | awk '{print $4}')
    [ -n "$addresses" ] || fail "nothing is listening on port $port."
    if echo "$addresses" | grep -qv "^127\.0\.0\.1:$port\$"; then
      fail "port $port listens on more than 127.0.0.1: $(echo $addresses). Stop the service (systemctl stop $UNIT) and check $UNIT_PATH."
    fi
  done
  note "ports ${PORTS[*]} listen on 127.0.0.1 only."
else
  note "ss isn't installed, so I couldn't check the ports listen on 127.0.0.1 only (docs/deploy-vps.md §6)."
fi

echo "Deployed: $UNIT at $(as_service_user git -C "$CHECKOUT" log --oneline -1), running. Reach it from Kubuntu with: ssh -N -L 3000:127.0.0.1:${PORTS[1]} root@VPS_IP, then http://localhost:3000 (docs/deploy-vps.md §7)."

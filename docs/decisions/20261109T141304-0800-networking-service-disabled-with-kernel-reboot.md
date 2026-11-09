# `networking.service` is disabled on the VPS, at the reboot for the new kernel

2026-11-09 (UTC) · decided by the owner · written by infrastructure and security

**Decided** (owner, 2026-11-09, "B, with the kernel reboot"): of four
options for the `networking.service` that fails at boot on the VPS
(A leave it, B disable it, C remove ifupdown, D edit its hook), **B**:
`systemctl disable networking.service`, done with the waiting updates
and the new kernel (`6.8.0-149`), so that one reboot tests both. The
steps: `docs/deploy-vps.md` §17. Not yet run.

**Why**: ifupdown configures nothing on the VPS
(`/etc/network/interfaces` only sources an empty `interfaces.d/`); the
network is netplan with systemd-networkd, and `lo` is brought up by
systemd's PID 1 itself (`loopback_setup()`, systemd v255
`src/core/main.c`). The failure is a bug in ifupdown's own hook,
`/etc/network/if-up.d/resolved` (`return` outside a function), at the
current version for noble. Leaving it keeps `systemctl
is-system-running` at `degraded`, a false alarm that would hide a real
one. B is undone with one command (`systemctl enable`); C removes a
package whose dependants weren't checked; D leaves a local edit to a
packaged file.

**What it can't show before the reboot**: disabling changes only what
starts at the next boot, so whether anything unseen needed the unit is
known only then. §17 step 1 checks its reverse dependencies first; a
console that works without the network is needed in case SSH doesn't
come back, and whether Hostinger's has one isn't checked.

Source: the VPS operator's handoff
`docs/session-handoff/vps-operator/20261109T140011-0800.md` (the twelve
read-only checks); systemd v255 `src/core/main.c` line 2239 and
`src/shared/loopback-setup.c`.

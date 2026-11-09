# libvirt is disabled on the VPS, its packages kept

2026-11-09 (UTC) · decided by the owner · written by infrastructure and security

**Decided** (owner, 2026-11-09, "B, disable libvirt"; "We do not use
libvirt on the VPS, but it is conceivable we might in the future"): of
three options for libvirt on the VPS (A leave it running, B disable it
and keep the packages, C remove the packages), **B**. The steps:
`docs/deploy-vps.md` §18. Not yet run.

**Why**: nothing in this project uses virtual machines, and none is
defined on the VPS. libvirt's `default` network autostarts, running
`dnsmasq` on the bridge `virbr0` and adding firewall rules beside
`ufw`'s; `libvirtd` (root) starts on demand through its sockets;
`virtlogd` and `virtlockd` run all the time. A leaves unused software
running; C would mean reinstalling for "maybe later"; B stops it all
and is undone with a few commands.

**What it can't show yet**: whether a later package upgrade keeps the
units disabled (Debian's packaging is meant to; not checked here), so
§18 step 5 asks for a check after the next upgrade.

Source: the VPS operator's eight read-only checks (11-09 ~22:35 UTC),
recorded in this role's handoff of the same day; libvirt v10.0.0
`docs/manpages/virsh.rst` (`net-autostart`, `net-destroy`).

# Session handoff, 2026-11-04 17:38 Pacific Time (PST, −08:00; 01:38 UTC on 11-05)

A snapshot for starting a new Claude Code session, cloud or WebStorm. It's
dated because it doesn't get kept up to date: for how things are *now*,
`readme.html` wins wherever the two disagree. Paste or point the new session
at this file.

Continuing maxrecall-dsa (pflagerd/maxrecall-dsa.net). Read `readme.html`
and `CLAUDE.md` first; plans are in `docs/plans/`.

This handoff is from the session that worked on **limited live testing**
(`docs/plans/limited-live.md`). Another session worked on spaced
repetition at the same time (step 13, a chosen backlog; #51, #53, #54);
its state is in `docs/plans/spaced-repetition.md` and the readme.

## State at this time

- `master` at `2834d90`. `make test`: 195 tests; `make typecheck` and
  `make doc-check` pass (run on that commit for this handoff).
- **Limited live testing** (`docs/plans/limited-live.md`): getting the VPS
  ready for a handful of invited testers, SSH access unchanged. Nothing is
  exposed to the internet yet.
  - **Decided** (owner): D1 nginx + certbot in front (not Node doing HTTPS,
    which would end the unit's loopback-only `IPAddressDeny`); D2 one
    invite code per person; D3 Basic auth + rate limiting at nginx while
    testing is limited; D4 invited testers the owner trusts may use it
    before the remaining sandbox work, on condition the kernel is kept
    patched; Q3 (how a new tester starts): option (b), set up by hand,
    `docs/deploy-vps.md` §11 (the other session, #54).
  - **Step 1 done and deployed** (#52): registering needs an invite from
    `make invite EMAIL=…` (single use, 7 days, only the code's SHA-256
    stored in `auth/invites/`); `MAXRECALL_PASSWORD` is no longer used and
    the unit no longer reads `test.env`; new passwords need at least 12
    characters (owner's choice, below NIST's 15); `trust proxy` is
    `'loopback'`. The VPS log says `registration by invite only`.
  - **Step 2 done** (#55): `ufw` lets only SSH (22/tcp, IPv4 and IPv6) in,
    `docs/deploy-vps.md` §12. Checked from Kubuntu (a fresh `ssh … true`;
    `curl` to port 3000 times out). After a reboot (#56) the service,
    `ufw` and the sandbox all came back by themselves.
  - **D4's kernel condition holds** (pushed straight to `master` at the
    owner's request): `6.8.0-147-generic`, the newest Ubuntu offers the VPS
    (checked after `apt update`). Security updates install themselves daily
    (`unattended-upgrades`); `cloud-init` is held back and left so. 187
    ordinary updates are waiting, for a time the owner chooses.
  - **The VPS's DNS name is `srv702017.hstgr.cloud`** (owner): use it in
    every command for the VPS. On the VPS itself it resolves to `127.0.1.1`,
    so checks of reaching it from outside must run on Kubuntu. Its IP
    addresses are deliberately not in the repo (it's public).
- **The owner has no account on port 3000 on the VPS**: registration was
  closed there before step 1 (no `test.env`). The tunnel's trusted port
  needs none; once the site is public they'll need an invite too.

## Next, in the limited-live plan

- **Step 3, nginx + HTTPS: waiting for the domain name** (Q1: probably
  `maxrecall-code.net` or similar; not registered yet as far as this
  session knows). Before it: register it, add **A and AAAA** records (the
  VPS has both), and check with `dig +short <domain> A` / `AAAA` on
  Kubuntu. Then: a config in `deploy/` (HTTP → HTTPS redirect, proxy to
  `127.0.0.1:3000` only, never 3001, HSTS, Basic auth, `limit_req` on
  `/api/auth/`), `certbot --nginx -d <domain>`, and `ufw allow` 80 and 443
  (and in Hostinger's panel firewall, if it has one; not checked).
  `X-Forwarded-For` may be appended or replaced by nginx: Express's
  `trust proxy` reads it from the right (checked in `proxy-addr`).
- **Step 4**, checks from outside; **step 5**, a first invite to a second
  email of the owner's, following §11 through the tunnel (can be done now);
  **step 6**, backups (D5) and a note to testers.
- **D5, backups, still open.** The owner's idea: a git repository per
  `users/<email>/` folder. Checked with git 2.43.0: email-named folders
  work, SSH fetch addresses with two `@`s work; git's `safe.directory`
  check blocks root from `maxrecall`-owned repositories, and 2.43 doesn't
  take a `users/*` wildcard; `*.tmp-*` needs ignoring; `auth/` should stay
  out of git; `/srv/maxrecall/data/archive/` (§10) should be backed up too.

## Noted, not decided

- Deleting an account leaves its sessions working up to 360 days
  (`sessionEmail` doesn't check the account): a reset by hand should also
  delete that email's files in `auth/sessions/` (readme, Known gaps).
- Changing anyone's backlog (`make backlog-add`/`-remove`) means stopping
  the server for everyone; fine for a handful of testers.
- Per-IP login throttling and per-user fairness in the judge queue, once
  others use it.
- Key-only SSH login (`PasswordAuthentication no`), if it isn't already.
- The 187 pending updates and the upgrade to 26.04: each a planned step of
  its own, followed by `make sandbox-test` and `make line-numbers-test`.

## How we work (learned this session)

- Teach as you go (`CLAUDE.md`). Stop for the owner only on architectural
  choices or ones that reverse an earlier decision of theirs; state small
  choices and carry on (the owner said so after too many questions).
- **The cloud session can't reach the VPS or Kubuntu.** Anything there is
  for the owner to run: give each command in its own block with every
  argument explained, and what to look for in the output.
- Two sessions push to `master` at once, so **fetch `master` before every
  commit** and merge it in. Conflicts so far were always both sides adding
  a top row to the readme's Decisions table, or appending a section to
  `docs/deploy-vps.md` (renumber the later one). Check a PR's
  `mergeable_state` after pushing.
- Pull requests by default; the owner merges. The owner allowed small
  record-only notes straight onto `master` (a fast-forward), once, by
  asking for it; ask again next time. After a PR is merged, restart the
  branch from `master`.
- Checks run for real in the cloud: a server on spare ports with
  throwaway `MAXRECALL_USERS_DIR` and `MAXRECALL_AUTH_DIR`, headless
  Chromium for pages, and Ubuntu packages downloaded and unpacked to read
  their actual files (as for `ufw`).
- Corrections made this session, so they aren't repeated: Node doing HTTPS
  was not blocked from reaching Let's Encrypt (certbot runs outside the
  unit); nginx needn't replace `X-Forwarded-For`; the reboot banner's
  restart wasn't for a kernel.

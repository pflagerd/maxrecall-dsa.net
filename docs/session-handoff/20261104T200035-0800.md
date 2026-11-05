# Session handoff, 2026-11-04 20:00 Pacific Time (PST, −08:00; 04:00 UTC on 11-05)

A snapshot for starting a new Claude Code session, cloud or WebStorm. It's
dated because it doesn't get kept up to date: for how things are *now*,
`readme.html` wins wherever the two disagree. Paste or point the new session
at this file.

Continuing maxrecall-dsa (pflagerd/maxrecall-dsa.net). Read `readme.html`
and `CLAUDE.md` first; plans are in `docs/plans/`.

This handoff is from the session that worked on **limited live testing**
(`docs/plans/limited-live.md`). It replaces
`session-handoff.20261104T173852-0800.md`, from this session about two and
a half hours earlier, which still had step 3 waiting for a domain name.
Another session works on questions and learners at the same time
(spaced-repetition steps 13–14, Test, how to add a problem: #51–#61); its
state is in `docs/plans/spaced-repetition.md`, `docs/plans/playtest.md` and
the readme.

## State at this time

- `master` at `3ded810`, plus this file, pushed straight to `master` at
  the owner's request (no pull request). `make test`: 217 tests;
  `make typecheck` and `make doc-check` pass (run on that commit for this
  handoff). **#61** (how to add a new problem, the other session) is open,
  not merged.
- **The site is live at <https://maxrecallcode.net>** (limited-live steps
  1–4 done). `maxrecallcode.com` and `.org` redirect there; no `www`. A
  visitor gets nginx's shared Basic auth login first (D3), then the app's
  own sign-in. The owner registered there with an invite and saw their
  list, 2026-11-05. Checked from Kubuntu: `.org` → 301 to `.net`;
  `HTTP/2 401` with `strict-transport-security: max-age=86400`; port 3000
  times out from outside.
- **What's on the VPS** (`srv702017.hstgr.cloud`; use that name in commands;
  on the VPS itself it resolves to `127.0.1.1`, so checks of reaching it
  from outside must run on Kubuntu; its IP addresses are deliberately not
  in the repo, which is public):
  - The service (`deploy/maxrecall-dsa.test.service`) on `127.0.0.1:3000`
    (sign-in) and `:3001` (trusted, the SSH tunnel only). Registering needs
    an invite (`make invite`, §4); `MAXRECALL_PASSWORD` and `test.env` are
    gone.
  - nginx 1.24 (`deploy/nginx-maxrecallcode.conf`, installed as
    `/etc/nginx/sites-available/maxrecallcode.conf`): HTTPS, TLS 1.2/1.3,
    HTTP/2, HSTS a day, Basic auth (`/etc/nginx/maxrecall.htpasswd`, user
    `tester` unless the owner chose another), rate limiting on
    `/api/auth/login` and `/register` only, proxy to port 3000 only,
    `proxy_read_timeout 300s`. Updating it: copy the file again, then
    `nginx -t && systemctl reload nginx`.
  - One Let's Encrypt certificate for all three names, from
    `certbot certonly --webroot -w /var/www/letsencrypt --cert-name
    maxrecallcode.net`, renewed by `certbot.timer` with
    `--deploy-hook 'systemctl reload nginx'` saved.
  - `ufw`: 22, 80 and 443 in (IPv4 and v6), everything else dropped
    (§12, §13).
  - Kernel `6.8.0-147-generic`, the newest offered (D4's condition holds);
    security updates install themselves daily; `cloud-init` is held back;
    187 ordinary updates wait.
  - A new tester is set up with `make learner-create` then `make invite`
    (§11, the other session's step 14), with the server running.
- **The owner's VPS account:** now registered on port 3000 (the public
  site). `MAXRECALL_USER` is the trusted port's owner and the only one who
  may **Test** (#60), signed in or through the tunnel.

## Next, in the limited-live plan

- **Step 5: a rehearsal tester**, a second email of the owner's, following
  `docs/deploy-vps.md` §11 (`make learner-create`, `make invite`), in a
  private window.
- **Step 6: backups (D5) and a note to testers** (what's stored, that the
  owner can read it). D5 is open. The owner's idea is a git repository per
  `users/<email>/` folder. Checked with git 2.43.0:
  - email-named folders work, and SSH fetch addresses with two `@`s work;
  - git's `safe.directory` check blocks root from `maxrecall`-owned
    repositories, and 2.43 doesn't take a `users/*` wildcard;
  - `*.tmp-*` needs ignoring;
  - `auth/` should stay out of git;
  - `/srv/maxrecall/data/archive/` (§10) should be backed up too.

  The simpler alternative is `rsync` of `/srv/maxrecall/data/` to Kubuntu
  (§9 does `users/`). Until there's a backup, testers' work exists only on
  the VPS.
- **Later:** HSTS from a day to a year (`max-age=31536000`) once settled;
  the 187 updates (`apt upgrade`), then `make sandbox-test` and
  `make line-numbers-test` on the VPS; the upgrade to 26.04 as its own
  step. Each of these is the owner's call.

## Noted, not decided

- Deleting an account leaves its sessions working up to 360 days
  (`sessionEmail` doesn't check the account): a reset by hand should also
  delete that email's files in `auth/sessions/` (readme, Known gaps).
- Changing a learner's backlog (`make backlog-add`/`-remove`) stops the
  server for everyone for a few seconds; `make learner-create` doesn't.
- Per-IP login throttling in the app (nginx limits by address already),
  and per-user fairness in the judge queue.
- Key-only SSH login (`PasswordAuthentication no`), if it isn't already.

## How we work (learned in this session)

- Teach as you go (`CLAUDE.md`). Stop for the owner only on architectural
  choices or ones that reverse an earlier decision of theirs; state small
  choices and carry on (the owner said so after too many questions).
- **The cloud session can't reach the VPS or Kubuntu** (no route, no
  computer folders shared). Anything there is for the owner to run: each
  command in its own block, every argument explained, and what to look
  for in the output. Ask for output at the points where a mistake is
  cheaper to catch early.
- **Test what the owner will run, in the cloud first**: install the real
  Ubuntu 24.04 package (`apt-get install`, or `apt-get download` and
  `dpkg-deb -x` to read its files), run it against the real app with
  throwaway `MAXRECALL_USERS_DIR`/`MAXRECALL_AUTH_DIR`, and quote file and
  line for each fact. `curl` to local servers needs `--noproxy '*'`
  (quoted, or in a bash array: an unquoted `*` expanded into filenames
  once). The cloud's default `python3` is 3.13, which breaks Ubuntu's
  certbot: run it as `/usr/bin/python3.12 /usr/bin/certbot`. The cloud
  has no IPv6, so `listen [::]` fails there.
- Two sessions push to `master` at once: **fetch `master` before every
  commit, and stop if it moved** (I committed twice before merging; harmless,
  but merge first). Conflicts so far were always both sides adding a top
  row to the readme's Decisions table, "Last updated", or a section at the
  end of `docs/deploy-vps.md` (renumber the later one). Check a PR's
  `mergeable_state` after pushing, and look at the other open PRs.
- Pull requests by default; the owner merges. Record-only notes have gone
  straight onto `master` (a fast-forward) when the owner said so each
  time; ask each time. After a PR is merged, restart the branch from
  `master`.
- When an earlier statement turns out wrong, say so and record it in the
  plan. This session's: Node doing HTTPS wasn't blocked from Let's Encrypt
  (certbot runs outside the unit); nginx needn't replace
  `X-Forwarded-For`; the reboot banner's restart wasn't for a kernel;
  step 3 needed no app change.

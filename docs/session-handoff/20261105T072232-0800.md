# Session handoff, 2026-11-05 07:22 Pacific Time (PST, −08:00; 15:22 UTC)

A snapshot for starting a new Claude Code session, cloud or WebStorm. It's
dated because it doesn't get kept up to date: for how things are *now*,
`readme.html` wins wherever the two disagree. Paste or point the new session
at this file.

Continuing maxrecall-dsa (pflagerd/maxrecall-dsa.net). Read `readme.html`
and `CLAUDE.md` first; plans are in `docs/plans/`.

This handoff is from the session that worked on **limited live testing**
(`docs/plans/limited-live.md`). It replaces
`session-handoff.20261104T200035-0800.md`, from this session the evening
before, which predates the how-to-add-a-new-user page and D5's decisions.

**Two sessions, two areas** (owner, 2026-11-05): the other session does
**users and questions**; this one does **accesses, security and such**.
The other session's handoff, written a minute earlier, is
`session-handoff.20261105T072149-0800.md` (#67): read it too. It still
calls this session's 20:00 handoff its latest; this one replaces that.
Its state is also in `docs/plans/spaced-repetition.md`,
`docs/plans/playtest.md` and the readme.

## State at this time

- `master` at `4e2b2ef` (the other session's handoff, #67), plus this
  file. `make test`: 240 tests; `make typecheck` and `make doc-check` pass
  (run on `c378b08`; #67 added only a Markdown file). No pull request of
  this session's is open.
- **The site is live at <https://maxrecallcode.net>** (limited-live steps
  1–4 done, #52, #55, #62). `maxrecallcode.com` and `.org` redirect there;
  no `www`. A visitor gets nginx's shared Basic auth login first (D3), then
  the app's own sign-in, which needs an invite. The owner has registered
  there. Checked from Kubuntu: redirects, `HTTP/2 401` with HSTS
  (`max-age=86400`), port 3000 unreachable from outside.
- **What's on the VPS** (`srv702017.hstgr.cloud`; use that name in commands;
  on the VPS itself it resolves to `127.0.1.1`, so checks of reaching it
  from outside must run on Kubuntu; its IP addresses are deliberately not
  in the repo, which is public):
  - The service (`deploy/maxrecall-dsa.test.service`) on `127.0.0.1:3000`
    (sign-in) and `:3001` (trusted, the SSH tunnel only).
  - nginx 1.24 (`deploy/nginx-maxrecallcode.conf`, installed as
    `/etc/nginx/sites-available/maxrecallcode.conf`), one Let's Encrypt
    certificate for all three names (renewed by `certbot.timer`, reloading
    nginx), the shared login in `/etc/nginx/maxrecall.htpasswd`.
    `docs/deploy-vps.md` §13.
  - `ufw`: 22, 80 and 443 in, everything else dropped (§12, §13).
  - Kernel `6.8.0-147-generic`, the newest offered (D4 holds); security
    updates install themselves daily; 187 ordinary updates wait.
- **Adding a user or tester: `docs/how-to-add-a-new-user.html`** (#63),
  in the style of `docs/how-to-add-a-new-question.html` (renamed from
  `how-to-add-a-new-problem.html` in #66; its checklist's storage key
  still says `new-problem`, the other session's call). Seven steps on the
  VPS, all with the server running: decide; `make learner-create`; make
  their folder a git repository (step 3); `make invite`; what to send them
  (a draft message that also says what's stored about them, D5's note to
  testers); they register; check it as them in a private window. Also the
  same on Kubuntu, more questions, a forgotten password and taking someone
  off (both delete the user's sessions too), the owner's account and the
  shared login. **Not yet followed for real**: the first time is step 5 of
  the plan, a rehearsal with a second email of the owner's.
- **D5, backups, mostly decided** (owner, 2026-11-05):
  - Each user's folder is a git repository, made at setup, every git
    command as `maxrecall` (with a per-repository identity, and
    `.gitignore` `*.tmp-*`).
  - **Option B: Kubuntu pulls** over SSH; nothing is pushed from the VPS,
    which holds no credentials. Kubuntu clones with
    `--upload-pack='sudo -u maxrecall git-upload-pack'` **and**
    `-c remote.origin.uploadpack=…` (either alone fails: tested over
    `file://`, not yet over SSH).
  - The owner will do the Kubuntu side with **git-nested, a tool of their
    own, unpublished**. Don't look it up: a public PyPI/GitHub project of
    the same name is someone else's, and the owner said not to use its
    source. Ask the owner how theirs works if it matters.
  - **Open:** the periodic commit on the VPS, without which a pull only
    ever brings the first commit (**issue #64**, with the decisions it
    needs); backing up `auth/` (keep it out of git) and `archive/`.

## Next

- **Plan step 5:** the rehearsal tester, following the new page. Expect
  fixes to the page from it; the Kubuntu clone over SSH is its least
  tested part. **Both handoffs list this** (the other as "§11 on the VPS
  … not tried yet"): it's the overlap between users and access. Whichever
  session the owner uses for it, record the outcome in the plan and the
  readme, so the other sees it. My suggestion: this session's, since the
  page, the invite and the shared login are access.
- **Issue #64**, then the rest of plan step 6 (backups), before real
  testers.
- **Later, the owner's call:** HSTS from a day to a year; the 187 updates
  (`apt upgrade`), then `make sandbox-test` and `make line-numbers-test` on
  the VPS; the upgrade to 26.04 as its own step.

## Noted, not decided

- Deleting an account leaves its sessions working (`sessionEmail` doesn't
  check the account); the page's reset and removal work around it by
  deleting the sessions. A real fix is in the code (readme, Known gaps).
- Changing a learner's backlog stops the server for everyone for a few
  seconds; `make learner-create` doesn't.
- Per-IP login throttling in the app (nginx already limits by address),
  per-user fairness in the judge queue, key-only SSH login.

## How we work (learned in this session)

- Teach as you go (`CLAUDE.md`). Stop for the owner only on architectural
  choices or ones that reverse an earlier decision of theirs; state small
  choices and carry on. When the owner does part of the work (here: git
  commands for step 3), review it as a mentor: what's right, what would
  fail, and why, then the corrected version, tested.
- **The cloud session can't reach the VPS or Kubuntu.** Anything there is
  for the owner to run: each command in its own block, every argument
  explained, what to look for. Ask for output where a mistake is cheaper
  to catch early.
- **Test in the cloud first**, with the real Ubuntu 24.04 package and the
  real app:
  - nginx and certbot install with `apt-get`; run certbot as
    `/usr/bin/python3.12 /usr/bin/certbot` (the default `python3` is 3.13
    and breaks it); the cloud has no IPv6, so drop `listen [::]` there.
  - `curl` to local servers needs `--noproxy '*'`, quoted or in a bash
    array (an unquoted `*` expanded into filenames once).
  - **A service user can't reach the scratchpad**: its parent folders are
    `drwx------`. For a test as another user, `chmod o+x` the three
    parents, then put `drwx------` back. Use `set -e` or `if` in such
    tests: once a failed `cd` let commands run in the repo checkout
    (nothing changed; `git status`, `git fsck` checked).
  - Downloading outside code (e.g. `pip download`) is refused by the
    environment; read source as web pages instead, and only when the
    owner hasn't said otherwise.
  - Headless Chromium checks for a docs page: wait for an asynchronous
    Copy before reading the clipboard (without the wait, 1 of 15 looked
    copied on a page that works).
- The other session's rules, which hold here too:
  - once a branch is pushed, **merge `master` into it, never rebase**
    (rebasing needs a force-push; no `--force-with-lease` either);
  - keep `git push` a separate step, never chained after a merge that
    might stop on a conflict;
  - before opening a PR, `git merge-tree --write-tree --name-only HEAD
    origin/master` (exit 0 is clean);
  - on the VPS, run git in `/srv/maxrecall/maxrecall-dsa.net` as
    `maxrecall` (`sudo -u maxrecall git -C …`), as for the user
    repositories; the VPS clock is UTC;
  - exact replacements that assert one match, not `sed 's/…/…/'`;
  - every inline function with a `{ … }` body gets a comment block, also
    in an HTML page's script, which `make doc-check` doesn't read.
- Two sessions push to `master` at once: **fetch `master` before every
  commit, and stop if it moved.** Conflicts so far: both sides adding a top
  row to the readme's Decisions table, "Last updated", a section at the end
  of `docs/deploy-vps.md` (renumber the later one), or the same readme row.
  Check a PR's `mergeable_state` and the other open PRs after pushing.
- Pull requests by default; the owner merges. Record-only notes and
  handoffs have gone straight to `master` (a fast-forward) when the owner
  said so each time; ask each time. After a PR is merged, restart the
  branch from `master`.
- When something said earlier turns out wrong, say so and record it.
  This session's: Node doing HTTPS wasn't blocked from Let's Encrypt;
  nginx needn't replace `X-Forwarded-For`; the reboot banner wasn't for a
  kernel; step 3 needed no app change; `MAXRECALL_USER` also decides who
  may Test (#60); "git-nested" isn't the public project of that name.

# The guarded deploy's survey runs `make test`, and stops at code that skipped a pull request

2026-11-09 (UTC) · decided by the owner · written by infrastructure and security

**Decided** (owner, 2026-11-09, "A, with C as a later issue"): the
guarded deploy's step 1 (`docs/deploy-vps.md`, "Updating: the guarded
deploy") gains three checks:
- **stop** at any commit that reached `master` without a pull request,
  other than a handoff (`git log --first-parent --no-merges`);
- list the pull requests that change judge code (`questions/*.judge.js`,
  `judge/`) with the owner's yes;
- when the deploy changes more than docs, **`make test` must pass** at
  the commit, run in the surveying checkout (a cloud session or
  Kubuntu), not on the VPS.

Of three options for where `make test` is proven (A the survey, B
`scripts/deploy-server.sh` on the VPS, C GitHub Actions on every pull
request), **A** now; **C** later, as issue #213.

**Why**: a fill-in-the-blank question's judge runs inside the server
process with the server's access, and its checks (R1, its own cases,
each judge paired with its question) are only in `make test`. Nothing
ran `make test` before a deploy: GitHub runs no checks on a pull
request, and `make deploy-server` runs no tests. B was ruled out:
`routes.test.js` starts real servers beside the live one, and the VPS
is slow to hand out memory (#23). C is the strongest, but is a project
of its own (toolchains and bubblewrap on GitHub's runners).

**Checked** on `b9a5bef..7b928c8` (what the VPS runs, to `master`):
the first check printed nothing, against 85 handoff commits in the
range, and printed a throwaway direct commit to
`judge/fill-in-the-blank.js` (never pushed); the second listed #181 and
#208.

**What it can't do**: it tests the commit deployed, not each pull
request, so a failing test still reaches `master` and is found only at
the next deploy. A "Squash and merge" pull request would look like a
direct push to the first check (it says to stop and ask).

Source: `docs/deploy-vps.md` (the guarded deploy, step 1);
`docs/roles/questions.md` ("Judge files"); `questions.test.js`;
`scripts/deploy-server.sh`; `.github/workflows/`.

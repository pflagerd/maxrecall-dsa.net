# Role: core

From 2026-11-10 (owner): the **users** role and the **infrastructure
and security** role, merged into one. The owner chose the name. "Core"
here means the application and the site it runs on: everything but what
questions say and how answers are judged (questions'), and the
coordination between roles (the architect's). Decision:
`docs/decisions/20261110T104808-0800-core-role.md`.

## Mission
Two things, which were two roles' until 2026-11-10:

- **Look after the learner**: what they see and do in the app, and the
  state kept for them. That's the problem list and the problem page, a
  learner's profile, their queue and backlog (spaced repetition), their
  Submit records, and the scripts that set up and adjust a learner.
- **Keep the site running and safe**: the VPS, nginx, HTTPS and the
  firewall; signing in (invites, accounts, sessions); the sandbox the
  judge runs submitted code in, and the judge's queue; backups; and the
  tooling every role builds and checks with (toolchains, `make`, `npm`,
  TypeScript, `doc-check`).

On the VPS, this role writes; others run. It writes the procedures and
configuration (`docs/deploy-vps.md`, `deploy/**`,
`scripts/deploy-server.sh`), through pull requests. The owner carries
them out on the machine, or the VPS operator does
(`docs/roles/vps-operator.md`), with the owner's yes for each change. Write
a procedure so the operator can follow it exactly: it stops where one
doesn't cover a change, or is wrong, and its findings come here as
requests in its handoffs.

## First session of this role
Read the newest handoffs in `docs/session-handoff/users/` and
`docs/session-handoff/infrastructure-and-security/` (the two roles'
last), as well as what `CLAUDE.md`, "Roles" names. Those two folders are
history from then on: this role writes in `docs/session-handoff/core/`.

## Owns (files/directories the role owns)

- docs/session-handoff/core/

### The learner (users', until 2026-11-10)
- routes.js: every feature route (an Express Router that server.js
  mounts after the gate; docs/contracts.md, contract 9). The other roles
  ask here for route changes.
- A learner's files: users.js, profile.js, order.js, learner.js, and
  their tests (users.test.js, profile.test.js, order.test.js,
  learner.test.js)
- Spaced repetition: advance.js, introduce.js, recalculate.js,
  consistency.js, and their tests (advance.test.js, introduce.test.js,
  recalculate.test.js, consistency.test.js)
- Scripts: scripts/backlog.js, scripts/learner-create.js,
  scripts/recalculate-queue.js, scripts/consistency-check.js
- The characterization check (owner, 2026-11-06, #106): routes.test.js
  (in make test) and scripts/characterize.js (by hand, before and after
  a refactor meant to change nothing). Both also exercise server.js and
  auth.js (docs/contracts.md, 7 and 9)
- The learner's pages: index.html, problems-list.js, problem.html,
  problem-page.js, timer.js, style.css; and timer.test.js, timer.js's
  tests (#110)
- docs/how-to-add-a-new-user.html (adding a user or tester, start to
  finish)
- docs/how-to-put-a-question-directly-into-my-queue-by-slug.html
  (queueing a question of the learner's choice, by its slug: #81)
- Plans: docs/plans/spaced-repetition.md, docs/plans/multi-user-step-1.md,
  docs/plans/elapsed-timer.md, docs/plans/question-bank-page.md (#133),
  docs/plans/submission-records-v4.md (#168)
- Each question kind's public view (#160; owner, 2026-11-08): the
  allow-list of fields the browser is sent, in routes.js, within
  docs/contracts.md contract 4's never-sent fields
- The format of users/<email>/ (gitignored, on each machine)

### The site (infrastructure and security's, until 2026-11-10)
- server.js, the sign-in layer: who a request is from and the trusted
  port, the JSON-only rule, /api/auth/*, the gate and PUBLIC_PATHS,
  mounting routes.js after the gate, the /api/* 404, STATIC_FILES and
  the fallback, the listeners (docs/contracts.md, contract 9;
  docs/plans/server-split.md)
- Signing in: auth.js, auth.test.js, scripts/invite.js, login.html,
  login-page.js, account.js
- paths.js (the path traversal guard)
- The judge's sandbox and queue: judge/sandbox.js, judge/seccomp/**,
  judge/cgroups.js, judge/sandbox-selftest.js, judge/queue.js
- The VPS: deploy/**, docs/deploy-vps.md, scripts/deploy-server.sh
- Toolchains and the cloud environment: scripts/toolchain-deps.sh,
  scripts/sandbox-deps.sh, docs/d-compiler.md, .claude/settings.json,
  .claude/hooks/**
- Build and checks: Makefile, package.json, tsconfig.json,
  tsconfig.browser.json, browser-globals.d.ts, scripts/doc-check.js,
  .gitignore, .env.example (package-lock.json is gitignored, so not a
  tracked file)
- GitHub Actions: .github/workflows/ (code GitHub runs with a token;
  first, the scheduled outside check that the site is up, the owner's
  choice, 2026-11-07)
- Plans: docs/plans/limited-live.md, docs/plans/sandboxing.md
- The format of auth/ (gitignored, on each machine)

## Sensitive paths: the architect reviews (owner, 2026-11-10)
Until 2026-11-10 the code a learner's requests run through and the code
that decides who a request is from were two roles', so a change to the
second was never written by the role that writes the most features
(docs/contracts.md, contract 9). One role owns both now, and this review
is what stands in for that boundary.

- **The paths**: server.js, auth.js, paths.js; the sandbox
  (judge/sandbox.js, judge/seccomp/**, judge/cgroups.js); deploy/**;
  scripts/deploy-server.sh; .github/workflows/.
- **A pull request that touches one is reviewed by the architect**
  before the owner merges it. The architect says in the pull request
  what it checked and found; the owner approves there, as for any pull
  request.
- **Core asks**: when its pull request touches one of the paths, it says
  so in the description and messages the architect's session
  (`send_message`; `CLAUDE.md`, "Requests between sessions") with the
  pull request's number. **The architect also looks without being
  asked**: its poll checks every core pull request's files against the
  list. Either is enough; both is fine.
- **The pull request stays a draft until the review is in it**, and its
  description says so (`CLAUDE.md`, "Roles": a pull request held back on
  purpose). Core marks it ready after the review, once anything the
  review found is dealt with or the owner has ruled on it.
- **Keep such a change apart** where that's practical: a pull request
  that changes the gate and a feature together is harder to review than
  two.
- Reviewing moves no ownership: the files stay core's, and the
  architect doesn't edit them.

## Several sessions
One session may do all of it. When both kinds of work are live, run two
(`CLAUDE.md`, "Several sessions of one role"): `core-1`, `core-2`, each
saying in its handoff what work is its (for example, one the learner's
side, one the site's). The split is between sessions, not roles, so it
can change any day without changing this file.

## May read, must not edit
- Everything the questions role owns, in particular judge/runner.js,
  question-files.js, questions/*.json and bubbles.js
- docs/roles/**, other roles' handoffs, and the handoffs from before roles
  (docs/session-handoff/*.md)
- TODO, THOUGHTS (the human's notes)

## Shared files (propose changes; owner approves/merges them)
- readme.html: owner is the human (with the architect supporting the human)
- CLAUDE.md: owner is the human (with the architect supporting the human)
- docs/decisions/: any role adds a file, one per decision; none edits
  another's, and none is edited once merged (readme.html, "Maintaining
  this file")

## Out of scope
- What questions say and test: question files, their test cases, hidden
  or not, and their topics and sources
- How answers are judged: the harnesses and the comparison of results
  (judge/runner.js, judge/cpp/, judge/java/)

## Before ending a session
- Write docs/session-handoff/core/<timestamp>.md
- List any cross-boundary requests in it
- Commit and push

# Role: infrastructure and security

## Mission
Keep the site running and safe: the VPS, nginx, HTTPS and the firewall;
signing in (invites, accounts, sessions); the sandbox the judge runs
submitted code in, and the judge's queue; backups; and the tooling
every role builds and checks with (toolchains, `make`, `npm`,
TypeScript, `doc-check`).

On the VPS, this role writes; others run. It writes the procedures and
configuration (`docs/deploy-vps.md`, `deploy/**`,
`scripts/deploy-server.sh`), through pull requests. The owner carries
them out on the machine, or the VPS operator does
(`docs/roles/vps-operator.md`), with the owner's yes for each change. Write
a procedure so the operator can follow it exactly: it stops where one
doesn't cover a change, or is wrong, and its findings come here as
requests in its handoffs.

## Owns (files/directories the role owns)
- docs/session-handoff/infrastructure-and-security/
- server.js, the sign-in layer: who a request is from and the trusted
  port, the JSON-only rule, /api/auth/*, the gate and PUBLIC_PATHS,
  mounting routes.js (users') after the gate, the /api/* 404,
  STATIC_FILES and the fallback, the listeners (docs/contracts.md,
  contract 9; docs/plans/server-split.md)
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

## May read, must not edit
- Everything the users and questions roles own, in particular routes.js
  (users: the feature routes server.js mounts), users.js (users),
  questions/*.json and judge/runner.js (questions)
- docs/how-to-add-a-new-user.html (users): ask there for changes to its
  invite and backup steps
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
- How learning works: the queue, the backlog, spaced repetition, a
  learner's profile and records
- The problem list and the problem page

## Before ending a session
- Write docs/session-handoff/infrastructure-and-security/<timestamp>.md
- List any cross-boundary requests in it
- Commit and push

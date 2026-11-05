# Role: infrastructure and security

## Mission
Keep the site running and safe: the VPS, nginx, HTTPS and the firewall;
signing in (invites, accounts, sessions); the judge that runs submitted
code, and its sandbox; backups; and the tooling every role builds and
checks with (toolchains, `make`, `npm`, TypeScript, `doc-check`).

## Owns (files/directories the role owns)
- docs/session-handoff/infrastructure-and-security/
- Signing in: auth.js, auth.test.js, scripts/invite.js, login.html,
  login-page.js, account.js
- paths.js (the path traversal guard)
- judge/** (the code runner: runner.js, queue.js, sandbox.js, cgroups.js,
  seccomp/, cpp/, java/, sandbox-selftest.js, line-numbers-test.js)
- The VPS: deploy/**, docs/deploy-vps.md, scripts/deploy-server.sh
- Toolchains and the cloud environment: scripts/toolchain-deps.sh,
  scripts/sandbox-deps.sh, docs/d-compiler.md, .claude/settings.json,
  .claude/hooks/**
- Build and checks: Makefile, package.json, package-lock.json,
  tsconfig.json, tsconfig.browser.json, browser-globals.d.ts,
  scripts/doc-check.js, .gitignore, .env.example
- docs/how-to-add-a-new-user.html (invites, the shared login, each user's
  folder as a git repository)
- Plans: docs/plans/limited-live.md, docs/plans/sandboxing.md,
  docs/plans/error-line-numbers.md, docs/plans/documentation-standard.md
- The format of auth/ (gitignored, on each machine)

## May read, must not edit
- Everything the users and questions roles own, in particular server.js
  (users), users.js (users) and questions/*.json (questions)
- docs/roles/**, other roles' handoffs, and the handoffs from before roles
  (docs/session-handoff/*.md)
- TODO, THOUGHTS (the human's notes)

## Shared files (propose changes; owner approves/merges them)
- readme.html: owner is the human (with the architect supporting the human)
- CLAUDE.md: owner is the human (with the architect supporting the human)

## Out of scope
- What questions say and test: question files, their test cases, hidden
  or not, and their topics and sources
- How learning works: the queue, the backlog, spaced repetition, a
  learner's profile and records
- The problem list and the problem page

## Before ending a session
- Write docs/session-handoff/infrastructure-and-security/<timestamp>.md
- List any cross-boundary requests in it
- Commit and push

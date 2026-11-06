# Role: users

## Mission
Look after the learner: what they see and do in the app, and the state
kept for them. That's the problem list and the problem page, a learner's
profile, their queue and backlog (spaced repetition), their Submit
records, and the scripts that set up and adjust a learner.

## Owns (files/directories the role owns)
- docs/session-handoff/users/
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
- The learner's pages: index.html, problems-list.js, problem.html,
  problem-page.js, timer.js, style.css
- docs/how-to-add-a-new-user.html (adding a user or tester, start to
  finish)
- docs/how-to-put-a-question-directly-into-my-queue-by-slug.html
  (queueing a question of the learner's choice, by its slug: #81)
- Plans: docs/plans/spaced-repetition.md, docs/plans/multi-user-step-1.md,
  docs/plans/elapsed-timer.md
- The format of users/<email>/ (gitignored, on each machine)

## May read, must not edit
- Everything the infrastructure-and-security and questions roles own, in
  particular server.js (the sign-in layer: ask there to add a page or
  file to STATIC_FILES), auth.js and the judge's sandbox (infrastructure
  and security), judge/runner.js, question-files.js, questions/*.json and
  bubbles.js (questions)
- Makefile and package.json (infrastructure and security): ask for a new
  `make` target there
- docs/roles/**, other roles' handoffs, and the handoffs from before roles
  (docs/session-handoff/*.md)
- TODO, THOUGHTS (the human's notes)

## Shared files (propose changes; owner approves/merges them)
- readme.html: owner is the human (with the architect supporting the human)
- CLAUDE.md: owner is the human (with the architect supporting the human)

## Out of scope
- Anything touching the code runner or hidden test cases
- Signing in, invites, the VPS, nginx and the sandbox
- What a question says or tests

## Before ending a session
- Write docs/session-handoff/users/<timestamp>.md
- List any cross-boundary requests in it
- Commit and push

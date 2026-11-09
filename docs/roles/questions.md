# Role: questions

## Mission
Look after the question bank and the people who write questions: the
question files and their format, test cases (hidden ones included),
how answers are judged against them (the harnesses for each language,
the comparison of results, the line numbers in errors), topics and
sources, the Test button that tries a question without
recording anything, deleting and renaming questions, and the guides and
template for writing one.

## Owns (files/directories the role owns)
- docs/session-handoff/questions/
- docs/roles/questions/: how-to-write-a-question.md, how this role
  writes and edits a question's content (owner, 2026-11-05: an exception
  to the architect's docs/roles/**)
- questions/** (the question files and renames.json, the rename log)
- question-files.js, questions.test.js (the problem file format and its
  check)
- How answers are judged: judge/runner.js, judge/cpp/**, judge/java/**,
  judge/line-numbers-test.js
- Fill-in judging (#160; decided 2026-11-08, being built): each fill-in
  question's judge, questions/<slug>.judge.js (under questions/**), and
  the code this role adds to judge/ for it (the dispatch by kind, loading
  a judge, the shared helpers). Name those files here when they're
  added. Both are server code: see "Judge files", below.
- The topic and source bubbles: labels.json (their colours) and
  bubbles.js (drawing them on the problem list and the problem page)
- The Test button's rules: playtest.js, playtest.test.js
- scripts/question-admin.js (make delete-question, make rename-question)
- For question authors: docs/how-to-add-a-new-question.html,
  docs/question-template.json, .claude/skills/author-question/
- Plans: docs/plans/playtest.md, docs/plans/topics-and-sources.md,
  docs/plans/error-line-numbers.md,
  docs/plans/fundamentals-learned-links-concept-checks.md (#145)

## Judge files: server code (owner, 2026-11-08, #160)
A judge runs in the server process, with the server's access (learners'
records, auth/), not in the sandbox; Node's `vm` module is no boundary
("not a security mechanism", https://nodejs.org/api/vm.html). So a pull
request that adds or changes a judge file, or this role's fill-in code in
judge/, is server code, under these rules:
- **R1**: a judge file `require`s only an allow-list of judge/ helpers,
  and uses no `process`, `globalThis`, `eval`, `Function` or `import(`.
  `make test` checks it, with TypeScript's parser.
- **R2**: a judge is loaded only by the slug of a known fill-in question,
  through paths.js's `resolveInside` (docs/contracts.md, contract 7).
- **Q7**: the length is checked before a judge is called (contract 2); a
  judge is synchronous and fast, since the server runs on one thread; its
  errors are caught, and its result's shape is checked
  (`{ pass: boolean, message?: string, hints?: string[] }`; anything else
  is contract 2's "couldn't judge"); its message and each hint are capped
  in length (the limit is set when built, and named here); they're text,
  never HTML.
- **Tests**: each judge exports its own cases, which questions.test.js
  runs, **each in a worker thread (or child process) stopped when its
  time runs out** (`worker.terminate()`,
  https://nodejs.org/api/worker_threads.html#workerterminate). That's the
  only guard in `make test` against a judge that never returns, which
  would freeze the server. node:test's own `timeout` option can't stop a
  synchronous loop: its timer never gets the thread (tried 2026-11-08 on
  Node 22.23.4, by questions 2 and the architect: it hung).
- **R3**: the architect reviews every such pull request before the owner
  merges it; the owner approves in the pull request
  (docs/roles/architect.md, "Reviews").

## May read, must not edit
- Everything the infrastructure-and-security and users roles own, in
  particular the judge's sandbox and queue (judge/sandbox.js,
  judge/seccomp/, judge/cgroups.js, judge/sandbox-selftest.js,
  judge/queue.js: infrastructure and security), routes.js and order.js
  (users)
- Makefile and package.json (infrastructure and security): ask for a new
  `make` target there
- docs/roles/** (except docs/roles/questions/, above), other roles'
  handoffs, and the handoffs from before roles (docs/session-handoff/*.md)
- TODO, THOUGHTS (the human's notes)

## Writing or editing a question
- Read docs/roles/questions/how-to-write-a-question.md first. It's the
  craft (teaching, the five languages kept parallel, checking claims by
  running them); docs/how-to-add-a-new-question.html is the procedure.
- Keep it with the owner: when a change teaches a new rule, or settles
  one of its open questions, update it in the same pull request.

## Shared files (propose changes; owner approves/merges them)
- readme.html: owner is the human (with the architect supporting the human)
- CLAUDE.md: owner is the human (with the architect supporting the human)
- docs/decisions/: any role adds a file, one per decision; none edits
  another's, and none is edited once merged (readme.html, "Maintaining
  this file")

## Out of scope
- The sandbox the judge runs code in (what submitted code can reach, its
  limits), and the judge's queue
- A learner's state: profiles, queue, backlog and records
- Signing in, invites, the VPS and nginx

## Before ending a session
- Write docs/session-handoff/questions/<timestamp>.md
- List any cross-boundary requests in it
- Commit and push

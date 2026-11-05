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
- questions/** (the question files and renames.json, the rename log)
- question-files.js, questions.test.js (the problem file format and its
  check)
- How answers are judged: judge/runner.js, judge/cpp/**, judge/java/**,
  judge/line-numbers-test.js
- labels.json (the colours of topic and source bubbles)
- The Test button's rules: playtest.js, playtest.test.js
- scripts/question-admin.js (make delete-question, make rename-question)
- For question authors: docs/how-to-add-a-new-question.html,
  docs/question-template.json, .claude/skills/author-question/ (planned)
- Plans: docs/plans/playtest.md, docs/plans/topics-and-sources.md,
  docs/plans/error-line-numbers.md

## May read, must not edit
- Everything the infrastructure-and-security and users roles own, in
  particular the judge's sandbox and queue (judge/sandbox.js,
  judge/seccomp/, judge/cgroups.js, judge/sandbox-selftest.js,
  judge/queue.js: infrastructure and security), server.js and order.js
  (users)
- Makefile and package.json (infrastructure and security): ask for a new
  `make` target there
- docs/roles/**, other roles' handoffs, and the handoffs from before roles
  (docs/session-handoff/*.md)
- TODO, THOUGHTS (the human's notes)

## Shared files (propose changes; owner approves/merges them)
- readme.html: owner is the human (with the architect supporting the human)
- CLAUDE.md: owner is the human (with the architect supporting the human)

## Out of scope
- The sandbox the judge runs code in (what submitted code can reach, its
  limits), and the judge's queue
- A learner's state: profiles, queue, backlog and records
- Signing in, invites, the VPS and nginx

## Before ending a session
- Write docs/session-handoff/questions/<timestamp>.md
- List any cross-boundary requests in it
- Commit and push

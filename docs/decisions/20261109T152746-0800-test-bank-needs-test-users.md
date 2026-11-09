# A test question bank needs a users folder marked as test data, or the server and users' admin scripts refuse

2026-11-09 · decided by the owner (option B2) · written by users

**The problem** (the architect's finding on PR 198, widened by users):
`MAXRECALL_QUESTIONS_DIR` (PR 198, questions) moves the question bank for
tests. With it set and a real users folder:

- users' `start()` would add the test bank's questions to every real
  learner's `backlog.json` at start-up (`prepareQueues()`, through
  `order.js`'s `fillBacklog`; it only adds, so cleaning up is by hand);
- users' admin scripts (`backlog`, `learner-create`, `recalculate-queue`,
  `consistency-check`) would act on, or report on, real learners' files
  against the test bank.

**Decided** (owner, 2026-11-09, option B2): while `MAXRECALL_QUESTIONS_DIR`
is set, the users folder must hold an empty file named `TEST-USERS`
(`users.js`'s `TEST_USERS_MARKER`), which tests create and a real users
folder never has. Otherwise `start()` throws, so the server doesn't start,
and the four scripts refuse in their usual way ("Refused: …" and exit
code 1; the consistency check's "not run" and 2), each saying why.

**Why not the rule first proposed** (option B, "refuse unless
`MAXRECALL_USERS_DIR` is set too", chosen and then withdrawn the same
day): the live service sets `MAXRECALL_USERS_DIR` for its real folder
(`deploy/maxrecallcode.service`), and `docs/deploy-vps.md` has the
operator run the admin scripts with it, so that rule wouldn't have
protected the VPS. Users found this before building it and told the
owner. Option A (refuse whenever the variable is set) couldn't cover
start-up, which `routes.test.js` needs with the variable set; option B3
(the users folder inside the system's temporary directory) rested on a
convention rather than an explicit mark.

**What follows**: a test bank reaching the live service would stop it
from starting, and the unit's `Restart=always` would retry it (the
architect's point on PR 198) rather than let it change learners' files.
`docs/contracts.md` contract 9 (`start()` may throw before `app.listen`) is
the architect's, queued for the owner.

Source: `users.js` (`TEST_USERS_MARKER`, `testBankRefusal`), `routes.js`
(`start`), `scripts/backlog.js`, `scripts/learner-create.js`,
`scripts/recalculate-queue.js`, `scripts/consistency-check.js`,
`users.test.js`, `routes.test.js`; PR 198.

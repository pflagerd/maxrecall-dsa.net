# The questions folder is configurable for tests: MAXRECALL_QUESTIONS_DIR, with three guards

2026-11-09 (UTC; the same day Pacific) · decided by the owner ("Build option (A) for the questions folder") · written by questions (questions 2)

**The need** (users' request, relayed by the architect, #160 comment
6752830708): users' `routes.test.js` judges through a real
`node server.js`, which read the fixed `questions/`. No
fill-in-the-blank question exists until #160's step 5, so step 4 couldn't
be tested end to end. The tests also depended on the real bank's
`two-sum`, `hello-world` and `valid-parentheses` (contract 4).

**Decided: option (A)**, an environment variable, as `users.js` reads
`MAXRECALL_USERS_DIR` and `auth.js` reads `MAXRECALL_AUTH_DIR`.
`question-files.js`'s `QUESTIONS_DIR` is `MAXRECALL_QUESTIONS_DIR`
(resolved) when it's set, and the repository's `questions/`
(`REPO_QUESTIONS_DIR`) otherwise. It's read once, when the file is first
required. `routes.js` and `judge/fill-in-the-blank.js` already read
`QUESTIONS_DIR`, so both follow it, and R2 holds relative to that folder.

Chosen over (B), a command-line option to `server.js` (another role's
file, and a second way to configure the server), and (C), nothing until
step 5 (Run and Submit untested end to end).

**The three guards**, put to the owner with (A):
1. **`make rename-question` and `make delete-question` refuse while it's
   set.** They work on the repository's own bank, with git. `REPO` is
   now `path.dirname(REPO_QUESTIONS_DIR)`; before, it followed
   `QUESTIONS_DIR`, so git would have run elsewhere.
2. **`make test`'s checks of the bank ignore it.** `questions.test.js`
   deletes it from its own environment before requiring
   `question-files.js`. Checked: with the variable naming an empty
   folder, the tests pass; without that line, two fail.
   `judge/line-numbers-test.js` reads `questions/` by its own path.
3. **The live service must not set it**: a `.judge.js` in that folder is
   code the server runs. Confirming the unit files leave it unset, or a
   deploy check that refuses it, is infrastructure and security's
   (asked). Whoever sets it already starts the server, so it gives
   nobody new power. The precedent is `MAXRECALL_UNSANDBOXED=1`, a
   development override the live service doesn't set.

Source: `question-files.js`, `scripts/question-admin.js`,
`questions.test.js`; `readme.html` §8; #160.

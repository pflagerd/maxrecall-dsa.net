# Session handoff, 2026-11-03 20:24 Pacific Time (PST, −08:00; 04:24 UTC on 11-04)

A snapshot for starting a new Claude Code session, cloud or WebStorm. It's
dated because it doesn't get kept up to date: for how things are *now*,
`readme.html` wins wherever the two disagree. Paste or point the new session
at this file.

Continuing maxrecall-dsa (pflagerd/maxrecall-dsa.net). Read `readme.html`
and `CLAUDE.md` first; plans are in `docs/plans/`.

## State at this time

- `master` at `e9d8a1f` (plus this file's pull request). `make test`: 159
  tests; `make typecheck` and `make doc-check` pass.
- **Spaced repetition** (`docs/plans/spaced-repetition.md`): **steps 1–11
  are built and merged** (step 11 was #48). Each step's entry in the plan's
  Steps section says what was decided (the owner's numbered details), what
  was built and how it was checked. In short:
  - Each user has `users/<email>/profile.json` (languages allowed and
    turned on), `order.json` (the queue: `pass`, `passesInARow` per
    (question, language) pair) and `backlog.json` (pairs waiting, in
    question creation order). Layouts: `readme.html`, "Where data lives".
  - At server start, every user's queue and backlog are created or filled
    (`prepareQueues`), then the consistency check is logged.
  - A saved Submit moves its pair 1.3^k places ± 10% (`advance.js`) and
    brings new pairs in (`introduce.js`: at least 3 in the queue, plus one
    every 5 Submits), in `order.js`'s `recordSubmit`.
  - The problem page's Submit turns into **Next** (`GET /api/next`); **Skip**
    (`POST /api/questions/:slug/skip`) saves a record with
    `"skipped": "yes"` (records are now `schemaVersion` 3) and counts as a
    fail.
  - The problem list (`GET /api/queue`) shows the queue in order, then the
    backlog.
  - `make consistency-check` (`consistency.js`) reports where the files and
    the records disagree; it only reads.
  - `make delete-question SLUG=…` and `make rename-question FROM=… TO=…`
    update every user's files and `questions/renames.json`, staging the git
    change for the owner to commit. `DRY_RUN=1` changes nothing. Stop the
    server first (they refuse otherwise). After a `git pull` on the VPS that
    renames or deletes a question, see `docs/deploy-vps.md` §8.
- **Left in the plan:** only step 12, "later": recalculating from the
  records, courses, dependencies, an adaptive introduction rule. **Next, by
  the owner's choice (2026-11-03): recalculating the queue from the
  records**, starting with its open decisions. `consistency.js`'s
  `expectedProgress` is its core.
- **Checked in the cloud only, not yet on Kubuntu or the VPS.** Nothing has
  read the owner's real `users/` folder. First thing on Kubuntu:
  `make consistency-check`. Expected, but not seen: one warning, "N pairs
  have records but are still in the backlog", for the Submits from before
  step 6 created the queue. `make consistency-check VERBOSE=1` lists them.
  Nothing from these sessions has been deployed to the VPS; whether it has
  been updated since, these sessions can't see.

## Noted, not decided

- The backlog's order: with every language on, each question comes in all
  its languages before the next question (D6 as decided). The alternative
  is each question once in the first language before any repeats.
- A shared `languages.js`: `problem-page.js`'s `LANGUAGE_LABELS` and
  `problems-list.js`'s `LANGUAGE_NAMES` hold the same five names, under two
  names because the browser files share one global scope for TypeScript.
- Redirecting an old question name to its new one after a rename (old
  bookmarks stop working; `renames.json` has what's needed).
- Unit tests for Skip's and Submit's server logic, by moving
  `submissionRecord` and the streak check out of `server.js`.
- A GitHub Actions job running `make test typecheck doc-check` on every PR.
- A deleted question's records stay (D5). If a new question reuses that
  name, they'd attach to it in the check and in a recalculation.

## Hands off unless the owner asks

- #19 and #24 (record format, reported runtime including compile time):
  the owner is thinking them through. Version 3 only added `skipped`, as
  version 2 only added `elapsedMs`.
- Kubuntu's Node (v25.5.0, not an LTS release): the owner uses it for other
  things.
- Never deploy anything on the owner's Kubuntu laptop.

## How we work

- Teach as you go (`CLAUDE.md`). Lay out the options and wait for the
  owner's decision on anything architectural; state small choices and carry
  on. The owner answers numbered details ("1-7 yes"): record each answer in
  the plan, in that step's entry.
- **Every change goes through a pull request**, one per step, on its own
  branch (e.g. `spaced-repetition-step-11`), not pushed to `master`
  directly. A PR can be built on another one that's still open (merge it
  in, no force-push); then say "merge #N first" in its description. Once
  you've said a PR is ready, don't push to it again without saying so. The
  owner merges; never merge yourself.
- Words (owner): a function's **signature** is its parameters' and return
  value's types; a `@typedef` for a record is a **type** (not "shape").
  Parameter types are what callers pass, not `unknown`.
- Each step's pattern: the rule as pure functions with `node:test` tests
  (`order.js`, `consistency.js`), and a thin layer for the files
  (`users.js`, `question-files.js`, `server.js`, `scripts/`). Each new test
  is checked against deliberately broken versions of the code. Say which
  were caught, and why any that weren't can't behave differently.
- Checks that run the real thing, kept in the cloud scratchpad, not the
  repo:
  - a 39-request smoke of the server, compared with the previous step's
    responses;
  - scenario scripts for each step against a real server over temporary
    users folders (`MAXRECALL_USERS_DIR`);
  - headless Chromium for the pages, with CodeMirror and KaTeX served
    locally through Playwright's request interception, because the cloud
    blocks cdnjs;
  - a 37-observation regression run of the pages against `master` (a
    temporary `git worktree`).
- Test servers: give each script its own port. Stop servers in a `finally`
  (a crashed script left one holding its port twice, and the next run then
  talked to the stale server). Stop a leftover by its PID, found by its
  `PORT` in `/proc/<pid>/environ`, never with `pkill -f "node server.js"`,
  which killed the session's own shell once.
- Real git operations (`make rename-question`) are tested in a `git clone`
  in the scratchpad, never in the checkout.
- `make` variables meant for a script go through its environment, never
  pasted into a recipe (shell injection): see `scripts/question-admin.js`.
- No force-pushes: if a commit is already pushed, make a new one.
- Removing a systemd unit security setting needs the owner's explicit
  approval.
- Ask the owner to run checks on Kubuntu (LDC 1.41.0, newer compilers) and
  the VPS (Ubuntu 24.04, LDC 1.36, 2 cores). They have behaved differently
  from the cloud before.
- `node_modules` is shared between branches in one checkout: after
  switching to a branch with other development dependencies, run
  `npm install` (or a `make` target that does).
- The cloud clone may be shallow; git history there can't give dates such
  as a question's creation.

# Session handoff, 2026-11-03 14:01 Pacific Time (PST, −08:00; 22:01 UTC)

A snapshot for starting a new Claude Code session, cloud or WebStorm. It's
dated because it doesn't get kept up to date: for how things are *now*,
`readme.html` wins wherever the two disagree. Paste or point the new session
at this file.

Continuing maxrecall-dsa (pflagerd/maxrecall-dsa.net). Read `readme.html`
and `CLAUDE.md` first; plans are in `docs/plans/`.

## State at this time

- `master` at `93a634d` (plus this file's pull request).
- **Spaced repetition** (`docs/plans/spaced-repetition.md`): all eight
  decisions D1–D8 made by the owner; the decision log at the top has one
  entry per decision, and the Steps section lists 11 build steps.
  - **Step 1 done** (#27): `advance.js`, 1.3^k places ± 10%, stochastically
    rounded, at least 1, with `advance.test.js`, run by `make test`.
    Nothing uses it yet.
  - **Next: step 2**, `introduce.js` and `introduce.test.js`: bring in a
    backlog pair when the queue has fewer than 3, or 5 Submits after the
    last one (D6). Needs no more decisions.
  - Then step 3 (`created` in every question file, filled in by the owner
    on Kubuntu from the full git history), step 4 (`profile.json`), and
    on.
- **Documentation standard** (`docs/plans/documentation-standard.md`,
  `CLAUDE.md` "Documenting code"): done. Every JavaScript function has
  JSDoc with its signature (each argument's and the return value's types),
  and every JavaScript file is checked by `make typecheck`: Node files in
  `tsconfig.json`, browser files in `tsconfig.browser.json` (with
  `browser-globals.d.ts`). TypeScript 7.0.2, `@types/node`,
  `@types/express`, `@types/codemirror` are pinned development
  dependencies. Merged as #28 (`make typecheck`), #29 (server), #30 (front
  end) and #31 (judge).
- Checked in the cloud only, not yet on Kubuntu or the VPS:
  `make typecheck`, `make test` (9 of 9), and, after #31,
  `make line-numbers-test` (36 of 36) and the escape test (16 probes, 15
  contained, 1 skipped).
- Found along the way, recorded in `readme.html`, not changed: a server
  started with no `PATH` couldn't start a sandbox (Known gaps).

## Hands off unless the owner asks

- #19 and #24 (record format, reported runtime including compile time):
  the owner is thinking them through. D8 of spaced repetition will bump
  records to `schemaVersion` 3 (`"skipped": "yes"`), separately.
- Kubuntu's Node (v25.5.0, not an LTS release): the owner uses it for other
  things.
- Never deploy anything on the owner's Kubuntu laptop.

## How we work

- Teach as you go (`CLAUDE.md`). Lay out the options and wait for the
  owner's decision on anything architectural; state small choices and carry
  on. The owner may want to go through decisions one at a time: record each
  answer in the plan as it comes.
- **Every change goes through a pull request** (owner, 2026-11-03), one per
  step, not pushed to `master` directly. **Separate branches are fine**
  (owner's OK), e.g. `jsdoc-server`. A PR can be built on another one
  that's still open (merge it in, no force-push); then say "merge #N
  first" in its description. Once you've said a PR is ready, don't push to
  it again without saying so: a merge takes only the commits the PR showed
  then (#28 was opened for a commit that missed #27's merge that way).
- After a merge, the session's branch is restarted from the new `master`
  (`git switch -C <branch> origin/master`), and pushed as a fast-forward.
- Words (owner): a function's **signature** is its parameters' and return
  value's types; a `@typedef` for a record is a **type** (not "shape").
  Parameter types are what callers pass, not `unknown`, even where the
  function checks its argument itself.
- Documentation-only changes are checked three ways: `make typecheck` (and
  a wrong type put in on purpose fails it); the code with comments
  removed, printed by TypeScript 6.0.3's parser, is compared with
  `master`'s and may differ only by cast parentheses (TypeScript 7's npm
  package can't be loaded for that); and the code is run against
  `master`'s own run (the judge's two suites, a 39-request server check,
  and headless Chromium for the pages). Those scripts were in the cloud
  scratchpad, not the repo.
- The cloud clone is shallow (97 commits), so git history can't give a
  question's creation date there (D6 of spaced repetition).
- No force-pushes: if a commit is already pushed, make a new one.
- Removing a systemd unit security setting needs the owner's explicit
  approval.
- Test against the real server and judge: headless Chromium for the page,
  with CodeMirror and KaTeX served locally (from npm, through Playwright's
  request interception) because the cloud blocks cdnjs. Check that a new
  test fails on the old code. `make sandbox-deps` installs bubblewrap if
  the cloud container lacks it.
- Ask the owner to run checks on Kubuntu (LDC 1.41.0, newer compilers) and
  the VPS (Ubuntu 24.04, LDC 1.36, 2 cores). They have behaved differently
  from the cloud before.
- `node_modules` is shared between branches in one checkout: after
  switching to a branch with other development dependencies, run
  `npm install` (or a `make` target that does), or `make typecheck`
  reports missing types.
- Stop a background server by its PID, never with `pkill -f "node
  server.js"`, which killed the session's own shell once.

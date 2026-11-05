# Session handoff, 2026-11-03 05:57 Pacific Time (PST, −08:00; 13:57 UTC)

A snapshot for starting a new Claude Code session, cloud or WebStorm. It's
dated because it doesn't get kept up to date: for how things are *now*,
`readme.html` wins wherever the two disagree. Paste or point the new session
at this file.

Continuing maxrecall-dsa (pflagerd/maxrecall-dsa.net). Read `readme.html`
first (`CLAUDE.md` says so); plans are in `docs/plans/`.

## State at this time

- `master` at `624be36` (plus this file's commit).
- Sandboxing plan (`docs/plans/sandboxing.md`) is complete, steps 0–8.
  The remaining gaps are issues #22–#25.
- Done on 2026-11-03 and merged:
  - #18: Submit grays out per language after a saved Submit.
  - Console: a Run/Submit answer is filed under the language it was sent
    in.
  - #20: elapsed-time timer (`timer.js`), and `elapsedMs` saved in Submit
    records (`schemaVersion` 2) (`docs/plans/elapsed-timer.md`).
  - #26: error line numbers match the editor. The learner's code is a file
    of its own per language; D is a separate module with `judge_prelude`
    and is compiled with `-g`. Runtime errors end in "(line N)", except in
    C++. Checked by `make line-numbers-test`, 36 checks
    (`docs/plans/error-line-numbers.md`).
- VPS: root's checkout passed `make line-numbers-test` 36/36, and the
  escape test gave 15 contained, 1 skipped in a service-like `systemd-run`
  unit. `make deploy-server` may not have been run since that `master`:
  check the service's checkout (`/srv/maxrecall/maxrecall-dsa.net`) before
  assuming it's current.
- Next candidate: #21, a countdown timer, building on `timer.js`'s
  `createStopwatch`.

## Hands off unless the owner asks

- #19 and #24 (record format, reported runtime including compile time):
  the owner is thinking them through.
- Kubuntu's Node (v25.5.0, not an LTS release): the owner uses it for other
  things.
- Never deploy anything on the owner's Kubuntu laptop.

## How we work

- Teach as you go (`CLAUDE.md`). Lay out the options and wait for the
  owner's decision on anything architectural; state small choices and carry
  on.
- One branch per change, pushed. "Merge without a pull request" means
  fast-forward `master`: check `git merge-base --is-ancestor origin/master
  HEAD`, then `git push origin HEAD:master`. No force-pushes: if a commit
  is already pushed, make a new one.
- Removing a systemd unit security setting needs the owner's explicit
  approval.
- The cloud clone is shallow, with explicit fetch refspecs. When pushing a
  new branch, add its refspec (`git config --add remote.origin.fetch
  +refs/heads/<branch>:refs/remotes/origin/<branch>`) so
  `origin/<branch>` exists and the stop hook sees the push.
- Test against the real server and judge: headless Chromium for the page,
  with CodeMirror served locally because the cloud blocks cdnjs. Check that
  a new test fails on the old code.
- Ask the owner to run checks on Kubuntu (LDC 1.41.0, newer compilers) and
  the VPS (Ubuntu 24.04, LDC 1.36, 2 cores). They have behaved differently
  from the cloud before: D's first #26 approach passed in the cloud and
  failed on Kubuntu.
- Stop a background server by its PID, never with `pkill -f "node
  server.js"`, which killed the session's own shell once.

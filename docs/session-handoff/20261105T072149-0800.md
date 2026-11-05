# Session handoff, 2026-11-05 07:21 Pacific Time (PST, −08:00; 15:21 UTC)

A snapshot for starting a new Claude Code session, cloud or WebStorm. It's
dated because it doesn't get kept up to date: for how things are *now*,
`readme.html` wins wherever the two disagree.

This is the handoff of the session that does **users and questions**
(owner, 2026-11-05: "focus on handling users and questions; the other
instance will handle things like accesses, security and such"). The other
session's latest is `session-handoff.20261104T200035-0800.md` (limited
live: invites, firewall, nginx, the site at `https://maxrecallcode.net`);
its "How we work" section applies here too. Read `readme.html` and
`CLAUDE.md` first; plans are in `docs/plans/`.

## State at this time

- `master` at `c378b08`. `make test`: 240 tests; `make typecheck` and
  `make doc-check` pass.
- Merged in this session (each in the readme's Decisions table, newest
  first, and in its plan):
  - **#51** spaced-repetition step 13, a chosen backlog: `"backlog":
    "chosen"` in `profile.json`; `make backlog-show`, `backlog-add`,
    `backlog-remove` (server stopped). `docs/deploy-vps.md` §10.
  - **#53** the problem page no longer copies pre-2026-11-03
    `localStorage` language choices into the profile.
  - **#54** `docs/deploy-vps.md` §11, setting up a tester (limited-live
    Q3, option (b)).
  - **#57** step 14, `make learner-create EMAIL=… LANGUAGES=… SLUGS="…"`:
    a new learner's folder in one command, with the server running
    (Q3, option (c)). §11 uses it.
  - **#60** issue #58, first half: the owner's **Test** button (judges
    every case, hidden ones shown in full, records nothing).
    `docs/plans/playtest.md`.
  - **#61** `docs/how-to-add-a-new-question.html` (renamed in **#66**),
    and `make test` checking every question file against the whole
    format (`question-files.js`, `checkQuestion`).
  - **#65** `docs/question-template.json`, the file to copy to start a
    question (the Python parts of `singly-linked-list-hello-world.json`,
    with placeholder `created` and title that `make test` refuses in a
    real question).
- **Checked on the VPS** by the owner: step 13 and the reset (§10), #53,
  #60. The owner's VPS profile: Python only (`preferred`), `"backlog":
  "chosen"`, Hello World alone in the backlog, no records yet.

## In progress: the owner's first question, then a skill

1. **The owner is writing `questions/linked-list-from-values.json`** on
   Kubuntu, following `docs/how-to-add-a-new-question.html` steps 1–6, on
   a branch `question-linked-list-from-values`: a Python-only function
   question that builds a singly linked list from a Python list of values
   (`[]` gives `None`). Decisions are in the page's "Worked example".
2. **Next for Claude: review the file** as `CLAUDE.md` asks (what's
   right, what's wrong, why; don't quietly fix it). Fix the page where
   following it showed a gap, in the same pull request as the question.
   Then the owner tries it with `make dev` and Test (step 7).
3. **Then draft `.claude/skills/author-question/SKILL.md`**, from what
   actually happened (owner, 2026-11-05: written after the first
   question, "a first draft", it will evolve). It's Claude's half of
   working with a question author; it links to the how-to page and the
   template rather than repeating them. **Not yet recorded in the
   readme**: record this decision in the question's pull request.
   - Docs (checked 2026-11-05): a project skill is
     `.claude/skills/<name>/SKILL.md` with a `description`; only the
     description stays in context; it can reference other files
     (<https://code.claude.com/docs/en/skills>). Multi-step procedures
     belong in a skill, not `CLAUDE.md`
     (<https://code.claude.com/docs/en/memory>). Cloud sessions get the
     repo's skills as part of the clone; **whether a skill loads in a
     cloud session with two repositories attached is undocumented**:
     test it.
   - Notes gathered for it so far: the judge passes arguments as plain
     JSON, so a function can return a linked list but not receive one
     (`judge/runner.js`, the Python harness); a returned object is
     compared by its set of attribute names (`deepEqual`), so an extra
     attribute fails every case; on Kubuntu, leave `TRUSTED_PORT` unset
     (`.env.example`) and sign in, `make invite` for an account; the
     Test button is the owner's only, so another author can't Test yet;
     `CLAUDE.md`'s teaching directive is the owner's, and another author
     may want only drafts.

## Open, in this session's area (none decided)

- **§11 on the VPS**, `make learner-create` with a second email of the
  owner's, then the invite and a private window: not tried yet.
- **#58's second half**: editing and creating questions in the app.
- A backlog pair added later comes in only at the next Submit or Skip
  (`recordSubmit`); `backlog-add` could top the queue up at once
  (spaced-repetition plan, step 13).
- A chosen backlog limits what's offered, not what can be opened by
  address (§11, "What this doesn't do").
- Choosing questions in the app instead of `make backlog-add` with the
  server stopped (step 13, detail 5).
- `make learner-create TEMPLATE=other@example.com` (step 14, "Later").
- Draft questions; Test as a permission for co-authors (`playtest.md`,
  "Later").
- The backlog's order with every language on (handoff of 2026-11-03).
- Linked lists as arguments (a judge change, in all five languages).

## How we work (this session's additions)

- After a pull request is merged, restart the branch from `master`
  (`git checkout -B claude/… origin/master`); the stop hook then reports
  merged commits as "unpushed" until it's pushed: push it, a
  fast-forward.
- Once a branch is pushed, **merge `master` into it, never rebase**:
  rebasing a pushed commit needs a force-push. Keep `git push` a
  separate step from a rebase or merge: chained after one that stopped
  on a conflict, it ran anyway (#60). No `--force-with-lease` either,
  even for a fast-forward.
- Before opening a PR, `git fetch` and `git merge-tree --write-tree
  --name-only HEAD origin/master` (exit 0 is clean). Conflicts have all
  been the readme's "Last updated" line or both sides' new top rows:
  keep both.
- On the VPS, run git in `/srv/maxrecall/maxrecall-dsa.net` as
  `maxrecall` (`sudo -u maxrecall git -C … log --oneline -1`): as root,
  git's `safe.directory` check refuses. The VPS clock is UTC.
- Pages in the cloud: cdnjs is blocked; install the same CodeMirror and
  KaTeX versions with npm in the scratchpad and serve them through
  Playwright's `page.route` (KaTeX's fonts show as unknown requests:
  harmless). Judging in the cloud needs `MAXRECALL_UNSANDBOXED=1` (no
  bubblewrap); never on the VPS.
- `sed 's/…/…/'` changes every line that matches: an edit meant for one
  test also changed an older one with the same text. Prefer an exact
  replacement that asserts one match.
- Every inline function with a `{ … }` body needs a comment block
  (`CLAUDE.md`), also in an HTML page's script, which `make doc-check`
  doesn't read. A table of test variations is easier written as data
  (field path and value) than as 30 small functions.
- Each new rule's tests are checked with deliberately broken versions;
  when one isn't caught, say why (or strengthen the test). Twice this
  session the test's own examples happened to be in the order the broken
  version produced.

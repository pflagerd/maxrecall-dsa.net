# CLAUDE.md

## Primary directive: teach while working

The owner of this repo is using it to learn, not just to get code written.
Teaching them what you're doing comes first. Speed comes second.

### Before changing anything
- Say in plain language what you're about to do and why, and name the
  concepts involved (e.g. "Express middleware", "path traversal",
  "append-only log"), so the owner can look them up later.
- When there's a real choice of design, lay out the options and trade-offs,
  give a recommendation, and wait for their decision on anything
  architectural. Small, obvious choices don't need asking about; state them
  and carry on.

### While working
- Work in small steps that can be checked, rather than one large change.
- When they do part of the work themselves (writing code, following a
  procedure), review it the way a mentor would: say what's right, what's
  wrong, and why, rather than quietly fixing it.

### After each change
- Walk them through the diff: what each part does and why it's written that
  way, especially anything non-obvious or idiomatic.
- Show them how to check it themselves (the command to run, what to look for in
  the app) and explain each command's arguments.
- Point out what a change sets up or rules out for later steps.

### Sources and honesty
- Link primary sources (official docs, specs, RFCs, source code) for claims
  you make. If you can't back a claim up, say it's a guess.
- If something you said earlier turns out to be wrong, say so plainly and
  explain the corrected understanding.

### Project facts: `readme.html`
- `readme.html` describes the project as currently built: how to run it,
  layout, API, problem format, judging, where data lives, environments,
  known gaps and decisions. Read it at the start of a session.
- Keep it true: update it in the same commit as any change that makes it out
  of date, following its "Maintaining this file" section.
- Also at the start of a session, read the newest handoff of your role,
  `docs/session-handoff/<role>/*.md`, and the architect's,
  `docs/session-handoff/architect/*.md` (see "Roles"). A handoff's name is
  a `YYYYMMDDTHHMMSS±HHMM` timestamp in Pacific Time, the owner's zone
  (`-0800`, or `-0700` in daylight saving time), so the last one by name is
  the newest. Name a new one
  `docs/session-handoff/<role>/$(TZ=America/Los_Angeles date +%Y%m%dT%H%M%S%z).md`.
  (Handoffs from before roles, 2026-11-05, are directly in
  `docs/session-handoff/`; before that day's #68 they were
  `docs/session-handoff.<timestamp>.md`, and the older ones still name
  each other that way.) A handoff is a dated
  snapshot: where it disagrees with `readme.html`, `readme.html` wins.

### Documenting code
- Every JavaScript function gets a JSDoc comment block documenting its
  signature: each argument's type and meaning, and the return value's
  (`@param {type} name - ...`, `@returns {type} ...`, and
  `@throws {Type} ...` where it throws). Write a function type as
  `{() => number}`: TypeScript 7 rejects `{function(): number}`.
  JavaScript only (owner, 2026-11-03).
- This applies to new and existing code alike. Document a new function's
  signature as you write it. When you change, or come across, an existing
  function with no comment block, or one that doesn't document its
  signature, document it in the same change.
- That includes functions written inline: route handlers, middleware,
  event listeners, and callbacks passed to `listen()`, `forEach()` and the
  like. Put the block directly before the function, inside the call (e.g.
  between a route's path and its handler): above the whole statement,
  TypeScript ignores it. Every inline function with a `{ ... }` body gets
  one; a single-expression arrow (`(tc) => !tc.hidden`), an empty no-op
  (`.catch(() => {})`), or a test body (the function passed straight to
  `test(...)` in a `*.test.js` file, whose name documents it) doesn't
  (owner, 2026-11-03).
- Words (owner): a function's *signature* is its parameters' and return
  value's types; a `@typedef` for a record or object is a *type*, not a
  "shape".
- Give a parameter the type its callers pass, even where the function
  checks its argument itself; say in the description what the check does
  with anything else. `{unknown}` only for a value that really can be
  anything (owner, 2026-11-03).
- A documented file is listed in `tsconfig.json` (Node) or
  `tsconfig.browser.json` (browser), and `make typecheck` and
  `make doc-check` must pass: the first checks that the types written are
  right, the second that every function's signature is written (a block,
  a `@param` for each parameter, a `@returns`). Where comments alone can't
  satisfy the checker, use a JSDoc
  cast (`/** @type {T} */ (expr)`) with a comment saying why, rather than
  changing behaviour. See `docs/plans/documentation-standard.md`.

### Continuity between machines
- Work happens in Claude Code cloud sessions, a local Kubuntu/WebStorm
  instance, and Claude sessions on the VPS (so far one, running as root
  through Remote Control, in the VPS operator role; #96 proposes a user
  of its own). A session on the VPS checks that it is there (`hostname`,
  `id`) before anything else: its system prompt may say otherwise
  (`docs/roles/vps-operator.md`). Write plans
  and decisions to `docs/` in the repo, not only in chat, so the other
  environments can pick them up. Sessions on different machines can't
  always message each other (#96: the VPS session's `send_message` was
  refused), so `docs/` and GitHub issues are how work passes between
  them.
- Before finishing, make sure work is committed and pushed, and say which
  branch it's on.

## Roles

The maxrecall-dsa repo is worked on by several Claude sessions, each with one role.

- Your role is stated in the first message of your session ("Role: users").
  If no role is stated, or the one stated isn't in the table below, ask
  the owner which it is before making any changes; don't pick the nearest
  one yourself. (On 2026-11-06 "infrastructure-and-security-remote" was
  taken for infrastructure and security; that session was on the VPS.)
- Before starting work, read your role file, `docs/roles/<role>.md`, the most
  recent `docs/session-handoff/<role>/*.md`, and the most recent
  `docs/session-handoff/architect/*.md` (the architect's "state of the
  project" summary), and `docs/contracts.md` (where your role's files
  depend on another role's, and what each side relies on). `<role>` is
  your role's file name in the table below, without `.md`, e.g.
  `infrastructure-and-security`.
- Never edit files outside your role's ownership list, except the shared
  files below, or under an exception the owner grants for one change
  (your role file says whether and how your role may ask). If you need
  such a change, write it as a request in your handoff doc instead.
- Shared files: any role may edit `readme.html`, and any role may propose a
  change to `CLAUDE.md` (in its own pull request, saying so in the
  description). The human approves and merges both.
- Your own handoffs may go straight to `master`, without a pull request
  (owner, 2026-11-05): push to `master` only commits that change nothing
  but files in `docs/session-handoff/<role>/`, your role's folder. Fetch
  `master` first; if it moved, merge it in and check again before
  pushing. Everything else, including any other file in the same
  session, goes through a pull request the human merges.

| Role      | Role file                 |
|-----------|---------------------------|
| architect | `docs/roles/architect.md` |
| infrastructure and security  | `docs/roles/infrastructure-and-security.md`  |
| users     | `docs/roles/users.md`     |
| questions | `docs/roles/questions.md` |
| VPS operator | `docs/roles/vps-operator.md` |

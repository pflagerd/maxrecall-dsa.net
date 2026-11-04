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
- Also at the start of a session, read the newest
  `docs/session-handoff.*.md`. Its name ends in a `YYYYMMDDTHHMMSS±HHMM`
  timestamp in Pacific Time, the owner's zone (`-0800`, or `-0700` in
  daylight saving time), so the last one by name is the newest. Make one
  with `TZ=America/Los_Angeles date +%Y%m%dT%H%M%S%z`. It's a dated
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
  one; a single-expression arrow (`(tc) => !tc.hidden`) or an empty no-op
  (`.catch(() => {})`) doesn't (owner, 2026-11-03).
- Words (owner): a function's *signature* is its parameters' and return
  value's types; a `@typedef` for a record or object is a *type*, not a
  "shape".
- Give a parameter the type its callers pass, even where the function
  checks its argument itself; say in the description what the check does
  with anything else. `{unknown}` only for a value that really can be
  anything (owner, 2026-11-03).
- A documented file is listed in `tsconfig.json` (Node) or
  `tsconfig.browser.json` (browser), and `make typecheck` must pass. Where comments alone can't satisfy the checker, use a JSDoc
  cast (`/** @type {T} */ (expr)`) with a comment saying why, rather than
  changing behaviour. See `docs/plans/documentation-standard.md`.

### Continuity between machines
- Work happens in both Claude Code cloud sessions and a local
  Kubuntu/WebStorm instance. Write plans and decisions to `docs/` in the
  repo, not only in chat, so the other environment can pick them up.
- Before finishing, make sure work is committed and pushed, and say which
  branch it's on.

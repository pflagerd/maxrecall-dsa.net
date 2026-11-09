# R1's ways round are closed by kind; its check's limit is stated; an allow-list of names comes next

2026-11-09 (Pacific) · decided by the owner · written by the architect

**Background.** R1 (#160, B7.1; `docs/roles/questions.md`, "Judge
files") says what a fill-in-the-blank judge file may use, since a judge
runs inside the server process with the server's access. PR 181 built
its check, `judgeSourceProblems` in `questions.test.js`: it reads a
judge file with TypeScript's parser and refuses listed names (a
deny-list). The architect's R3 reviews of PR 181 (2026-11-09) found six
ways round it, each reaching `process`, `fs` or `child_process` when a
judge is loaded with `require`, then three more kinds that use no
forbidden name at all (changing a built-in, `fetch`, `Promise.then`; and
`async`/`await`, tested since).

**Decided** (owner, 2026-11-09, in the architect's session):

- **B: close the six by kind, in PR 181**, before it merged: `'use
  strict'` and no `this`; `module` only as `module.exports`; more
  forbidden names and property names, wherever a property's name is
  written; computed keys only as literals. Built by questions 2
  (`638a149`); merged with PR 181.
- **A as well: say what the check can't do.** It catches accidents, not
  every deliberate evasion; review (R3) and the owner's approval are the
  guard against those. In R1's text.
- **C: real isolation as an idea**: a judge outside the server process,
  #185. Not scheduled.
- **(a) for the three new kinds: an allow-list of names**, plus no writes
  to built-ins, no `prototype` and no `async`/`await` or generators (the
  last the architect's addition), in a follow-up by questions after PR
  181 and before #160's step 5. Chosen over (b) #185 first, and (c)
  relying on R3 alone.

**Why**: a deny-list over JavaScript keeps leaking, because the language
always has another name or path nobody listed; each review found more.
An allow-list refuses anything unknown, as R1 already does for
`require`. Only isolation (#185) is a real boundary, so the check's limit
is written down rather than implied.

Source: `docs/roles/questions.md`, "Judge files"; `questions.test.js`;
PR 181's R3 review comments; #160's comments of 2026-11-09; #185.

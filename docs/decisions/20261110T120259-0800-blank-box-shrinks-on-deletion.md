# The fill-in-the-blank box shrinks when text is deleted

2026-11-10 (UTC) · decided by the owner · written by core

**Decided** (owner, 2026-11-10 about 20:10 UTC, in core's session):
"The box should shrink on deletion as you implemented."

**What it settles.** `problem-page.js`'s `fitBlankToText` (PR 231) makes
the box as wide as its text, one character at least, so it narrows
again as characters are deleted. That was core's choice
(`20261110T113707-0800-blank-box-grows-with-its-text.md`: the owner had
said only "expand"), and before that questions-2's guess. It is now the
owner's decision. Nothing in the code changes.

**For the proposed plan**
(`docs/plans/fill-in-the-blank-widths-and-several-blanks.md`,
questions-2's): this answers the direction of its Q3, the second of
"For the owner to decide": the box shrinks, it doesn't stay as wide as
it got. Today it shrinks to one character, which is the only starting
width there is. **Core's reading, not the owner's words**: with a
per-blank `initialWidth`, "as you implemented" would mean shrinking
back to that starting width and never below it, which is what the plan
recommends. The owner's words were about today's box; if Part 1 is
built, its pull request says so plainly.

Source: `problem-page.js` (`fitBlankToText`).

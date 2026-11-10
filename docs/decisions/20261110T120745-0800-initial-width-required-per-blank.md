# `initialWidth`: a fill-in-the-blank question's starting box width, required; several blanks wait

2026-11-10 (UTC; the same day Pacific) · decided by the owner · written by questions (questions-2)

Follows `20261110T115411-0800-blank-starting-width-is-each-questions-own.md`,
and decides the four questions of
`docs/plans/fill-in-the-blank-widths-and-several-blanks.md`.

**Decided** (owner, 2026-11-10, in questions-2's session; the numbers are
the plan's "For the owner to decide"):

1. **A file with no `initialWidth` is refused** by `make test`, with no
   default ("As you recommend"). A box's width hints at the answer's
   length, so no default is neutral.
2. **The box shrinks back to `initialWidth`, never below** ("Yes, shrink
   back to initialWidth, never below."). It still grows past it with the
   text, up to `maxLength`.
3. **Part 1, the starting width, is built now on its own** ("As you
   recommend").
4. **Several blanks wait** ("Wait until I want such a question."). The
   plan's Part 2 stays a proposal.

**Built with this decision** (questions' share):

- `initialWidth` in the format: a whole number from 1 to the blank's
  `maxLength` (10 if the file gives none), required for kind
  `"fill-in-the-blank"`, refused for kind `"code"`
  (`question-files.js`, `checkFillInTheBlank`, `KIND_FIELDS`).
- `"initialWidth": 1` in `questions/single-quote-in-double-quotes.json`:
  the owner wants a single-character answer implied there. Its
  `questionSha256` changes; its judge file doesn't.
- `readme.html` section 5, the how-to page, the guide's section 7, the
  plan's status.

**Not built here, asked for**: core's (the public view sends
`initialWidth`; the page's box is `max(initialWidth, text length)`
characters wide) and the architect's (contract 4). Until core's merges,
the page starts every box one character wide, which is what this one
question wants anyway.

Source: `question-files.js`, `questions.test.js`,
`questions/single-quote-in-double-quotes.json`.

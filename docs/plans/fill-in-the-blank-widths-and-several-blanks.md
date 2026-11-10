# Fill-in-the-blank: each blank's starting width, and several blanks in one question

Status: **Part 1 decided, and questions' share of it built** (questions,
questions-2 session, 2026-11-10); core's share and contract 4 are asked
for. **Part 2 waits** until the owner wants a question with several
blanks. See "Decided" below. Where this disagrees with `readme.html`,
`readme.html` wins: it describes what's built.

## Decided (owner, 2026-11-10, questions-2's session)

Answering "For the owner to decide", at the end:

1. **Q2: (a)**, as recommended: a fill-in-the-blank question with no
   `initialWidth` is refused by `make test`.
2. **Q3**: "Yes, shrink back to initialWidth, never below." (Earlier, in
   core's session, of today's box: "The box should shrink on deletion as
   you implemented"; core's
   `docs/decisions/20261110T120259-0800-blank-box-shrinks-on-deletion.md`.)
3. **Part 1 is built now, on its own**, as recommended.
4. **Part 2**: "Wait until I want such a question."

**Part 1, where it stands:**

- Questions (built): `initialWidth` in `question-files.js`
  (`checkFillInTheBlank`, `KIND_FIELDS`, the `QuestionFile` type), its
  tests in `questions.test.js`, `"initialWidth": 1` in
  `single-quote-in-double-quotes.json`, `readme.html` section 5, the
  how-to page, the guide's section 7.
- Core (asked): send `initialWidth` to the browser (`routes.js`'s
  allow-list), and make the box `max(initialWidth, text length)`
  characters wide (`problem-page.js`, `fitBlankToText`).
- The architect (asked): contract 4's list of the kind's fields, and
  that `initialWidth` may be sent.

## The owner's words (2026-11-10, questions-2's session)

After PR 231 (core) made every fill-in-the-blank box start one character
wide and grow with its text:

- "I want the single-character answer implied." (Of
  `single-quote-in-double-quotes`: there, a one-character box is right.)
- "The one-character start rule is incorrect. A future question should
  ask about the initial width(s). There could be multiple blanks."
- Asked what "ask about" means: **the author asks the owner** what each
  blank's starting width should be, and writes the answer into the
  question file. (Not: the file must state it or `make test` refuses.
  Q2 below asks whether to add that as well.)
- Asked how far to take it now: **a plan first**, covering both, nothing
  built until the owner decides.

So two things are wanted: a starting width that is each blank's own, not
the page's rule; and room for a question with more than one blank.

## What's built today (read from `master` at `d286e76`)

One blank travels through five places. Each would change.

| Where | Whose | Today |
|---|---|---|
| The question file | questions (`question-files.js`, `checkFillInTheBlank`) | `template` (by language), `blank` (the marker, e.g. `"___"`, exactly once in each template), `maxLength` (optional, 1 to 100, 10 if absent). No width. |
| What the browser gets | core (`routes.js`, `PUBLIC_FILL_IN_THE_BLANK_FIELDS`) | `template`, `blank`, and `maxLength` with its default filled in. |
| The page | core (`problem-page.js`, `renderTemplate`, `fitBlankToText`) | One `<input>` where the marker is. Its width is `max(1, text length)` characters: the same rule for every question. |
| The request, and its check | core (`routes.js`, about line 316) | `answer: { blank }`: an object with one field, `blank`, a string no longer than `maxLength`. |
| The judge | questions (`judge/fill-in-the-blank.js`, `questions/<slug>.judge.js`) | `judge(blank, { language })`, `blank` a string, returning `{ pass, message?, hints? }`. Its own cases: `{ blank, language?, pass, messageIncludes? }`. |
| The stored record | core (records version 4, `docs/plans/submission-records-v4.md`) | `answer: { blank }`, as the server checked it. |

Contracts 2 and 4 (`docs/contracts.md`) describe the request, the
judge's call and the file's fields, so each part below that changes one
of them is a contract change: the architect's file, with core's
agreement or the owner's approval.

## Part 1: a starting width for a blank

**Q1. The field.** Proposed: **`initialWidth`**, a whole number of
characters, from 1 to the blank's `maxLength`. The box starts that wide.
"Initial width" is the owner's phrase.

**Q2. When a file leaves it out.** Options:

- (a) **Refused**: `make test` fails for a fill-in-the-blank question
  with no `initialWidth`. The one question that exists gets
  `"initialWidth": 1` in the same pull request. An author can't forget to
  ask.
- (b) **Defaults to `maxLength`**: a box as wide as the most it takes.
  Hints only at the limit, which the box enforces anyway.
- (c) **Defaults to 1**: today's behaviour. The owner has called this
  rule incorrect, so it's listed only for completeness.

Recommended: **(a)**. A width is always a hint about the answer, so
there's no neutral default; (a) makes the choice visible in every file.
The owner chose "the author asks me" and not "the file must say", so
this is a further question, not a reading of that answer.

**Q3. Growing and shrinking.** Proposed: the box is
`max(initialWidth, text length)` characters wide. It grows past
`initialWidth` as today, up to `maxLength`, and shrinks back to
`initialWidth`, never below. (Today's rule is this with `initialWidth`
fixed at 1. Shrinking at all was questions-2's guess, passed on to core
and built; the owner hasn't said.)

**Q4. Sent to the browser?** Yes: the page can't draw the box without
it, and it tells a learner nothing the box doesn't show. Core adds it to
the public view's allow-list (contract 4: "Questions adding a field to a
kind says here whether it may be sent").

**What it takes**, if Part 1 is built on its own, before Part 2:

1. Questions: `initialWidth` in `question-files.js` (the check, the
   `QuestionFile` type), `questions.test.js`, this question's file,
   `readme.html` section 5, the how-to page. No judge file changes, so
   no R3 review.
2. Core: the allow-list in `routes.js`, and `fitBlankToText` in
   `problem-page.js`.
3. The architect: contract 4's list of the kind's fields.

The question's `questionSha256` changes when its file gets the field.

## Part 2: several blanks in one question

**Q5. How the file names them.** Options:

- (A) **By position**: one marker, appearing N times in each template;
  a list of N blanks (`maxLength`, `initialWidth` each), matched to the
  marker's occurrences in order. The answer is a list of N strings.
  - Short to write.
  - Every language's template must have the blanks in the same order,
    and a record's answer `["'", "\\"]` doesn't say which is which if
    the template is later edited.
- (B) **By name**: each blank has a name and its own marker, each marker
  exactly once in each template, in any order:

  ```json
  "blanks": {
    "open":  { "marker": "__1__", "maxLength": 3, "initialWidth": 1 },
    "close": { "marker": "__2__", "maxLength": 3, "initialWidth": 1 }
  }
  ```

  The answer is an object, `{ "open": "'", "close": "'" }`.
  - A language may order them differently (the five languages kept
    parallel, the guide's section 2, don't always put things in the same
    order).
  - A stored answer says which blank each text was for.
  - **A one-blank question is the case with one name, `blank`**: its
    answer, `{ "blank": "'" }`, is exactly today's request and today's
    record. So nothing already stored changes meaning.

Recommended: **(B)**.

**Q6. The question that exists.** Options: (i) today's form
(`blank`, `maxLength` at the top) stays valid as the one-blank form, read
through one function in `question-files.js` that gives every reader a
list of blanks, as `kindOf` does for `kind`; or (ii) every question uses
`blanks`, and the one that exists is rewritten. Recommended: **(i)**, so
a one-blank question stays short to write; `initialWidth` then sits at
the top beside `maxLength`, which is Part 1 unchanged. That's why Part 1
can be built first without being reshaped later.

**Q7. The judge.** Options:

- (a) **One judge function sees every blank** and returns one verdict:
  `judge(answer, { language })`, `answer` the object of Q5(B). It can
  judge blanks together (an opening and a closing quote that must
  match).
- (b) **One function per blank**, each judged alone. Simpler, but can't
  express "these two must agree".

Recommended: **(a)**. Then a further choice: the one judge that exists
takes a string today. Either one-blank judges keep `judge(blank, …)` and
only several-blank judges take the object (two signatures, chosen by
whether the file has `blanks`), or every judge takes the object and the
existing judge is changed once (one file, an R3 review, a new
`judgeSha256`). Recommended: **every judge takes the object**; one
signature is one thing to review. Cases become
`{ answer: { … }, language?, pass, messageIncludes? }`.

**Q8. Which blank was wrong.** Today's verdict is `{ pass, message?,
hints? }` for the whole answer. A judge could also name the blanks that
are wrong, for the page to mark. Proposed: **not in the first build**;
the message can say it in words. Decide after there's a question that
needs it.

**Q9. Limits**, so that no one file lifts what the route checks
(#160's Q15): each blank's `maxLength` at most 100, as today; and at
most **10 blanks** a question (a number to settle: no question is
drafted yet).

**Q10. Kept simple, for now.** Every language's template has every
blank, exactly once. An empty blank is allowed in a Run, Submit or Skip,
as today. The same text wanted in two places is two blanks.

**What it takes**, by role. Each line is a request, not something this
plan decides for another role:

- **Questions**: the format and its check; `judge/fill-in-the-blank.js`
  (the answer's check, the call, the cases' form); the worker harness in
  `questions.test.js`; the existing judge, if Q7 goes as recommended
  (R3); `readme.html` sections 5 and 6; the how-to page and the guide.
- **Core**: the public view (`blanks`, without anything of the judge);
  the request's check (exactly the question's names, each a string
  within its own `maxLength`); the page: several boxes, Tab between
  them, Enter checks, each sized by its own `initialWidth`; a draft
  kept per blank (today `answerText()` is one string); the Submissions
  tab and "load into the box" for an answer with several fields. Whether
  records need a version 5 is core's to say: with Q5(B) a one-blank
  record is unchanged, and a several-blank one has the same `answer`
  field with more names in it.
- **The architect**: contracts 2 (the answer, `judgeFillInTheBlank`'s
  call) and 4 (the kind's fields, what's never sent); R3 for the judge
  code.

## Until this is decided

- The page's rule stays as PR 231 left it: every box starts one
  character wide. Right for `single-quote-in-double-quotes` (owner);
  wrong as a rule (owner).
- **A second fill-in-the-blank question whose answer isn't one character
  waits for Part 1.** Its author asks the owner the starting width
  either way (`docs/roles/questions/how-to-write-a-question.md`,
  section 7).

## For the owner to decide

1. Q2: a file with no `initialWidth`: refused (recommended), or a
   default, and which?
2. Q3: shrink back to `initialWidth` when text is deleted (recommended),
   or stay as wide as it got?
3. Build Part 1 now, on its own (recommended: it's small, and Q6(i)
   means Part 2 doesn't reshape it), or wait and build both together?
4. Part 2's shape: Q5 by name (recommended) or by position; Q6; Q7.
   These can wait until a question with several blanks is wanted.

Source: `question-files.js`, `judge/fill-in-the-blank.js`, `routes.js`,
`problem-page.js`, `questions/single-quote-in-double-quotes.json`,
`docs/contracts.md` (contracts 2 and 4),
`docs/plans/submission-records-v4.md`,
`docs/decisions/20261110T113526-0800-blank-box-grows-with-its-text.md`.

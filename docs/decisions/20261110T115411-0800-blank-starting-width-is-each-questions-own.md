# A blank's starting width is each question's own, asked of the owner; a plan for it and for several blanks

2026-11-10 (UTC; the same day Pacific) · decided by the owner · written by questions (questions-2)

Changes `20261110T113526-0800-blank-box-grows-with-its-text.md` (core),
which made one character the starting width of every fill-in-the-blank
box.

**Decided** (owner, 2026-11-10, in questions-2's session, after merging
PR 231):

- **For `single-quote-in-double-quotes`, one character is right**: "I
  want the single-character answer implied."
- **As a rule for every question it's wrong**: "The one-character start
  rule is incorrect. A future question should ask about the initial
  width(s). There could be multiple blanks."
- **"Ask" means the author asks the owner** what each blank's starting
  width should be, and writes it into the question file (the owner's
  choice of three readings offered).
- **A plan first, nothing built**: the starting width and several blanks
  both touch questions' format, core's page and routes, and contracts 2
  and 4.

**Done with this decision**: the plan,
`docs/plans/fill-in-the-blank-widths-and-several-blanks.md` (proposed;
questions'), and the rule in the guide,
`docs/roles/questions/how-to-write-a-question.md`, section 7. No code
changed: the page still starts every box one character wide, until the
owner decides the plan's questions.

**A correction** (questions-2): the handoff addendum
`docs/session-handoff/questions/20261110T113953-0800.md` called the
one-character start "the rule for every such question" and proposed only
asking the owner when a longer answer came up. The owner's answer is
that the rule itself is wrong, not just to be asked about.

Source: `problem-page.js` (`fitBlankToText`), the plan above.

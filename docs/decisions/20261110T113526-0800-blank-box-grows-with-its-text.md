# The fill-in-the-blank box starts one character wide and grows with its text

2026-11-10 (UTC) · decided by the owner · written by core

**Decided** (owner, 2026-11-10 about 19:33 UTC, in questions-2's
session, after merging PR 229 and looking at the page; read by core in
that session's transcript): "I'd like the initial field width to be one
character, but allow the user to enter up to three. I'd like the field
to expand if he types more than one." Asked of core by questions-2
(`send_message`), since the box is core's (`problem-page.js`,
`style.css`).

**Changes** the width PR 229 gave it
(`20261110T112343-0800-blank-box-exactly-maxlength-wide.md`): a fixed
`maxLength` characters. That file's `content-box` stays, and is what
makes a width in `ch` the room for text.

**What it does now.** `problem-page.js`'s `fitBlankToText(box)` sets the
box's width to its text's length in `ch`, one at least. It's called
when the box is drawn, on every `input` event (typing, pasting,
deleting), and when code puts text in the box (`setAnswerText`: Load in
the Submissions tab, a submission reopened from the address, switching
language), since setting `value` from code fires no `input` event.
`maxLength` still limits what can be typed, so it is also the widest
the box gets.

**Core's choices, each small, none the owner's words:**

- **It shrinks again** as characters are deleted, back to one. The
  owner said only "expand". A box that stayed wide after a deletion
  would show how long an earlier try was, and nothing else would.
- **One rule for every fill-in-the-blank question**, not a starting
  width per question (questions-2's recommendation too). A per-question
  width would be a new field in the question format (`question-files.js`,
  questions'; `docs/contracts.md`, contract 4). So the box's width no
  longer hints at the answer's length for any question: an empty box is
  one character wide whether the answer has one character or ten.
- **The text after the box moves** as the box widens, and a line near
  the page's edge can wrap differently (seen: "a" moved to the next
  line at three characters). It follows from a box that grows inside a
  line of text.

**Measured** on the real problem page (Chromium, a cloud session, a
throwaway server on the trusted port, the question as PR 228 left it;
the CDN's files stubbed, which this page doesn't need): empty and one
character, `1ch`; two, `2ch`; three, `3ch`; a fourth key changes
nothing (`maxlength` 3); deleting gives `2ch`, then `1ch`; text set at
once (as a paste does) is fitted. At no step did the box scroll its
text, and the page logged no error.

**Not checked**: Firefox, Safari, a phone. A character the monospace
font doesn't have (a phone's curly quote) is drawn from another font
and may not be one `ch` wide, so the box may scroll or gap by the
difference: a reading of how `ch` is defined, not something seen. Load
from the Submissions tab wasn't driven in the browser; it goes through
`setAnswerText`, which calls the same function.

Source: `problem-page.js` (`fitBlankToText`, `renderTemplate`,
`setAnswerText`), `style.css` (`.fill-in-template .fill-in-blank`).

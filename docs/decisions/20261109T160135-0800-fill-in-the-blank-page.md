# The fill-in-the-blank page: the template in the editor's place with a box at the blank, Check, Enter checks, no Test

2026-11-09 · decided by the owner ("all recommended", users' nine options) · written by users

#160's B2 and B3 had decided the page's basis: the template shown as fixed
code with an input box at the blank (not an editor with locked parts);
Check as this kind's Run; Submit records; on a fail, the judge's message
and hints, as text (contract 2). The owner chose the rest, each as users
recommended:

1. **The template goes in the right pane**, in the code editor's place;
   the left pane (Learning, Applying, Submissions) is as for code.
2. **Plain monospace text**, built with text nodes, the box inline at
   the blank: no syntax colouring (the code editor has none either).
3. **The box**: HTML's `maxlength` from the question's `maxLength`,
   about that many characters wide; autocomplete, autocapitalize,
   autocorrect and spellcheck off. Whether that stops phones' smart
   punctuation is a guess, not checked on a phone; the judge explains a
   curly quote either way (#160, B3).
4. **Enter in the box checks** the answer (nothing is recorded), rather
   than submitting or doing nothing.
5. **The Results tab** shows the verdict, then the message and hints; the
   stdout and stderr tabs are hidden, since nothing runs.
6. **A passing Submit turns into Next**, as for code (D7).
7. **No Test button** for this kind, matching the server's refusal
   (decided earlier the same day, #197). #160's B3 had said Test "does
   the same without recording"; users recommended refusing without having
   re-read B3, and said so when it found it. The owner kept the refusal:
   a Check shows everything, since this kind has no hidden cases.
8. **The Submissions tab** shows what was typed and the judge's message
   under a fill-in-the-blank row's verdict; Load puts the answer back in
   the box. So the summary (`GET /api/submissions`) now carries `answer`.
9. **The code lives in `problem-page.js`**, so no new file needs adding
   to `server.js`'s `STATIC_FILES` (infrastructure and security's).

Source: `problem-page.js` (`renderTemplate`, `setUpFillInTheBlank`,
`answerTemplates`, `answerText`, `setAnswerText`, `answerFields`,
`renderResults`, `resultCell`, `recordText`, `whyNotLoadable`),
`style.css`, `routes.js` (`toSubmissionSummary`); #160, B2 and B3.

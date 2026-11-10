# "A Single Quote Inside Double Quotes": a new sentence, and a blank of three characters

2026-11-10 (UTC; the same day Pacific) · decided by the owner · written by questions (questions-2)

Changes `20261109T155155-0800-first-fill-in-the-blank-question.md`, which
has the question as first built.

**Decided** (owner, 2026-11-10, in questions-2's session):

- **The template** is now `print("You can put a single quote like ___ in
  a double quoted string without a leading backslash.")`. It was
  `print("One way to print a single quote (___) is to put it in a double
  quoted string like this one.")`.
- **No `\` character in the sentence.** The owner's first wording ended
  "…a leading backslash \\." (a backslash, then the full stop). Run on
  Python 3.13.18, `\.` inside a string prints `\.` but with
  `SyntaxWarning: invalid escape sequence '\.'`, and with warnings made
  errors (`python3 -W error`) it is a `SyntaxError`. That a later Python
  will refuse it outright is questions-2's recollection of Python's
  reference, a guess here: the cloud session couldn't reach
  docs.python.org to check. Offered `\\.`
  (valid, but an escape this question doesn't teach), `\.` as typed, or
  no backslash character, the owner chose the last.
- **`maxLength` is 3** (it was the default, 10). Every answer the judge
  has a message for still fits: `\'` is 2 characters, `"'"` and a quote
  with spaces 3.
- **The description** says "where the blank is": the old sentence's
  parentheses are gone.
- **The judge's behaviour is unchanged**; two of its comments said "at
  most 10 characters" and now say 3. Its bytes change, so records made
  from now on have a new `judgeSha256`, and a new `questionSha256`.
- **Python only**, as before; no other language has this question.

**Asked of core, not done here**: the box is drawn one character wider
than `maxLength` (`problem-page.js`, `renderTemplate`:
`box.style.width = `${box.maxLength + 1}ch``), so it is about 4
characters wide with this change, down from 11. The owner wants exactly
3. That line is core's, and changes every fill-in-the-blank question's
box.

**Checked by running** (Python 3.13.18, the new template with each of the
judge's cases in the blank): `'` and `\'` print the sentence with `'`;
`‘` prints with no error; `"'"` and `"` are `SyntaxError: unterminated
string literal`; `''` prints two quotes; a quote with spaces prints the
spaces. Each of the judge's messages still says what Python does.

Source: `questions/single-quote-in-double-quotes.json`,
`questions/single-quote-in-double-quotes.judge.js`, `problem-page.js`.
Not read this session (unreachable from the cloud):
https://docs.python.org/3/reference/lexical_analysis.html#escape-sequences

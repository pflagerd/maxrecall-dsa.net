# The third fill-in-the-blank question: "A Double Quote Inside Single Quotes"; its judge fails nothing Python would accept

2026-11-10 (UTC; the same day Pacific) · decided by the owner · written by questions (questions-2)

Proposed in Issue 244, at the owner's request: "Propose the double quote
inside single quotes question as a new issue. I don't want any answers
Python would accept but the judge fails at this time."

**Decided** (owner, 2026-11-10, in questions-2's session, answering
Issue 244's five questions):

1. **The rule's meaning** ("Yes"): the judge passes every answer that
   makes the program print the sentence with exactly one `"` where the
   blank is, and fails only answers that print something else or don't
   run.
2. **`maxLength` 2.**
3. **`initialWidth` 1**, implying a single character.
4. **The sentence keeps "without a leading backslash"**: `print('You can
   put a double quote like ___ in a single quoted string without a
   leading backslash.')`.
5. **Slug and title**: `double-quote-in-single-quotes`, "A Double Quote
   Inside Single Quotes".

**As written**:

- `questions/double-quote-in-single-quotes.json`: Fundamentals, topic
  `String`, Python only, kind `fill-in-the-blank`. It builds on two
  questions, `single-quotes-make-a-string` and
  `single-quote-in-double-quotes` (neither is reached through the other:
  both build only on `hello-world`).
- **The judge**, `questions/double-quote-in-single-quotes.judge.js`,
  passes `"` and `\"`. `\"` passes **with a message**: "That works.
  Inside single quotes a " needs no backslash, so " alone is enough."
  The server passes a pass's message on (`judge/fill-in-the-blank.js`),
  and the page shows a message whatever the status (`problem-page.js`,
  `renderResults`: read in the code, not seen in a browser).
- **This differs from the first question on purpose**: there `\'` fails
  ("would technically work, but is not what we asked for"). The two
  merged questions are unchanged: the owner's rule was given for this
  one ("at this time"), and questions-2 asked whether it should reach
  them; no answer yet.

**Checked by running** (Python 3.13.18):

- For Issue 244: every answer of 1, 2 and 3 printable ASCII characters
  in the template (95; 9,025; 857,375). Printing exactly the sentence:
  `"`; `\"`; and at 3 characters `"''`, `''"` and `\42`, which is why
  `maxLength` is 2.
- For the judge as written: all 9,507 answers of up to 2 characters
  (printable ASCII and the two curly double quotes), each judged and
  each run in the template. The judge passes exactly the answers that
  print the sentence, and each message that says what Python does (`'`
  is an unterminated string; the curly quotes print; a space is printed
  too; `""` prints two) holds for every answer that gets it.

Source: the two files above; Issue 244; `judge/fill-in-the-blank.js`;
`problem-page.js`.

# The second fill-in-the-blank question: "Single Quotes Make a String Too", with its judge

2026-11-10 (UTC; the same day Pacific) · decided by the owner · written by questions (questions-2)

**Decided** (owner, 2026-11-10, in questions-2's session, choosing among
the options questions-2 put):

- **Which question**: that a string can be written between single
  quotes, before the two others proposed (a double quote inside single
  quotes; the backslash escape `\'`), which both build on it. The three
  are what Issue 160's Part A left "for later questions, if wanted".
- **The blank**: starts 1 character wide and takes up to 3
  (`initialWidth` 1, `maxLength` 3): a single-character answer is
  implied, and `\'`, `''`, `')` can still be typed and explained.
- **Slug and title**: `single-quotes-make-a-string`, "Single Quotes Make
  a String Too".
- **The sentence**: `Hello World!`, tying it to Hello World, the question
  it builds on.

**As written**:

- `questions/single-quotes-make-a-string.json`: Fundamentals, topic
  `String`, Python only, `alreadyLearned: ["hello-world"]`, kind
  `fill-in-the-blank`. The template is `print('Hello World!___)`: the
  blank is the quote that ends the string.
- **One new concept**: a string may be written between single quotes,
  and ends with the kind of quote it starts with.
- **The Learning tab** shows it on other text, `print('Good morning.')`,
  and links Python's tutorial page (not opened this session:
  `docs.python.org` is blocked from the cloud; the link has no `#`
  fragment, since a section's anchor couldn't be checked).
- **The judge**, `questions/single-quotes-make-a-string.judge.js`, reads
  the blank's text and never runs the program. It passes only `'`. Its
  messages, for a fail: `"`; the curly `‘` and `’`; `\'`; `''`; `'''`;
  `')`; `"'`; nothing; `'` with a space; anything with no `'` in it; and
  anything else. 17 cases.
- **Answers Python accepts but the judge fails**: `'''`, `'` with a
  space, and `'` followed by more code (`'*2` prints the text twice).
  The question asks for the quote and nothing else, as the first
  question fails `\'`.
- **A message says what Python does only where that's certain**: the
  catch-all for an answer containing `'` makes no claim, because what
  Python does depends on the rest (`'x` is "invalid syntax", `',1`
  prints `Hello World! 1`).

**Checked by running** (Python 3.13.18): the template with each of the
judge's cases in the blank, beside its message.

Source: the two files above; Issue 160 (Part A, Q1); `readme.html`
section 5.

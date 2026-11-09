# The first fill-in-the-blank question: "A Single Quote Inside Double Quotes", with its judge

2026-11-09 (UTC; the same day Pacific) · decided by the owner ("Write step 5 as proposed") · written by questions (questions-2)

**Decided** (owner, 2026-11-09, accepting questions-2's proposal, which
built on #160's Part A drafts and B3 table):

- **The question**:
  - `questions/single-quote-in-double-quotes.json`, "A Single Quote Inside
    Double Quotes";
  - Fundamentals, topic `String`, Python only;
  - `alreadyLearned: ["hello-world"]`;
  - kind `fill-in-the-blank`.
- **The template**: `print("One way to print a single quote (___) is to
  put it in a double quoted string like this one.")`. The blank is `___`,
  holding at most 10 characters (the default `maxLength`).
- **The Learning tab** teaches a `'` inside `"…"` on other text,
  `print("Don't stop.")`, so it doesn't give the answer away (guide §1).
  It says `\'` prints the same but isn't what's asked, and "Learned
  earlier" is last.
- **The judge**, `questions/single-quote-in-double-quotes.judge.js`, reads
  the blank's text and never runs the program. It passes only `'`. For a
  fail it gives #160's B3 messages:
  - `\'`;
  - the curly `‘` and `’`;
  - `"'"`;
  - `''`;
  - `"`;
  - empty;
  - anything else.

  It adds one, proposed by questions-2: **a `'` with spaces around it**
  ("Just the quote, with no spaces: Python would print the spaces too").
  Its 12 cases cover each message.

**Small choices made writing it** (questions-2):
- The messages are plain text, so where #160's draft wrapped `'` in
  backticks (Markdown), the judge writes the character itself ("Type the
  straight ' instead"). The page shows messages as text, so backticks
  would show literally (Q7).
- The judge takes only `blank`: the question is in Python only, so it
  doesn't need the language it's answered in.

**Every claim was run** (guide §3), on Python 3.13.18 with the exact
template:
- `'` and `\'` print the same;
- `‘` and `’` print with no error;
- `"'"` and `"` are syntax errors;
- `''` and ` ' ` print as written;
- `print("Don't stop.")` and `print("Don\'t stop.")` both print
  `Don't stop.`.

**Not to merge before users' fill-in-the-blank page has merged.** Once
it's in `questions/`, learners meet it: `prepareQueues` adds every
question to "all" backlogs at start-up. Until that page exists, the
problem page shows its "can't show" message for every kind but `code`,
so a learner could neither answer nor skip it. That's the architect's R3
review of #212. Records version 4 was already merged (#209).

Source: the two files above; #160 (Part A, B1, B3); `readme.html` §5.

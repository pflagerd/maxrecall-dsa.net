# Proposal: a question on `"` and `'` in Python, and checking the syntax a learner used

Questions 2, 2026-11-08, at the owner's request: "propose a new question
which teaches the learner about the use of `"` and `'` in Python strings
… explore how we can check to make sure the learner uses specific
syntax … e.g. … `"'"` … and not … `"\'"` … detect that and encourage
the learner to use the desired (taught) syntax."

**Status: proposal only, nothing built.** The owner's decisions are the
numbered questions (Q1–Q8). Part B overlaps #92 and #11, which are Part 3
of `docs/plans/fundamentals-learned-links-concept-checks.md` (questions 1's,
merged in #145). This file builds on that part and doesn't change it;
where they differ, it says so (B2).

Facts below were run in a cloud session (Python 3.13.18, Node, g++, javac,
ldc2) with scratch programs; the ones not run are marked as guesses.

---

## Part A. The question

### What it teaches

In Python a string can be written with either quote, and the two make the
same string: `'Hello'` and `"Hello"` are equal
([Python reference, String and Bytes literals](https://docs.python.org/3/reference/lexical_analysis.html#string-and-bytes-literals)).
So a string with an apostrophe in it goes in double quotes, `"It's"`, and
one with double quotes in it goes in single quotes, `'She said "hi".'`.
The backslash escape (`'It\'s'`) does the same job, and is what this
question asks the learner **not** to use.

### Q1. One question, or two?

The guide's rule is one new concept per question, counted finely
(`docs/roles/questions/how-to-write-a-question.md` §1; owner, 2026-11-06).
Two concepts are in play:

1. **Either quote makes a string, and they're the same string.** Today a
   Python learner has only seen `"…"` in Hello World, and `'abc'` in other
   questions' examples (the guide's open question on Python quotes, §6).
2. **Use the other kind of quote to hold a quote.** It needs (1).

- (a) **Two questions** (recommended, by the rule):
  - **Single or Double Quotes** (`single-or-double-quotes`). Print
    `Hello World!` using single quotes. Builds on Hello World.
  - **Quotes Inside a String** (`quotes-inside-a-string`). Print
    `It's raining.`, then `She said "hi".` on the next line. Builds on the
    first.
- (b) **One question**, Quotes Inside a String, whose Learning tab also
  teaches (1). Fewer, but two concepts.

**Both questions need a syntax check.** The first, because
`print("Hello World!")` passes (it's Hello World again); the second,
because `'It\'s raining.'` passes. That makes them a small, real test of
Part B: one "must use", one "must use / must not use".

**Later, not proposed now:** a third question, **Escaping a Quote**
(`\'`, `\"`, `\\`, `\n`), where the check is reversed: there `\'` is the
taught syntax. Part B's design has to allow both directions.

### Q2. Which languages?

| | Either quote makes a string? | `"It's"` | A `"` inside a string |
|---|---|---|---|
| Python | yes (`'…'`, `"…"`, also `'''…'''`, `"""…"""`) | fine | `'She said "hi".'` |
| JavaScript | yes (`'…'`, `"…"`, also `` `…` ``) | fine | `'She said "hi".'` |
| C++, Java | no: `'…'` is one **character** (`char`) | fine | `"She said \"hi\"."`: an escape is the only plain way |
| D | no: `'…'` is a `char` | fine | `\"`, or a WYSIWYG string `` `She said "hi".` `` |

Run: all five print `It's raining.` and `She said "hi".` as above, and all
five accept `"It\'s"` as well (it's a valid escape in each).

So the lesson is the same in Python and JavaScript, and a **different**
lesson in C++, Java and D (characters versus strings). Every question so
far has all five languages, but the format allows fewer: `starterCode`
needs at least one, and a question's languages are its keys
(`question-files.js`, lines 191–199). A learner with only Java wouldn't be
given it (its pairs are per language: `questionInfos()`'s `languages`).

- (a) **Python only** (what was asked), as its own lesson. JavaScript
  later, once there's a check for JavaScript (B3).
- (b) **Python and JavaScript**, kept parallel, the JavaScript check
  coming later.
- (c) **All five**, with C++, Java and D teaching their own version
  ("`'…'` is a character; strings are `"…"`").

**Recommendation: (a)**, with C++/Java/D's lesson (characters versus
strings) as its own question later. A guess, not checked: no question in
the real bank has fewer than five languages, so the first one may show
something no test has covered yet (the problem list, the language picker).
I'd check users' code for it before building, and ask users if anything
looks off.

### The rest of the question (for Q1 (a), the second question)

- **Difficulty**: Fundamentals (#93, being built in questions 1's #154;
  this waits for it).
- **Topics**: `["String"]` (in `labels.json` already). **Sources**: `[]`.
- **`alreadyLearned`**: `["single-or-double-quotes"]` (for (b): `["hello-world"]`).
- **`judgeMode`**: `"program"`, like Hello World. One test case, no input,
  expected `It's raining.\nShe said "hi".` (output is trimmed at both
  ends and then compared exactly: `judge/runner.js`, 1333–1334). Hidden
  cases add nothing for a program with no input.
- **Learning tab**, in the guide's patterns (§5): what each quote does,
  with an example on other text (`print("Don't stop.")`), so it doesn't
  give the answer away (§1); what the check will look for (Part 3 Q9's
  recommendation, B6 here); "Learned earlier" last.
- **Description**: print the two lines exactly; the starter code a comment,
  as in Hello World.
- **A trap worth a warning?** `print('It's raining.')` is a
  `SyntaxError`. That's the first thing a learner is likely to write, so
  the Learning tab can show it and say why (the guide, §2, "Warn about a
  trap the question walks into").

---

## Part B. Checking the syntax a learner used

### B1. Why the judge can't do it today

Run in the cloud, with these two programs:

```python
print("It's raining.")        # taught
print('It\'s raining.')       # escaped
```

- **The output is byte-for-byte the same** (`It's raining.\n`). The judge
  compares output only (`judge/runner.js`), so both are Accepted.
- **Python's syntax tree can't tell them apart either.** `ast.parse`
  gives the same `Constant(value="It's raining.")` for both
  ([`ast`](https://docs.python.org/3/library/ast.html)). How the string
  was *spelled* is gone once it's parsed.
- **Python's tokenizer can.** `tokenize` keeps each literal exactly as
  written (`'It\'s raining.'`), and gives comments as tokens of their own
  ([`tokenize`](https://docs.python.org/3/library/tokenize.html)).

So this is a **lexical** check (about tokens: how literals are written),
not a **syntactic** one (about the structure of the program). That
matters for the choice below.

### B2. Where this differs from Part 3 (#92)

Part 3's Q9 recommends (a), text patterns matched **after removing
comments and string literals**. That's right for `+=` or `toupper`, but
it would remove exactly what this check has to look at: the inside of the
string literals. And Part 3's (b), syntax trees, is the level B1 shows
can't see it.

So whatever is built for #92 needs one more thing for this: rules that
say **where** they look: in code, in string literals (with the
literal's delimiter and its inside), or in comments. I'd raise that with
questions 1, whose Part 3 it is, before either is built.

### B3. How to read the code: the options

Each was tried on six versions of the answer (prototype, below).

- **(a) Search the raw source** for `\'`. One line of code, but crude.
  It flags a comment that mentions `\'`, and it misses `chr(39)` and
  `"""It's raining."""`, which aren't the taught syntax either.
- **(b) Python's own tokenizer, run in the sandbox** (recommended for
  Python). Rules look at each literal's delimiter and inside: "no `\` before a
  quote" and "some `"…"` literal contains `'`". Comments don't count.
  It's the tokenizer of the Python that runs the code, so a newer Python's
  syntax (3.12's f-strings, PEP 701) comes with it. The prototype handles
  3.12+'s f-string tokens.
  - A guess, to check on the VPS (`python3 --version`; read-only, the VPS
    operator's): Ubuntu 24.04's `python3` is 3.12.
- **(c) A small lexer written in JavaScript**, in the server, for each
  language. One mechanism for all five, but it's a second copy of each
  language's literal rules, to keep in step with the language. Python's are
  intricate: prefixes such as `rb`, triple quotes, and since 3.12 quotes
  nested inside f-strings. And it would run learners' code through a
  scanner in the server process, outside the sandbox (the architect's
  point on Part 3: size limits, no patterns that backtrack badly,
  infrastructure and security's review).
- **(d) A checker program per question**, written by the question's
  author, run in the sandbox: it gets the source and prints hints. It's
  the most flexible, and the "special judge" idea from programming
  contests, applied to the source rather than the output. But it's code
  in every question file, to write and test each time. **Not
  recommended now**; maybe later, for checks the rules can't express.
- **(e) No check: teach, and show the taught answer afterwards.** The
  Applying tab, which the learner sees once they've submitted, shows the
  `"It's"` solution and says why. Nothing to build, but nothing detects
  the escape either.

For JavaScript (Q2 (b), (c)), there's no tokenizer built into Node for
programs to use. A JavaScript lexer has a well-known hard case: `/` can
start a regular expression or be division, and only the grammar around it
tells which. So it's a parser package such as acorn
([acorn](https://github.com/acornjs/acorn), MIT, open source; a new
dependency, infrastructure and security's `package.json`), or (c). A
guess, not tried. That's why Q2 recommends Python first.

### B4. Q3. What kinds of rule?

- (a) **Named checks**, each written and tested once in the judge, e.g.
  `no-escaped-quote`, `quote-inside-other-quote`. A question lists them, with its
  own message. Simple and safe, but each new idea needs a code change.
- (b) **Small rules over the token kinds** (recommended), e.g.
  `{ "in": "string", "delimiter": "\"", "contains": "'" }` with
  `"must": true` or `false` and a `"message"`. Matching is by **plain
  substring, not regular expression**, so no pattern can backtrack badly
  (ReDoS) on a learner's code. The same rules serve #92's `+=` (`"in":
  "code"`) and #11's `toupper`.
- (c) Per-question checker programs (B3 (d)).

### B5. Q4–Q6. When it runs, and what the learner sees

The owner's word was "encourage", so there's a real choice of how hard
the check is.

- **Q4. When**: Part 3's Q10, the same here: only once every test case
  passes (a wrong answer is fixed first), on Run, Test and Submit.
- **Q5. What a failed check does on Submit:**
  - (a) **A fail, with a new status** (Part 3's `Concept Not Used`;
    here perhaps `Syntax Not Used`, the owner's name). It counts as a fail
    in spaced repetition (`order.js` treats every status but `Accepted`
    as one), so the question comes back sooner, which is the practice the
    check is for. Needs no change of users' to be recorded.
  - (b) **Accepted, with advice**: the record says Accepted, and the
    page shows the hint. It's gentler, but the learner can keep using the
    escape and never practise the taught syntax.
  - (c) **(a) on Submit, (b) on Run**: Run, which isn't recorded, says
    "this works, but this question asks for …" before the learner
    submits.
  - **Recommendation: (c).** On Run it encourages; on Submit it holds to
    the taught syntax.
- **Q6. Showing the hint.** Read from users' `problem-page.js`
  (1605–1627): the status line shows any status, in the fail colour if it
  isn't Accepted. But a result with test results shows the **first test
  case's** `error`, not the result's own, so a hint has no proper place
  yet. A small change of users' (a `hints` field, each with its line,
  shown under the status, escaped like `error`) would give it one. That's
  a request to users, and a change to contract 2 (what a judge result
  carries).

### B6. Q7. Should the learner see the rules before submitting?

Part 3's Q11 recommends yes: the field reaches the browser anyway
(`toPublicProblem` sends everything but `testCases`), and it helps to
know. The same here, with the Learning tab saying it in words: "This
question checks that you put the apostrophe inside double quotes, not
behind a backslash."

### B7. Q8. Who builds it, and in what order

The overlap with #92 makes this a joint decision for questions 1 and 2.
Proposed:

1. The owner decides Q1–Q7 here, and Part 3's Q9–Q11 (the same mechanism
   for #92), together if possible, so one design is built once.
2. Questions builds the check (`judge/runner.js`, the format's field in
   `question-files.js`, `questions.test.js`, the docs), Python first.
   Infrastructure and security reviews what runs in the sandbox (a second
   process per checked submission: about 25 ms for the prototype, timed
   outside the sandbox).
3. Users, if Q6 is yes: `problem-page.js` shows `hints`.
4. The architect records contract 2's new status and `hints`, and
   contract 4's new field.
5. Then the question(s), Fundamentals, after #154.

---

## The prototype (run 2026-11-08, Python 3.13.18)

About 60 lines of Python (in the questions 2 session's scratchpad, not
the repo). It reads string literals with `tokenize` (f-strings included,
as 3.12+ splits them into `FSTRING_START`/`FSTRING_MIDDLE`/`FSTRING_END`),
and applies three rules: no backslash before a quote (pairs of
backslashes are a backslash, so `"\\'"` isn't an escaped quote); some
`"…"` literal contains `'`; some `'…'` literal contains `"`.

| Version of the answer | Output right? | Prototype | Raw search for `\'` |
|---|---|---|---|
| `"It's raining."`, `'She said "hi".'` (taught) | yes | ok | no match |
| `'It\'s raining.'`, `"She said \"hi\"."` | yes | both escapes found, with lines | match |
| taught, plus a comment `# Don't write 'It\'s'` | yes | ok | **false match** |
| `'It' + chr(39) + 's raining.'` | yes | "no `"…"` literal holding a `'`" | **missed** |
| `"""It's raining."""` | yes | "no `"…"` literal holding a `'`" | **missed** |
| `f"It's {x}ing."`, `f'She said "hi".'` | yes | ok | no match |

What it shows:
- The "must use" rule catches what "must not use" can't: `chr(39)` and
  the triple quotes aren't the escape, and aren't the taught syntax
  either.
- A rule has to know a comment from a string.
- Each finding has a line number for the hint.

## What this sets up, and rules out

- (b) in B3 and B4 makes "in string literals" a first-class place for a
  rule, which #92's design needs to allow anyway for the later Escaping
  question (where `\'` is required, not forbidden).
- Python first means a JavaScript version of either question waits for a
  JavaScript tokenizer; choosing acorn later is a new dependency.
- A new status (Q5 (a)) is saved in learners' records. Renaming it later
  means old records keep the old name.

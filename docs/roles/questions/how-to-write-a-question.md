# How to write a question

How the questions role, with the owner, writes and edits a question's
*content*: the Learning tab, the description, examples, constraints,
starter code and test cases, in five languages. A first draft
(2026-11-05), to be refined as we learn; the owner and the questions
role keep it together. Where it disagrees with `readme.html`,
`readme.html` wins.

The *procedure* (a branch, the template, the fields, `make test`, Run and
Test, the pull request, deploying) is in
[`docs/how-to-add-a-new-question.html`](../../how-to-add-a-new-question.html);
the format is `readme.html` section 5, checked by `question-files.js`'s
`checkQuestion`. This file doesn't repeat them. The planned
`.claude/skills/author-question/` skill should link here rather than hold
these rules itself.

Each rule says where it comes from: a question file, or a change where we
learned it. A rule with no source is marked as a guess.

## 1. What a question is for

- **It teaches before it tests.** The learner sees the Learning tab
  first, Applying once they've submitted (`readme.html`, Front end). The
  Learning tab teaches the *pieces* the question needs; putting them
  together is the exercise.
- **Don't spell out the answer.** An example or a warning that is the
  solution with the names filled in takes the exercise away. Show the
  same idea on the example's own values instead. (#86: the Java warning
  uses `result += 'h' + 'I'`, not the loop's `result += c + c`, whose
  fix would be the answer.)
- **One new concept per question** (owner, 2026-11-05). A question
  teaches exactly one concept the learner hasn't met before. It may also
  use a concept an earlier question taught: ideally at most one, though
  in rare cases more are needed (Is Unique I builds on two). When a draft
  needs two new concepts, split it: the one the other depends on gets a
  question of its own, first, and the later one refers back to it.
  (Double Each Character taught two, going through a string and building
  a new one; the second became Build a New String. In #86, joining a
  list and Java's `StringBuilder` came out of it to go in a joining
  question.)
- **Count concepts finely.** Two operators that do different things are
  two concepts, even when they look alike (owner, 2026-11-06: Build a New
  String taught both `+` and `+=`; it now teaches `+` alone, and `+=` has
  a question of its own, Add to a String). Before calling a draft done, list what each
  example shows the learner for the first time: each item on the list is
  a concept.
- **Mind the chain.** Questions build on each other through their
  "Learned earlier" sections (`readme.html`, Decisions, 2026-10-30: Double
  Each Character → To Uppercase and Lowercase → Swap Case with Helpers).
  The question file says the same in `alreadyLearned`, a list of the
  slugs it builds on; `make test` checks that it names existing
  questions, matches the "Learned earlier" links in every language's
  Learning tab, and has no loop.
- **List only the questions it builds on directly** (owner, 2026-11-06).
  The ones those build on come with them: To Uppercase and Lowercase
  lists Double Each Character, not also Build a New String, which Double
  Each Character builds on. `make test` refuses an entry already reached
  through another (`findRedundantLearned`). It also keeps most lists to
  the one already-learned concept the rule above asks for.
- **Nothing yet shows an earlier question first** (owner, 2026-11-05:
  `alreadyLearned` is there so that something can, later). A new
  learner's backlog is ordered by `created` (spaced-repetition plan, D6),
  so a prerequisite written after the question that needs it comes after
  it. Don't backdate `created` to fix that: with a chosen backlog,
  `make backlog-add … AT=` puts it first.
  Don't lean on what a later question teaches: Double Each Character's
  Java warning says a `char` "is stored as a number", not "its ASCII
  code", because character codes are To Uppercase and Lowercase's subject.
  Before changing what a question teaches, search the others for links
  to it (`grep -l 'slug=<slug>' questions/*.json`) and check their
  one-line summaries of it still hold.

## 2. Five languages, one question

The hardest part, and where most of the care goes.

- **Same structure everywhere.** The same sections, in the same order,
  with the same examples and, where the languages agree, the same
  sentences. A learner switching language should find the same lesson.
- **Differ only where the language really differs, and say so.**
  Double Each Character's second heading is "Strings can't be changed:
  build a new one" in four languages and "A `std::string` can be
  changed" in C++, which then says so outright ("Unlike strings in
  JavaScript, Python, Java and D…").
- **Change one language, check its analogues in the other four.** The
  same idea has a different name in each: when the owner asked for
  joining a list to go (JavaScript's `parts.join("")`, Python's
  `"".join(parts)`), Java's `StringBuilder` was the same idea under
  another name, and came out next (#86). And when a language loses an
  example, check it still has what the others have: Java was left with
  only a `char` array, the hardest way, until it got `+=` like the rest.
- **Each language in its own idiom**, not a translation of one:
  - *Words*: "array" (JavaScript, Java, D), "list" (Python), "vector"
    (C++) for the same argument (`two-sum.json`'s description).
  - *Names*: `camelCase` everywhere but Python's `snake_case`
    (`functionName` in every question: `twoSum`, `two_sum`).
  - *Length* in constraints: `s.length`, `len(s)`, `s.size()`,
    `s.length()`, `s.length` (`double-each-character.json`).
  - *A character*: a one-character string in JavaScript and Python, a
    `char` in C++, Java and D. It decides how examples are written
    (`"h"` or `'h'`) and which traps exist (below).
  - *Starter code*: JavaScript's has a JSDoc block with the parameter
    and return types; Java's is a method of `class Solution` (every
    function-mode question).
- **Warn about a trap the question walks into**, in the language that has
  it. Java's `char + char` is an `int`, so `result += 'h' + 'I'`
  appends `"177"` (#86). JavaScript and Python don't have that trap, so
  they don't get the warning. Not every trap: one this question's
  learner is likely to write.

### Analogous structures, so far

From the questions written so far; add rows as questions need them.

| | JavaScript | Python | C++ | Java | D |
|---|---|---|---|---|---|
| Go through a string's characters | `for (const c of s)` | `for c in s:` | `for (char c : s)` | `for (char c : s.toCharArray())` | `foreach (c; s)` |
| Can a string be changed? | no | no | yes (`std::string`) | no | no (`immutable(char)[]`) |
| Put two strings together (concatenation) | `a + b` | `a + b` | `a + b` (one side a `std::string`: two literals don't compile) | `a + b` | `a ~ b` |
| Append to a string | `result += c` | `result += c` | `result += c` | `result += c` | `result ~= c` |
| Length | `s.length` | `len(s)` | `s.size()` | `s.length()` | `s.length` |

Source: the Learning tabs of `questions/build-a-new-string.json` and
`questions/double-each-character.json`.

## 3. Checking what we write

- **Run every claim that can be run.** The cloud has all five toolchains
  (`readme.html`, Environments). Write a scratch program in the
  scratchpad, run it, and use what it prints; don't work it out by hand.
  (#86: Java's `"hI"`, `"177"` and `194196` were all run before going in.)
- **Link primary documentation**: Java 21's API docs (the VPS runs
  OpenJDK 21, `readme.html`, Environments), the D language
  specification, Python's docs. Every
  external link opens in a new tab: `target="_blank" rel="noopener"`.
- **Constraints match the test cases.** Double Each Character says
  `0 ≤ len(s) ≤ 500`, printable ASCII; its test cases include the empty
  string, a 500-character string and all 95 printable characters.
- **Examples are the visible test cases; the hidden ones cover the
  edges** (the how-to page, step 5).
- `make test` checks the format, not that `expected` is right: that's
  the owner's Test button.

## 4. Editing a question that exists

- **What a change costs** (from the readme and contracts):
  - Wording, Learning text, examples, added test cases: a plain edit.
    Saved records keep `questionSha256`, so they show the file changed
    after them.
  - Changing what the function must return: past Accepted results were
    judged against the old rule, and nothing re-judges them.
  - Renaming: `make rename-question`, never `git mv` (contract 4).
  - `functionName` or `signature`: saved submissions reopened from the
    Submissions tab would fail if run again.
  - `created`: moves the question in a new learner's backlog.
- **Edit the raw text, not the parsed JSON.** Loading and re-saving the
  file reformats all of it, the one-line test cases included, and buries
  the change in the diff. Use exact replacements in a short script, each
  asserted to match once (#86's scripts did).
- **Read the result in place** before committing. #86's first warning
  read well on its own, and gave the answer away once it sat in the page.
- **Record it** in `readme.html`'s Decisions, saying which languages
  changed and which didn't.

## 5. HTML patterns in the files

- Sections are `<h3>`; code examples are
  `<div class="example"><pre>…</pre></div>`, with comments aligned in a
  column.
- The description ends with "New to this? The `<button type="button"
  class="tab-ref-link" data-tab="learning">Learning</button>` tab
  covers …" in 6 of the 8 questions with a Learning tab (not Hello World
  or Singly Linked List Hello World). Whether that should be the rule is
  open (section 6).
- "Learned earlier", where there is one, is the Learning tab's last
  section (in all five that have one; Singly Linked List Hello World
  ends with "References"): "This question builds on:" and a list of
  `<a href="/problem.html?slug=…" target="_blank" rel="noopener">Title</a>:
  what it taught.` (`swap-case-with-helpers.json`, `is-unique-i.json`).
- Math in constraints is KaTeX, with code in `\texttt{}`:
  `"$0 \\le \\texttt{len(s)} \\le 500$"`.

## 6. Open questions

Not decided; settle them with the owner and move them up as rules.

- **Python string quotes in examples.** Build a New String, Add to a
  String, Double Each Character and Is Unique I write `'abc'` (what
  Python's `repr` prints); Swap Case with
  Helpers, To Uppercase and Lowercase and Valid Parentheses write
  `"Hello World"`. Pick one.
- **Should every question have a Learning tab?** 8 of the 15 do; the
  other seven (Two Sum, Climbing Stairs and others) don't.
- **"New to this?" in every description with a Learning tab**, or only
  where the Learning tab teaches something the description relies on.
- **How many hidden test cases.** From 2 of 5 (Two Sum) to 18 of 22 (Swap
  Case with Helpers, To Uppercase and Lowercase). A guess: as many as the edges need, but no rule yet.
- **The joining question** (owner, 2026-11-05): collecting pieces and
  joining them, with Java's `StringBuilder` and each language's analogue.
  `to-uppercase-lowercase.json` uses both (Python `.join(parts)`, Java
  `StringBuilder`): look at it then.

## Changes to this file

- 2026-11-05: first draft (owner's request), from Double Each
  Character's changes in #86 and a survey of the 13 questions.
- 2026-11-06: counts in sections 5 and 6 brought up to date for the 15
  questions (Build a New String and Add to a String, #89 and #91),
  counted with a script over `questions/*.json`.

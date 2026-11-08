# Fundamentals, "Learned earlier" links, and checking the concept was used (#93, #88, #92): a proposal

Status: **Part 1 decided** (owner, 2026-11-08: Q1 to Q3, below), not yet
built; **Q5 moved to #146**; **Parts 2 and 3 still proposed**, to be
decided later (owner, 2026-11-08). Proposed by questions, 2026-11-08
(#145). The owner answers the questions below in this file; each part
can be decided and built on its own. Where this disagrees with
`readme.html`, `readme.html` wins: it describes what's built.

Why together: #93 and #88 each change contract 4 (the question bank,
`docs/contracts.md`), and #92 changes contract 2 (judging). Designing them
at once changes each contract once, and shows where they touch (#88 and
#92 both lean on `alreadyLearned`'s chain; #93's level is that chain).

Facts below were read from the code at `c7fbafb` (`master`,
2026-11-08) unless marked as a guess.

## Part 1. #93: a difficulty below Easy, "Fundamentals"

The owner (2026-11-08): "Fundamentals" is a **difficulty**, below Easy,
for questions about language features.

### What exists today

- `difficulty` is one of `Easy`, `Medium`, `Hard`: `question-files.js`'s
  `DIFFICULTIES`, checked by `checkQuestion` (`make test`).
- Hello World already has the word, as a **topic**:
  `"topics": ["Fundamentals"]`, `"difficulty": "Easy"`. `labels.json`
  doesn't list it, so its bubble has the default colour.
- Users' pages turn a difficulty into the CSS class
  `difficulty-<lowercase>` (`problems-list.js`'s `difficultyClass`,
  `problem-page.js`), and `style.css` colours only `difficulty-easy`
  (green), `-medium` (yellow) and `-hard` (red). A new value shows as an
  uncoloured badge until `style.css` has a rule (contract 4 says so).
- Nothing sorts, filters or counts by difficulty: it's only displayed
  (searched every `.js`, `.css` and `.html` file for `difficulty`).
  `scripts/backlog.js` (users') prints it padded to 6 characters; a
  12-character "Fundamentals" pushes that row's later columns right.
- `order.json` and `backlog.json` store slugs, not difficulties, so
  changing a question's difficulty changes no learner's files.

### Q1. Which questions are Fundamentals?

Proposed rule, for the guide (`docs/roles/questions/how-to-write-a-question.md`):
**a question is Fundamentals when its one new concept is a feature of the
language or its standard library** (syntax, an operator, how a built-in
type behaves, a library function); **Easy or above when its new concept is
a data structure or an algorithm**, even if the language has it built in.

Applied to the 15 questions, by each one's new concept (its Learning tab's
headings, or its description where it has none):

| Question | New concept | Proposed |
|---|---|---|
| Hello World | a complete program that prints | **Fundamentals** |
| Build a New String | `+` on strings; strings can't be changed | **Fundamentals** |
| Add to a String | `+=` | **Fundamentals** |
| Double Each Character | going through a string | **Fundamentals** |
| To Uppercase and Lowercase | characters are numbers (ASCII) | **Fundamentals** |
| Swap Case with Helpers | the library's ready-made case helpers | **Fundamentals** |
| Is Unique I | hash tables (Python's `set`, …) | Easy (a data structure) |
| Singly Linked List Hello World | making and linking nodes | Easy (a data structure) |
| the other seven (Two Sum, …) | classic problems | unchanged |

The borderline one is **Is Unique I**: its tool is in each standard library
(`set`, `HashSet`, …), but what it teaches is the idea of a hash table,
so the rule puts it at Easy. **Recommendation: the table as it stands.**

**Decided** (owner, 2026-11-08): **the six, and Is Unique I too**, so
seven questions are Fundamentals. The rule above put Is Unique I at
Easy, so it's reworded to fit (questions' wording, for the guide; the
owner can change it in the pull request that adds it):

> **Fundamentals**: the question's one new concept is something the
> language or its standard library already gives you, learned by using
> it: syntax, an operator, how a built-in type behaves, a library
> function, or a ready-made container such as Python's `set`.
> **Easy or above**: the new concept is a data structure the learner
> builds (e.g. linked nodes), or an algorithm, an idea for solving the
> problem (e.g. Two Sum's looking up the complement), even if it uses a
> library container along the way.

So Is Unique I is Fundamentals (its new concept is using a `set`,
`HashSet`, … to remember what's been seen), Singly Linked List Hello
World stays Easy (the learner makes and links the nodes), and Two Sum
stays where it is (its new concept is the complement lookup, not the
hash map it uses).

### Q2. Hello World's topic "Fundamentals"

With the level, the list would show "Fundamentals" twice on Hello World's
row: the badge and the topic bubble.

- (a) Keep the topic. Nothing to change; the repetition stays.
- (b) Replace it with what the question is about, e.g. `"Output"`,
  the way the string questions have `"String"`.
- (c) Empty it, `"topics": []` (allowed: `checkQuestion` accepts an empty
  list).

**Recommendation: (b)**, so a topic says what a question is about and
the badge says how hard it is, with no word used for both.

**Decided** (owner, 2026-11-08): **(b)**, Hello World's topic becomes
`"Output"`. `labels.json` lists neither `Fundamentals` nor `Output`, so
the bubble keeps the default colour, as now.

### Q3. One level, or more?

The issue says "a level or maybe levels". **Recommendation: one,
`Fundamentals`, now.** Another can be added the same way later; nothing
here rules one out.

**Decided** (owner, 2026-11-08): **one**, so the difficulties are
`Fundamentals`, `Easy`, `Medium`, `Hard`.

### Q4. The badge's colour (users', `style.css`)

Users choose. A suggestion only: something outside the green-yellow-red
scale of the other three, e.g. blue, so it doesn't read as "easier than
easy" on the same scale but as a different kind of question. That's a
guess at what reads well, not something checked with anyone.

### What it changes

- **Contract 4**: `difficulty`'s values become `Fundamentals`, `Easy`,
  `Medium`, `Hard`, and `style.css` colours `difficulty-fundamentals`.
- **Questions' files**: `question-files.js` (`DIFFICULTIES`, and its
  JSDoc), `questions.test.js` (the expected message), the seven question
  files (Q1, as decided), Hello World's topic (Q2), `docs/how-to-add-a-new-question.html`,
  the guide (Q1's rule), `readme.html` section 5.
- **Users' files**: `style.css` (the colour); the JSDoc in
  `problems-list.js`, `problem-page.js` and `routes.js` that says
  `"Easy", "Medium" or "Hard"`; `scripts/backlog.js`'s padding, if
  wanted.
- **Fixtures** (contract 4): Hello World is one of `routes.test.js`'s three
  fixture questions, but the test relies only on it existing in Python
  and JavaScript, so a change of difficulty or topic doesn't break it.
  `scripts/characterize.js` snapshots its `difficulty`: run the change
  outside a refactor's two snapshots.
- **Merge order**: users' `style.css` rule first (a class nothing uses
  yet is harmless), then questions'. The other way round, the seven badges
  show uncoloured until users' change lands.

### Q5. For later, not #93: the order a new learner meets them

A new learner's backlog is taken **in `created` order** (D6,
`docs/plans/spaced-repetition.md`), and the string chain was written out
of order: To Uppercase and Lowercase (created 2026-10-30T14:23Z) comes
before Double Each Character (10-30T17:10Z), and both before Build a New
String and Add to a String (2026-11-06), which it builds on. So a learner
who chooses all of them meets the chain backwards. (Read from each file's
`created`.)

Pairs come into the queue from the front of the backlog (`order.js`,
`candidates.slice(0, introduceCount(…))`). D6 already expects this to
change: "Later: … their order on **dependencies** between questions".

A Fundamentals level doesn't change that by itself. Two ways it could
later, both a change to users' D6 and to contract 4, and neither proposed
here:

- order a backlog by `alreadyLearned` (a question after the ones it builds
  on), which the architect has listed as a future change since #89;
- or order it by difficulty first, then `created`.

**Recommendation:** a separate issue for users, after this one, since it
reorders learners' backlogs.

**Moved to #146** (users, 2026-11-08), which lays out the choices for
the owner. **A correction** (questions, from #146): "in `created`
order" is true only of a `"backlog": "all"` backlog, which the server
fills (`order.js`, `allowedPairs`). A chosen backlog, which
`make learner-create` gives every new learner, keeps the order the owner
types (`order.js`, `pairsToAdd`), so there the risk is a mistyped order
with nothing to catch it, not a backwards one.

## Part 2. #88: clicking a "Learned earlier" link

Not decided yet: the owner chose to decide Parts 2 and 3 later
(2026-11-08), after Part 1 is built.

The issue: clicking a "Learned earlier" question loads it, with a warning,
and swaps it into the queue: the clicked question becomes the current one,
and the question it was clicked from comes next. **The queue change is
users'** (`order.js`, `routes.js`, `problem-page.js`). Questions' part is
what the link looks like in the question files, which users' page would
recognise.

### What exists today

- Every "Learned earlier" link is written
  `<a href="/problem.html?slug=<slug>" target="_blank" rel="noopener">`,
  in each language's `learning` HTML: 25 links, in 5 questions × 5
  languages.
- `checkQuestion` already insists that each Learning tab links exactly the
  questions in `alreadyLearned`, by matching `/problem.html?slug=…`
  (`QUESTION_LINK_PATTERN`).
- `alreadyLearned` reaches the problem page: `routes.js`'s
  `toPublicProblem` sends every field but `testCases`. Nothing of users'
  reads it yet.
- Today a click opens the earlier question in a **new tab**, with no
  language in the address and no warning. Opening a question changes
  nothing; a Submit or Skip there moves its pair (`order.js`'s
  `recordSubmit`, as `docs/plans/question-bank-page.md` describes).

### Q6. The links' form

- (a) **Keep the links as they are.** Users' page handles a click on any
  link in the Learning tab whose slug is in the problem's
  `alreadyLearned`. Nothing changes in the 25 links; the contract records
  the form that `checkQuestion` already enforces.
- (b) **Mark them**, the way in-page tab links are marked: e.g.
  `<a class="learned-link" data-slug="…">`, like the existing
  `<button class="tab-ref-link" data-tab="…">`. That's clearer to read in
  the HTML, but means rewriting all 25 links and `checkQuestion`'s
  pattern.
- (c) **No links in the files**: users' page builds the "Learned earlier"
  list itself from `alreadyLearned`. It ends the duplication that
  `checkQuestion` polices, but each link's per-language sentence ("putting
  two strings together into a new one with `+`") would need a field of its
  own, or be lost.

**Recommendation: (a).** It works with the files as they are, and the
form is already checked by `make test`.

### Q7. `target="_blank"`

With #88 the click opens the question in the same tab and changes the
queue, so the new tab no longer fits. Users' handler can stop the default
action either way, so this isn't required. **Recommendation:** leave the
attribute until users' change lands, then remove it in a questions pull
request, so that a page without users' handler still works meanwhile.

### Q8. A language for the swapped-in pair

The queue holds pairs (question, language), so the swap needs a language
for the earlier question. The natural one is the language of the page the
link was clicked on. That works only if the earlier question has that
language in its `starterCode`. **It holds today** (all 15 questions have
all five languages; each of the 5 links checked), **but nothing enforces
it.** Proposed: a check in `checkQuestion`, *every language of a question
is a language of each question in its `alreadyLearned`*, so a question can't
build on one a learner can't open in their language. **Recommendation:
add it with #88.** Whether the learner must already have that pair in
their queue or backlog is users' to decide.

### What it changes

- **Contract 4**: users start relying on `alreadyLearned` (through
  `toPublicProblem`) and on the link form above; and on Q8's check.
- **Questions' files**: `question-files.js` and `questions.test.js` (Q8),
  later the 25 links (Q7).
- **Merge order**: questions' Q8 check first, then users' #88.

## Part 3. #92 (and #11): checking the learner used the concept

#92: make sure the learner used the new concept, e.g. `+=` in Add to a
String, though `s = s + t` gives the same answer. #11 is its mirror:
refuse a shortcut, e.g. `toupper` in To Uppercase and Lowercase. Today the
judge only compares answers (`judge/runner.js`); nothing reads the code.

### Q9. How to read the code

- (a) **Text patterns, per question and language**, e.g. "must contain
  `+=`" or "must not contain `toupper`", matched after removing comments
  and string literals (so `# +=` or `"+="` don't count). Cheap, the same
  in all five languages, and testable. But crude: it can't tell *which*
  `+=` (an `i += 1` counter passes "must use `+=`" while the string is
  still built with `s = s + t`), and a determined learner can fool it.
  Removing comments and strings needs a small scanner per language
  (Python's `#` and its several string forms; `//` and `/* */` for the
  C-like four; D's nesting `/+ +/`; JavaScript's template literals). That
  it's small is a guess.
- (b) **Syntax trees** (an *abstract syntax tree*, AST: the program
  parsed into its structure), which can ask "is `+=` applied to a
  string?". Python has it built in
  (https://docs.python.org/3/library/ast.html); the other four would need
  a parser each (JavaScript: a package such as acorn, a new dependency;
  C++, Java and D: their compilers' own options, if they have them, which
  I haven't checked). Precise, but uneven across the five languages and
  much more work.
- (c) **Take the shortcut away at run time**, e.g. delete
  `String.prototype.toUpperCase` in JavaScript's harness. Works only for
  some library functions in some languages (C++ can't), and can't check
  that something *was* used.

**Recommendation: (a)** first, opt-in per question, with each check's
message written by the question's author, and the Learning tab saying
what will be checked, so the learner isn't surprised. (b) could come
later, for Python first, if (a) proves too crude.

### Q10. When it runs, and what it reports

- Proposed: judge as now; **only if every test case passes** is the code
  checked. A wrong answer still says Wrong Answer, so the learner fixes
  that first.
- A failed check needs a status. A new one (a name for the owner, e.g.
  `Concept Not Used`) is a new value in contract 2. **Read from users'
  code**: `order.js` counts every status but `"Accepted"` as a fail, and
  `problem-page.js` shows any status but `"Accepted"` in the fail colour,
  so a new status needs no change of users' to be shown and recorded as a
  fail. `routes.test.js` matches `Accepted` and `Wrong Answer` only on its
  fixture questions; as long as `two-sum` gets no check, it's unaffected.
  **Incomplete** (questions, 2026-11-08): infrastructure and security's
  `judge/sandbox-selftest.js` matches `'Accepted'`, `'Compile Error'`
  and `'Time Limit Exceeded'` as strings too (contract 2, since #147). A
  new status leaves them alone; renaming one wouldn't, so add, never
  rename.
- Run and Test as well as Submit: proposed yes, so the learner meets the
  check before Submitting.

### Q11. Should the learner see the checks?

`toPublicProblem` sends the problem page every field but `testCases`, so a
new field (e.g. `conceptChecks`) would reach the browser. Seeing "must use
`+=`" isn't secret, and arguably helps. **Recommendation:** send it, and
say so in the Learning tab; hiding it would be a change of users'
(`toPublicProblem`) and a line in contract 4.

### What it changes

- **Contract 2**: a new status value. **Contract 4**: a new optional field
  in the format, reaching the browser.
- **Questions' files**: `judge/runner.js`, `question-files.js` (the
  field's check), `questions.test.js`, the format's docs, then the
  questions that use it (Add to a String first).
- **Users' files**: none required, as above.

## After the owner decides

- Each part's decisions are recorded in a file in `docs/decisions/`, in
  the commit that writes them here (`readme.html`, "Maintaining this
  file").
- Then the pull requests, in the merge orders above, each saying what it
  changes in `docs/contracts.md`, which the architect updates.

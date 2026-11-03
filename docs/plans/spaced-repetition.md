# Plan: spaced repetition (the order questions come back in)

Status: **planned, 2026-11-03.** Nothing is built yet. All eight
decisions, D1–D8, are made; the decision log just below has one entry
per decision, and the Decisions section gives each one in full, with the
reasoning behind it.

## Decision log

| Date | Decision | Effect on the rest of the plan |
| --- | --- | --- |
| 2026-11-03 | **D1 (owner):** order by **queue position**, with flexibility in how a question advances. The queue is a JSON file, **`order.json`**, in the user's directory (to be replaced by a real database eventually). Each queue element holds the question's name, its file name without `.json` (e.g. `two-sum` for `questions/two-sum.json`), and more fields as decided below. Details, all accepted: elements are **objects**; the file has a top-level **`schemaVersion`**; it's **written safely** (a temporary file, then `rename()`; no `await` between reading and writing it). | Settles most of D5: the queue is **stored**, not worked out from the records. D4's rule becomes one possible advance rule, not the only one. |
| 2026-11-03 | **D2 (owner):** **one queue for everything**, not one per language. Not every learner will have every language. How a learner is shown questions, and whether they may switch languages or set a default language at all, depends on their **user profile**, **`profile.json`** in their user directory. Details, all accepted: queue elements are **(question, language) pairs**; **allowed** fields (set by the owner or a teacher) are kept apart from **preferred** ones (set by the learner); Run and Submit **refuse a language the profile doesn't allow** (`403`); **no `profile.json`** means all five languages, switching allowed; a **removed language's pairs are skipped**, not deleted; the two `localStorage` language settings (`maxrecall-dsa:default-language`, `maxrecall-dsa:available-languages`) **go**. A newly allowed language's pairs go into the backlog (D6). | **New file** `users/<email>/profile.json`, which decides which pairs exist, so it's built before the queue. |
| 2026-11-03 | **D3 (owner):** as recommended, a Submit passes only if it's **`Accepted`**, all tests passing. There is **no "how easy"**. Tests may also fail for timeouts (they already do: `Time Limit Exceeded`), or for other reasons still to be decided. The result is recorded in `order.json` as an attribute **`pass`**, the string **`"yes"` or `"no"`**. Details, all accepted: `pass` is decided in **one function**; the server accepts **only exactly `"yes"`/`"no"`** when reading; a pair never submitted has **no `pass`**; `order.json` is updated **only after the Submit record is saved**. | Each queue element has a `pass` field. D3's options (b) `elapsedMs` and (c) asking the learner are dropped. |
| 2026-11-03 | **D4 (owner):** start with a function like MaxRecall's 2-to-the-n-with-randomness, but less aggressive: **1.3^k, plus or minus 10%**, with **stochastic rounding**, and **at least 1 place**. k is **"correct in a row"**, kept in a counter **`passesInARow`** in the queue element (a pass adds 1, a fail sets it to 0, then the move uses the new value). The function goes in its own file, **`advance.js`** (the name is for now), tested by **`advance.test.js`** beside it. D4 will become much more nuanced over time; this is a starting point. Details, all accepted: `advance.js` only works out **how many places** (a move past the end goes last); the **random function is passed in**; **CommonJS**; **any saved Submit of a pair moves it**, wherever it is in the queue. | Replaces the 2^k table first proposed. An element has at least `question`, `language`, `pass` and `passesInARow`. On average a fail moves 1.03 places and a first pass 1.30. Tests are run by a new `make test` (`node --test`). |
| 2026-11-03 | **D5 (owner):** the queue is **stored in a file** (`order.json`). Ways to **recalculate it from the Submit records** will be worked out later. There is a **consistency check** between the sources of truth (`questions/`, `questions/renames.json`, `profile.json`, the submission records, `order.json`, `backlog.json`), accepted as proposed in the D5 section. Details, all accepted: the check **only reports**; it's a **pure function in its own file**, run by a `make` target and logged at server start. **Deleting a question removes references to it**, and **renaming one updates references to it** (so its progress is kept), in every user's `order.json` and `backlog.json`, through **`make delete-question`** and **`make rename-question`**, which also work after a `git pull` has already changed the file. A **rename log, `questions/renames.json`**, links old Submit records to the new name; records of deleted questions are kept and ignored. | Three functions to build: the check, remove references, update references. |
| 2026-11-03 | **D6 (owner):** a backlog, **`backlog.json`** in the user's directory. Questions are added to it **in the order they were (are) created**. Later: which questions go in will depend on the **courses** a learner is doing, and their order on **dependencies** between questions (some assume others are already mastered). For now, creation order only. Details, all accepted: a **`created` field in each question file** (ties broken by file name); the backlog holds **pairs**, by question and then by the profile's language order; **at least 3 pairs kept in the queue, plus one more every 5 Submits**, in a file of its own, **`introduce.js`**; an introduced pair goes to the **front**; missing pairs are **appended automatically** (at server start, and when a language is newly allowed); a **new user** starts with everything in the backlog; a **`submitsSinceLastIntroduced`** counter at the top of `order.json`. | Changes the problem file format (`created`), so `readme.html` section 5 changes when that's built. |
| 2026-11-03 | **D7 (owner):** (a), **stay on the results** after a Submit, but **the Submit button itself turns into a Next button**, rather than being grayed out with a second button beside it. Details, all accepted: per language, as now; **"Next" on the button, what's next in its tooltip**; Next **ignores clicks for its first second** (a double click on Submit mustn't leave the results unread); a **reload shows Submit again**; an **unsaved Submit stays Submit**. The server says what's next (`GET /api/next`), and the page takes **`?language=`** in its address. | Replaces issue #18's grayed-out Submit (`updateSubmitButton` in `problem-page.js`), so `readme.html`'s Front end section changes when it's built. |
| 2026-11-03 | **D8 (owner):** Skip **marks the current pair `pass` = `"no"`**, then **loads the next pair as Next would**. Skips are **treated as the learner failing**, and **a Skip is saved as a submission record with `"skipped": "yes"`**; ordinary Submits **leave the field out**. Details, all accepted: a Skip counts **exactly like a failed Submit** (`passesInARow` to 0, moved `advance(0)` places, counted towards `submitsSinceLastIntroduced`); Skip is **hidden once the button says Next**; a **confirmation** when `passesInARow` is more than 0; a **backlog pair moves into the queue** when skipped or submitted; records go to **`schemaVersion` 3**; a Skip record has the **same fields as a Submit**, with `status`, `passed`, `total`, `runtimeMs`, `stdout` and `stderr` `null` and `results` `[]`, since it isn't judged; the **Submissions tab lists Skips** as "Skipped"; a Skip **doesn't count as having answered** (the Learning/Applying tab rule). | **Changes the 2026-10-29 decision** that Skips aren't recorded: they are now, in the same `submissions/` folder. Check 6 and the later recalculation read a Skip record as a fail, so `order.json` and the records agree. Anything reading `submissions/` has to check `skipped`. |

## What the owner asked for (from `TODO`)

> The problem list should have the problems which were the hardest for the
> programmer to answer coming up more frequently than problems the
> programmer found easier.
>
> As each problem is correctly answered it is moved down the list by some
> number of problems. The easier the problem for the programmer, the
> further down the list it goes. The harder the problem, the nearer down
> the list it goes.
>
> When Submit button is hit, switch to the next problem in order in the
> list.
>
> Implement Skip button logic.

Already decided, and this plan builds on it (`readme.html`, Decisions):

- Progress is per **(question, language)** (2026-10-30). The thing being
  scheduled is a pair like *(two-sum, python)*, not a question.
- Only **Submit** is recorded, not Run or Skip (2026-10-29). So difficulty
  can only be judged from Submit records: verdict, `elapsedMs` (since
  2026-11-03), and the times between them.
- Records are one file per Submit, never changed after they're written
  (`users/<email>/submissions/<timestamp>.json`).

## Concepts to look up

- **Spaced repetition**: review something again just before you'd forget
  it; the gap grows each time you get it right.
- **Leitner system**: cards move up a box when right and back to box 1
  when wrong; higher boxes are reviewed less often. Sebastian Leitner's
  1972 book *So lernt man lernen* is the primary source; it isn't online,
  so there's no link to it here.
- **SM-2**: SuperMemo's algorithm, which gives each card a due *date* from
  a grade of 0–5 and an "easiness factor". Primary source: Piotr
  Woźniak's [description of SM-2](https://super-memory.com/english/ol/sm2.htm).
- **FSRS**: the model Anki now offers, which fits a memory model to your
  review history. Primary sources: [The Algorithm](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)
  (the authors' wiki) and [Anki's FSRS docs](https://docs.ankiweb.net/deck-options.html#fsrs).
- **Queue-position scheduling**: what MaxRecall does (below). Instead of a
  due date, a card is put back *N places* down a queue. Time doesn't
  matter, only how many other cards you answer in between.
- **Derived state / event sourcing**: computing the current state (here,
  the queue) by replaying an append-only log of events (here, Submit
  records), instead of storing the state itself.

## How MaxRecall (pflagerd/maxrecall.net) does it

The owner's flash-card app already does what `TODO` describes. Read at
`116ef7d`:

- Each user has one queue, `guidOrder.json`: `current` (cards in rotation)
  and `new` (the backlog) ([`GuidOrder.ts`](https://github.com/pflagerd/maxrecall.net/blob/116ef7d/GuidOrder.ts#L43-L53)).
- Answering takes the front card and puts it back `advanceCount` places
  down (`splice`), or at the end if the queue is shorter
  (`advanceFlashcardGuid`).
- `advanceCount` comes from the streak of correct answers, from the table
  4, 8, 16, 32, … ([`ServerFlashCard.ts` L10–17](https://github.com/pflagerd/maxrecall.net/blob/116ef7d/ServerFlashCard.ts#L10-L17)),
  looked up at index `correctInARow + 1` ([L100](https://github.com/pflagerd/maxrecall.net/blob/116ef7d/ServerFlashCard.ts#L100)).
  So a wrong answer moves the card **8** places, the first right answer
  **16**, then 32, 64, … The table's 4 is never used; the comment there
  says "starting with 8", which matches what's actually used.
- It's then randomized by about ±7% (`advanceCountRandomizePercent = 100 / 7`
  in [`constants.ts`](https://github.com/pflagerd/maxrecall.net/blob/116ef7d/constants.ts#L1-L3),
  applied in [`maxrecall-server.ts` L127](https://github.com/pflagerd/maxrecall.net/blob/116ef7d/maxrecall-server.ts#L127)).
- New cards come from the backlog one at a time, every
  `countUntilNextNewCard` answers: 32 answers apart when you're getting
  0% right, down to 4 apart at 100% ([L43–45](https://github.com/pflagerd/maxrecall.net/blob/116ef7d/maxrecall-server.ts#L43-L45),
  [L130–137](https://github.com/pflagerd/maxrecall.net/blob/116ef7d/maxrecall-server.ts#L130-L137)).
  The better you're doing, the faster new material arrives.

**Why it can't be copied as is:** MaxRecall's decks hold many cards. Here
there are 13 questions, so at most 13 pairs per language. With MaxRecall's
numbers, one right answer (16 places) or even a wrong one (8) sends a pair
to the end or near it, so the queue turns into plain round-robin and hard
questions don't come back any sooner. The steps have to start small.

## Decisions

All made by the owner on 2026-11-03. The options not chosen are in the
plan's git history (last in `26bc929`).

### D1. Queue positions, stored in `order.json`

**Questions are ordered by queue position, as in MaxRecall, not by due
dates, with flexibility in how a question advances (D4). The queue is
`users/<email>/order.json`, to be replaced by a real database
eventually. Each element is an object naming the question by its file
name without `.json` (e.g. `two-sum` for `questions/two-sum.json`), with
the fields D2–D4 add; the file has a top-level `schemaVersion`; and it's
written safely.**

- **Name equals slug:** on 2026-11-03 all 13 question files had `slug`
  equal to the file name, and `loadProblem` in `server.js` finds a
  question by file name. Submit records' `question` field is the same
  value, so the queue and the records refer to questions the same way.
- **Writing it safely:** write a temporary file and `rename()` it over
  `order.json`, so a crash never leaves half a file. Here replacing the
  file is the point, so `rename()` is right (unlike Submit records, which
  use `link()` so they *can't* be replaced). Reading, changing and writing
  it happen with no `await` in between, so two Submits from two tabs
  can't each read the old queue and one overwrite the other's change (a
  lost update).
- **Time away doesn't count:** after a month off, the queue is exactly
  where it was left. Every Submit has `submittedAt`, so a later step could
  still pull long-unseen pairs forward.

### D2. One queue for everything, and `profile.json`

**One queue holds every (question, language) pair, e.g.
`{"question": "two-sum", "language": "python"}`, keeping the 2026-10-30
design that progress is per (question, language). Not every learner will
have every language: which languages a learner has, and whether they may
switch languages or set a default at all, come from their profile,
`users/<email>/profile.json`.**

- **Allowed and preferred are kept apart** in the profile: what the
  learner is *allowed* (languages, may they switch, may they set a
  default), set by the owner or a teacher; and what the learner *prefers*
  (their default language), set by the learner within those limits. For
  now the owner edits the file by hand; an API for the learner's
  preferences can come later.
- **The server enforces it:** Run and Submit refuse a language the
  profile doesn't allow (`403`). Today the server accepts all five
  languages (`SUPPORTED_LANGUAGES`, `server.js`) from anyone.
- **No `profile.json`** means all five languages, switching allowed, so
  the owner's current setup keeps working until a profile is written.
- **When the profile changes:** a newly allowed language's pairs go into
  the backlog (D6); a removed language's pairs are skipped, not deleted,
  so the progress is there if it comes back.
- **The two `localStorage` language settings go**
  (`maxrecall-dsa:default-language`, `maxrecall-dsa:available-languages`):
  the default language and the language menu come from the profile, so
  there's one source.
- **"Next" may be in another language** (see D7).

### D3. A pass is `Accepted`, recorded as `"pass": "yes"` or `"no"`

**A Submit passes only if it's `Accepted`, all tests passing; there is no
"how easy". The result is recorded in the pair's element in `order.json`
as `pass`, the string `"yes"` or `"no"`.**

- **Timeouts already fail.** The judge returns `Time Limit Exceeded` with
  `passed: 0` (`judge/runner.js`, the `outcome.timedOut` branch), and
  memory-limit kills and runtime and compile errors aren't `Accepted`
  either. So today `pass` is `"yes"` exactly when `status` is `Accepted`.
- **One function decides `pass`,** so other failure reasons, still to be
  decided (perhaps a countdown running out, issue #21), are added in one
  place.
- **Only exactly `"yes"` or `"no"`** is accepted when the server reads
  the file. A string leaves room for more values later, but `"Yes"` or a
  typo in a hand-edited file is still valid JSON, so it has to be checked.
- **A pair never submitted has no `pass`,** so "new" and "failed" can be
  told apart.
- **`order.json` is updated only after the Submit record is saved,** so
  the queue never reflects a Submit that has no record.
- `pass` holds only the latest result; the streak is `passesInARow` (D4),
  and the full history stays in the Submit records.

### D4. A pair moves 1.3^k places, ± 10%, in `advance.js`

**Starting with a function like MaxRecall's 2-to-the-n-with-randomness,
but less aggressive: 1.3^k places, plus or minus 10%, stochastically
rounded, and at least 1. k is "correct in a row", kept in the element as
`passesInARow`. The function goes in its own file, `advance.js` (the name
is for now), tested by `advance.test.js` beside it. D4 will become much
more nuanced over time; this is a starting point.**

- **k includes this Submit:** a Submit first updates `passesInARow` (a
  pass adds 1, a fail sets it to 0), and `advance.js` then uses the new
  value.
- **Stochastic rounding:** a value like 1.3 becomes 2 with probability
  0.3 and 1 otherwise, so the *average* move is exactly
  1.3^k × (1 ± 10%).
- **At least 1 place,** so a pair never comes straight back: after a fail,
  0.9 to 1.1 would otherwise round down to 0 some of the time.
- **`advance.js` only works out how many places.** Moving the element
  within `order.json` belongs to the code that reads and writes that
  file, so changing the rule means editing `advance.js` alone. A move
  longer than the queue puts the element at the end, as MaxRecall's
  `advanceFlashcardGuid` does.
- **The random function is passed in,** e.g.
  `advance(k, random = Math.random)`, so tests can supply fixed "random"
  numbers and get repeatable answers.
- **CommonJS** (`require`/`module.exports`), like `users.js`.
  `package.json` has no `"type"` field, so Node treats `.js` files as
  CommonJS ([Node's `"type"` docs](https://nodejs.org/api/packages.html#type)).
- **Any saved Submit of a pair moves it,** wherever it is in the queue,
  since the learner can open any question from the list. A Submit that
  failed for other reasons (judge busy, not saved) moves nothing.
- **Tests** are run by a new `make test` (`node --test`).

**What the rule does** (simulated 2026-11-03: 100,000 samples per k;
queues of 13 questions × 5 languages = 65 pairs, all in the queue from
the start, every Submit a pass, run 200 times):

| k | 0 (failed) | 1 | 2 | 3 | 4 | 5 | 8 | 16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Average places | 1.03 | 1.30 | 1.69 | 2.20 | 2.86 | 3.71 | 8.15 | 66.45 |
| Range | 1–2 | 1–2 | 1–2 | 1–3 | 2–4 | 3–5 | 7–9 | 59–74 |

- A fail and a first pass differ on average (1.03 vs 1.30 places). With
  plain rounding instead, both moved exactly 1, and the ±10% had no effect
  below k = 5.
- It takes about 16 passes in a row for a pair to reach the end of a
  65-pair queue.
- A working set forms at the front: a median of 12 different pairs in the
  first 100 Submits, and a median of 921 Submits until all 65 have come
  up once (106 for 13).

### D5. The queue is stored; a consistency check reports

**The queue is stored in `order.json`; ways to recalculate it from the
Submit records will be worked out later. A function checks consistency
between the sources of truth, and only reports. Deleting a question
removes references to it, and renaming a question updates references to
it, so its progress is kept.**

**The sources of truth** and what each one owns:

| Source | Owns |
| --- | --- |
| `questions/*.json` | Which questions exist, and which languages each has (`starterCode`) |
| `questions/renames.json` | Which old question names became which new ones |
| `users/<email>/profile.json` | Which languages this learner has |
| `users/<email>/submissions/*.json` | What was submitted or skipped, and how it was judged (the history; never changed) |
| `users/<email>/order.json` | The queue order, and each pair's `pass` and `passesInARow` |
| `users/<email>/backlog.json` | Pairs not yet in the queue, in the order they'll be introduced (D6) |

**The consistency check.** Each finding names the user, the file, the
element and what's wrong.

1. **The files themselves:** `order.json` and `backlog.json` parse as
   JSON and have a known `schemaVersion`, and every element has the
   fields it must, with valid values: `question` a string, `language` one
   of the five, `pass` absent or exactly `"yes"`/`"no"`, `passesInARow` a
   whole number, 0 or more, and 0 whenever `pass` is `"no"`. Backlog
   elements have no `pass` or `passesInARow`.
2. **No duplicates:** each (question, language) pair at most once, across
   `order.json` and `backlog.json` together (a pair is in one or the
   other, never both).
3. **Deleted or renamed questions:** every element's `question` has a
   file in `questions/`, and that question has the element's language.
   If the name is in `renames.json`, the finding says what it was
   renamed to, and that the update-references command will fix it.
4. **Missing pairs:** every pair the learner could do (the question has
   the language, and the profile allows it) is in `order.json` or
   `backlog.json`. A missing one is a new question or a newly allowed
   language that hasn't been added to the backlog yet.
5. **Profile:** elements whose language the profile no longer allows.
   Reported as information, not an error, since they're kept on purpose
   (D2).
6. **Records agree:** for each pair in `order.json`, the latest saved
   record matches `pass` (`Accepted` ↔ `"yes"`; anything else, including a
   Skip, ↔ `"no"`), and `passesInARow` equals the number of `Accepted`
   Submits at the end of its history. Records are matched through
   `renames.json`, so a renamed question keeps its history. A pair with
   records but no `pass`, a `pass` with no records, or a backlog pair
   that has records, is reported. Records of deleted questions are
   ignored. Check 6 is also the core of the later "recalculate from the
   records".

- **Only reporting, never changing anything:** a question file can be
  missing for a harmless reason. Checking out a branch that doesn't have
  it yet, for instance, would otherwise wipe that question's progress.
  Until something removes them, the server skips elements whose question
  is missing when choosing the next question.
- **Where it lives and when it runs:** a pure function in its own file
  (e.g. `consistency.js`) that takes the sources and returns a list of
  findings, run by a `make` target, and once at server start, logging
  what it finds without refusing to start.
- **What runs remove and update references:** commands that do the whole
  job, `make delete-question SLUG=…` and `make rename-question FROM=…
  TO=…`. Rename does `git mv`, changes the file's `slug` field to match,
  adds the rename to `renames.json`, and updates the references. Delete
  does `git rm` and removes the references. Each also works when the file
  change has *already* happened (the VPS gets it by `git pull`, which
  doesn't touch `/srv/maxrecall/data/users`); then it only updates the
  references.
- **Every user, and both files:** the functions go through every user's
  `order.json` and `backlog.json`.
- **Old Submit records after a rename** are followed through the rename
  log, `questions/renames.json` (`{"old-name": "new-name"}`), committed
  with the rename. Records themselves are never changed.
- **Old Submit records after a delete** are kept as history; the check
  ignores them.
- **Smaller effects of a rename:** a bookmarked old address
  (`problem.html?slug=…`) stops working, and the file's SHA-256 changes
  (its `slug` field changed), so old records show the question as edited
  since, which is true.
- **The cost of storing:** the file is a second copy of what the records
  say, so it can drift from them (a record copied in from the VPS with
  `rsync` moves nothing). The check is how drift is found.

### D6. New pairs wait in `backlog.json`, in creation order

**Pairs not yet in the queue wait in `users/<email>/backlog.json`, added
in the order their questions were (are) created. Later, which questions
go in will depend on the courses a learner is doing, and their order on
dependencies between questions: some assume others are already mastered
(concepts: a *prerequisite graph*, which is a *directed acyclic graph*,
put in order by a *topological sort*). For now, creation order only.**

- **Creation order comes from a `created` field in each question file**
  (an ISO 8601 date and time), filled in once from the full history on
  Kubuntu, and written by whoever creates a question from then on. Ties
  are broken by file name. It moves with the file when it's renamed. It
  changes the problem file format, so `readme.html` section 5 gets
  updated with it. Git history can't be relied on instead: this cloud
  clone is shallow (97 commits), so 9 of the 13 question files show as
  "added" in its oldest commit, `5ef8b96` (a service rename on
  2026-10-29), which is just where the clone stops; and two files were
  added in one commit (`double-each-character`, `swap-case-with-helpers`),
  so even full history has ties. File modification times are no better,
  since `git checkout` resets them.
- **The backlog holds pairs,** like `order.json`, with the same element
  shape minus `pass` and `passesInARow`, ordered by question (creation
  order), then by the order of languages in the profile. Hello World in
  every allowed language comes before the next question.
- **Introduction rule:** at least 3 pairs are kept in the queue, and one
  more comes in from the backlog every 5 Submits, in a file of its own
  beside `advance.js`, `introduce.js`, so it can later be made to depend
  on how well the learner is doing, as MaxRecall's
  `countUntilNextNewCard` does (32 Submits apart at 0% correct, 4 apart at
  100%).
- **An introduced pair goes to the front,** so it's the next question, as
  in MaxRecall (`addNextBacklogFlashcardGuid` `unshift`s it).
- **Missing pairs are appended automatically** to the end of each user's
  `backlog.json`, in creation order, at server start and when a profile
  allows a new language. Unlike removing references, adding loses
  nothing, so it's safe to do automatically. A pair whose question is
  later missing again is just skipped.
- **A brand-new user** starts with everything in `backlog.json` and an
  empty `order.json`.
- **Counting Submits** for "every 5" uses a top-level
  `submitsSinceLastIntroduced` in `order.json`, next to `schemaVersion`,
  so it survives a server restart.

**Why a rule is needed** (simulated 2026-11-03: 65 pairs, starting from
an empty queue, 300 Submits, with D4's rule): a queue holding one pair
always gives back that same pair, so with no rule beyond "when the queue
is empty", the same pair came back 299 times out of 300. With "at least 3
in the queue, and one more every N Submits":

| N | Pairs added after 100 Submits | After 300 |
| --- | --- | --- |
| 3 | 35 | all 65 |
| 5 | 22 | 62 |
| 10 | 12 | 32 |

Whether 70% or all of the Submits passed made no difference to these
counts, since the rule counts Submits, not passes.

### D7. Submit turns into Next

**After a saved Submit the page stays on the results, so the learner can
see what went wrong, and the Submit button itself turns into a Next
button, rather than being grayed out with a second button beside it.**

- **What Next opens:** a saved Submit has already updated the pair
  (D3, D4) and may have brought a pair in from the backlog (D6). "Next"
  is then the front of `order.json`, skipping pairs whose question is
  missing (D5). With one queue (D2), next may be in another language.
- **Per language, as now:** Submit turns into Next for the language just
  submitted. Switched to another language, it's Submit again, since
  that's another pair.
- **"Next" on the button, what's next in its tooltip** ("Two Sum, in
  C++"), since a long label would push the toolbar around.
- **Next ignores clicks for its first second** (and looks disabled for
  that second). Submit and Next are the same button in the same place, so
  a second click on Submit while it's judging could otherwise land on
  Next the moment the result arrives, and the learner would leave before
  reading it.
- **A reload shows Submit again,** as the grayed-out Submit is enabled
  again today: still a nudge, not a rule.
- **A Submit that wasn't saved** (`saved: false`) moves nothing and stays
  Submit.
- **The server says what's next:** `GET /api/next` returns the front
  pair. Bringing a pair in from the backlog happens when the Submit is
  saved, not when "next" is asked for, so `GET /api/next` changes nothing
  and asking twice gives the same answer. HTTP calls a GET *safe* for
  that reason ([RFC 9110 §9.2.1](https://www.rfc-editor.org/rfc/rfc9110#section-9.2.1)).
- **The page takes `?language=`** in its address, e.g.
  `problem.html?slug=two-sum&language=cpp`; today it reads only `?slug=`
  and `?submission=` (`problem-page.js`). It chooses the editor's
  language for that visit without changing the learner's default (as
  Load from the Submissions tab already does), and is refused (shown as a
  message) if the profile doesn't allow that language.
- **Nothing left:** if the queue and backlog are both empty, Next says so
  instead of going anywhere.
- **The problem list** shows the queue in order with each pair's
  language, then the backlog, marked "new". Opening any of them is still
  allowed.
- This replaces issue #18's grayed-out Submit (`updateSubmitButton` in
  `problem-page.js`), so `readme.html`'s Front end section changes when
  it's built.

### D8. Skip counts as a fail, and is recorded

**Skip marks the current pair `"pass": "no"`, then loads the next pair,
as Next would. Skips are treated as the learner failing, and each Skip is
saved as a submission record with `"skipped": "yes"`; ordinary Submits
leave the field out.**

This **changes the 2026-10-29 decision** that Skips aren't recorded. A
Skip record goes in the same folder as Submit records,
`users/<email>/submissions/`. Check 6 (records agree) and the later
recalculation read a Skip record as a fail, so `order.json` and the
records agree.

- **Exactly like a failed Submit:** `passesInARow` goes to 0, the pair
  moves `advance(0)` places (about 1), and it counts towards
  `submitsSinceLastIntroduced`, so Skipping still brings in new pairs.
- **Skip is hidden once the button says Next,** so a Skip can't overwrite
  the `"yes"` just earned.
- **A confirmation** ("Skipping resets your 9 passes in a row") only when
  `passesInARow` is more than 0.
- **A pair still in the backlog,** opened from the problem list and then
  skipped or submitted, moves from `backlog.json` into `order.json`
  first, then is treated as above.
- **The server does it:** `POST /api/questions/:slug/skip` with the
  language, which saves the record, updates `order.json` and answers with
  what's next.
- **Records go to `schemaVersion` 3** once this is built. It's separate
  from the record changes the owner is thinking through in issues #19 and
  #24, as `elapsedMs` (version 2) was. Records without `skipped` (all
  ordinary Submits, and every record from before) aren't Skips.
- **A Skip record has the same fields as a Submit,** for one shape of
  record: `submittedAt` (when it was skipped), `question`,
  `questionSha256`, `language`, `judgeMode`, the editor's `code` at that
  moment, and `elapsedMs` from the timer. The code isn't judged, so
  `status`, `passed`, `total` and `runtimeMs` are `null`, `results` is
  `[]`, and `stdout` and `stderr` are `null`.
- **The Submissions tab lists Skips** with "Skipped" as the verdict, and
  Load still puts their code in the editor. `GET /api/submissions`
  summaries gain `skipped`.
- **A Skip doesn't count as having answered,** so a pair with only Skips
  still opens on the Learning tab, not Applying.
- **Anything that reads `submissions/`** (the "your time" column, future
  statistics) has to check `skipped`, or it will count Skips as Submits.

## Steps

Rewritten 2026-11-03, after D1–D8. Each step is small, checkable on its
own, and merged before the next starts. Tests use Node's built-in test
runner ([`node:test`](https://nodejs.org/docs/latest-v22.x/api/test.html)),
each checked to fail against a deliberately wrong version first.

1. **`advance.js`**: `advance(k, random = Math.random)` returns how many
   places, 1.3^k ± 10%, stochastically rounded, at least 1. Nothing uses
   it yet. Tested by `advance.test.js` beside it, run by a new
   `make test` (`node --test`): fixed "random" numbers, and a statistical
   test that the average over many runs is close to 1.3^k. Needs only
   D4, so it can start now.
2. **`introduce.js`**, the introduction rule: given the queue's length
   and `submitsSinceLastIntroduced`, whether to bring in a backlog pair
   (fewer than 3 in the queue, or 5 Submits since the last). Tested by
   `introduce.test.js`.
3. **`created` in every question file**, filled in by the owner on
   Kubuntu from the full git history (the `git log --diff-filter=A`
   command in D6); `readme.html` section 5 updated.
4. **`profile.json`**: read it (no file means all five languages,
   switching allowed); Run and Submit refuse a language it doesn't allow
   (`403`); the page's language menu and default language come from it,
   replacing the two `localStorage` settings.
5. **`order.json` and `backlog.json`**: reading with validation, safe
   writing, and filling each user's backlog with missing pairs at server
   start. Nothing changes them on Submit yet.
6. **Submit updates the queue**, after the record is saved: `pass`,
   `passesInARow`, the move from `advance.js`, the introduction rule, and
   a backlog pair moving into the queue when it's submitted.
7. **Next**: `GET /api/next`, `?language=` in the page address, and
   Submit turning into Next (with the one-second guard).
8. **Skip**: `POST /api/questions/:slug/skip`, Skip records
   (`"skipped": "yes"`, `schemaVersion` 3) in `submissions/`, and the
   Skip button on the page.
9. **The problem list** in queue order, then the backlog, marked "new".
10. **`consistency.js`**, its `make` target and the log at server start.
11. **`make delete-question` and `make rename-question`**, with
    `questions/renames.json`.
12. Later: recalculating from the records, courses, dependencies, and an
    introduction rule that depends on how well the learner is doing.

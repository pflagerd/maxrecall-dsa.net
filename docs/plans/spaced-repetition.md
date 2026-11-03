# Plan: spaced repetition (the order questions come back in)

Status: **in planning, 2026-11-03.** Nothing is built yet. The owner is
going through D1–D8 one at a time; the decision log just below records
each answer and what it changed.

## Decision log

| Date | Decision | Effect on the rest of the plan |
| --- | --- | --- |
| 2026-11-03 | **D1 (owner):** order by queue position, with flexibility in how a question advances. The queue is a JSON file, `order`, in the user's directory (to be replaced by a real database eventually). Each queue element holds the question's name, its file name without `.json` (e.g. `two-sum` for `questions/two-sum.json`), and probably more fields, still to be decided. | Settles most of **D5**: the queue is **stored**, not worked out from the records. D4's step sizes become one possible advance rule, not the only one. D2 (per language) now decides whether `order` holds one queue per language or one with a language in each element. D1's details (file name, element shape, `schemaVersion`, safe writes) are proposed and waiting for the owner. |
| 2026-11-03 | **D2 (owner):** **one queue for everything**, not one per language. Not every learner will have every language. How a learner is shown questions, and whether they may switch languages or set a default language at all, depends on their **user profile**, a JSON file `profile` in their user directory. | **New file**: `users/<email>/profile`. The profile decides which languages' pairs are in the queue. The two language settings now kept in the browser's `localStorage` (`maxrecall-dsa:default-language`, `maxrecall-dsa:available-languages`) become profile matters. Details still open: see D2. |
| 2026-11-03 | **D3 (owner):** as recommended, a Submit passes only if it's `Accepted`, all tests passing. There is **no "how easy"** in this requirement. Tests may also fail for timeouts, or for other reasons still to be decided. The result is recorded in **`order.json`**, in the user's directory, as an attribute **`pass`** whose value is the string `"yes"` or `"no"`. | Settles D1's file name: **`order.json`**. Each queue element now has a `pass` field. D3's options (b) `elapsedMs` and (c) asking the learner are dropped. D4 must say whether one `pass` is enough to decide how far to move, or whether a streak needs more history. |
| 2026-11-03 | **D4 (owner):** start with a function like MaxRecall's 2-to-the-n-with-randomness, but less aggressive: **1.3^k, plus or minus 10%**, with **stochastic rounding**. k is **"correct in a row"**, kept in a counter called **`passesInARow`**, tracked as part of the queue element in `order.json`. The function goes in its own file, **`advance.js`** (the name is for now). D4 will become much more nuanced over time; this is a starting point. | Replaces the 2^k table proposed in D4. An element now has at least `question`, `pass` and `passesInARow`, so it's an object, settling D1's "element shape" detail. With stochastic rounding a fail and a first pass differ on average (1.03 vs 1.30 places). D4's open details below, including what this rule does on a 65-element queue. |
| 2026-11-03 | **D1 details (owner):** accepted all four: `order.json`, elements are objects, a top-level `schemaVersion`, and safe writes (temporary file, then `rename()`; no `await` between reading and writing). | D1 is fully decided. `profile` vs `profile.json` (D2) is still open. |
| 2026-11-03 | **D5 (owner):** the queue is **stored in a file** (`order.json`). Ways to **recalculate it from the Submit records** will be worked out later. When a question is deleted, it **must be deleted from `order.json` too**. There will be a **function that checks consistency between the sources of truth**. | D5 is decided. New piece of work: a consistency check over `questions/`, `order.json`, the Submit records and the profile (details in D5). How a deleted question leaves `order.json` is still open. |
| 2026-11-03 | **D5 details (owner):** (1) the consistency check **only reports**. (2) Not a "repair" command but a function that **removes references to a question** from `order.json`, run **when a question is deleted**. (3) The check is a pure function in its own file, run by a `make` target and logged at server start. (4) **Renaming a question updates references to it** in `order.json`, so its progress isn't lost. **D2 detail (owner):** the profile is **`profile.json`**. | Two functions to build alongside the check: remove references, and update references. Still open: what triggers them (a question is a file in `questions/`, so deleting or renaming one is a file operation that nothing in the server sees), and how old Submit records, which keep the old name, are linked to the new one. |
| 2026-11-03 | **D5 (owner):** accepted the consistency check as proposed, with the adjustments the later decisions imply, and the four recommendations: `make delete-question` / `make rename-question` commands (also usable after a `git pull`), every user, a rename log `questions/renames.json` for old Submit records, and records of deleted questions ignored. | D5 is fully decided. The check now also covers `backlog.json` and `renames.json` (D5 section). |
| 2026-11-03 | **D6 (owner):** a backlog, **`backlog.json`** in the user's directory. Questions are added to it **in the order they were (are) created**. Later: which questions go in will depend on the **courses** a learner is doing, and their order on **dependencies** between questions (some assume others are already mastered). For now, creation order only. | A sixth source of truth. Remove/update references cover `backlog.json` too. Still open: where creation order comes from (git can't tell in a shallow clone), pairs vs questions, and when a pair moves from the backlog into the queue. |
| 2026-11-03 | **D6 details (owner):** accepted all seven: a `created` field in each question file (ties broken by file name); the backlog holds (question, language) pairs, by question then by the profile's language order; at least 3 pairs kept in the queue, plus one more from the backlog every 5 Submits, in a function of its own beside `advance.js`; an introduced pair goes to the front; missing pairs are appended to backlogs automatically (server start, a newly allowed language); a new user starts with everything in the backlog; a `submitsSinceLastIntroduced` counter at the top of `order.json`. | D6 is fully decided. Settles D2's "pairs" detail and its "where a new language's pairs go". Changes the problem file format (`created`), so `readme.html` section 5 changes when that's built. |

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

## Decisions for the owner

Each has a recommendation; none is built until you choose.

### D1. Queue positions or due dates?

**Decided 2026-11-03 (owner): (a), queue positions, stored in a file
`order.json` in the user's directory, as described in the decision log.**
All four details below were accepted by the owner on 2026-11-03:

- **File name:** `order.json` (owner, with D3).
- **Element shape:** an object, settled by D3 and D4, which put `pass`
  and `passesInARow` in it alongside `question` (not a bare string as in
  MaxRecall's `guidOrder.json`).
- **Version:** recommended a top-level `schemaVersion`, as Submit records
  have, so a later change of format can be recognised.
- **Name equals slug:** on 2026-11-03 all 13 question files had `slug`
  equal to the file name, and `loadProblem` in `server.js` finds a
  question by file name. Submit records' `question` field is the same
  value, so the queue and the records refer to questions the same way.
- **Writing it safely:** write a temporary file and `rename()` it over
  `order.json`, so a crash never leaves half a file. Here replacing the
  file is the point, so `rename()` is right (unlike Submit records, which
  use `link()` so they *can't* be replaced). Reading, changing and writing
  it should happen with no `await` in between, so two Submits from two
  tabs can't each read the old queue and one overwrite the other's change
  (a lost update).

The original options:

- **(a) Queue positions, like MaxRecall** (recommended). It's what `TODO`
  describes ("moved down the list by some number of problems"), you
  already know how it behaves, and it works with a small bank: there's
  always a next question. Downside: time away doesn't count. After a
  month off, the queue is exactly where you left it, though you've
  probably forgotten more.
- **(b) Due dates (Leitner, SM-2 or FSRS).** Models forgetting over real
  time. With 13 questions, most days nothing would be due, and FSRS needs
  a lot of review history to fit its parameters.
- **(c) Positions now, time later.** (a), but with the records' timestamps
  kept in mind so a later step could, say, pull long-unseen pairs forward.
  Since every Submit already has `submittedAt`, choosing (a) now doesn't
  rule this out.

### D2. One queue per language, or one for everything?

**Decided 2026-11-03 (owner): one queue for everything**, with a per-user
profile, `users/<email>/profile.json`, deciding which languages a learner has
and whether they may switch languages or set a default. Details still
open:

- **What an element is:** recommended a **(question, language) pair**,
  e.g. `{"question": "two-sum", "language": "python"}`, keeping the
  2026-10-30 design that progress is per (question, language). The
  alternative, one element per question with the language picked from
  the profile when it comes up, would lose per-language progress.
- **File name:** `profile.json` (owner, 2026-11-03).
- **Who may change what:** recommended keeping two kinds of field apart in
  the profile: what the learner is *allowed* (languages, may they switch,
  may they set a default), set by the owner or a teacher; and what the
  learner *prefers* (their default language), set by the learner within
  those limits. For now the owner edits the file by hand; an API for the
  learner's preferences can come later.
- **Enforced by the server, or only hidden in the page?** Today the
  server accepts all five languages (`SUPPORTED_LANGUAGES`, `server.js`)
  from anyone. Recommended: Run and Submit refuse a language the profile
  doesn't allow (a `403`), so "no access" is real and not only a hidden
  menu item.
- **No profile file:** what a user with no `profile.json` gets. Recommended:
  all five languages, may switch, so the owner's current setup keeps
  working until a profile is written.
- **When the profile changes:** a language added means its pairs have to
  enter the queue (where? the same question as new questions, D6); a
  language removed means its pairs are skipped or removed (recommended
  skipped, so the progress isn't lost if it comes back).
- **What happens to the `localStorage` settings:** the default language
  and the language menu would come from the profile instead. Recommended:
  remove both keys' use once the profile exists, so there's one source.

The original options:

- **(a) One queue per language** (recommended). You work in one language
  at a time (the default language), and the list and "next question"
  follow the language you're in.
- **(b) One queue of all (question, language) pairs.** "Next" could jump
  from Python to D.

### D3. What counts as right, and does "how easy" matter yet?

**Decided 2026-11-03 (owner): right = `Accepted`, recorded as
`"pass": "yes"` or `"pass": "no"` in the element's entry in
`order.json`. No "how easy".** Notes and details still open:

- **Timeouts already fail.** The judge returns `Time Limit Exceeded` with
  `passed: 0` (`judge/runner.js`, the `outcome.timedOut` branch), and
  memory-limit kills and runtime and compile errors also aren't
  `Accepted`. So today `pass` is `"yes"` exactly when `status` is
  `Accepted`.
- **Other failure reasons, still to be decided** (for example, perhaps,
  a countdown running out, issue #21): recommended deciding `pass` in one
  small function, so a new reason is added in one place.
- **Strings, not JSON's `true`/`false`:** owner's choice. One advantage:
  a string leaves room for more values later. The cost: `"Yes"` or a typo
  in a hand-edited file is still valid JSON, so the server should check
  that the value is exactly `"yes"` or `"no"` when it reads the file.
- **Never submitted:** recommended leaving `pass` out of the element,
  rather than `"no"`, so "new" and "failed" can be told apart (D6).
- **Only the latest result:** one `pass` holds the last Submit's result.
  The full history stays in the Submit records. Whether D4 needs more
  (a streak count) is for D4.
- **Order of writing:** recommended updating `order.json` only after the
  Submit record has been saved, so the queue never reflects a Submit that
  has no record.

The original options:

- **(a) Right = `Accepted` (all tests pass), anything else = wrong**
  (recommended, to start). Simple and objective. `status` is set in
  `judge/runner.js` (`'Accepted'` only when every test passes).
- **(b) Also use `elapsedMs`**: a fast Accepted moves further than a slow
  one. This is the "easier goes further" part of `TODO`, but what's "fast"
  differs per question, so it needs a baseline (your own earlier times?).
  A good second step once there's data.
- **(c) Ask the learner** after an Accepted (Hard / Good / Easy), as Anki
  does. Would need a new field in the record, and so a `schemaVersion`
  bump.

### D4. How far does a pair move?

**Decided 2026-11-03 (owner): 1.3^k ± 10%, in `advance.js`**, as a
starting point to be changed over time. Details still open, with
recommendations:

- **What k is** (owner): correct in a row, kept in the element as
  **`passesInARow`**. As I read it: a Submit first updates the counter
  (a pass adds 1, a fail sets it to 0), and `advance.js` then uses the
  new value, so k includes this Submit.
- **Rounding** (owner): **stochastic rounding**. A value like 1.3 becomes
  2 with probability 0.3 and 1 otherwise, so the *average* move is
  exactly 1.3^k × (1 ± 10%). Recommended still **at least 1** place, so a
  pair never comes straight back: after a fail, 0.9 to 1.1 would
  otherwise round down to 0 some of the time.
- **What `advance.js` does:** only works out *how many places*. Moving
  the element within `order.json` belongs to the code that reads and
  writes that file. Then changing the rule means editing `advance.js`
  alone. A move longer than the queue puts the element at the end, as
  MaxRecall's `advanceFlashcardGuid` does.
- **Randomness passed in:** e.g. `advance(k, random = Math.random)`, so
  tests can supply fixed "random" numbers and get repeatable answers.
- **Module format:** CommonJS (`require`/`module.exports`), like
  `users.js`. `package.json` has no `"type"` field, so Node treats `.js`
  files as CommonJS ([Node's `"type"` docs](https://nodejs.org/api/packages.html#type)).
- **Which Submit moves the queue** (raised with D3): only a Submit of the
  element at the front, or any Submit of that pair, wherever it is, and
  every time? Recommended: any saved Submit moves that pair from wherever
  it is, since the learner can open any question from the list.

**What 1.3^k ± 10% does** (worked out 2026-11-03 with a throwaway
simulation; rounding as above, every Submit a pass, 13 questions × 5
languages = 65 elements, all in the queue from the start):

| k | 1.3^k | Places moved (with ±10%) |
| --- | --- | --- |
| 0 (failed) | 1.00 | 1 |
| 1 | 1.30 | 1 |
| 2 | 1.69 | 2 |
| 3 | 2.20 | 2 |
| 4 | 2.86 | 3 |
| 5 | 3.71 | 3–4 |
| 6 | 4.83 | 4–5 |
| 8 | 8.16 | 7–9 |
| 10 | 13.79 | 12–15 |
| 16 | 66.54 | 60–73 (the end) |

- **A fail and a first pass move the same distance** (1 place), as do
  k = 2 and k = 3 (2 places). So early on the rule can't tell a hard
  question from an easy one.
- **The ±10% does nothing until k = 5**: below that, rounding swallows it.
- **It takes 16 passes in a row** for a pair to reach the end of a
  65-element queue.
- In the first 100 Submits, all passes, only **12 different pairs** come
  up, about 10 times each, and it takes **934 Submits** before every one
  of the 65 has come up once. With 13 elements (one language) it's 111.
  In effect a working set of about a dozen forms at the front, which is
  what D6's backlog would otherwise do.

**With stochastic rounding** (second simulation, 2026-11-03: 100,000
samples per k; queues run 200 times):

| k | 0 (failed) | 1 | 2 | 3 | 4 | 5 | 8 | 16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Average places | 1.03 | 1.30 | 1.69 | 2.20 | 2.86 | 3.71 | 8.15 | 66.45 |
| Range | 1–2 | 1–2 | 1–2 | 1–3 | 2–4 | 3–5 | 7–9 | 59–74 |

- A fail and a first pass now differ on average, and the randomness has
  an effect from the start.
- The working set is about the same: a median of 12 different pairs in
  the first 100 Submits, and a median of 921 Submits until all 65 have
  come up once (106 for 13).

The 2^k proposal it replaces:

Recommended starting numbers for a small bank, with `k` = Accepted in a row
including this one:

| Result | Moves down | Compare MaxRecall |
| --- | --- | --- |
| Not accepted | 2 places | 8 |
| Accepted, k = 1 | 2 places | 16 |
| k = 2 | 4 | 32 |
| k = 3 | 8 | 64 |
| k | 2^k, or to the end | 4·2^(k+1) |

No randomization at first (see D5 for why). These would be named constants
in one place, so they're easy to tune.

### D5. Store the queue, or work it out from the records?

**Decided 2026-11-03 (owner): stored**, in `users/<email>/order.json`.
Ways to recalculate it from the Submit records come later. A deleted
question must be deleted from `order.json` too. A function will check
consistency between the sources of truth.

**The sources of truth** and what each one owns:

| Source | Owns |
| --- | --- |
| `questions/*.json` | Which questions exist, and which languages each has (`starterCode`) |
| `questions/renames.json` | Which old question names became which new ones |
| `users/<email>/profile.json` | Which languages this learner has |
| `users/<email>/submissions/*.json` | What was submitted and how it was judged (the history; never changed) |
| `users/<email>/order.json` | The queue order, and each pair's `pass` and `passesInARow` |
| `users/<email>/backlog.json` | Pairs not yet in the queue, in the order they'll be introduced (D6) |

**The consistency check** (accepted by the owner 2026-11-03, adjusted for
the decisions since). Each finding names the user, the file, the element
and what's wrong. It only reports.

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
   Submit's verdict matches `pass` (`Accepted` ↔ `"yes"`), and
   `passesInARow` equals the number of `Accepted` Submits at the end of
   its history. Records are matched through `renames.json`, so a renamed
   question keeps its history. A pair with records but no `pass`, a
   `pass` with no records, or a backlog pair that has records, is
   reported. Records of deleted questions are ignored. Check 6 is also
   the core of the later "recalculate from the records".

**Decided 2026-11-03 (owner):**

- **The check only reports; it never changes anything.** Reason: a
  question file can be missing for a harmless reason. Checking out a
  branch that doesn't have it yet, for instance, would otherwise wipe
  that question's progress. Until something removes them, the server
  skips elements whose question is missing when choosing the next
  question.
- **Where it lives and when it runs:** a pure function in its own file
  (e.g. `consistency.js`) that takes the sources and returns a list of
  findings, run by a `make` target, and once at server start, logging
  what it finds without refusing to start.
- **Deleting a question → remove references to it**, a function that
  runs when a question is deleted.
- **Renaming a question → update references to it**, so the pair keeps
  its place, `pass` and `passesInARow`.
- **What triggers them:** commands that do the whole job,
  `make delete-question SLUG=…` and `make rename-question FROM=… TO=…`.
  Rename does `git mv`, changes the file's `slug` field to match, adds
  the rename to `renames.json`, and updates the references. Delete does
  `git rm` and removes the references. Each also works when the file
  change has *already* happened (the VPS gets it by `git pull`, which
  doesn't touch `/srv/maxrecall/data/users`); then it only updates the
  references.
- **Every user, and both files:** the functions go through every user's
  `order.json` **and `backlog.json`** (the second added with D6).
- **Old Submit records after a rename:** followed through the rename log,
  `questions/renames.json` (`{"old-name": "new-name"}`), committed with
  the rename. Records themselves are never changed.
- **Old Submit records after a delete:** kept as history; the check
  ignores them.
- **Smaller effects of a rename:** a bookmarked old address
  (`problem.html?slug=…`) stops working, and the file's SHA-256 changes
  (its `slug` field changed), so old records show the question as edited
  since, which is true.

The original options:

- **(a) Work it out from the Submit records each time** (recommended).
  Replay every Submit for that language in time order through the rules
  in D4. No new files, nothing to keep in sync, nothing to migrate.
  `users/` stays hand-managed and can be copied from the VPS with `rsync`
  and the queue comes out right. Changing the rules re-orders past
  history too, which helps while tuning. Cost: it reads every record on
  each request, which is fine for one user and hundreds of records, but
  would need a cache later. Randomization would have to come from a
  seeded random number generator so replays agree.
- **(b) Store it**, like `guidOrder.json`, updated on each Submit. Fast,
  but it's a second copy of the truth that can drift from the records
  (a record copied in by hand wouldn't be counted).

### D6. Where do questions you've never submitted go?

**Decided 2026-11-03 (owner): a backlog, `backlog.json`**, in the user's
directory. Questions go into it **in the order they were created**. Later
goals, not for now:

- **Courses:** what goes into a learner's backlog will depend on which
  courses they're doing.
- **Dependencies:** some questions assume others have already been
  mastered, so the backlog should follow those relationships (concepts:
  a *prerequisite graph*, which is a *directed acyclic graph*, put in
  order by a *topological sort*).

**Details, all accepted by the owner on 2026-11-03:**

- **Where "order of creation" comes from.** Git history can't be relied
  on: this cloud clone is shallow (97 commits), so 9 of the 13 question
  files show as "added" in its oldest commit, `5ef8b96` (a service
  rename on 2026-10-29), which is just where the clone stops. Two files
  were added in one commit (`double-each-character`,
  `swap-case-with-helpers`), so even full history has ties. File
  modification times are no better, since `git checkout` resets them.
  Recommended: a **`created` field in each question file** (an ISO 8601
  date and time), filled in once now from the full history on Kubuntu,
  and written by whoever creates a question from then on. Ties are
  broken by file name. It moves with the file when it's renamed. (The
  alternative is one list file of all questions in creation order.)
  Either way it changes the problem file format, so `readme.html`
  section 5 gets updated with it.
- **Pairs, not questions.** The backlog holds (question, language) pairs,
  like `order.json`, with the same element shape minus `pass` and
  `passesInARow`. Recommended order: by question (creation order), then
  by the order of languages in the profile. Hello World in every allowed
  language comes before the next question. The alternative, every
  question in one language before the next language, is a per-course
  matter later.
- **When a pair moves from the backlog into the queue.** This has to be
  decided, because a queue holding one pair always gives back that same
  pair. Simulated 2026-11-03 (65 pairs, starting from an empty queue,
  300 Submits, with 1.3^k ± 10%): with no rule beyond "when the queue is
  empty", the same pair came back **299 times out of 300**. Results for a
  rule of "keep at least 3 pairs in the queue, and add one more every N
  Submits":

  | N | Pairs added after 100 Submits | After 300 |
  | --- | --- | --- |
  | 3 | 35 | all 65 |
  | 5 | 22 | 62 |
  | 10 | 12 | 32 |

  (Whether 70% or all of the Submits passed made no difference to these
  counts, since the rule counts Submits, not passes.) Recommended: **at
  least 3 in the queue, and one more every 5 Submits**, in a small
  function of its own beside `advance.js`, so it can later be made to
  depend on how well the learner is doing, as MaxRecall's
  `countUntilNextNewCard` does (32 Submits apart at 0% correct, 4 apart
  at 100%).
- **Where an introduced pair goes in the queue:** at the front, so it's
  the next question, as in MaxRecall (`addNextBacklogFlashcardGuid`
  `unshift`s it).
- **How the backlog gets filled:** a function that appends every missing
  pair (check 4) to the end of each user's `backlog.json`, in creation
  order. Unlike removing references, adding is safe to do automatically:
  recommended at server start, and when a profile allows a new language
  (this answers D2's "where do a new language's pairs go"). A pair whose
  question is later missing again is just skipped, as in `order.json`.
- **A brand-new user:** everything starts in `backlog.json`, and
  `order.json` starts empty.
- **Counting Submits** for "every 5": it needs a counter that survives a
  server restart. Recommended: a top-level field in `order.json` (e.g.
  `submitsSinceLastIntroduced`), next to `schemaVersion`.

The original options:

- **(a) A backlog, introduced one at a time** (recommended), MaxRecall
  style: one new pair every N answers. Order of the backlog: by
  difficulty, then title, until there's a way to say which questions must
  come first (the prerequisites question from 2026-10-30 is still open).
  N: I'd start with a fixed 3 and leave MaxRecall's "faster when you're
  doing well" scaling for later.
- **(b) All new ones first**, then the review queue.
- **(c) All new ones at the end.**

### D7. What happens after a Submit?

`TODO` says Submit should switch to the next problem. But the Results tab
is how you see what went wrong.

**What D1–D6 already fix:** a saved Submit updates the pair's `pass` and
`passesInARow`, moves it with `advance.js`, counts towards
`submitsSinceLastIntroduced`, and may bring a pair in from the backlog.
"Next" is then whatever is at the front of `order.json`, skipping pairs
whose question is missing (D5). With one queue (D2), **next may be in
another language**.

**Options:**

- **(a) Stay on the results, and show a "Next →" button** once the Submit
  is saved, naming what's next, e.g. "Next: Two Sum (C++)"
  (recommended). You read the results first, and a change of language
  doesn't come as a surprise. The grayed Submit's tooltip ("Go back to
  the list for the next question", issue #18) would point to the button
  instead.
- **(b) Go straight to the next question**, as `TODO` says. The results
  are then only in the Submissions tab of the question you left.
- **(c) Go on by itself after a few seconds**, with a way to stay.

**Details, with recommendations:**

- **The server decides what's next.** A new `GET /api/next` returns the
  front pair. Bringing a pair in from the backlog happens when the Submit
  is saved, not when "next" is asked for, so `GET /api/next` changes
  nothing and asking twice gives the same answer. HTTP calls a GET
  *safe* for that reason ([RFC 9110 §9.2.1](https://www.rfc-editor.org/rfc/rfc9110#section-9.2.1)).
- **Which Submits count** (from D4, not yet confirmed): any saved Submit
  of a pair moves that pair from wherever it is, since the learner can
  open any question from the list, and Submits failed for other reasons
  (judge busy, not saved) don't count.
- **Opening a pair in a given language:** the page has no `?language=`
  in its address today (it reads only `?slug=` and `?submission=`,
  `problem-page.js`). "Next" needs one, e.g.
  `problem.html?slug=two-sum&language=cpp`. It would choose the editor's
  language for that visit without changing the learner's default (as
  Load from the Submissions tab already does), and be refused (shown as
  a message) if the profile doesn't allow that language.
- **Nothing left:** if the queue and backlog are both empty, the button
  says so instead of going anywhere.
- **The problem list:** shows the queue in order with each pair's
  language, then the backlog, marked "new". Opening any of them is still
  allowed.
- **A Submit that wasn't saved** (`saved: false`) moves nothing and shows
  no "Next →", because nothing changed.

### D8. What does Skip do?

This one touches an earlier decision: Skip isn't recorded (2026-10-29),
so with D5 (a) a Skip can't change the order.

- **(a) Skip just opens the next question** without changing the order
  (recommended for now). The skipped pair stays at the front, so it's
  still first next time.
- **(b) Record Skips** (a new record type, revisiting 2026-10-29) so Skip
  can move the pair down a little, like MaxRecall's
  `moveFlashCardGuidToEndOfBacklog`.

## Steps (once decided)

Each step is small and checkable on its own. **To be rewritten** once
D1–D8 are through: D1 and D2 have already changed them (a stored `order`
file instead of a replay, and a `profile.json` that has to come first,
since it decides which languages are in the queue).

1. **`scheduler.js`**: a pure function, roughly
   `buildQueue(questions, submissions, language)` returning the ordered
   pairs with each one's streak and whether it's new. No server or page
   changes. Tested with Node's built-in test runner
   ([`node:test`](https://nodejs.org/docs/latest-v22.x/api/test.html)),
   including a test that fails against a deliberately wrong rule.
2. **`GET /api/queue?language=`** in `server.js`, built from the user's
   records.
3. **Problem list** in queue order for the current language.
4. **"Next question" and Skip** on the problem page (D7, D8).
5. Later: `elapsedMs` (D3 b), time away (D1 c), prerequisites.

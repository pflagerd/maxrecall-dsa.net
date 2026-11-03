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
| 2026-11-03 | **D4 (owner):** start with a function like MaxRecall's 2-to-the-n-with-randomness, but less aggressive: **1.3^k, plus or minus 10%**. It goes in its own file, **`advance.js`** (the name is for now). D4 will become much more nuanced over time; this is a starting point. | Replaces the 2^k table proposed in D4. A pair's element needs *k* (passes in a row), which one `pass` field can't give. D4's open details below, including what this rule does on a 65-element queue. |

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
`order` in the user's directory, as described in the decision log.**
Details still open:

- **File name:** `order.json` (owner, with D3).
- **Element shape:** recommended an object, e.g. `{"question": "two-sum"}`,
  not a bare string as in MaxRecall's `guidOrder.json`. Then the fields
  still to be decided can be added later without changing what an
  element *is*.
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
profile, `users/<email>/profile`, deciding which languages a learner has
and whether they may switch languages or set a default. Details still
open:

- **What an element is:** recommended a **(question, language) pair**,
  e.g. `{"question": "two-sum", "language": "python"}`, keeping the
  2026-10-30 design that progress is per (question, language). The
  alternative, one element per question with the language picked from
  the profile when it comes up, would lose per-language progress.
- **File name:** `profile` or `profile.json` (same question as D1's
  `order`).
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
- **No profile file:** what a user with no `profile` gets. Recommended:
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

- **What k is:** passes in a row, including this Submit; 0 after a
  `"no"`. That needs a counter in the element (a field name to choose,
  e.g. `passesInARow`), since `pass` only holds the latest result.
  Counting back through the Submit records instead would make the queue
  depend on them again (D5).
- **Rounding:** to the nearest whole place, and **at least 1**, so a pair
  never comes straight back as the next question.
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

**Mostly settled by D1 (2026-11-03): stored**, in `users/<email>/order`.
Still to discuss: what happens when the file and the records disagree
(e.g. Submit records copied in from the VPS with `rsync`, or a question
added to or removed from `questions/`), and whether there should be a way
to rebuild `order` from the records.

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

- **(a) Stay, and show a "Next question →" button** once the Submit is
  saved (recommended). The grayed Submit's tooltip already says "Go back
  to the list for the next question" (issue #18).
- **(b) Go straight to the next question**, as `TODO` says.
- The problem list would also show the queue order for the current
  language, with new questions marked.

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
file instead of a replay, and a `profile` file that has to come first,
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

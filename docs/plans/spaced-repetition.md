# Plan: spaced repetition (the order questions come back in)

Status: **in planning, 2026-11-03.** Nothing is built yet. Decisions D1–D8
below are waiting for the owner.

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

- **(a) One queue per language** (recommended). You work in one language
  at a time (the default language), and the list and "next question"
  follow the language you're in.
- **(b) One queue of all (question, language) pairs.** "Next" could jump
  from Python to D.

### D3. What counts as right, and does "how easy" matter yet?

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

Each step is small and checkable on its own.

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

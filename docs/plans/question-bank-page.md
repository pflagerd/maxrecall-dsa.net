# The question bank page (issue #133): a proposal

Status: **proposed** (users, 2026-11-08). Nothing is built. The owner
decides Q1–Q6 below; until then this is a design to argue with, not a
plan to follow.

## What the owner asked for

Issue #133 (owner, 2026-11-07):

> Create a page accessible only to me currently, which shows all the
> question slugs in questions/, kind of like what would happen if they
> were all in my queue.
>
> Perhaps with a checkmark if it's in my backlog or in my queue.

Routed to users by the architect (`docs/session-handoff/architect/
20261107T182846-0800.md`): the page, its route in `routes.js`, reading the
queue and backlog; propose the design first. Serving a new page is
infrastructure and security's (`STATIC_FILES` in `server.js`, contract 9).

## What exists already (read from the code at `8389109`)

1. **The whole bank is already listed to every signed-in user.**
   `GET /api/questions` (`routes.js`, `listProblems`) answers every
   question's slug, title, difficulty, topics and sources. So the slugs
   aren't secret: "only to me" decides **who sees the page**, not who may
   know what's in the bank. (Hidden test cases stay hidden either way:
   nothing here sends them.)
2. **The list page already has an "every question" view.**
   `problems-list.js`'s `showAllQuestions` lists every question by title
   when the queue can't be listed (an invalid queue file). It's a
   fallback, with no marks and no languages.
3. **There's an owner check, but it's named for Test.** `playtest.js`'s
   `canTestQuestions(email, OWNER_EMAIL)` (questions' file, contract 3):
   true only for `OWNER_EMAIL` (`MAXRECALL_USER`, `users.js`), which is
   also who every request on the trusted listener is. `GET /api/profile`
   answers it as `canTestQuestions`, and the page shows Test by it.
4. **The queue and backlog are per pair**, a (question, language), not per
   question (spaced-repetition plan, D1, D2). A question with five
   languages can be in the queue in Python, in the backlog in Java, and in
   neither in C++.
5. **How many marks you'd see depends on your backlog setting**
   (`profile.json`'s `backlog`, step 13; `readme.html`, Where data lives):
   - `"all"` (the default): at every server start, every pair your
     profile allows that isn't in either file is appended to the backlog.
     So nearly every row would be ticked; the exceptions are a question
     added since the last restart, and a language your profile doesn't
     allow.
   - `"chosen"`: nothing is appended; the backlog holds only what
     `make backlog-add` put there. Then the marks show what you've chosen,
     and the unmarked rows are the rest of the bank. **I guess this is the
     case the issue is about** ("kind of like what would happen if they
     were all in my queue"); I can't see `users/` on the VPS to check.
6. **Opening any question by its slug is a feature** (owner, 2026-11-06,
   `readme.html` Decisions; `docs/how-to-put-a-question-directly-into-my-queue-by-slug.html`):
   `problem.html?slug=…&language=…` opens it, and its Submit or Skip puts
   it straight into the queue. So a page that links each row to its
   question is also a way to queue a question of your choice.
7. **`GET /api/queue` hides pairs it can't open**: those in a language
   turned off, or whose question lacks that language (`canOpenPair`).
   A page built on it would show such a pair as unmarked even though it's
   in a file.

## The questions for the owner

Each has options, trade-offs and a recommendation.

### Q1. A new page, or a view of the list page?

- **(a) A new page**, e.g. `bank.html` with its own `bank.js`. What the
  issue says ("a page"); keeps the learner's list simple; a natural place
  for owner tools later (a teacher's view, adding to the backlog). Costs:
  two new files that infrastructure and security must add to
  `STATIC_FILES` (contract 9), a cross-role request; and the list's
  row-building code (`questionCells`, `addRow`, `difficultyClass` in
  `problems-list.js`, which runs itself when loaded) either copied or
  moved into a script both pages load (a third new file).
- **(b) A view of the list page**: `index.html?view=bank`, reached by a
  link above the list that only you see. No new files to serve, no other
  role involved, the same table and look, and the existing
  `showAllQuestions` becomes its starting point. Costs:
  `problems-list.js` grows a second mode; the learner's page carries
  owner-only code (hidden, but there).

**Recommendation: (b).** It's the smaller change, needs nobody else, and
"kind of like what would happen if they were all in my queue" reads like
the same table. If owner tools grow later (Q6), moving the view to its
own page is a contained change then.

### Q2. Who counts as "me"?

- **(a) Reuse `canTestQuestions`.** No new code. But it's questions' rule
  for the Test button (contract 3), and using it for something else ties
  the two together: if a tester is ever allowed Test, they'd see this too.
- **(b) A check of users' own**, in `routes.js`, against `OWNER_EMAIL`
  (`users.js`, users' file), and a new flag in the profile answer,
  `canSeeQuestionBank`, named for what it allows, like `canTestQuestions`.
  Today it's true for the same person (`OWNER_EMAIL`, and anyone on the
  trusted listener), but the two can part later (a teacher) without
  touching questions' file.

**Recommendation: (b).** Same person today, no contract change, and
"currently" in the issue suggests it may widen.

Either way the route itself refuses anyone else (**403**), not only the
page's link, so "only me" doesn't depend on the page hiding a link.

### Q3. One row per question, or per pair?

The issue says slugs, but the queue is per pair (fact 4).

- **(a) One row per question, one mark**: ticked if any of its pairs is
  in the queue or the backlog. Matches the issue's words; hides which
  language.
- **(b) One row per question, a column per language**: in each, where that
  pair is: **"#3"** (third in the queue), **"backlog"**, **"—"** (in
  neither file), or blank when the question doesn't have that language.
  The columns are the languages your profile allows, in your order.
- **(c) One row per pair**, like the list page. With five languages,
  five times the rows.

**Recommendation: (b).** One line per slug, as asked, without hiding
the per-language truth. With only Python allowed it's one column, and
reads like (a) with the position added.

### Q4. What's in a row, and in what order?

Proposed columns: **slug** (asked for by name), title, the language
columns (Q3), difficulty, created (date only). Sources and topics
bubbles too, as on the list, if you want them; I'd leave them off to
keep the row narrow.

Order, one of:
- **(a) by `created`, then slug**: the order a backlog `"all"` brings
  new questions in, so it reads "like they were all in my queue";
- (b) by slug, A to Z: easiest to find one by name;
- (c) by title, as the fallback view does now.

**Recommendation: (a).** No sorting controls at first; the browser's
find (Ctrl+F) finds a slug.

### Q5. Does a row link to its question?

- **(a) Yes**: each language cell opens `problem.html?slug=…&language=…`,
  and the title opens it in your default language. A line above the
  table says that a Submit or Skip there puts it into your queue (fact 6).
- (b) No: a read-only list; open a question by typing its address, as
  now.

**Recommendation: (a).** It's what the list does, and with a chosen
backlog it's the quickest way to try, and so queue, any question.

### Q6. Out of scope for now?

Proposed: no adding to or removing from the backlog or queue from the
page (`make backlog-add` stays the way: it needs the server stopped,
and a route that writes the files is a design of its own); no editing
of questions; no other users' queues. Any of these would be a later
issue.

## The design, if the recommendations are taken

- **`GET /api/question-bank`** (`routes.js`; safe, writes nothing):
  **403** unless `canSeeQuestionBank`; **401** signed out, as for every
  feature route (the gate, contract 9). Answers
  `{ languages, questions: [{ slug, title, difficulty, created, languages,
  pairs: { <language>: { where: "queue" | "backlog", position? } } }] }`:
  every question in `questions/` through `questionInfos()` (contract 4,
  which users' `routes.js` already uses), sorted by `created`, then slug;
  `languages`, the columns, the profile's allowed languages in its order.
  It reads `order.json` and `backlog.json` through `queueView()` (as
  `GET /api/queue` does: the backlog filled in memory for `"all"`, so
  this page and the list agree), but **not** through `canOpenPair`, so a
  pair in a language turned off still shows where it is (fact 7).
  An invalid profile or queue file: the same 500 as `GET /api/queue`.
- **`GET /api/profile`** adds `canSeeQuestionBank`.
- **`index.html`, `problems-list.js`**: a "Question bank" link above the
  list, shown when `canSeeQuestionBank`; `?view=bank` shows the bank
  table instead of the queue, with a link back. Rows built with
  `textContent`, as now.
- **Tests** (`routes.test.js`): the owner gets the bank, with the marks
  matching the files; another learner gets 403; signed out, 401; the
  owner's turned-off language still shows its pair.
- **Docs**: `readme.html` (API, Front end, Decisions), this plan's status.
- **Other roles**: none, with Q1 (b) and Q2 (b). With Q1 (a),
  infrastructure and security adds the new files to `STATIC_FILES`
  (contract 9), and `docs/contracts.md` doesn't otherwise change.
- **This file** is new: a request to the architect to add it to users'
  list in `docs/roles/users.md`, beside the other plans.

## Thinking ahead

- A **teacher** (the profile's "edited by hand by the owner, or later a
  teacher") would want this page for a learner of theirs, not for
  themselves. Q2 (b)'s capability name, and a route that takes the
  signed-in user's own files only for now, keep that open.
- **#88** (clickable "Learned earlier" links) and **#93** (a level below
  Easy) change what a row could show (prerequisites, a new difficulty).
  The difficulty column takes a new value as it comes (an uncoloured
  badge until `style.css` has a rule, contract 4).
- If the bank grows to hundreds of questions, a filter box would be the
  next thing; not needed at 15.

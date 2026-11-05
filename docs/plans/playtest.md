# Plan: testing a question without recording anything (issue #58)

Status: **done, 2026-11-05** (option 1, details 1–5, all yes). Linked from
`readme.html` → Decisions & plans.

## The issue

The owner (2026-11-05): "Need a way to player-test new questions without
recording results. Eventually, will want a way to edit/create new
questions." The second part is for later: it ties in with the "how to add
a new problem" page described in `TODO`.

## What there was

- **Run** judges against the visible test cases only, and records nothing.
- **Submit** judges against all of them, hidden ones included, then saves
  a record and moves the question in the learner's queue
  (`server.js`, `handleExecution`).
- A hidden case's result carries no input, expected or actual
  (`judge/runner.js`, `TestResult`), so the person who wrote it couldn't
  see why one failed.

## Options considered (2026-11-05)

1. **A Test button, for the owner only** (chosen): every test case, hidden
   ones shown in full, nothing saved or moved. Works on any question, new
   or edited.
2. **Draft questions** (`"draft": true`): kept out of every backlog and
   list, openable only by the owner, never recorded. Its weak point: an
   existing question being edited can't be made a draft without leaving
   every learner who has it. Possible later, if a question must be live on
   the VPS but hidden from learners.
3. **A throwaway users folder on Kubuntu** (`make dev` with a temporary
   `MAXRECALL_USERS_DIR`): no app change, but nothing on the VPS.
4. **A throwaway test learner on the VPS**: no code, but an invite, a
   sign-in, and records to clean up.

## Details (owner: "Option 1, details 1-5 yes")

1. **Test, next to Submit, shown only to the owner.** The learner's own
   result for that question doesn't change.
2. **The server decides**: `POST /api/questions/:slug/test` is refused
   (403) for anyone but `MAXRECALL_USER`, before anything else is looked
   at, so it doesn't even say whether a question exists. Not a profile
   permission: the `allowed` permissions default to true, so a new one
   would turn Test on for every learner without a `profile.json`.
3. **No record, no queue change, no timer save.** It waits its turn in the
   judge's queue like Run and Submit.
4. **Hidden test cases shown in full, in a Test only.** Done without
   changing the judge: the judge leaves out a hidden case's details by
   looking at its copy's `hidden`, so the server gives it copies with
   `hidden` taken off (`playtest.js`, `revealHidden`), then marks those
   cases again in the result, `hidden: true, revealed: true`
   (`markRevealed`). (When proposing this, I'd said it meant changing how
   `judge/runner.js` shapes results; it didn't.)
5. **Any language the question has**, not only those the profile allows:
   it tests the question, not the learner. The page's language dropdown
   still offers only the languages turned on, so to Test in another one,
   turn it on in the language menu first.

## What was built

- `playtest.js` (pure): `canTestQuestions(email, ownerEmail)`,
  `revealHidden(testCases)`, `markRevealed(results, testCases)`; tests in
  `playtest.test.js`.
- `server.js`: the `/test` route; `handleExecution` takes a `mode`
  (`run`, `submit` or `test`); `checkExecutionRequest` skips the profile
  and queue checks for a Test; `GET /api/profile` and `PATCH
  /api/profile/preferred` both answer with `canTestQuestions`, since the
  page replaces its copy of the profile with either.
- `problem.html`, `problem-page.js`: the Test button (hidden unless
  `canTestQuestions`); "Tested, not recorded" in the status line; a
  revealed case labelled "Hidden test case N (shown because this is a
  Test)", with its input, expected and actual.

## Checked (cloud, 2026-11-05)

- `make test` (217 tests, 4 new), `make typecheck`, `make doc-check`.
- 9 deliberately broken versions of `playtest.js`, all caught.
- A real server, the owner on the trusted port with a profile allowing
  Python only: Test of Climbing Stairs in Python, correct (5/5, the three
  hidden cases with their details) and wrong (`expected 5 actual 4` on a
  hidden case); in Java, which the profile doesn't allow (accepted; Run in
  Java still 403); a Java compile error; the owner's files' checksums
  unchanged by all of them; a Submit afterwards still recorded, hidden
  details still left out. A registered learner: `canTestQuestions: false`
  in both profile answers, Test 403, also for a question that doesn't
  exist; no records.
- Headless Chromium: the owner sees Test; after a Test the status says
  "Tested, not recorded", hidden cases show in full, Submit is still
  Submit and Skip still there; a Submit then becomes Next as before; a
  learner doesn't see Test.

## Later

- Editing and creating questions in the app (the issue's "eventually").
- Draft questions (option 2), if needed.
- If teachers or co-authors come along, Test as a permission rather than
  owner-only (detail 2), with a default of false.

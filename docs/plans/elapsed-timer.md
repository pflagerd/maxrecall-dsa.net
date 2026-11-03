# Plan: elapsed-time timer (issue #20)

Status: **waiting for the owner's decisions** (T1–T7 below). Nothing is
built yet. Written 2026-11-03.

Issue #20 says only "Add an elapsed time timer." Issue #21, "Allow an
optional Countdown Timer.", is the same kind of feature, so the timer is
designed so a countdown can reuse it later (T7).

## What exists today

- The problem page (`problem.html`, `problem-page.js`) has no clock. The
  editor toolbar holds the language dropdown, Run, Submit and Skip.
- Progress is per **(question, language)** (readme.html, Decisions,
  2026-10-30).
- Since #18, Submit grays out for a language after a saved Submit. That is
  remembered only in memory, so a reload enables it again.
- A saved Submit record (`server.js`, `handleExecution`) has `submittedAt`
  but nothing about how long the learner took. readme.html says to bump
  `schemaVersion` (now 1) when the record format changes.
- The planned spaced-repetition ordering can only judge difficulty from
  Submit records (readme.html, Decisions, 2026-10-29). Time to solve is an
  obvious signal for it, but only if it's saved.

## Decisions

### T1. What does one clock measure?

- **(a) One clock per (question, language)**, running only while that
  language is shown. Switching to Java pauses Python's clock and starts or
  resumes Java's. This matches per-language progress and #18.
- (b) One clock per question, whatever the language. It's simpler, but a
  C++ attempt then inflates the Python time.

**Recommendation: (a).**

### T2. When does it start?

- **(a) When the question opens in that language.** Reading the question
  counts, as in a timed interview.
- (b) On the first edit to the code. This leaves out reading time and could
  also mislead: you can think for ten minutes before typing.
- (c) A Start button. This is the most control, but it's one more click, and
  easy to forget.

**Recommendation: (a).**

### T3. When does it stop?

- **(a) At a saved Submit, for that language.** The clock freezes, showing
  the time taken. This fits #18: once Submit is grayed out, the attempt is
  over. A failed Submit (not saved) doesn't stop it.
- (b) Only at an Accepted Submit. With #18, though, any saved Submit
  already ends the attempt.

**Recommendation: (a).**

### T4. Does it pause when you aren't looking?

- **(a) It pauses while the browser tab is hidden** (another tab, minimized
  window, locked screen), using the Page Visibility API
  (<https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API>).
  It does *not* pause when another window merely covers the browser, so
  looking something up in a second window still counts.
- (b) It never pauses (wall-clock time). Leaving the laptop overnight
  produces a time of hours.
- (c) A manual Pause button, with or without (a).

**Recommendation: (a)**. A Pause button can come later if wanted.

### T5. What does a reload do?

- **(a) It starts again from zero**, like #18's gray-out. This is the
  simplest, and consistent with #18.
- (b) It carries on, using the browser's `sessionStorage` for that tab. That
  means more code, and #18 would then arguably need the same, otherwise the
  timer survives a reload while the Submit gray-out doesn't.

**Recommendation: (a)**, revisited together with #18 if reloads turn out to
matter.

### T6. Is the time saved in the Submit record?

- **(a) Yes: the page sends `elapsedMs` with Submit, and the record keeps
  it**, with `schemaVersion` bumped to 2. Older records simply don't have
  the field. The value comes from the browser, so it's what the learner's
  page says, not something the server measured. That's fine for
  self-practice, but it can be faked by anyone who edits the request. A
  server-measured time would need the server to record when you opened the
  question, which is a larger change.
- (b) No: display only. Nothing to migrate, but spaced repetition can't
  use it.

**Recommendation: (a).** If #24 (runtime and error text in records) is done
soon, both record changes could share one `schemaVersion` bump.

### T7. How does it look?

- **(a) `m:ss` (`h:mm:ss` from one hour) in the editor toolbar**, after
  Skip, in digits that don't jiggle (`font-variant-numeric: tabular-nums`).
  Clicking it hides the digits and shows just a clock icon; clicking again
  shows them. Some people find a visible timer stressful. The choice is
  remembered in `localStorage`, and the clock keeps running while hidden.
- (b) Always shown.
- (c) In the page header instead.

**Recommendation: (a).** The clock is built as a small module of its own,
`timer.js`, that counts up. A countdown (#21) can later count down from a
limit using the same pause, resume and freeze logic.

## Steps once decided

1. `timer.js`: a clock you can start, pause, resume, freeze and read, with
   no page code in it. A headless test checks pausing and resuming.
2. The problem page: one clock per language, the toolbar display, pausing
   while the tab is hidden, freezing at a saved Submit. Tested in headless
   Chromium, as for #18.
3. If T6 (a): `elapsedMs` in the Submit request and the record, with
   `schemaVersion` 2 and readme.html's record table updated.

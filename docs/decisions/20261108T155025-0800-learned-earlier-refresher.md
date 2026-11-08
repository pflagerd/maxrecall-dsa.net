# A "Learned earlier" link opens a refresher: the earlier question, passed again, with the schedule unchanged

2026-11-08 · decided by the owner · written by questions

**Decided** (owner, 2026-11-08, in the questions 1 session; #88, Part 2
of `docs/plans/fundamentals-learned-links-concept-checks.md`), in place
of #88's queue swap:

- **A click opens a refresher**, the earlier question's full page, in the
  clicked page's language: "The Learning tab is not enough. I want the
  learner to PROVE he has remembered by passing the submission (again)."
  (Chosen over showing only the earlier question's Learning tab.)
- **A refresher doesn't change the schedule**: its Submit is judged, but
  no pair moves. (Chosen over #88's swap, which made the earlier question
  the current one, so that its Submit counted: a pass would bring it back
  sooner than its schedule, and a Skip or a fail would reset its passes in
  a row; `order.js`, `recordSubmit`; `advance.js`.)
- **It pre-empts** the question it was clicked from, and there's no gate:
  after a pass, the learner gets whatever the queue gives next.
- **Questions' part**: the 25 links keep their form (Q6 (a)); a `make
  test` check that each earlier question has every language of the
  question built on it, added now (Q8); `target="_blank"` follows users'
  choice of tab (Q7).

No preference from the owner, so questions' recommendations, for users
to settle: the same tab, with a warning that the code in progress is lost
(the page keeps no drafts); every refresher Submit saved, pass or fail,
marked as a refresher.

**Why**: a learner who has forgotten an earlier question should be able
to go back and show they remember it, without that visit counting as
practice in the schedule (owner).

Source: `docs/plans/fundamentals-learned-links-concept-checks.md`, Part 2;
`order.js` (`recordSubmit`); `routes.js` (the Submit route, then
`updateQueue`).

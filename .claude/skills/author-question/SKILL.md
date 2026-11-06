---
name: author-question
description: Write a new question for the MaxRecall DSA question bank, or change an existing question's content (questions/<slug>.json, in five languages: its Learning tab, description, examples, constraints, starter code or test cases). Use when asked to add, draft, split, rewrite or fix a question. Says what to read, in what order, and the checks before a pull request; the rules themselves are in the files it names.
---

# Author a question

This skill holds no rules of its own. They're in the files below, so each
rule has one place to change. Paths are from the repository's root.

## Whose work this is

Question files (`questions/**`) are the questions role's
(`docs/roles/questions.md`). A session with another role doesn't edit
them: it writes the request in its handoff (`CLAUDE.md`, "Roles").

## Read first, in this order

1. **The craft:**
   [`docs/roles/questions/how-to-write-a-question.md`](../../../docs/roles/questions/how-to-write-a-question.md):
   what a question is for, one new concept per question,
   `alreadyLearned`, the five languages kept parallel, checking claims
   by running them, editing a question that exists, the HTML patterns,
   and the questions still open.
2. **The procedure:**
   [`docs/how-to-add-a-new-question.html`](../../../docs/how-to-add-a-new-question.html):
   deciding what the question is, a branch, the template
   (`docs/question-template.json`), the fields, the test cases,
   `make test`, Run and Test, the pull request, deploying.
3. **The format:** `readme.html` section 5, checked by
   `question-files.js`'s `checkQuestion`. Where these files disagree,
   `readme.html` wins.

## The steps, and where each comes from

1. **Propose before writing.** The concept, the questions it builds on,
   the slug, title and difficulty (how-to, step 1). A new question is a
   design choice: lay it out and wait for the owner's decision
   (`CLAUDE.md`, "Before changing anything").
2. **Run every claim** in its language before it goes in (guide,
   section 3).
3. **Edit question files as raw text**, not by re-saving parsed JSON
   (guide, section 4).
4. **Check:** `make test` (how-to, step 6); and `make typecheck` and
   `make doc-check` too if any JavaScript changed (`CLAUDE.md`,
   "Documenting code").
5. **Try it in the app** with Run and Test (how-to, step 7). The
   problem page needs a CDN that cloud sessions can't reach
   (`readme.html`, Known gaps), so there it's the owner who tries it.
6. **Record it** in the same pull request: `readme.html`'s Decisions,
   and the guide when the change teaches a rule or settles an open
   question (`docs/roles/questions.md`, "Writing or editing a
   question").

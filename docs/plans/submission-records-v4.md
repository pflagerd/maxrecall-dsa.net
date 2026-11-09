# Submission records, version 4: a fill-in-the-blank answer (#160, Q11)

Status: **decided** (users, 2026-11-08; the owner chose D1 to D5 as
recommended, and D6 after questions 2's review, 2026-11-08). Nothing built: it waits for questions' side
of #160 (B7). Where this disagrees with `readme.html`,
`readme.html` wins: it describes what's built.

**Renamed** (owner, 2026-11-09, #160): the kind is `"fill-in-the-blank"`,
not `"fill-in"`, in code and in stored records alike, so a version 4
record's `kind` is `"fill-in-the-blank"`. Nothing else here changed.
Recorded in `docs/decisions/20261108T193643-0800-fill-in-the-blank-format-and-judging.md`,
"Named". The merged decision files this plan names keep the old word, as
merged decision files aren't edited.

#160 (questions 2's fill-in-the-blank proposal) leaves Q11 to users: what
a saved Submit (or Skip) keeps for a question whose `kind` isn't
`"code"`. This plan answers it. Facts were read from `master` at
`cf90d5d` unless marked as a guess.

## What's decided already (#160, owner, 2026-11-08)

- **Q3**: a question's `kind` field; absent means `"code"`. A fill-in-the-blank
  question has `template` and `blank` (and `maxLength`, Q8), and its
  languages are its template's keys, so the (question, language) pair
  model stays. Its judge is a file beside it,
  `questions/<slug>.judge.js` (Q6), not a field.
- **Q5**: each kind defines its own answer, e.g. `{ "blank": "'" }`. A
  `"code"` question's answer **stays `code`**, in requests and records.
- **Q9**: a wrong form is `Wrong Answer` plus the judge's message; a
  fill-in-the-blank result leaves out `passed` and `total`.
- **Q6b, Q10**: a judge returns `{ pass, message?, hints? }`; only the
  server turns `pass` into `Accepted` or `Wrong Answer`.
- **Q9a**: a judge that throws records nothing. So there's no record for
  that case.
- **Q6.4**: a fill-in-the-blank record's hash covers its judge file too
  (`questions/<slug>.judge.js`, Q6). Today `questionSha256` hashes only
  the `.json` file's bytes (`routes.js:124`), and nothing compares it:
  it's a trace for whoever looks into a Submit later.

## Records today (version 3)

`routes.js`'s `submissionRecord` writes, for every Submit or Skip
(`users.js`, the `SubmissionRecord` type):

`schemaVersion` (3), `submittedAt`, `question`, `questionSha256`,
`language`, `judgeMode`, `code`, `skipped` (Skips only), `status`,
`passed`, `total`, `runtimeMs`, `elapsedMs`, `results`, `stdout`,
`stderr`.

Who reads them, and what each needs:

| Reader | Reads | Fill-in-the-blank needs |
|---|---|---|
| Consistency check 6, `consistency.js:34-40, 123-132` | `submittedAt`, `question`, `language`, `status`, `skipped` | nothing: `status` is `Accepted` or `Wrong Answer` (Q9) |
| `make recalculate-queue`, `recalculate.js:121` | `status`, `skipped` (through `passFor`) | nothing, as above |
| `readSubmission`, `users.js:142` | parses the JSON; checks no field and no version | nothing |
| The Submissions list, `routes.js:573` (`toSubmissionSummary`) | `status`, `passed`, `total`, `runtimeMs`, `elapsedMs`, `skipped` | the kind, so the page knows how to show the line |
| The Submissions tab, `problem-page.js:1879-1880` | `${s.passed}/${s.total}`, `${s.runtimeMs} ms` with **no check** | a check: today a fill-in-the-blank line would read "Wrong Answer · null/null" |
| "Load into editor", `problem-page.js:1989-2010` | `record.code` into the editor | the fill-in-the-blank page puts `answer.blank` back in the box instead |
| The Learning/Applying tab rule, `problem-page.js:1811` | `skipped` only | nothing |

No reader checks `schemaVersion`. It records when a field appeared, for
people and for code that wants to know.

## The proposal: version 4

A version 4 record is version 3 with these changes. Version 1 to 3
records stay as they are: nothing is rewritten.

1. **`kind`**, always written: `"code"` or `"fill-in-the-blank"` (D2).
2. **The answer**: for `"code"`, `code` as today (Q5). For any other
   kind, **`answer`**: the kind's answer object as the server validated
   it, only the kind's own fields (D1, as changed by #160's Q12), e.g. `{ "blank": "\\'" }`, and **no `code`** (D1).
3. **`judgeMode`** only for `"code"`, where it means something.
4. **What a fill-in-the-blank judge doesn't produce is `null`**: `passed`,
   `total`, `runtimeMs`, `stdout` and `stderr`; `results` is `[]`. A
   Skip already does this, so readers handle it (D4).
5. **`message` and `hints`**, when the judge gives them (D3): so the
   Submissions tab can show, later, why a fill-in-the-blank answer failed.
6. **A Skip of a fill-in-the-blank question** keeps what the box held as
   `answer`, as a Skip of a code question keeps the editor's text.
7. **`judgeSha256`** for a fill-in-the-blank record: the SHA-256 of its judge file,
   beside `questionSha256`, which stays the `.json` file's alone (D6).

An example, a failed fill-in-the-blank Submit:

```json
{
  "schemaVersion": 4,
  "submittedAt": "2026-11-10T18:04:11.512Z",
  "question": "single-quote-in-double-quotes",
  "questionSha256": "…",
  "judgeSha256": "…",
  "language": "python",
  "kind": "fill-in-the-blank",
  "answer": { "blank": "\\'" },
  "status": "Wrong Answer",
  "message": "Your answer would technically work, but is not what we asked for. …",
  "passed": null, "total": null, "runtimeMs": null,
  "elapsedMs": 41250,
  "results": [], "stdout": null, "stderr": null
}
```

A code Submit in version 4 differs from version 3 only in
`"schemaVersion": 4` and `"kind": "code"`.

## Decisions (owner, 2026-11-08: each as recommended)

- **D1. Where a non-code answer goes.** Decided: (a).
  - (a) **`answer`, the kind's own object; `code` stays for code**
    (recommended). Q5 already keeps `code` for code questions, so every
    existing record, test and reader of `code` is untouched.
  - (b) `answer` for every kind, `{ "code": "…" }` for code. One shape,
    but it changes code records and every reader of `code`, which Q5
    ruled out.
  - **Changed** (owner, 2026-11-08, #160's Q12, after questions 2's and
    infrastructure and security's reviews): the answer is kept **as the
    server validated it**. An answer with any field but its kind's own
    (for fill-in-the-blank, anything but `blank`) is refused before the judge is
    called, as is a `blank` that isn't a string (`typeof`) or is longer
    than `maxLength` (Q8, capped at 100 by Q15). Nothing is recorded for
    a refused answer. A valid answer is the same object the request sent.
    Why: a request needn't come from our page, and without the refusal a
    hand-made one could put any fields, of any size, into a learner's
    records. (Earlier the same day the owner had kept "as sent";
    `docs/decisions/20261108T182945-0800-submission-records-v4.md` says
    so, and the decision file that changes it is the newer one.)
- **D2. `kind` in the record.** Decided: (a).
  - (a) **Always written in version 4** (recommended). A record says
    what it is without its question file, which may change kind later
    (`questionSha256` already shows a file changed, but not how).
  - (b) Only for kinds other than `"code"`. Shorter, but a reader has to
    know that absent means code, as with `skipped`.
- **D3. The judge's `message` and `hints`.** Decided: (a).
  - (a) **Kept** (recommended): the learner can see later why a fill-in-the-blank
    answer failed, as a code answer's `stderr` shows why it failed.
  - (b) Not kept: the verdict only.
- **D4. Fields a fill-in-the-blank judge doesn't produce.** Decided: (a).
  - (a) **`null`, as for a Skip** (recommended): every record has the
    same fields, and readers already handle `null` there.
  - (b) Left out. Smaller files, but readers must handle both `null`
    (Skips) and missing.
- **D5. #88's refresher mark** (#88 on hold, owner, 2026-11-08).
  Decided: (a). #88's
  refresher Submits would need `refresher: "yes"`, which consistency
  check 6 and the replay skip (users' finding, told to questions 1).
  - (a) **If #88 resumes before this is built, the mark joins version
    4**; otherwise it's version 5 (recommended): one format change per
    deploy where possible, but neither waits for the other.
  - (b) Hold this until #88 is decided.
- **D6. Recording which judge judged it** (#160 Q6.4; found missing by
  questions 2's review). Decided: (a).
  - (a) **A separate `judgeSha256`**, of `questions/<slug>.judge.js`,
    beside `questionSha256` (recommended): each hash is of one file, so
    each can be matched with that file's history, showing which changed.
  - (b) `questionSha256` covering both files together: one field, but
    its meaning differs by kind, and a change doesn't say which file.
  - **The `judge/` helpers aren't hashed** (owner, with questions 2,
    2026-11-08, #160's Q13: "I don't think hash covers the helpers").
    A judge may use shared helpers in `judge/` (#160 Q6.3), so a change
    to one can change how answers are judged with no trace in the
    records. Git history and the architect's review of judge code
    (#160 Q14) are the record of that. D6 is unchanged.

## What users builds, once decided and once questions' side is in

- `routes.js`: `submissionRecord` writes version 4 by kind, with
  `judgeSha256` for fill-in-the-blank (the judge file read and hashed with the
  question, as `loadProblem` does for the `.json`);
  `toSubmissionSummary` passes `kind` (and `message`, under D3(a)).
- `users.js`: the `SubmissionRecord` type, with `code` optional and
  `kind`, `answer`, `message`, `hints` added.
- `problem-page.js`: the Submissions tab shows counts and time only when
  they're numbers (the result line already checks, `:1605-1607`), and the
  message under D3(a); "load" puts a fill-in-the-blank answer back in the box, and
  refuses a record whose kind isn't the question's.
- `readme.html`, "Where data lives"; `routes.test.js` for both kinds.

## What it sets up, and rules out

- **A new kind adds one `answer` shape**, not a new record version,
  unless it needs fields of its own.
- **Deploying it changes what's stored on disk**, so the guarded deploy
  stops for infrastructure and security first (`docs/deploy-vps.md`,
  "Updating: the guarded deploy", step 1).
- **Going back to an older server after fill-in-the-blank records exist** (a
  guess, not tried): its Submissions tab would show "null/null" for them,
  and loading one into the editor would find no `code`. No queue or
  check is affected, since `status` is a normal verdict. An older server
  can't show a fill-in-the-blank question at all, since questions' format check
  refuses unknown kinds.

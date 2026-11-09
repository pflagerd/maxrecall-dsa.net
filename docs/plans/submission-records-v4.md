# Submission records, version 4: a fill-in answer (#160, Q11)

Status: **decided** (users, 2026-11-08; the owner chose D1 to D5 as
recommended, 2026-11-08). Nothing built: it waits for questions' side
of #160 (B7). Where this disagrees with `readme.html`,
`readme.html` wins: it describes what's built.

#160 (questions 2's fill-in-the-blank proposal) leaves Q11 to users: what
a saved Submit (or Skip) keeps for a question whose `kind` isn't
`"code"`. This plan answers it. Facts were read from `master` at
`cf90d5d` unless marked as a guess.

## What's decided already (#160, owner, 2026-11-08)

- **Q3**: a question's `kind` field; absent means `"code"`. A fill-in
  question has `template`, `blank` and `judge`, and its languages are its
  template's keys, so the (question, language) pair model stays.
- **Q5**: each kind defines its own answer, e.g. `{ "blank": "'" }`. A
  `"code"` question's answer **stays `code`**, in requests and records.
- **Q9**: a wrong form is `Wrong Answer` plus the judge's message; a
  fill-in result leaves out `passed` and `total`.
- **Q6b, Q10**: a judge returns `{ pass, message?, hints? }`; only the
  server turns `pass` into `Accepted` or `Wrong Answer`.
- **Q9a**: a judge that throws records nothing. So there's no record for
  that case.

## Records today (version 3)

`routes.js`'s `submissionRecord` writes, for every Submit or Skip
(`users.js`, the `SubmissionRecord` type):

`schemaVersion` (3), `submittedAt`, `question`, `questionSha256`,
`language`, `judgeMode`, `code`, `skipped` (Skips only), `status`,
`passed`, `total`, `runtimeMs`, `elapsedMs`, `results`, `stdout`,
`stderr`.

Who reads them, and what each needs:

| Reader | Reads | Fill-in needs |
|---|---|---|
| Consistency check 6, `consistency.js:34-40, 123-132` | `submittedAt`, `question`, `language`, `status`, `skipped` | nothing: `status` is `Accepted` or `Wrong Answer` (Q9) |
| `make recalculate-queue`, `recalculate.js:121` | `status`, `skipped` (through `passFor`) | nothing, as above |
| `readSubmission`, `users.js:142` | parses the JSON; checks no field and no version | nothing |
| The Submissions list, `routes.js:573` (`toSubmissionSummary`) | `status`, `passed`, `total`, `runtimeMs`, `elapsedMs`, `skipped` | the kind, so the page knows how to show the line |
| The Submissions tab, `problem-page.js:1879-1880` | `${s.passed}/${s.total}`, `${s.runtimeMs} ms` with **no check** | a check: today a fill-in line would read "Wrong Answer · null/null" |
| "Load into editor", `problem-page.js:1989-2010` | `record.code` into the editor | the fill-in page puts `answer.blank` back in the box instead |
| The Learning/Applying tab rule, `problem-page.js:1811` | `skipped` only | nothing |

No reader checks `schemaVersion`. It records when a field appeared, for
people and for code that wants to know.

## The proposal: version 4

A version 4 record is version 3 with these changes. Version 1 to 3
records stay as they are: nothing is rewritten.

1. **`kind`**, always written: `"code"` or `"fill-in"` (D2).
2. **The answer**: for `"code"`, `code` as today (Q5). For any other
   kind, **`answer`**: the kind's answer object exactly as the request
   sent it, e.g. `{ "blank": "\\'" }`, and **no `code`** (D1).
3. **`judgeMode`** only for `"code"`, where it means something.
4. **What a fill-in judge doesn't produce is `null`**: `passed`,
   `total`, `runtimeMs`, `stdout` and `stderr`; `results` is `[]`. A
   Skip already does this, so readers handle it (D4).
5. **`message` and `hints`**, when the judge gives them (D3): so the
   Submissions tab can show, later, why a fill-in answer failed.
6. **A Skip of a fill-in question** keeps what the box held as
   `answer`, as a Skip of a code question keeps the editor's text.

An example, a failed fill-in Submit:

```json
{
  "schemaVersion": 4,
  "submittedAt": "2026-11-10T18:04:11.512Z",
  "question": "single-quote-in-double-quotes",
  "questionSha256": "…",
  "language": "python",
  "kind": "fill-in",
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
- **D2. `kind` in the record.** Decided: (a).
  - (a) **Always written in version 4** (recommended). A record says
    what it is without its question file, which may change kind later
    (`questionSha256` already shows a file changed, but not how).
  - (b) Only for kinds other than `"code"`. Shorter, but a reader has to
    know that absent means code, as with `skipped`.
- **D3. The judge's `message` and `hints`.** Decided: (a).
  - (a) **Kept** (recommended): the learner can see later why a fill-in
    answer failed, as a code answer's `stderr` shows why it failed.
  - (b) Not kept: the verdict only.
- **D4. Fields a fill-in judge doesn't produce.** Decided: (a).
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

## What users builds, once decided and once questions' side is in

- `routes.js`: `submissionRecord` writes version 4 by kind;
  `toSubmissionSummary` passes `kind` (and `message`, under D3(a)).
- `users.js`: the `SubmissionRecord` type, with `code` optional and
  `kind`, `answer`, `message`, `hints` added.
- `problem-page.js`: the Submissions tab shows counts and time only when
  they're numbers (the result line already checks, `:1605-1607`), and the
  message under D3(a); "load" puts a fill-in answer back in the box, and
  refuses a record whose kind isn't the question's.
- `readme.html`, "Where data lives"; `routes.test.js` for both kinds.

## What it sets up, and rules out

- **A new kind adds one `answer` shape**, not a new record version,
  unless it needs fields of its own.
- **Deploying it changes what's stored on disk**, so the guarded deploy
  stops for infrastructure and security first (`docs/deploy-vps.md`,
  "Updating: the guarded deploy", step 1).
- **Going back to an older server after fill-in records exist** (a
  guess, not tried): its Submissions tab would show "null/null" for them,
  and loading one into the editor would find no `code`. No queue or
  check is affected, since `status` is a normal verdict. An older server
  can't show a fill-in question at all, since questions' format check
  refuses unknown kinds.

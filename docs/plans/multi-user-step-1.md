# Plan: multi-user step 1 — record each Submit under `users/<email>/`

Status: **done 2026-10-29.** Steps 0, 1, 2 and 4 are built (readme updated with each, so step 3 was folded in).
Started 2026-10-29. Linked from `readme.html` → Decisions & plans.

## Already decided (2026-10-29)

- Each user's directory is named by email address: `users/daniel.pflager@gmail.com/`.
- `users/` is committed to git. The repository is public, so this data is
  public, and that's fine. **Changed 2026-10-30:** `users/` is now gitignored
  and the owner manages it by hand, for testing.
- The submitted code is stored.
- Only Submit is recorded (not Run, not Skip).
- nodemon ignores `users/` (`package.json` → `nodemonConfig`), so saving a
  record doesn't restart `make dev`.

## How Submit works today

1. `problem-page.js` → `execute('submit')` POSTs `{language, code}` to
   `/api/questions/:slug/submit` (`/api/problems/…` until 2026-10-29).
2. `server.js` → `handleExecution` loads `questions/<slug>.json`, validates the
   body, and calls `runSubmission` (`judge/runner.js`).
3. The judge returns `{status, passed, total, runtimeMs, stdout, stderr, results}`.
   `status` is one of `Accepted`, `Wrong Answer`, `Runtime Error`,
   `Compile Error`, `Time Limit Exceeded`.
4. The page shows the result, and nothing is kept once the tab is closed.

Step 1 adds one thing between 3 and 4: **write a record to disk**.

## Change 2026-10-29 (owner's request, after step 1)

Records are saved directly in `users/<email>/submissions/<timestamp>.json`,
not in a folder per question. The `question` field inside each record says
which question it was. Effect on step 2: listing one question's submissions
means reading the folder and filtering on `question`. That's fine at this size,
and the files are going to be replaced anyway. Saving uses `link()` instead of
`rename()`, so a collision between two Submits in the same millisecond fails
with a warning rather than overwriting.

## Decisions made 2026-10-29 (second round)

- **D1 layout:** A, one JSON file per Submit. The owner plans to replace
  file-based storage with something better later, so this only has to be simple.
- **D2 record:** `schemaVersion`, `submittedAt` (UTC), `question`,
  `questionSha256`, `language`, `judgeMode`, `code`, `status`, `passed`,
  `total`, `runtimeMs`, `results` (pass/fail per test), **`stdout` and `stderr`
  kept**. No `user` field: the directory name already says who it is.
- **D3 identity:** A, a server setting (`MAXRECALL_USER`, defaulting to
  `daniel.pflager@gmail.com`). It's only the owner for now.
- **D4 committing:** A, the owner commits `users/` by hand.
- **D5 scope:** steps 0–3; the Submissions tab is a later step.

The options as they were presented are kept below for the record.

## Options considered

### D1. File layout

| Option | Layout | For | Against |
|---|---|---|---|
| **A. One JSON file per submission** (recommended) | `users/<email>/submissions/<slug>/<timestamp>.json`, with the code inside the JSON | Each Submit creates a new file and never edits an old one, so commits from the cloud and from Kubuntu can't conflict. One file means one write, which is easy to make all-or-nothing. | The code is stored as a JSON string, so on GitHub it reads as one long line with `\n` in it. Over time there will be many small files. |
| B. One append-only log per problem | `users/<email>/<slug>.jsonl`, one line per Submit (JSON Lines) | Fewer files, and a problem's whole history is in one place. | If both machines add a line, git sees two edits to the end of the same file, which is a merge conflict. |
| C. Like A, with the code in its own file | `…/<timestamp>.json` plus `…/<timestamp>.py` (or `.cpp`, …) | The code is readable and syntax-highlighted on GitHub and in WebStorm. | Two files per Submit, so a crash between the two writes leaves half a record. More code to keep the two files in step. |

Recommendation: **A**. If you want to read old code on GitHub, C is the
next best choice.

File names: an ISO-8601 UTC time with `:` replaced by `-`, e.g.
`2026-10-29T03-10-00.123Z.json`. Windows doesn't allow `:` in file names
([Microsoft: Naming Files](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)),
and this keeps the repo usable there. Sorting by name also sorts by time.

### D2. What each record contains

As decided (layout A):

```json
{
  "schemaVersion": 1,
  "submittedAt": "2026-10-29T03:10:00.123Z",
  "question": "two-sum",
  "questionSha256": "<hash of questions/two-sum.json at the time of the Submit>",
  "language": "python",
  "judgeMode": "function",
  "code": "def twoSum(nums, target):\n    ...",
  "status": "Wrong Answer",
  "passed": 3,
  "total": 5,
  "runtimeMs": 41,
  "results": [true, true, true, false, false],
  "stdout": "",
  "stderr": ""
}
```

- `schemaVersion`: lets later code read old records after the format changes.
- `problemSha256`: problem files get edited (test cases added, wording fixed).
  The hash shows whether two records were judged against the same version.
  It uses Node's built-in `crypto.createHash('sha256')`
  ([Node docs](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)).
- `results` keeps one pass/fail value per test case and leaves out the
  inputs, expected values and outputs. Those are already in
  `questions/<slug>.json`, so storing them again would be repetition.
- **Left out: `stdout` and `stderr`.** They can be large, for example from a
  print in a loop, and they add a lot of noise to git.

Decided: keep them.

### D3. How the server knows who the user is (no login yet)

| Option | How | For | Against |
|---|---|---|---|
| **A. Server setting** (recommended) | `MAXRECALL_USER` environment variable, defaulting to `daniel.pflager@gmail.com` | Nothing from the browser goes into a file path, so a path traversal attack has nothing to work with. Small. | Only one user per running server, which is all step 1 needs. |
| B. Browser sends it | The page sends `user` in the request body | Closer to multi-user. | Anyone who can reach the server can write into anyone's folder. Needs checking, and without login it means nothing anyway. |

The value from A is still checked: lower-cased, then matched against a strict
pattern such as `^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$`. If it doesn't match,
the server refuses to start.

### D4. Who commits `users/`

| Option | For | Against |
|---|---|---|
| **A. You, by hand** (recommended for now) | No surprises, and you choose when and how to describe it. | Easy to forget. Records only reach the other machine after you commit and push. |
| B. The server runs `git commit` after each Submit | Nothing is forgotten. | A commit per Submit clutters history. The server would need git and a configured identity, and would have to handle a failed commit. Pushing automatically is riskier still. |
| C. A `make` target, e.g. `make save-results` | One command does `git add users && git commit`. | You still have to remember to run it. |

Note: you practise on Kubuntu, not in the cloud. The cloud has no browser, and
a cloud container is thrown away with any uncommitted `users/` data.

### D5. What step 1 includes

Proposed: steps 0–3 below, with the Submissions tab as step 4, later. Or should step 1 stop at 2?

## Steps (each one small and checkable)

**Step 0: fix the path check first.** `loadProblem` checks
`file.startsWith(QUESTIONS_DIR)`, which has no trailing separator. I tested it on
2026-10-29: `GET /api/problems/..%2Fquestions-evil%2Fx` returned a file from a
sibling directory `questions-evil/`. The new `users/` code needs the same kind of
check, so write a single helper, `resolveInside(baseDir, ...parts)`. It uses
`path.relative` ([Node docs](https://nodejs.org/api/path.html#pathrelativefrom-to))
and rejects any result that starts with `..` or is absolute, and both
`questions/` and `users/` use it. Check: the same `curl` returns 404.

**Step 1: write a record on Submit.** Add a small module (e.g. `users.js`) with
`saveSubmission(record)`. It writes the file under a temporary name in the same
directory, then renames it into place. POSIX `rename` is atomic, so a reader
sees either the whole file or no file at all
([POSIX rename()](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html)).
`handleExecution` calls it only for `submit`, after judging.
- **If saving fails, the learner still sees their result.** The response gets
  `saved: false` and `saveError`, and the page shows a warning. A judged result
  is never thrown away because the disk write failed.
- **If it succeeds, the response gets `submissionId`** (the timestamp part of
  the file name).

Check: Submit in the browser, then `ls users/*/submissions/` and open the new file.

**Step 2: read endpoints.**
**As built (2026-10-29), replacing the two bullets below:** submissions are
top-level, matching the flat folder: `GET /api/submissions` (optionally
`?question=<slug>`) and `GET /api/submissions/:id`. The API itself moved from
`/api/problems` to `/api/questions` the same day.

- `GET /api/problems/:slug/submissions` returns the current user's records,
  newest first, without `code`.
- `GET /api/problems/:slug/submissions/:id` returns one record, including `code`.
  `:id` must match the timestamp pattern exactly before it gets anywhere near a path.

Check with `curl`.

**Step 3: readme.html.** Update §3 (Layout), §4 (API), §8 (Where data lives)
and §11 (Decisions) in the same commits as steps 0–2, as `CLAUDE.md` requires.

**Step 4 (later): Submissions tab.** List the records from step 2 in the tab
that currently says "Coming Soon", and let a past submission's code be loaded
back into the editor.

## What this sets up, and rules out

- **Hard problems coming back more often** (from `TODO`) can be built from
  these records: number of failed Submits, time to first Accepted, time since
  the last Submit. Without Run data, it can't count the attempts made before
  a Submit.
- **Hidden test cases are already public.** They're in `questions/*.json` in a
  public repo. Records don't make that worse. It only matters if the site is
  ever hosted for learners who would look.
- **Real multi-user** (login, many folders) will mean replacing D3-A with a
  logged-in identity. The `resolveInside` helper and the email check from step 0
  and D3 carry over unchanged.
- **The stored code is not run again.** It's stored data only, so storing it
  doesn't add to the existing "submitted code is not sandboxed" gap.

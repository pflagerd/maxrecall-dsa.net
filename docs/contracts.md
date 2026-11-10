# Contracts between roles

Where one role's files depend on another's: what crosses the boundary,
who uses it, and what they rely on. Owned by the architect
(`docs/roles/architect.md`); changed only with the affected roles'
agreement or the human's approval.

## How to read and use this file

- **Provider**: the role whose files define it. **Used by**: the roles
  whose files rely on it.
- **What crosses** names things, not their types. Each function's
  signature is its JSDoc in the provider's file, checked by
  `make typecheck`; this file doesn't copy it, so there's nothing here to
  drift from it.
- **Relied on** is what would break them if it changed, including
  what no type checker sees (strings matched by value, paths, ports).
- **Changing one**: a provider that wants to change something listed
  here, or a role that wants to start relying on something new from
  another role, writes it as a request in its handoff. The architect
  routes it; the change goes in once the roles using it agree or the human
  approves, with this file updated in the same pull request.
- **Checking**: each architect session (step 2, "contract drift")
  compares every `require` that crosses roles, and the strings and paths
  below, with this file, and the browser globals and element ids of
  sections 10 and 11, and that `server.js` still mounts the router as
  section 9 says.

## 1. The judge's sandbox and queue

Provider: infrastructure and security (`judge/sandbox.js`,
`judge/cgroups.js`, `judge/queue.js`). Used by: questions
(`judge/runner.js`).

- **What crosses**: from `judge/sandbox.js`, `SUBMISSION_ENV`,
  `RUN_LIMITS`, `CPU_LIMIT_EXIT_CODE`, `HELPER_DIR`,
  `HELPER_SANDBOX_PATH`, `findOnPath`, `sandboxStatus`, `sandboxedRun`,
  `spawnSandboxed`, `prepareWorkDir`, `assertJudgingAllowed`; the whole of
  `judge/cgroups.js`; `withJudgeSlot` from `judge/queue.js`.
- **Relied on**:
  - `assertJudgingAllowed()` throws `SandboxUnavailableError` unless the
    sandbox works or `MAXRECALL_UNSANDBOXED=1`.
  - `withJudgeSlot(task)` runs at most `MAX_RUNNING` at once and rejects
    with `JudgeBusyError` once `MAX_WAITING` are waiting.
  - The two errors' `code` values, `'SANDBOX_UNAVAILABLE'` and
    `'JUDGE_BUSY'`, and `JudgeBusyError`'s `retryAfterSeconds`: see
    section 2.

## 2. Judging, for the server and the sandbox test

Provider: questions (`judge/runner.js`; `judge/fill-in-the-blank.js`
for fill-in-the-blank questions). Used by: users (`routes.js`;
`routes.test.js`, through a real `node server.js`); infrastructure and
security (`judge/sandbox-selftest.js`).

- **What crosses**: `runSubmission`; `judgeFillInTheBlank` (from
  `judge/fill-in-the-blank.js`, since PR 197) and `judgeSha256Of` (PR
  208, for records version 4, PR 209); for the sandbox test also
  `TIMEOUT_MS` and `CPP_COMPILE_TIMEOUT_MS`. (`server.js`'s start-up log
  uses `describeSandbox`, `MAX_RUNNING` and `MAX_WAITING`, but since the
  split both sides of that are infrastructure and security's.)
- **Relied on**:
  - `runSubmission(submission)` gives a `JudgeResult`, and judges through
    the real sandbox and queue: the sandbox test submits hostile code
    through it to prove the sandbox holds.
  - `routes.js` answers 503 for an error whose `code` is
    `'SANDBOX_UNAVAILABLE'` or `'JUDGE_BUSY'`, and sets `Retry-After` from
    `retryAfterSeconds` for `'JUDGE_BUSY'`; `'JUDGE_FAILED'` (a fill-in-the-blank
    judge that failed, below) gets the generic "couldn't judge" answer;
    anything else is a 500. It matches the strings, not the classes:
    renaming a code passes `make typecheck` and turns every busy judge
    into a 500.
  - `routes.test.js` matches a `JudgeResult`'s `status` values
    `'Accepted'` and `'Wrong Answer'` as strings, and reads its `total`
    and `results` (a Test's answer). Renaming a status fails `make test`
    (section 4 has the questions it judges).
  - `judge/sandbox-selftest.js` matches `status` values as strings too,
    the same three in seven places (2026-11-08; the reliance was there
    already, and only this item is new):
    - `'Accepted'`: G7's ESCAPED, the C++ submission that includes the
      owner-only canary header compiled (line 491); G9 counts the
      Accepted results of its concurrent judgings (683).
    - `'Compile Error'`: G7's contained, with the compiler's own
      complaint about the header (498); G10's contained, the compile
      stopped at its time limit (717), and its skipped, GCC's own
      `constexpr` limit ended it first (731).
    - `'Time Limit Exceeded'`: an after-timeout orphan probe really ran
      (461); G6d, where the wall clock stopped it: skipped on few cores,
      ESCAPED on enough cores that the CPU-time limit should have (530).

    Renaming one of them still passes `make test`, which doesn't run the
    self-test. `make sandbox-test`, run by hand, then fails with those
    probes inconclusive: G7 and G6d can no longer report ESCAPED, and
    G9 counts no Accepted judgings. (Infrastructure and security found the four
    places the first version of this item missed.)
  - **Fill-in-the-blank questions** (#160; decided 2026-11-08, built 2026-11-09). What
    users rely on when the question's `kind` is `"fill-in-the-blank"`:
    - **The answer** is the kind's own object, `{ blank }`; a `"code"`
      question's answer stays `code`, unchanged.
    - **Users' routes check it first**: `blank` must be a string
      (`typeof`, since `express.json()` would pass an array or
      `{ length: 1 }`) no longer than the question's `maxLength`
      (`.length`, which counts UTF-16 units as HTML's `maxlength` does),
      and the answer may have no field but the kind's own (for fill-in-the-blank,
      only `blank`; #160's Q12, owner, 2026-11-08). Anything else is
      refused before questions' judging is called, and nothing is
      recorded for it. Questions' judging may rely on all of this.
    - **`judgeFillInTheBlank(question, answer, language)`** is what
      users' routes call (users' request, 2026-11-09). It's
      **synchronous**, and returns `{ status, message?, hints? }` (its
      `FillInTheBlankResult`). For a judge that fails it throws
      `JudgeFailedError`, code `'JUDGE_FAILED'`, having **logged the
      details itself**, so users logs nothing more for that code. For a
      question that isn't fill-in-the-blank, or an answer the route
      should have refused, it throws a `TypeError`, a caller's mistake,
      which users answers as a plain 500.
    - **`judgeSha256Of(question)`** (users' request, 2026-11-09) returns
      the hex SHA-256 of the question's judge file **as it was loaded**:
      the bytes of the code that judges, even if the file changed on disk
      since (`require` caches it until the server restarts). It loads the
      judge if need be, and throws `JudgeFailedError`, code
      `'JUDGE_FAILED'`, if it can't. Users calls it only for a Submit,
      after `judgeFillInTheBlank`, and answers its throw as a failed
      judging (500 "couldn't judge", nothing recorded, no queue change).
      A Skip doesn't call it: its record's `judgeSha256` is `null`
      (owner, 2026-11-09, option A), so a judge that won't load can't
      block a Skip.
    - **The result's `status`** is `'Accepted'` or `'Wrong Answer'`,
      mapped from the judge's `pass` in one place in questions' code; no
      judge names a status. It adds `message` and `hints`, the judge's,
      which users' page shows as text, never as HTML. It leaves out
      `passed` and `total`, which the page would print as "0/1 test cases
      passed".
    - **A judge that fails** (throws, or returns something other than
      `{ pass, message?, hints? }`) gives a distinct "couldn't judge"
      outcome, not a status: users record nothing, change no queue, and
      show only "We couldn't judge this answer; it wasn't recorded." The
      details go to the server's log, never to the page. Questions'
      judging throws it as a `JudgeFailedError` whose `code` is
      `'JUDGE_FAILED'`, as the queue throws `JudgeBusyError`
      (`'JUDGE_BUSY'`); users' routes match the string (owner, 2026-11-08,
      #160 step 3).

## 3. The Test button's rules

Provider: questions (`playtest.js`). Used by: users (`routes.js`, which
has the route).

- **What crosses**: `canTestQuestions`, `revealHidden`, `markRevealed`.
- **Relied on**: only the owner may Test (`canTestQuestions`);
  `revealHidden` returns copies, so the question file isn't changed.
  Recording nothing for a Test is `routes.js`'s side of it.

## 4. The question bank

Provider: questions (`question-files.js`, `questions/**`). Used by: users
(`routes.js`, `scripts/backlog.js`, `scripts/learner-create.js`,
`scripts/recalculate-queue.js`, `scripts/consistency-check.js`;
`routes.test.js` and `scripts/characterize.js`, which use three real
questions as fixtures, below).

- **What crosses**: `QUESTIONS_DIR`, `isQuestionFile`, `questionInfos`,
  `RENAMES_FILE`, `readRenamesText`, `kindOf`,
  `fillInTheBlankMaxLength`, `REPO_QUESTIONS_DIR` (PR 198); and the
  files themselves.
- **Relied on**:
  - A question's slug is its file name without `.json` (spaced-repetition
    plan, D1). Learners' `order.json` and `backlog.json` store slugs, so
    renaming a file means `make rename-question` (section 5), never a
    plain `git mv`.
  - The problem file format, `readme.html` section 5, in particular
    `created`, `title`, `difficulty`, `topics`, `sources`,
    `alreadyLearned` and the languages of `starterCode`, which
    `questionInfos()` passes on.
  - **`kind`, what type of question it is** (#160; decided 2026-11-08,
    built 2026-11-09): `"code"` (every question so far) or `"fill-in-the-blank"`.
    - An absent `kind` means `"code"`, filled in by one function in
      `question-files.js` that every reader calls, so no file needs
      editing and no record's `questionSha256` changes. That function
      is **`kindOf(question)`**: it returns the `kind` field, or
      `"code"` when it's absent, and doesn't check it (an unknown kind
      passes through; users sends such a question only the fields
      common to every kind; users' request, 2026-11-09).
    - Each kind has its own fields: `"code"` today's (`starterCode`,
      `judgeMode`, `testCases` and the rest); `"fill-in-the-blank"` has
      `template`, `blank` and `maxLength` (default 10, and at most 100:
      `make test` refuses more, #160's Q15, owner, 2026-11-08, so no one
      question file can lift the limit users' routes check).
      **`fillInTheBlankMaxLength(question)`** returns `maxLength`, or the
      default, 10, when it's absent: users' routes check a `blank`'s
      length against it. `blank` is
      the marker text that stands for the blank in each language's
      `template` (e.g. `"___"`); `make test` checks that it occurs exactly
      once in each (owner, 2026-11-08, #160 step 3). `make test` refuses
      an unknown kind, and another kind's fields.
    - Every kind declares its languages (a fill-in-the-blank question's are its
      `template`'s keys), so users' `{ question, language }` pairs hold.
    - **A fill-in-the-blank question's judge is a file beside it**,
      `questions/<slug>.judge.js`, questions' (its rules:
      `docs/roles/questions.md`, "Judge files"). `questionInfos()` lists
      only `.json` files, so a judge is never taken for a question.
      `make rename-question` and `make delete-question` are to move or
      remove it with its question (today they handle only the `.json`,
      `scripts/question-admin.js`). Users' records hash it as
      `judgeSha256` (#168),
      so they rely on that path.
    - **Never sent to the browser**, whatever a kind's public view says:
      for `"code"`, the hidden test cases (`toPublicProblem` sends
      `visibleTestCases` and `hiddenCount` in place of `testCases`); for
      `"fill-in-the-blank"`, nothing of its judge (the file, its source, its cases).
      **Each kind's public view is users'** (owner, 2026-11-08): an
      allow-list in `routes.js`, replacing `toPublicProblem`'s deny-list,
      within these never-sent fields. Questions adding a field to a kind
      says here whether it may be sent; users' list sends only what it
      names, so a field left off is missing from the page, not leaked.
  - `difficulty`'s values, matched as strings: `Fundamentals` (below
    Easy, for language features; #93), `Easy`, `Medium`, `Hard`. Users'
    pages make it the CSS class `difficulty-<value in lowercase>`
    (`problems-list.js`'s `difficultyClass`, `problem-page.js`), and
    `style.css` colours `difficulty-fundamentals`, `-easy`, `-medium` and
    `-hard`. Another new value passes `make test` once
    `question-files.js` allows it, and shows as an uncoloured badge
    until `style.css` has a rule for it: users' rule merges first.
  - `alreadyLearned` (optional; #89, direct prerequisites only since
    #91): `questionInfos()` passes it on (#146), and users' `order.js`
    (`dependencyOrder`, through `allowedPairs`) puts each question of an
    `"all"` backlog after the ones it names; `prerequisiteWarnings`
    (#161, for `make learner-create` and `make backlog-add`) warns when a
    chosen backlog puts a question before one it names, or leaves one
    out. Both rely on an array of slugs; an entry naming no question is
    ignored, and a missing field means "builds on nothing". They rely on
    `checkQuestion` refusing a loop only for the order to mean anything:
    a loop loses no pair (its questions are appended in creation order;
    `order.test.js`). Not relied on: entries being direct prerequisites
    only, or having no duplicates (the same order either way; a
    duplicated entry repeats a warning line). It also reaches the
    problem page (it's in the public view's allow-list in `routes.js`,
    #178, #180), where nothing of users' reads it yet; #88's links
    would be a further change to this contract.
  - `questions/renames.json`, the rename log, is questions' file but
    users' `consistency.js` parses it (`parseRenames`, `updateRenames`):
    its format is part of this contract both ways.
  - **One type crosses the other way**: questions' `question-files.js`
    builds `QuestionListing`, what `questionInfos()` returns, on users'
    `QuestionInfo` from `order.js` (`import('./order').QuestionInfo &
    Pick<…>`, its `@typedef`; since #112). A type only, nothing at run time,
    but it ties the two in `make typecheck`: renaming or moving
    `QuestionInfo` fails questions' check. A field that `questionInfos()`
    starts passing on must be in `QuestionListing`, or questions' change
    fails with TS2353: either in users' `QuestionInfo` (then users'
    change merges first) or in questions' own `Pick<QuestionFile, …>`,
    with `QuestionFile` declaring it (then no change of users' is
    needed). #146's `alreadyLearned` takes the second way, so its two
    pull requests merge in either order (questions' and users' findings,
    2026-11-08).
  - **Three questions are users' test fixtures** (questions' finding,
    users agreeing, 2026-11-07). `routes.test.js` (in `make test`) judges
    through a real server, which reads the real `questions/`:
    `QUESTIONS_DIR` is fixed, unlike the users and auth folders the test
    overrides. It relies on:
    - `two-sum`: exists; Python's `functionName` is `two_sum` and
      JavaScript's `twoSum`; the test's hash-map solutions in both are
      Accepted and `return [0, 0]` in Python is Wrong Answer; at least
      one test case is `hidden` (the test reads the file to count them).
      Run, Test, Submit and Skip are tested on it.
    - `hello-world`: exists, in Python and JavaScript.
    - `valid-parentheses`: exists, in Python.

    So renaming or deleting one of them, dropping one of those
    languages, changing a `functionName` or what's judged right, or
    leaving `two-sum` without a hidden case fails `make test` though
    nothing of users' is wrong: agree it with users first, through the
    architect. Wording, the Learning tab, and test cases the two
    solutions still pass are free; run `node --test routes.test.js`
    after editing one of the three. `scripts/characterize.js` (by hand,
    `make characterize`) snapshots answers for `two-sum` (Run, Test,
    Submit, Skip) and `hello-world`, so an edit to either between a
    refactor's two snapshots shows as a difference that isn't the
    refactor's. Fixture questions of the tests' own would free the real
    bank. **The way now exists** (PR 198; owner, 2026-11-09, option (A)):
    `MAXRECALL_QUESTIONS_DIR`, read once by `question-files.js`, moves
    `QUESTIONS_DIR` (and so where judge files load from) to a test folder.
    `REPO_QUESTIONS_DIR` always names the repository's `questions/`.
    `make test`'s `questions.test.js` and `make rename-question`/
    `delete-question` ignore or refuse the variable, and the live service
    never sees it: its unit unsets it
    (`UnsetEnvironment=MAXRECALL_QUESTIONS_DIR`,
    `deploy/maxrecallcode.service:56`), and `docs/deploy-vps.md` checks
    that after each deploy (infrastructure and security, PR 217). Users' tests moving
    to their own fixtures is users' work, not yet done.

## 5. A learner's files, for deleting and renaming questions

Provider: users (`users.js`, `order.js`, `consistency.js`). Used by:
questions (`scripts/question-admin.js`).

- **What crosses**: `listUsers`, `readUserFile`, `writeUserFile`;
  `parseQueueFiles`, `removeReferences`, `renameReferences`;
  `parseRenames`, `updateRenames`.
- **Relied on**: the formats of `users/<email>/order.json` and
  `backlog.json` (`readme.html` section 8). `make delete-question` and
  `make rename-question` read every learner's files first and refuse if
  any is invalid, then write `backlog.json` before `order.json`.

## 6. Helpers for admin scripts

Provider: questions (`scripts/question-admin.js`). Used by: users
(`scripts/backlog.js`, `scripts/learner-create.js`,
`scripts/recalculate-queue.js`).

- **What crosses**: `Refusal`, `checkName`, `refuseIfServerRunning`.
  Written for `question-admin.js` (spaced-repetition step 11) and reused
  by later scripts; left where they are (owner, 2026-11-05).
- **Relied on**:
  - `Refusal`: an `Error` meaning "stopped, nothing changed"; a script
    catches it, prints `Refused: <message>` and exits with status 1
    (e.g. `scripts/backlog.js`), and lets any other error through.
  - `checkName(variable, name)`: the rule for a question name, lowercase
    letters and digits joined by single hyphens (`NAME_PATTERN`). It's a
    questions rule that users' scripts apply to the slugs they're given.
  - `refuseIfServerRunning()`: refuses if a server answers on
    `127.0.0.1` at `$PORT` (default 3000) or `$TRUSTED_PORT`.
- Questions asks users before changing any of the three.

## 7. Paths, and who the users are

Provider: infrastructure and security (`paths.js`). Used by: users
(`routes.js`, for `loadProblem`; `users.js`); questions (loading a
fill-in-the-blank question's judge file, #160, built 2026-11-09: only by a known
fill-in-the-blank slug, through `resolveInside`, since a `require` of a chosen path
runs code; "inside" is inside `QUESTIONS_DIR`, which
`MAXRECALL_QUESTIONS_DIR` may move to a test folder, PR 198). And the other way: users
(`users.js`) provides `EMAIL_PATTERN` to `auth.js`, and `OWNER_EMAIL` and
`USERS_DIR` to `server.js` (infrastructure and security).

- **What crosses**: from `paths.js`, `resolveInside`; from `users.js`,
  `EMAIL_PATTERN`, `OWNER_EMAIL`, `USERS_DIR`; from `auth.js`,
  `createInvite`, for users' `routes.test.js` and `scripts/characterize.js`
  only (#106). (`auth.js`'s
  `register`, `login`, `sessionEmail` and the rest are used only by
  `server.js` since the split: both infrastructure and security's.)
- **Relied on**:
  - `resolveInside(baseDir, ...parts)` gives `null` for anything outside
    `baseDir` (path traversal), and for `baseDir` itself.
  - `EMAIL_PATTERN` is the one definition of an email this app accepts,
    for registering and for a learner's folder name alike.
  - `OWNER_EMAIL` is who the trusted listener's requests are
    (`server.js`), and who may Test (`routes.js`, through
    `canTestQuestions`): the same person in both.
  - `USERS_DIR` is where learners' files are; `server.js` only names it in
    its start-up log.
  - `createInvite(email)` resolves to an object with the invite's `code`,
    and writes under `MAXRECALL_AUTH_DIR` when that's set. Both of
    users' files call it in a child process, through `require('./auth')`
    **inside a `node -e` string** (each one's `makeInvites`), so a
    `require` scan doesn't find it: search for `'./auth'` as text too.

## 8. The sign-in routes and ports (retired)

**Retired 2026-11-05**, when `server.js` went to infrastructure and
security (`docs/plans/server-split.md`, step 4): the routes, the pages
that call them, nginx and the service file are now all that role's, so
this is no longer between roles. Kept, not renumbered, since other
documents name contracts by number; what follows is what that role
relies on within its own files.

Provider and user: infrastructure and security (`server.js`;
`login-page.js`, `account.js`, `deploy/nginx-maxrecallcode.conf`,
`deploy/maxrecallcode.service`).

- **What crosses**: the paths `/api/auth/register`, `/api/auth/login`,
  `/api/auth/logout`, `/api/auth/me`; the environment variables `PORT`
  and `TRUSTED_PORT`.
- **Relied on**:
  - The sign-in page posts to `/api/auth/login` and `/api/auth/register`,
    and every page asks `/api/auth/me`; `account.js` posts
    `/api/auth/logout`.
  - nginx rate-limits `location = /api/auth/login` and
    `location = /api/auth/register` by exact path, with two limits each
    since D3 (#82): per visitor (`maxrecall_signin`) and site-wide
    (`maxrecall_signin_all`). Renaming either route silently drops both.
  - `server.js` listens on `PORT` (sign-in) and `TRUSTED_PORT` (no
    sign-in, the SSH tunnel only), which the service file sets to 3000
    and 3001.

## 9. The router behind the gate

Provider: infrastructure and security (`server.js`, the sign-in layer).
Used by: users (`routes.js`, the feature routes). And the other way:
users provides `router` and `start` to `server.js`.

Since the split (#76, `docs/plans/server-split.md`), `server.js` holds
only the sign-in layer and is infrastructure and security's. Before it,
users owned all of `server.js`, and this contract was a review rule
(owner, 2026-11-05): a users change to the sign-in layer was reviewed by
infrastructure and security. That review is what #76 itself had.

- **What crosses**: from `routes.js`, `router` (an Express Router) and
  `start`; from `server.js`, `req.userEmail` and the `AppRequest`
  typedef, which `routes.js` takes as `import('./server').AppRequest`, a
  type only: `routes.js` never `require`s `server.js`.
- **Relied on, by users** (`server.js`'s side):
  - `server.js` mounts `router` after the gate and before the 404 for any
    other `/api/` URL (`app.all('/api/*', …)`), `STATIC_FILES` and the
    fallback to `index.html`. So the router sees only requests that have
    passed the gate, with `req.userEmail` set from a live session or the
    trusted listener, and the JSON-only rule for `POST` and `PATCH`
    already applied.
  - `server.js` requires `routes.js` before its other local modules, so
    modules load in the order they did before the split, and calls
    `start()` once, just before `app.listen`.
- **Relied on, by infrastructure and security** (`routes.js`'s side):
  - `routes.js` registers its routes when it's required, all under
    `/api/`, and does nothing else that decides who may see what: no
    `router.use`, `all` or `param`, no file serving (`sendFile`,
    `express.static`), no cookies, and it never assigns `req.userEmail`.
    What's public (`PUBLIC_PATHS`), what's served (`STATIC_FILES`) and who
    a request is from stay `server.js`'s.
  - `start()` does users' start-up work, `prepareQueues()` and
    `logConsistency()`, and loading the module starts nothing else.
    **It may throw**, before any of that and so before `app.listen`
    (PR 204; owner, 2026-11-09, option B2): when `MAXRECALL_QUESTIONS_DIR`
    names a test question bank and the users folder has no `TEST-USERS`
    file (`users.js`, `testBankRefusal`), since a test bank would
    otherwise be filled into real learners' backlogs. `server.js` calls
    it bare (`server.js:364`), so the throw ends the process, by design;
    under systemd's `Restart=always` it would restart until the
    start-rate limit stops it (a guess from systemd's defaults, not
    tested). The live service never sets the variable (infrastructure
    and security).
  - A new page or file to serve is a request to infrastructure and
    security to add it to `STATIC_FILES`.
- **Checking it** (owner, 2026-11-06, #106; both users'):
  - `routes.test.js`, in `make test`, asserts both sides through a real
    `node server.js`: the gate (signed out, 401 for every feature route),
    `PUBLIC_PATHS`, `STATIC_FILES`, the JSON-only rule, the trusted port,
    the `/api/*` 404, and that `start()` ran. Its gate test fails with
    the router mounted in front of the gate (one of #106's seven
    deliberate breaks).
  - `scripts/characterize.js`, by hand: a snapshot of 244 requests and
    the log, before and after a refactor meant to change nothing, then
    `diff`. It was the code block in
    `docs/session-handoff/users/20261105T141751-0800.md`; in
    infrastructure and security's negative test, 13 lines differed,
    signed out `/api/questions` giving the question bank.
- **Relied on, by `routes.test.js`** (strings no type checker sees):
  `server.js`'s start-up lines begin `Server listening` and `Trusted
  listener`, and it listens on `PORT` and `TRUSTED_PORT` (as in
  contract 8). Rewording either line makes the test wait 60 s and fail
  ("didn't listen"), though nothing is broken. A deliberate change to
  `server.js`'s side may need the test changed: infrastructure and
  security says so in its pull request, and users changes the test.

## 10. The topic and source bubbles

Provider: questions (`bubbles.js`, `labels.json`). Used by: users
(`index.html`, `problems-list.js`, `problem.html`, `problem-page.js`).

- **What crosses**: two global functions, since `bubbles.js` is a plain
  `<script>`, not a module: `loadLabels` and `renderBubbles`. The pages
  call them by name, so renaming one breaks a page without any error
  when it loads.
- **Relied on**:
  - Each page loads `bubbles.js` before its own script
    (`index.html`: before `problems-list.js`; `problem.html`: before
    `problem-page.js`).
  - `loadLabels()` fetches `/labels.json` and never rejects: if it
    can't, bubbles render uncoloured.
  - `renderBubbles(container, question, labels)` replaces what's in
    `container` with the question's `sources` and then its `topics`, so
    both the full question and the problem list's summary work. It builds
    them with `textContent` and `element.style`, applying only colours
    `CSS.supports` accepts, so a name or a hand-edited colour can't inject
    markup.
  - `bubbles.js` and `labels.json` are in `server.js`'s `STATIC_FILES`
    (contract 9).

## 11. The signed-in header

Provider: infrastructure and security (`account.js`). Used by: users
(`index.html`, `problem.html`).

- **What crosses**: the element with `id="account"`, which each page
  provides, and the `<script src="account.js">` each page loads.
  `account.js` fills the element with the signed-in email and a Log out
  button (it asks `/api/auth/me`, and posts `/api/auth/logout`, both in
  `server.js`, the same role's).
- **Relied on**: both pages keep that element and that script; without
  either, the email and Log out quietly disappear. `account.js` doesn't
  depend on anything else in the page.

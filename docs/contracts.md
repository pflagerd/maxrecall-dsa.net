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
  below, with this file, and checks that a pull request touching the
  sign-in layer of `server.js` (section 9) has had its review.

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

Provider: questions (`judge/runner.js`). Used by: users (`server.js`);
infrastructure and security (`judge/sandbox-selftest.js`).

- **What crosses**: `runSubmission`; for the sandbox test also
  `TIMEOUT_MS` and `CPP_COMPILE_TIMEOUT_MS`. `server.js` also takes
  `describeSandbox` from `judge/sandbox.js` and `MAX_RUNNING`,
  `MAX_WAITING` from `judge/queue.js` (infrastructure and security), for
  its startup log.
- **Relied on**:
  - `runSubmission(submission)` gives a `JudgeResult`, and judges through
    the real sandbox and queue: the sandbox test submits hostile code
    through it to prove the sandbox holds.
  - `server.js` answers 503 for an error whose `code` is
    `'SANDBOX_UNAVAILABLE'` or `'JUDGE_BUSY'`, and sets `Retry-After` from
    `retryAfterSeconds` for `'JUDGE_BUSY'`; anything else is a 500. It
    matches the strings, not the classes: renaming a code passes
    `make typecheck` and turns every busy judge into a 500.

## 3. The Test button's rules

Provider: questions (`playtest.js`). Used by: users (`server.js`, which
has the route).

- **What crosses**: `canTestQuestions`, `revealHidden`, `markRevealed`.
- **Relied on**: only the owner may Test (`canTestQuestions`);
  `revealHidden` returns copies, so the question file isn't changed.
  Recording nothing for a Test is `server.js`'s side of it.

## 4. The question bank

Provider: questions (`question-files.js`, `questions/**`). Used by: users
(`server.js`, `scripts/backlog.js`, `scripts/learner-create.js`,
`scripts/recalculate-queue.js`, `scripts/consistency-check.js`).

- **What crosses**: `QUESTIONS_DIR`, `isQuestionFile`, `questionInfos`,
  `RENAMES_FILE`, `readRenamesText`; and the files themselves.
- **Relied on**:
  - A question's slug is its file name without `.json` (spaced-repetition
    plan, D1). Learners' `order.json` and `backlog.json` store slugs, so
    renaming a file means `make rename-question` (section 5), never a
    plain `git mv`.
  - The problem file format, `readme.html` section 5, in particular
    `created`, `title`, `difficulty`, `topics`, `sources` and the
    languages of `starterCode`, which `questionInfos()` passes on.
  - `questions/renames.json`, the rename log, is questions' file but
    users' `consistency.js` parses it (`parseRenames`, `updateRenames`):
    its format is part of this contract both ways.

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

## 7. Signing in, and paths

Provider: infrastructure and security (`auth.js`, `paths.js`). Used by:
users (`server.js`, `users.js`). And the other way: users (`users.js`)
provides `EMAIL_PATTERN` to infrastructure and security (`auth.js`).

- **What crosses**: from `auth.js`, `AUTH_DIR`, `SESSION_LIFETIME_MS`,
  `register`, `login`, `sessionEmail`, `endSession`; from `paths.js`,
  `resolveInside`; from `users.js`, `EMAIL_PATTERN`.
- **Relied on**:
  - `sessionEmail(token)` gives the email, or `null` for anything that
    isn't a live session; it throws only if a session file can't be read.
  - `resolveInside(baseDir, ...parts)` gives `null` for anything outside
    `baseDir` (path traversal), and for `baseDir` itself.
  - `EMAIL_PATTERN` is the one definition of an email this app accepts,
    for registering and for a learner's folder name alike.

## 8. The sign-in routes and ports

Provider: users (`server.js`). Used by: infrastructure and security
(`login-page.js`, `account.js`, `deploy/nginx-maxrecallcode.conf`,
`deploy/maxrecall-dsa.test.service`).

- **What crosses**: the paths `/api/auth/register`, `/api/auth/login`,
  `/api/auth/logout`, `/api/auth/me`; the environment variables `PORT`
  and `TRUSTED_PORT`.
- **Relied on**:
  - The sign-in page posts to `/api/auth/login` and `/api/auth/register`,
    and every page asks `/api/auth/me`; `account.js` posts
    `/api/auth/logout`.
  - nginx rate-limits `location = /api/auth/login` and
    `location = /api/auth/register` by exact path: renaming either route
    silently drops its rate limit.
  - `server.js` listens on `PORT` (sign-in) and `TRUSTED_PORT` (no
    sign-in, the SSH tunnel only), which the service file sets to 3000
    and 3001.

## 9. The sign-in layer of `server.js` (a review rule)

Unlike 1–8, this isn't one role's code used by another: users owns
`server.js`, but part of it is security, which is infrastructure and
security's subject (`docs/roles/users.md`, "Out of scope"). A stopgap
(owner, 2026-11-05) until `server.js` is split, the sign-in layer kept
by infrastructure and security and the feature routes moved to route
modules.

File owner: users. Reviewer: infrastructure and security.

- **The sign-in layer**, found by these names rather than line numbers:
  - who a request is from: the middleware that sets `req.userEmail` and
    `req.viaTrustedPort`;
  - the JSON-only rule for every `POST` and `PATCH` (415 otherwise),
    which with the session cookie's `SameSite` stops cross-site request
    forgery;
  - the `/api/auth/*` routes (`register`, `login`, `logout`, `me`);
  - the gate: `PUBLIC_PATHS`, and the 401 or the redirect to the login
    page for everything else not signed in;
  - what's served: `STATIC_FILES`, and the fallback to `index.html`;
  - listening: `PORT`, `HOST`, `TRUSTED_PORT` (`trustedServer`, bound to
    `127.0.0.1`), and `trust proxy`.
- **Relied on**:
  - Every request that reaches a feature route and isn't for one of
    `PUBLIC_PATHS` has `req.userEmail` set, from a live session or the
    trusted listener.
  - Only `PUBLIC_PATHS` are reachable without signing in.
  - Only `STATIC_FILES` are served as files: never the server's source,
    `.env`, `users/` or `auth/`.
  - The trusted listener, where there's no sign-in, is reachable only
    from the machine itself.
- **The rule**: a users change that touches the sign-in layer, or adds
  to `PUBLIC_PATHS` or `STATIC_FILES`, is reviewed by infrastructure and
  security before the human merges it. The users session says so in its
  pull request's description and lists it in its handoff; the architect
  routes it. Feature routes that only read `req.userEmail` don't need
  the review.

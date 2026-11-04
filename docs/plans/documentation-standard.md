# Plan: bringing existing code up to the documentation standard

Status: **done, 2026-11-03.** All three pull requests: `jsdoc-server`
(#29) and `jsdoc-frontend` (#30) merged; `jsdoc-judge` on its branch,
built on #30. Every JavaScript file in the repository is documented and
listed in `tsconfig.json` or `tsconfig.browser.json`.

## The standard

From the owner's review of pull request #27, and since 2026-11-03 in
`CLAUDE.md`:

- Every JavaScript function gets a JSDoc comment documenting each argument
  and the return value, with their types: `@param {type} name - …`,
  `@returns {type} …`, and `@throws {Type} …` where it throws
  ([JSDoc](https://jsdoc.app/tags-param),
  [TypeScript's JSDoc support](https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html)).
- A documented file is listed in `tsconfig.json`, and `make typecheck`
  (pull request #28) must pass.

## Decisions (owner, 2026-11-03)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Which languages? | **JavaScript only.** C++, Java and shell files are left as they are. |
| 2 | "Possibly null" element lookups in the front end (`document.getElementById` returns `null` when there's no such element, so `strict` reports every use) | **(a) JSDoc type casts**, e.g. `/** @type {HTMLButtonElement} */ (document.getElementById('submit-btn'))`: no behaviour change. Not (b) null checks in the code. |
| 3 | Types for CodeMirror (loaded from a CDN, so TypeScript knows nothing about it) | **(a) `@types/codemirror`** (DefinitelyTyped, 5.60.x for CodeMirror 5), a pinned development dependency. |
| 4 | How to split the work | **Separate branches and pull requests**, one per area: `jsdoc-server`, `jsdoc-judge`, `jsdoc-frontend`. |
| 5 | Put the standard in `CLAUDE.md`? | **Yes.** |

## How each pull request is done

- **No behaviour changes.** Comments only, plus JSDoc casts where comments
  alone can't satisfy the checker, each with a comment saying why. A cast
  is itself a comment; the only code it adds is a pair of parentheses.
- **Checked three ways:** `make typecheck` passes, and fails on a type put
  in wrong on purpose in each file; the code with every comment removed
  (printed by TypeScript's own parser) is compared with `master`'s, and
  must differ only by those parentheses; and the code is run.
- **Parameter types are what the callers pass,** even where the function
  checks its argument itself (owner, review of pull request #29): e.g.
  `{string}`, not `{unknown}`, for an email that `normalizeEmail` also
  checks is a string. The description says what the check does with
  anything else. `unknown` is only for a value that really can be anything,
  such as a test case's expected JSON value.
- **Words:** a function's *signature* is its parameters' and return value's
  types (`@param`, `@returns`); a `@typedef` for a record is a *type*.
- **Functions written inline get comment blocks too** (owner,
  2026-11-03, correcting the rule first used here, which left them
  out): route handlers, middleware, and callbacks such as a server's
  `listen` callback. The block goes **directly before the function,
  inside the call**, e.g. between a route's path and its handler: a
  block above the whole `app.get(...)` statement belongs to the
  statement, and TypeScript ignores it for the function (checked: a
  deliberately wrong `@param` type above the statement gave no error;
  directly before the function, it did). Done for `server.js` in the
  `jsdoc-route-handlers` pull request (#38).
- **Which inline functions** (owner, 2026-11-03, option (b)): every one
  with a `{ ... }` body, but not a single-expression arrow such as
  `.filter((tc) => !tc.hidden)`, which says what it does in its one
  expression and is typed by what it's called on. Empty no-ops such as
  `.catch(() => {})` count as single expressions (`() => undefined` with
  braces). Front end: 23 in `problem-page.js`, `login-page.js`,
  `problems-list.js` and `account.js`, in the `jsdoc-inline-frontend`
  pull request; found by a scanner using TypeScript's parser (every arrow
  or function expression with a block body and no JSDoc block directly
  before it), and placed by a script that splits each call's arguments
  one per line and indents the function's body. Checked: four blocks
  broken on purpose are caught (including a destructured parameter,
  `([name, panel])`); with comments removed the code is identical to
  `master`'s; the browser check's 37 observations are identical (#40).
- **Test bodies are exempt** (owner, 2026-11-03, 1b): a function passed
  straight to `test(...)` in a `*.test.js` file; its name documents it.
  Helpers in test files aren't exempt.
- **Node files** (the `jsdoc-inline-node` pull request): 29 inline
  functions, in the judge (process events, loop and `.map()` callbacks,
  the escape test's wrappers), `auth.js`, `sandbox.js`, `server.js`, and
  three test helpers. Blocks go before the function inside its call or
  `new` (`new Promise(...)`), above the `const` or the assignment it's
  held in, or inside parentheses after `return`.
- **`make doc-check`** (owner, 2026-11-03: "keep the scanner"):
  `scripts/doc-check.js`, with TypeScript 6.0.3's parser installed as
  the npm alias `typescript6`, since TypeScript 7's package has no
  JavaScript API. It checks every function, named or inline, in the
  files the two tsconfig files list: a block, a `@param` for each
  parameter (by name, or by position for a destructured one), and a
  `@returns` (not for constructors and setters). It found two false
  alarms of its own on its first run (immediately invoked functions,
  whose block TypeScript attaches to the parentheses), fixed by reading
  such a block's tags itself; and it caught its own undocumented
  callback. Checked: each of six omissions made on purpose is reported
  (a whole block, one `@param`, a `@returns`, a destructured
  parameter's `@param`, an immediately invoked function's block, a test
  helper's block). One lesson on the way: `@param` or `@returns` written
  in a block's prose is read as a tag; say "param tag" instead.

## Pull request 1: `jsdoc-server` (2026-11-03)

`server.js`, `users.js`, `auth.js`, `paths.js`: 32 functions, 116 errors
under `strict` beforehand.

- **Named types** (`@typedef`): `SubmissionRecord` and `SavedSubmission`
  (`users.js`); `Account`, `Session`, `AuthResult` (`auth.js`);
  `AppRequest` (Express's request plus `userEmail` and `viaTrustedPort`),
  `Problem`, `TestCase`, `ProblemSummary`, `SubmissionSummary`,
  `JudgeError` (`server.js`).
- **`@types/express` 4.17.25** added, pinned, for the Express 4 in use
  (4.22.3 installed): without it, `req` and `res` are `any` and nothing
  about them is checked. Same reasoning as decision 3.
- **The four judge files `server.js` loads** (`judge/runner.js`,
  `sandbox.js`, `queue.js`, `cgroups.js`) start with `// @ts-nocheck` for
  now. TypeScript checks every file a listed file `require`s, and those add
  125 errors that belong to `jsdoc-judge`, which removes the line.
- **Casts, and why** (no behaviour change in any):
  - `err` in a `catch` is `unknown` under `strict`: cast to
    `NodeJS.ErrnoException`, `Error` or `JudgeError` where it's used.
  - `promisify(crypto.scrypt)` is typed as scrypt's shortest form, without
    options: cast to the four-argument form `hashPassword` uses.
  - `req.userEmail` is `string | null | undefined`, but the sign-in gate
    lets only signed-in requests reach saving and listing submissions:
    cast to `string` there (and `users.js` checks it again anyway).
  - `problem.functionName` is optional in the type, but a function-mode
    question always has it (the problem file format); one without would
    throw, as before.
  - `app.listen(PORT, HOST)`: `PORT` can be a string and `HOST`
    `undefined`, which Node accepts and Express's types don't.
  - Functions documented as returning `Response | void`: their
    `return res.status(…).json(…)` lines only stop early; the value isn't
    used.
- **Checked:** `make typecheck` passes; a wrong type put in on purpose
  fails it in each of the four files (`paths.js` 6 errors, `users.js` 2,
  `auth.js` 7 and 4, `server.js` 6). The comment-free code differs from
  `master`'s only by cast parentheses and one variable (`judgeError`,
  holding the same `err`); the judge files don't differ at all. The real
  server, with the sandbox, answered 39 requests (sign-in and throttling,
  the questions API, Run and Submit in Python and JavaScript, the
  submissions API, the sign-in gate, static files) exactly as `master`
  did, and logged the same lines. `make test`: 9 of 9.

## Pull request 3: `jsdoc-frontend` (2026-11-03)

`problem-page.js`, `login-page.js`, `problems-list.js`, `bubbles.js`,
`timer.js`, `account.js`: 70 functions, 314 errors under `strict`
beforehand (260 in `problem-page.js`). Built on `jsdoc-server` (merged
into it), so #29 goes first.

- **`tsconfig.browser.json`**: the browser files, with the DOM's types
  (`lib: dom`) and CodeMirror's (`@types/codemirror` 5.60.18, pinned,
  decision 3), not Node's. `make typecheck` runs it after `tsconfig.json`.
  All six files are checked together, though no page loads all of them;
  no two of them declare the same global, so that works.
- **`browser-globals.d.ts`**: declarations only, for three globals
  TypeScript can't see: `createStopwatch` and `formatElapsed` (TypeScript
  treats `timer.js` as a module because of its `module.exports` line, so
  their types are taken from it with `typeof import('./timer')`), and
  KaTeX's `renderMathInElement` (from cdnjs). It's a TypeScript file, but
  only declarations: nothing in it runs.
- **Element lookups** (decision 2): each `getElementById`/`querySelector`
  is cast to the element the page has there, e.g. `HTMLSelectElement` for
  `#language-select`, checked against `problem.html`, `index.html` and
  `login.html`. The login forms' named controls are typed too
  (`LoginForm`, `RegisterForm`), so `loginForm.email` is an input, not
  `any`.
- **Page state honestly nullable**: `problem`, `editor` and
  `currentLanguage` are `… | null`, as they are until the question loads;
  code that only runs after that casts at the use, with a comment.
  `problem-page.js` has 14 casts of `problem` as a result. A local
  variable would read better, but would be a code change.
- **Types** (`@typedef`): `PublicProblem`, `Example`, `JudgeResult`,
  `TestResult`, `ConsoleState`, `SubmissionSummary`, `SubmissionRecord`,
  `PaneBounds` (`problem-page.js`); `Labels`, `LabelStyle` (`bubbles.js`);
  `Stopwatch` (`timer.js`); `LoginForm`, `RegisterForm` (`login-page.js`).
- **Two documentation-only techniques:** `isColor` is a *type predicate*
  (`@returns {value is string}`), so a colour it accepts is known to be a
  string; `makeEl` is *generic* (`@template`), so `makeEl('table')` is an
  `HTMLTableElement`, as with `document.createElement`.
- **An existing comment moved:** the description of `loadLanguage` sat
  above `clearConsoleOutput`; it's now in `loadLanguage`'s JSDoc.
- **Checked:** `make typecheck` passes, and a wrong type put in on purpose
  fails it for each file (for `timer.js`, in `problem-page.js`, where its
  functions are used). With comments removed, the code differs from
  `master`'s only by cast parentheses (`timer.js`, `bubbles.js`,
  `account.js`: not at all). In headless Chromium against the real server
  (CodeMirror and KaTeX served from npm, since cdnjs is blocked in the
  cloud), 37 observations matched `master`'s exactly: the login page's
  redirect, register and mismatch message, the problem list, the problem
  page's header, language switching, tabs becoming spaces when typed, Run,
  Submit (5/5, the tooltip, the address, the frozen timer), the
  Submissions tab and Load, the timer and language menu, KaTeX, a missing
  submission's notice, logging out, and the console errors.

## Pull request 2: `jsdoc-judge` (2026-11-03)

`judge/runner.js`, `sandbox.js`, `cgroups.js`, `queue.js`,
`line-numbers-test.js`, `sandbox-selftest.js`: 82 functions, 166 errors
under `strict` beforehand. Built on `jsdoc-frontend` (#30), which was
merged meanwhile. Removes the four `// @ts-nocheck` lines #29 added, and
lists all six files in `tsconfig.json`.

- **Types** (`@typedef`): `TestCase`, `FunctionSignature` (a question's
  `signature` field: its parameters' and return value's types, a
  signature in the owner's sense), `Submission`, `TestResult`,
  `JudgeResult`, `JudgePaths`, `CompileCommand`, `ProcessSpec`,
  `CompileOutcome`, `RunOutcome`, `MemoryCounters` (`runner.js`); `Bind`,
  `CommandLine`, `SelfTestResult` (`sandbox.js`); `SubmissionCgroup`,
  `CgroupStatus` (`cgroups.js`); `Question` (`line-numbers-test.js`);
  `Probe`, `ProbeOutcome` (`sandbox-selftest.js`).
- **Techniques:** `withJudgeSlot` and `cgroups.wrap` are generic
  (`@template`): the first returns whatever its task returns, the second
  keeps its command object's other fields. `spawnSandboxed` has two
  signatures (`@overload`), one for `spawn` (a `ChildProcess`) and one for
  `spawnSync` (a finished result). The line-number test's cases are
  *tuples*, `[string, string, string, RegExp][]`.
- **`server.js`:** with `runSubmission` typed, `server.js` adding
  `saved`, `submissionId` and `saveError` to its result showed up as an
  error; Submit's answer is now typed as `JudgeResult` plus those three.
  `Problem.signature` is now `FunctionSignature`.
- **Found:**
  - `signature.customSerializer`: code spliced into the C++, Java and D
    harnesses so a question can return a type of its own (only
    `singly-linked-list-hello-world.json` uses it). It wasn't in
    `readme.html`'s problem file format; it is now.
  - `BASE_ARGS` in `sandbox.js` passes `--setenv PATH <the server's
    PATH>` to bwrap. If the server had no `PATH` at all, that would be
    `undefined`, which `spawn()` refuses, so no sandbox could start. A
    server always has a `PATH` in practice, so the cast assumes one; not
    changed, as it's behaviour.
- **Casts, and why** (no behaviour change in any): caught errors; a
  `cg.memory()` reading compared before and after only when there's a
  cgroup (`Boolean(cg) &&` first); a child's piped stdin/stdout/stderr,
  which exist with the default pipes; `functionName` in function judging,
  which always has one; `found.dir` once `found.error` is falsy (a
  truthiness test can't narrow the union for the checker, since the error
  could in principle be `""`); `status.parent` when `status.ok`; values a
  callback sets that the checker can't follow (`lastCgroupMemory`), or
  that a check at the top of a file guarantees (`ENV_CANARY`).
- **Checked:** `make typecheck` passes, and a wrong type put in on purpose
  fails it for each file. With comments removed, the code differs from
  `master`'s only by cast parentheses (`queue.js` and
  `line-numbers-test.js` not at all). Against `master`'s own runs:
  `make line-numbers-test` 36 of 36 with every line the same (apart from
  the JVM's one-off "Picked up JAVA_TOOL_OPTIONS" while `master`'s fresh
  checkout compiled `JudgeJson.class`); the escape test 16 probes, 15
  contained, 1 skipped, every probe's verdict the same; the server's 39
  requests the same, apart from the static `timer.js` itself, whose
  comments #30 changed. `make test`: 9 of 9.

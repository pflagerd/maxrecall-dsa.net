# Plan: bringing existing code up to the documentation standard

Status: **in progress, 2026-11-03.** Pull request 1 of 3 (`jsdoc-server`)
done on its branch; `jsdoc-judge` and `jsdoc-frontend` to come.

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
- **Inline callbacks** (Express route handlers, `.map()` callbacks) get
  their types from what they're passed to, and are described by the
  comment above them. A parameter of one gets a JSDoc type only where the
  checker needs it (e.g. `req` when it uses `req.userEmail`).

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

## Still to do

- **`jsdoc-judge`:** `judge/*.js` (82 functions, 166 errors), and remove
  the four `@ts-nocheck` lines.
- **`jsdoc-frontend`:** `problem-page.js`, `login-page.js`,
  `problems-list.js`, `bubbles.js`, `timer.js`, `account.js` (70
  functions, 314 errors, 260 in `problem-page.js`), with decisions 2 and 3.
  These run in the browser, so they need the DOM's types and their own
  settings (e.g. a second `tsconfig`), not Node's.

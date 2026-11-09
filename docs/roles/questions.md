# Role: questions

## Mission
Look after the question bank and the people who write questions: the
question files and their format, test cases (hidden ones included),
how answers are judged against them (the harnesses for each language,
the comparison of results, the line numbers in errors), topics and
sources, the Test button that tries a question without
recording anything, deleting and renaming questions, and the guides and
template for writing one.

## Owns (files/directories the role owns)
- docs/session-handoff/questions/
- docs/roles/questions/: how-to-write-a-question.md, how this role
  writes and edits a question's content (owner, 2026-11-05: an exception
  to the architect's docs/roles/**)
- questions/** (the question files and renames.json, the rename log)
- question-files.js, questions.test.js (the problem file format and its
  check)
- How answers are judged: judge/runner.js, judge/cpp/**, judge/java/**,
  judge/line-numbers-test.js
- Fill-in-the-blank judging (#160; decided 2026-11-08, being built): each fill-in-the-blank
  question's judge, questions/<slug>.judge.js (under questions/**), and
  the code this role adds to judge/ for it: judge/fill-in-the-blank.js (the
  dispatch by kind, loading a judge, `JudgeFailedError`, the shared
  helpers; #160 step 3). Name any further files here when they're added.
  Both are server code: see "Judge files", below.
- The topic and source bubbles: labels.json (their colours) and
  bubbles.js (drawing them on the problem list and the problem page)
- The Test button's rules: playtest.js, playtest.test.js
- scripts/question-admin.js (make delete-question, make rename-question)
- For question authors: docs/how-to-add-a-new-question.html,
  docs/question-template.json, .claude/skills/author-question/
- Plans: docs/plans/playtest.md, docs/plans/topics-and-sources.md,
  docs/plans/error-line-numbers.md,
  docs/plans/fundamentals-learned-links-concept-checks.md (#145),
  docs/plans/unit-test-questions.md and its prototype,
  docs/plans/prototypes/unit-test-questions-python/** (#174, PR 210)

## Judge files: server code (owner, 2026-11-08, #160)
A judge runs in the server process, with the server's access (learners'
records, auth/), not in the sandbox; Node's `vm` module is no boundary
("not a security mechanism", https://nodejs.org/api/vm.html). So a pull
request that adds or changes a judge file, or this role's fill-in-the-blank code in
judge/, is server code, under these rules:
- **R1** (#160, B7.1): **a judge file stays within its job**, reading the
  learner's blank and returning a verdict, and reaches nothing else of
  the server. So a judge file:
  - `require`s only an allow-list of judge/ helpers (none yet), and uses
    no `import(`;
  - begins with `'use strict'`, and uses no `this`;
  - uses `module` only as `module.exports`;
  - uses none of the names `process`, `globalThis`, `global`, `eval`,
    `Function`, `Reflect`, `Proxy`, `arguments`, or the timers
    (`setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`);
  - names none of the properties `require`, `constructor`, `__proto__`,
    `caller`, `callee`, or the descriptor and prototype functions
    (`getOwnPropertyDescriptor(s)`, `getPrototypeOf`, `setPrototypeOf`,
    `defineProperty`/`defineProperties`, the `__lookupGetter__` family),
    wherever a property's name is written (`x.name`, `x["name"]`, an
    object literal's key, a destructuring pattern);
  - writes a computed key (`x[k]`) only as a string or number literal.

  These close by kind the six ways round found in the architect's R3
  review of #181 (owner, 2026-11-09, option B). `make test` checks them
  with TypeScript's parser (`questions.test.js`, `judgeSourceProblems`).
  **What the check can't do** (owner, 2026-11-09, option A): it reads a
  judge's text and refuses what's listed, so it catches accidents, not
  every deliberate evasion. Review (R3) and the owner's approval are the
  guard against those; the real boundary would be a judge outside the
  server process (#185, an idea).

  **And an allow-list of names** (owner, 2026-11-09, option (a); built
  in #191), for the ways round that need no forbidden name (changing a
  built-in, `fetch`, code run after judging). A judge file also:
  - refers only to names it declares itself (a variable, parameter,
    function, class, destructuring name or catch binding, by scope, as
    TypeScript's checker resolves them) or to the allowed built-ins
    `String`, `Number`, `Boolean`, `Math`, `JSON`, `Array`, `Set`,
    `Map`, `RegExp` and values `undefined`, `NaN`, `Infinity`
    (`questions.test.js`'s `JUDGE_ALLOWED_BUILTINS`,
    `JUDGE_ALLOWED_VALUES`);
  - uses an allowed built-in only by calling it or reading a property
    (`Math.max(a, b)`, `new Set()`), never as a value (`const M = Math`,
    `arr.map(Number)`); `RegExp` only by calling or constructing it,
    since its legacy properties (`RegExp.input`, `$1`, …) hold the last
    match made anywhere in the server (the architect's R3 review of
    #191);
  - **writes only to variables it declares, or to `module.exports`
    itself, exactly: no property writes at all** (owner, 2026-11-09,
    option (i); built in #200), in every form of write (`=`, `+=`, `++`,
    `delete`, a destructuring or `for (… of …)` target). Otherwise a
    write to a property of a shared built-in function the judge has read
    into its own variable (`const h = ({}).hasOwnProperty; h.call = () =>
    true;`) would change that function for the whole server (#191's R3
    re-review). Method calls on its own objects (`list.push(x)`) aren't
    writes, and are allowed;
  - names no `prototype` property, and uses no `async`, `await`,
    generators or `yield`.

  If a further way round turns up, the next step is #185 (the judge
  outside the server process), not another rule (the architect's
  recommendation, given with option (i)).
- **R2**: a judge is loaded only by the slug of a known fill-in-the-blank question,
  through paths.js's `resolveInside` (docs/contracts.md, contract 7).
- **Q7**: the length is checked before a judge is called (contract 2); a
  judge is synchronous and fast, since the server runs on one thread; its
  errors are caught, and its result's shape is checked
  (`{ pass: boolean, message?: string, hints?: string[] }`; anything else
  is contract 2's "couldn't judge"); its message and each hint are capped
  in length (the message at most 500 characters, at most 5 hints of at
  most 300 each: `judge/fill-in-the-blank.js`'s `MESSAGE_MAX_LENGTH`,
  `HINTS_MAX`, `HINT_MAX_LENGTH`, chosen by questions 2 when built, #181);
  they're text, never HTML.
- **Tests**: each judge exports its own cases, which questions.test.js
  runs, **each in a worker thread (or child process) stopped when its
  time runs out** (`worker.terminate()`,
  https://nodejs.org/api/worker_threads.html#workerterminate). That's the
  only guard in `make test` against a judge that never returns, which
  would freeze the server. node:test's own `timeout` option can't stop a
  synchronous loop: its timer never gets the thread (tried 2026-11-08 on
  Node 22.23.4, by questions 2 and the architect: it hung).
- **R3**: the architect reviews every such pull request before the owner
  merges it; the owner approves in the pull request
  (docs/roles/architect.md, "Reviews").

## May read, must not edit
- Everything the infrastructure-and-security and users roles own, in
  particular the judge's sandbox and queue (judge/sandbox.js,
  judge/seccomp/, judge/cgroups.js, judge/sandbox-selftest.js,
  judge/queue.js: infrastructure and security), routes.js and order.js
  (users)
- Makefile and package.json (infrastructure and security): ask for a new
  `make` target there
- docs/roles/** (except docs/roles/questions/, above), other roles'
  handoffs, and the handoffs from before roles (docs/session-handoff/*.md)
- TODO, THOUGHTS (the human's notes)

## Writing or editing a question
- Read docs/roles/questions/how-to-write-a-question.md first. It's the
  craft (teaching, the five languages kept parallel, checking claims by
  running them); docs/how-to-add-a-new-question.html is the procedure.
- Keep it with the owner: when a change teaches a new rule, or settles
  one of its open questions, update it in the same pull request.

## Shared files (propose changes; owner approves/merges them)
- readme.html: owner is the human (with the architect supporting the human)
- CLAUDE.md: owner is the human (with the architect supporting the human)
- docs/decisions/: any role adds a file, one per decision; none edits
  another's, and none is edited once merged (readme.html, "Maintaining
  this file")

## Out of scope
- The sandbox the judge runs code in (what submitted code can reach, its
  limits), and the judge's queue
- A learner's state: profiles, queue, backlog and records
- Signing in, invites, the VPS and nginx

## Before ending a session
- Write docs/session-handoff/questions/<timestamp>.md
- List any cross-boundary requests in it
- Commit and push

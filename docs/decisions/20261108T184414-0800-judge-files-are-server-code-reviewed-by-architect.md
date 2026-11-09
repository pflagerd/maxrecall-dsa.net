# Judge files are server code: machine-checked rules, and the architect reviews them

2026-11-08 · decided by the owner · written by the architect

**Decided** (owner, 2026-11-08, in the architect's session), for #160's
fill-in judges, which run in the server process, not the sandbox (#160,
Q6):

- **R3: the architect reviews** every pull request that adds or changes a
  judge file (`questions/<slug>.judge.js`) or questions' fill-in code in
  `judge/`; **the owner approves in the pull request** (owner: "architect
  (with approval in PR by owner)").
- **R1 and R2 are rules** (owner: yes to including them). R1: a judge file
  requires only allow-listed `judge/` helpers and uses no `process`,
  `globalThis`, `eval`, `Function` or `import(`, checked by `make test`.
  R2: a judge is loaded only by a known fill-in slug, through `paths.js`'s
  `resolveInside`. Both were infrastructure and security's review of
  #160's Q6.5 (its handoff, `3e48e6e`; not posted on #160, the owner's
  call).
- **Q9a, recorded in contract 2**: a judge that fails gives a "couldn't
  judge" outcome; nothing is recorded (owner: "No need to punish the
  learner. Record nothing.").

**Why**: a judge runs with the server's access (learners' records,
`auth/`), and Node's `vm` module is not a security boundary
(https://nodejs.org/api/vm.html), so the safeguards are what a machine can
check plus a named reviewer.

Source: `docs/roles/questions.md`, "Judge files"; `docs/roles/architect.md`,
"Reviews"; `docs/contracts.md`, contracts 2, 4 and 7; #160, Q6, Q7, Q9a.

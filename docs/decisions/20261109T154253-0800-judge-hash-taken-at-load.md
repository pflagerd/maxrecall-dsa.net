# A fill-in-the-blank record's judgeSha256 is the hash of the judge as the server loaded it, not of the file at each request

2026-11-09 · decided by the owner (option b) · written by users

Records version 4 (`docs/plans/submission-records-v4.md`, D6) keep
`judgeSha256`, the SHA-256 of the question's judge file
(`questions/<slug>.judge.js`), so a Submit can be traced later to the
judge that judged it.

**The catch** (users, 2026-11-09): `judge/fill-in-the-blank.js` loads a
judge with `require`, and Node keeps the loaded module until the server
restarts. The question's `.json` is read on every request, so
`questionSha256` always matches what was used; a judge file read and
hashed on every request wouldn't, if the file changed under a running
server (a `git pull` without a restart): the record would name the new
file while the old code judged. Deploys and `make dev` (nodemon) restart,
so the window is narrow, but the record would be wrong without a sign.

**Decided** (owner, 2026-11-09, option b, over (a), users hashing the file
per request in `routes.js`): the hash is computed from the judge file's
bytes **when the judge is loaded**, by questions' judge code, and handed
to users with the verdict, so it's always the hash of the code that
judged. Infrastructure and security's #160 review recommended the same
("compute the hash when the judge is loaded, not per request"). The hash
stays on the server: Run's answer doesn't send it (contract 4: nothing of
a judge is sent).

**A Skip** (owner, 2026-11-09, option A, over loading the judge and
recording its hash or refusing the Skip): its record has
`judgeSha256: null` and the judge isn't loaded. A Skip judges nothing,
like its other judging fields, which are null too; every
fill-in-the-blank record keeps the same fields (D4); and a judge that
won't load can't stop a learner skipping.

**Who does what**: questions-2 added `judgeSha256Of(question)` to
`judge/fill-in-the-blank.js` (#208), which loads the judge if need be and
throws `'JUDGE_FAILED'` if it can't; users calls it after judging a
Submit and writes the hash into records (`routes.js`); the architect adds
it to contract 2.

Source: `judge/fill-in-the-blank.js` (`loadJudge`'s comment: "Node caches
it (require), so a changed judge takes effect when the server
restarts"), `routes.js` (`fillInTheBlankRecord`, `judgeWithHash`),
`docs/plans/submission-records-v4.md`; #160.

# The live service never reads a test question bank: the unit file removes `MAXRECALL_QUESTIONS_DIR`, and each deploy checks

2026-11-10 (UTC) · decided by the owner · written by infrastructure and security

**Decided** (owner, 2026-11-10 00:10 UTC, "(i) and (ii) - yes"), of three
options: **(i)** `deploy/maxrecallcode.service` gets
`UnsetEnvironment=MAXRECALL_QUESTIONS_DIR`; **(ii)** the guarded
deploy's step 5 (`docs/deploy-vps.md`) checks that the running server's
environment has no such variable (`/proc/<pid>/environ`, counted, never
printed) and that `/srv/maxrecall/data/users/TEST-USERS` doesn't exist.
Not (iii), `server.js` refusing the variable with `NODE_ENV=production`:
redundant once (i) exists, and another code path.

**Why**: `MAXRECALL_QUESTIONS_DIR` (#198) moves where questions and
their judges are read from, and a judge is code the server runs
(`docs/roles/questions.md`, "Judge files"). `users.js`'s
`testBankRefusal` (the owner's option B2, 2026-11-09) already refuses
the variable unless the users folder holds a `TEST-USERS` file, so the
live service could read a test bank only through two mistakes together:
the variable reaching it, and that file in the live users folder. (i)
removes the first for the live service; (ii) shows, after each deploy,
that neither happened.

**Checked**: systemd v255 `man/systemd.exec.xml` (line 2833):
`UnsetEnvironment=` "is applied as final step … it may undo assignments
from any configuration source, including assignments made through
Environment= or EnvironmentFile=, inherited from the system manager's
global set of environment variables". `systemd-analyze verify` (v255)
accepts the unit file, and names a misspelled `UnsetEnviroment=` as an
unknown key (it exits 0 either way: read its output). The step 5
pipeline counted 1 for a process started with the variable and 0
without; `printenv` exits 1 when a variable is unset.

**What it can't show yet**: that systemd removes the variable on the
VPS. A cloud session's systemd isn't running, so step 5 has a one-off
`systemd-run` test, with a control, for the first deploy with this unit
file. And `UnsetEnvironment=` guards against accidents, not root: a
drop-in that assigns it the empty string resets it.

Source: `question-files.js` (`QUESTIONS_DIR`), `users.js`
(`testBankRefusal`), `routes.test.js` (the start-up refusal test),
`deploy/maxrecallcode.service`, `docs/deploy-vps.md`.

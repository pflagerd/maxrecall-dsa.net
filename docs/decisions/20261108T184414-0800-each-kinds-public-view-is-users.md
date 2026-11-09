# Each question kind's public view is users'

2026-11-08 · decided by the owner · written by the architect

**Decided** (owner, 2026-11-08, in the architect's session: "A, users
owns the public view"): for #160's question kinds, the allow-list of
fields the browser is sent for each kind is users', in `routes.js`, where
`toPublicProblem` is today. Contract 4 lists each kind's fields that must
never be sent (for `"code"`, the hidden test cases; for `"fill-in"`,
nothing of its judge), and users' list stays within it. Option A, chosen
over the list being questions' (B), with users' code applying it.

**Why**: an allow-list fails safe. A field users' list doesn't name is
missing from the page, a visible bug, not a leak, so the route's owner
can hold the list, and the decision lives in one file. #160's table had
the public view as "questions/users"; its build list (B7 step 4) already
gave it to users.

Source: `docs/contracts.md`, contract 4 ("`kind`"); `docs/roles/users.md`,
"Owns"; #160, Q3 rule 2 and Q4.

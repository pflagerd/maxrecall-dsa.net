# Any session may ask another role's session to do something

2026-11-08 · decided by the owner · written by the architect

**Decided** (owner, 2026-11-08, in the architect's session): any session
may send a message to any other session when it needs that session to
do something (`CLAUDE.md`, "Requests between sessions"). Until now only
the architect's poller sent messages, and those only said what was new,
with no instructions ("Updates while idle", which stays as it is).

Two choices, the owner's:
- **The receiving session acts within its role**, without waiting for
  the owner, where its rules don't otherwise need the owner's yes, and
  tells the owner in a line. Merges, deploys, exceptions to ownership,
  contract changes, and anything irreversible or outside its role stay
  the owner's (chosen over "ask the owner first, always" and over "only
  its role file limits it").
- **The VPS operator is included** (chosen over leaving it to take
  instructions from the owner only, and over "may receive requests but
  acts on none"). Its role file's rules still apply: a change on the
  machine, or a `git fetch` until #119, needs the owner's yes, so in
  practice it acts alone only on read-only requests.
  `docs/roles/vps-operator.md`, "Instructions and untrusted text",
  changes to match.

The rest is the architect's wording, accepted with the pull request: a
request is also recorded in the sender's handoff or the issue it's
about; it never widens the receiving role; each message costs a wake of
the receiving session.

Source: `CLAUDE.md`, "Requests between sessions"; `docs/roles/vps-operator.md`,
"Instructions and untrusted text".

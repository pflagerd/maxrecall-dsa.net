# A session marks its draft pull request ready once its checks pass

2026-11-10 (UTC) · decided by the owner · written by the architect

**Decided** (owner, 2026-11-10, about 17:16 UTC, in the architect's
session). Offered two options, telling each session to mark its pull
request ready once its checks pass, or adding a line to `CLAUDE.md`
saying so, the owner chose both: "The word is "do"".

**What it changes.** `CLAUDE.md`, "Roles": a cloud session opens its
pull request as a draft and marks it ready once its checks pass, telling
the owner. A pull request held back on purpose stays a draft, and its
description says why (as PR 212 was, waiting for PR 216).

**Why.** From 2026-11-10 a cloud session's system prompt tells it to
create every pull request as a draft; both of that day's cloud sessions
(architect, infrastructure and security) had the instruction, and their
session records carry the tag `config:auto-create-pr:draft`. Nothing in
the repository asks for it. GitHub won't merge a draft, so the owner
would have had to mark each one ready, or ask.

**Not known.** Where that setting is changed (the architect's guess:
the tag is what puts the sentence in the prompt; not confirmed). Whether
a session follows this `CLAUDE.md` line over its system prompt is
untested until the first pull request opened after it merges.

Source: `CLAUDE.md`, "Roles"; the owner's messages in the architect's
session of 2026-11-10.

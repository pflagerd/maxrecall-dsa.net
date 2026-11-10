# A numbered session's pull requests and issues end with its session name

2026-11-10 (UTC) · decided by the owner · written by the architect

**Decided** (owner, 2026-11-10, about 20:03 UTC, in the architect's
session): "When questions-1 or questions-2 (or any other future numbered
session) posts an issue or PR, it is appending (questions) to the title.
I want it to append its session name (questions-1 for example) instead."

**What it changes.** `CLAUDE.md`, "Roles": a title ends with the role,
as before, when the role has one session ("… (core)"); from a numbered
session it ends with that session's name ("… (questions-1)"). The rule
now names issues as well as pull requests: until now only pull requests
were covered (owner, 2026-11-07), and ending an issue's title with the
role was a proposal in Issue 183.

**What it doesn't change.** Titles already given stay as they are. The
rest of Issue 183 (writing "Issue 160" and "PR 54" without "#") is
still a proposal.

**Why** (the architect's reading; the owner gave no reason in words):
with two sessions of one role, "(questions)" doesn't say which session
to ask about a change; `git log` then shows it, since GitHub's merge
commit carries the title.

Source: `CLAUDE.md`, "Roles" and "Several sessions of one role"; the
owner's message in the architect's session of 2026-11-10.

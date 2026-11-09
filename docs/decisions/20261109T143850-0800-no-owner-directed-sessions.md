# No owner-directed sessions: every session of a role follows the same rules

2026-11-09 (Pacific) · decided by the owner · written by the architect

**Decided** (owner, 2026-11-09, in the architect's session):

- **Questions 2 is no longer owner-directed**: "I want a change to
  questions 2 policy to give it the same powers as questions 1. Please
  lift all the restrictions I applied to it before. question 1 and
  question 2 should follow the same rules."
- **The rule itself is removed** from `CLAUDE.md` ("Remove owner-directed
  rule"), chosen over keeping it, unused, for later. `CLAUDE.md`,
  "Several sessions of one role", now says every session of a role
  follows the same rules: news goes to each of the role's sessions where
  it's unclear whose work it concerns, and a request to the
  lowest-numbered, with no exception. "Requests between sessions" no
  longer excludes any session.
- The owner may still assign any session work directly, as before; that
  no longer limits who may message it.

**Changes** these decision files on these points (they aren't edited):
`docs/decisions/20261108T120319-0800-several-sessions-of-one-role.md`
(owner-directed sessions; questions 2 the first) and
`docs/decisions/20261108T184841-0800-only-the-architect-messages-an-owner-directed-session.md`
(only the architect messages one).

**Since** (both questions sessions, told by the architect, 2026-11-09):
questions 1 and questions 2 agreed a split, each recorded in its
handoff. Questions 2 has Issue 160's build and Issue 185; questions 1 has
the rest. Requests whose owner is unclear go to questions 1 first.

Source: `CLAUDE.md`, "Several sessions of one role" and "Requests between
sessions".

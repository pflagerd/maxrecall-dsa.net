# Several sessions of one role are numbered, and the owner may direct one directly

2026-11-08 · decided by the owner · written by the architect

**Decided** (owner, 2026-11-08, in the architect's session), in
`CLAUDE.md`, "Several sessions of one role":

- **Numbered titles**, `maxrecallcode.net:<YYMMDD>:<role> <n>`. News and
  requests go to the session whose work they concern; each session says
  in its handoff, and to the architect, what work is its. (Option A,
  chosen over one session per role at a time, B, and every session of a
  role getting every message, C.)
- **Owner-directed sessions**, in general: the owner assigns their work
  directly. Such a session tells the architect what work the owner gave
  it. The architect sends it news only when the news affects that work.
  Its role's other sessions may send it news. Requests from other
  sessions go elsewhere.

**The first**: `maxrecallcode.net:261108:questions 2`, owner-directed
from 2026-11-08 (the owner: "I don't want questions 2 picking up
anything. I will be assigning it question-related work directly").
`maxrecallcode.net:261108:questions 1` takes questions' news and
requests otherwise.

**The architect's wording, accepted with the pull request**: where it's
unclear whose work something is, news goes to each of the role's
sessions but an owner-directed one, and a request to one session only
(the lowest-numbered that isn't owner-directed, which passes it on), so
the work isn't done twice; a request whose work is an owner-directed
session's goes to the owner.

Source: `CLAUDE.md`, "Several sessions of one role", "Updates while
idle" and "Requests between sessions".

# Only the architect messages an owner-directed session

2026-11-08 · decided by the owner · written by the architect

**Decided** (owner, 2026-11-08, in the architect's session: "You can
message questions 2, but other roles may not"), for every owner-directed
session (`CLAUDE.md`, "Several sessions of one role"):

- **Only the architect messages it**, news and requests alike. Until now
  the architect sent it news only when the news affected its assigned
  work, and sent it no requests.
- **No other session does**, its own role's included. Until now its
  role's other sessions could send it news (e.g. questions 1 to
  questions 2).
- A session that needs something from it asks the architect, who relays
  it, or the owner. The owner still assigns its work.

Chosen over: a rule for questions 2 alone; the architect sending news
only; questions 1 keeping its news to questions 2.

**Why**: one channel. Questions 2 works on what the owner assigns it;
messages from several sessions would pull it in several directions, and
each wakes it (`CLAUDE.md`, "Updates while idle", the cost).

Source: `CLAUDE.md`, "Several sessions of one role" and "Requests between
sessions". Changes `docs/decisions/20261108T120319-0800-several-sessions-of-one-role.md`
on this point.

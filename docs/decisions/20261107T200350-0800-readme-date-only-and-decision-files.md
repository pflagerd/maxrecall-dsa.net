# readme.html: "Last updated" holds only the date; each decision is a file here

2026-11-08 · decided by the owner · written by the architect

**Decided** (owner, 2026-11-08; A proposed by infrastructure and security,
B by the architect). Every pull request used to add to the same two places
in `readme.html`, the front of "Last updated" (one long line) and the top
of the Decisions table, so any two open at once conflicted there, even
when their real changes were unrelated (four such conflicts resolved by
hand on 2026-11-07 alone: #131 twice, #140 twice).

- **A**: "Last updated" holds only the date. What changed is in the
  commits (`git log -- readme.html`) and in this folder.
- **B**: each new decision, status, or plan started or finished, which
  used to be a row in the readme's Decisions table, is a file in
  `docs/decisions/`, one per decision, written in the same commit as the
  change. The table keeps its rows from before 2026-11-08 as history.

**The format** (also in the readme's "Maintaining this file"):

- Name: `docs/decisions/$(TZ=America/Los_Angeles date +%Y%m%dT%H%M%S%z)-<slug>.md`,
  a Pacific Time timestamp as handoffs have, so the newest is the last by
  name; `<slug>` a few lowercase words joined by hyphens.
- First line: `# <what was decided>`. Then one line: the date (UTC), who
  decided, which role wrote it. Then what a Decisions row said: what,
  why, and `Source:` lines naming the files it comes from.
- **Never edited once merged**: an append-only log. A later change, or a
  correction, is a new file that names this one. So two pull requests
  never edit the same file here, and can't conflict.
- Shared: any role adds a file (`CLAUDE.md`, "Roles"); none edits
  another's. The VPS operator asks for one in its handoff, as it does for
  the readme.
- Nothing lists these files one by one (not the readme, not an index
  file), since a list everyone adds to would conflict as the table did.

Not chosen: git's `union` merge driver (`.gitattributes`), which keeps
both sides' added lines but "tends to leave the added lines in the
resulting file in random order"
(https://git-scm.com/docs/gitattributes#_built_in_merge_drivers), would
have kept both versions of the one "Last updated" line, and may not be
used by GitHub's merge button (a guess, not checked).

Source: `readme.html` ("Last updated", section 11 "Decisions & plans",
section 12 "Maintaining this file"), `docs/roles/*.md` ("Shared files"),
`CLAUDE.md` ("Roles").

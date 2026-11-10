# The VPS operator may `git fetch` without asking

2026-11-10 (UTC) · decided by the owner · written by infrastructure and security

**Decided** (owner, 2026-11-10, about 17:11 UTC). Asked whether the VPS
operator may read `master` for a deploy's survey by a fetch that uses no
credential, into a scratch repository, without a yes each time: "Yes,
but I'd like vps-operator to be able to do git fetch without asking as
well." So both are allowed without asking:

- a plain `git fetch` in root's checkout, `/root/maxrecall-dsa.net`;
- a fetch over anonymous HTTPS into a scratch repository, as the
  operator did on 2026-11-10 (its handoff
  `docs/session-handoff/vps-operator/20261110T090714-0800.md`).

**What it changes.** The rule of 2026-11-08 (`readme.html`, Decisions,
that date; `docs/roles/vps-operator.md`): a `git fetch` in root's
checkout needed the owner's yes until Issue 119 is done, because it
reaches GitHub with root's SSH key, which is the owner's own key for
every repository on the account, and rewrites `origin/*`. This decision
ends that before Issue 119 is done. Issue 119 itself, replacing that
key with a deploy key for this repository only, stays open: the key's
reach is unchanged by this.

**What it doesn't change.** Everything else the operator does that
changes the machine still needs the owner's yes for that change: a
merge or pull in root's checkout, a deploy, anything under `/etc` or
`/srv`. A fetch changes `origin/*` and no checked-out file; the guarded
deploy's step 4 fetches again and compares before deploying
(`docs/deploy-vps.md`, "Updating: the guarded deploy").

**Why** (infrastructure and security's reading, not the owner's words):
the operator's survey needs to see `master`, and asking for each fetch
slowed every deploy; on 2026-11-10 the operator went round it with an
anonymous fetch and asked for a ruling.

**Still to bring into line** (not this role's files; asked of the
architect, 2026-11-10): `docs/roles/vps-operator.md` (its fetch rule,
and "Requests between sessions"), and `CLAUDE.md` ("Updates while idle":
no news to the VPS operator "until #119", whose reason was that each
check needs a fetch; "Requests between sessions": "a `git fetch` until
#119"). Until the role file changes, it and this decision disagree, and
this decision is the newer.

Source: `docs/deploy-vps.md` (step 1 of the guarded deploy); the
owner's message in infrastructure and security's session of 2026-11-10.

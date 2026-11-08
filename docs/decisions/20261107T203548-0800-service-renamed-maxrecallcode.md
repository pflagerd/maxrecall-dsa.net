# The service is `maxrecallcode.service`, renamed once by the next deploy (#123)

2026-11-08 · decided by the owner · written by infrastructure and security

**Decided** (owner, 2026-11-08, #123): the systemd unit
`maxrecall-dsa.test.service` becomes **`maxrecallcode.service`**, the
final name (option A), not `maxrecall-dsa.service` (B, the issue's first
wording). The issue says the repository becomes `maxrecallcode` later; B
would mean renaming the unit twice: two procedures, two restarts, and
the journal's history under three names. **One pull request** (the
owner's choice), so for this change the owner grants an exception to
edit other roles' files where they name the unit: users'
`docs/how-to-add-a-new-user.html` and
`docs/how-to-put-a-question-directly-into-my-queue-by-slug.html`
(`systemctl stop`/`start`), the architect's `docs/contracts.md` and
`docs/roles/vps-operator.md`. Dated plans (`docs/plans/*.md`) and the
readme's Decisions rows keep the old name as history.

**How**: `scripts/deploy-server.sh` installs `maxrecallcode.service`,
then stops, disables and deletes each earlier name in `OLD_UNITS`
(`maxrecall-dsa.test.service`, `maxrecall-dsa.service`), then enables and
starts the new one. `docs/deploy-vps.md` §16 is the deploy that does it,
with checks and an undo; §15 B now stops at a renamed unit file.

**Two traps, fixed in the script**:
- `OLD_UNIT` was `maxrecall-dsa.service`, B's name: changing only `UNIT`
  to it would have installed the unit, then removed it as "the old" one,
  and failed at `enable` with the site down (found by the architect,
  reproduced in a cloud test). The script now refuses an `OLD_UNITS`
  that lists `UNIT`, before it changes anything (a first version checked
  inside the removal loop, after stopping an earlier unit: caught by the
  same test).
- A first run was "no unit file at `UNIT_PATH`": under a new name that
  would have asked "Set up the maxrecall service on this machine?" as if
  nothing were installed. A unit file under any earlier name now counts
  as installed.

**Not changed**: the paths `/srv/maxrecall/maxrecall-dsa.net` and the
`Documentation=` link, which follow the repository's name (#123's second
half). The unit's `Description=` says "MaxRecall Code".

Source: `scripts/deploy-server.sh` (`UNIT`, `OLD_UNITS`, `first_install`),
`deploy/maxrecallcode.service`, `docs/deploy-vps.md` §5, §15, §16; issue
#123.

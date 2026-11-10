# Role: infrastructure and security (merged into core, 2026-11-10)

This role no longer exists. On 2026-11-10 the owner merged it, with the
users role, into one role named **core**: `docs/roles/core.md`.
Everything this file listed under "Owns" is in core's list, under "The
site". Its sign-in, sandbox, deploy and GitHub Actions files are now
"sensitive paths", which the architect reviews
(`docs/roles/core.md`, "Sensitive paths").

- A session told "Role: infrastructure and security" asks the owner
  which role it is (`CLAUDE.md`, "Roles": the role isn't in the table).
- `docs/session-handoff/infrastructure-and-security/` is history. Core's
  first session reads its newest file; core writes in
  `docs/session-handoff/core/`.
- This file as it was:
  `git show 57d906e:docs/roles/infrastructure-and-security.md`.
- Decision: `docs/decisions/20261110T104808-0800-core-role.md`.

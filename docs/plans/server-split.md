# Plan: split `server.js`, the sign-in layer from the feature routes

Owner's decision, 2026-11-05 (option A in the architect's discussion):
`server.js` keeps the sign-in layer and goes to **infrastructure and
security**; the feature routes move to a new `routes.js`, an Express
Router owned by **users**, which `server.js` mounts after the gate.
Until then, `docs/contracts.md` contract 9 (a review rule) stands in.
This plan is the architect's (`docs/roles/architect.md`); the code is
done by users, the role that owns `server.js` today.

## Why

`server.js` (1,368 lines) holds two things: the sign-in layer, which is
security, and the feature routes, which are users' and questions'
subject. With users owning the whole file, a users session could add to
`PUBLIC_PATHS` or `STATIC_FILES`, or change the trusted port's logic,
without the role responsible for security seeing it. Express runs
middleware and routes in the order they're added
(<https://expressjs.com/en/guide/using-middleware.html>), so whoever
owns the file that sets the order decides what the gate protects. After
the split, that's infrastructure and security, and a users session
can't put a route in front of the gate.

Ownership is per file (`CLAUDE.md`, "Roles"), so the layer has to be in
a file of its own; ownership of sections of one file was ruled out.

## After the split

| File | Owner | Holds |
|---|---|---|
| `server.js` | infrastructure and security | Creating the app, `trust proxy`, `express.json()`; who a request is from (`req.userEmail`, `req.viaTrustedPort`, the `AppRequest` typedef); the JSON-only rule for `POST` and `PATCH`; the cookie helpers and `/api/auth/*`; the gate and `PUBLIC_PATHS`; mounting `routes.js`; `STATIC_FILES` and the fallback to `index.html`; both listeners and the startup log |
| `routes.js` (new) | users | Every feature route now in `server.js`'s "Problem data", "API", "Saved submissions", "The learner's profile" and queue sections (`/api/questions…` including run, submit, test and skip, `/api/submissions…`, `/api/profile`, `/api/next`, `/api/queue`), their helpers, and the startup work `prepareQueues()` and `logConsistency()` |

`node server.js` stays the entry point, so the `Makefile`,
`package.json` and `deploy/maxrecall-dsa.test.service` don't change.

## Steps

### 1. Record how the server behaves now (users)

`make test` doesn't exercise the routes, so it can't show the move
changed nothing. Before moving anything, write a characterization check:
a script that starts the server on spare ports with throwaway folders
(`MAXRECALL_USERS_DIR`, `MAXRECALL_AUTH_DIR`, `MAXRECALL_USER` set to a
test email; `MAXRECALL_UNSANDBOXED=1` in the cloud only, never on the
VPS) and records, for each request below, the status, the
`Content-Type`, and the JSON's keys (not values that change from run to
run, like times and ids):

- signed out, on `PORT`: each of `PUBLIC_PATHS` (200); a page
  (redirect to the login page); an `/api/...` route (401); `/api/auth/me`;
- a `POST` to the API that isn't JSON (415);
- signed in (through `TRUSTED_PORT`, which is the test email): every
  feature route, including a Run, a Submit, a Test and a Skip on a small
  question, and `/api/next`, `/api/queue`, `/api/profile`;
- what's served: each of `STATIC_FILES` (200); and `server.js`,
  `package.json`, `.env.example` and `users/` (the fallback's
  `index.html`, never the file itself);
- `trustedServer`: listening on `127.0.0.1` only.

Run it and keep the output. The script lives in the session's scratchpad,
not the repo, unless the owner decides to keep it (see "Open").

### 2. Move the routes (users, one pull request)

- Create `routes.js`:
  `const router = express.Router();`. Move the feature routes into it
  unchanged except `app.get`/`app.post` becoming `router.get`/
  `router.post`, with the same paths, so mounting it with
  `app.use(router)` keeps every URL. Move their helpers and the `require`s
  only they use. Move `prepareQueues()` and `logConsistency()` into an
  exported `start()`, so loading the module does nothing by itself.
  Export `{ router, start }`. JSDoc blocks move with their functions.
- Refer to `AppRequest` as `import('./server').AppRequest` in JSDoc: a
  type import, checked by TypeScript and never run, so `routes.js` never
  `require`s `server.js` (which would be a circular `require`).
- In `server.js`, where the feature routes were (after the gate, before
  `STATIC_FILES` and the fallback): `const { router, start } =
  require('./routes'); start(); app.use(router);`. The fallback
  answers every unmatched path with `index.html`, so mounting the router
  after it would hide every route.
- `server.js` keeps `OWNER_EMAIL` (who the trusted port is) and
  `USERS_DIR` (the startup log) from `users.js`; these become contract
  7's.
- Add `routes.js` to `tsconfig.json`'s `files`. That's infrastructure
  and security's file: the owner allows this one line in this pull
  request as a one-time exception (see "Decided").
- Infrastructure and security reviews the pull request (contract 9: it
  touches the sign-in layer).

### 3. Check (users)

- The characterization check: same output as in step 1.
- `make test`, `make typecheck`, `make doc-check`.
- On Kubuntu, `make dev`: sign in, open a question, Run, Submit, Next;
  sign out and check pages go to the login page.
- After the owner deploys it (`make deploy-server` on the VPS):
  `https://maxrecallcode.net` still asks for the shared login and then
  the app's sign-in, and the tunnel's port 3001 still needs none.

### 4. Ownership and contracts (architect, the next pull request)

Merged straight after step 2's. In between, users owns both files, which
is stricter than the end state, never looser.

- `docs/roles/infrastructure-and-security.md` owns `server.js`;
  `docs/roles/users.md` owns `routes.js`, not `server.js`, and its
  read-only list gains `server.js`.
- `docs/contracts.md`: contract 9 becomes "the router is mounted after
  the gate": every request `routes.js` sees has `req.userEmail` from a
  live session or the trusted listener, and `routes.js` adds no public
  path or served file of its own (new pages are a request to add to
  `STATIC_FILES`). Contract 8 and most of 7 become internal to
  infrastructure and security; 7 gains `OWNER_EMAIL` and `USERS_DIR`.
  Contract 2 (the judge's error codes) moves from `server.js` to
  `routes.js`.
- `readme.html`: Layout (a `routes.js` row, and `server.js`'s), and the
  Decisions row.
- `docs/contracts.md`'s check script, if kept: `server.js` and
  `routes.js` in the right roles.

## Decided (owner, 2026-11-05)

- **`tsconfig.json`**, yes, a one-time exception. It's infrastructure
  and security's, and step 2 can't wait for it: TypeScript fails on a
  listed file that doesn't exist yet (`TS6053`), and an unlisted `routes.js` breaks `CLAUDE.md`'s rule that
  documented files are listed. So step 2's pull request adds the one
  line; the owner says so again in its review, and infrastructure and
  security reviews it anyway (contract 9). This allows that one line,
  not other changes to infrastructure and security's files.
- **Keep the characterization check?** Decided later, after step 3,
  once it's been useful once. As a permanent test (e.g.
  `server-routes.test.js`, run by `make test`) it would guard every later
  change to the routes; it needs a `Makefile` change (infrastructure and
  security's) and an owner for the test file.

## Open

- **The name** `routes.js`: fine as long as it's the only router; if
  questions later takes the judging routes (run, submit, test), they'd
  go to a second router of their own.

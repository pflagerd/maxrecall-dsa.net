# Plan: limited live testing on the VPS

Status: **in planning, 2026-11-04.** Nothing is built yet. Seven questions
and decisions for the owner are below (Q1–Q2, D1–D5). Linked from
`readme.html` → Decisions & plans.

## Goal

The owner's words (2026-11-04): get the VPS "ready for limited live
testing … live, albeit for a very limited target audience", keeping SSH
access as it is.

"Limited" is taken to mean: a handful of people the owner invites, each
with their own account and progress, reaching the app at
`https://maxrecall-dsa.net` from an ordinary browser. Not open sign-up.

## Where things stand (facts from the code and docs)

- **The server listens only on 127.0.0.1.** Port 3000 needs sign-in;
  port 3001 is the trusted port (everyone there is the owner), reached
  only through the SSH tunnel. Source: `deploy/maxrecall-dsa.test.service`
  (`HOST=127.0.0.1`), `server.js` (`TRUSTED_PORT`, `trustedServer`).
  Nothing is on 80 or 443 yet, as far as this repo knows.
- **Only the owner can register.** `register()` accepts only
  `OWNER_EMAIL`, with `MAXRECALL_PASSWORD` as the password, and that
  password becomes the account's password. Source: `auth.js`, `register()`.
  So letting anyone else in is an app change, not only a server change.
- **A new user's data is created when they need it.** `updateQueue()` in
  `server.js` creates `order.json` and `backlog.json` on a user's first
  saved Submit; `prepareQueues()` at start covers users who already have a
  folder. I haven't checked what `GET /api/queue` and `GET /api/next` show
  a brand-new user before their first Submit. That's to check in step 1.
- **The judge has one queue for everyone**: at most 2 judgings at once, a
  few more waiting, then 503. Source: `server.js` startup log, `judge/queue.js`;
  measured on the VPS 2026-11-03 (readme, Decisions). One busy user can
  make others wait.
- **The cookie's `Secure` flag follows `req.secure`.** Behind a reverse
  proxy that terminates HTTPS, Node sees plain HTTP, so `req.secure` is
  false and the cookie goes out without `Secure` unless Express's
  `trust proxy` is set. Already listed in readme, Known gaps. Source:
  `server.js` (`res.cookie(… secure: req.secure)`);
  [Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html).
- **The trusted listener shares the same Express `app`** (`server.js`,
  `trustedServer` calls `app(req, res)`), so a `trust proxy` setting
  applies to both. That's harmless for 3001, which nothing proxies to.
- **Every login attempt costs a 128 MiB scrypt hash, even for an email with
  no account** (on purpose, so timing doesn't reveal accounts). Source:
  `auth.js`, `login()` and `SCRYPT_PARAMS`. Node runs `crypto.scrypt` on
  libuv's thread pool ([Node crypto docs](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback)),
  4 threads by default ([`UV_THREADPOOL_SIZE`](https://nodejs.org/api/cli.html#uv_threadpool_sizesize)).
  So I expect strangers' login floods to cap at about 512 MiB and keep 4
  threads busy, which would also slow file reads that use the same pool.
  That's my reasoning from the docs, not measured. Throttling is per email,
  so a flood with a different email each time isn't throttled.
- **The sandbox's open items** (readme, Known gaps): the shared kernel
  (#22) is the only security one, and it's inherent to namespace
  sandboxes. #23, #24 and #26 are about quality. The readme says these are
  "the remaining work before others are let in".
- **Hidden test cases are public**, in `questions/*.json` in a public repo
  (`docs/plans/multi-user-step-1.md`).
- **Sessions are stored as SHA-256 hashes** of the token (`auth.js`,
  Sessions), so a backup of `auth/` holds no usable session tokens. It does
  hold password hashes.

## Questions only the owner can answer

- **Q1. DNS.** Does `maxrecall-dsa.net` (and `www.`, if wanted) have an A
  record (and AAAA, if the VPS has IPv6) pointing at the VPS? I couldn't
  look it up: the cloud session's network policy blocks DNS lookups. On
  Kubuntu, `dig +short maxrecall-dsa.net A` shows it.
- **Q2. The old MaxRecall.** Does `pflagerd/maxrecall.net` run on this
  VPS? Its `start-server` binds 80 and 443 itself and uses certbot's
  stop/start hooks (`maxrecall.net` repo: `start-server`,
  `maxrecall.net.service`). If it's on this VPS, the two need one web
  server in front of both, and that changes step 3.

## Decisions

### D1. What terminates HTTPS

| Option | For | Against |
|---|---|---|
| **A. nginx + certbot** | nginx is in Ubuntu 24.04's **main** archive, so Canonical issues its security updates ([nginx 1.24.0, noble](https://packages.ubuntu.com/noble/nginx)). Built-in rate limiting ([limit_req](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)) and Basic auth ([auth_basic](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html)), both used below. certbot edits the nginx config and renews by timer ([certbot docs](https://eff-certbot.readthedocs.io/en/stable/using.html#nginx)). | More configuration to understand. certbot is in **universe** ([certbot 2.9.0, noble](https://packages.ubuntu.com/noble/certbot)), but it only runs at renewal time and isn't in the path of requests. |
| **B. Caddy** | Gets and renews certificates by itself, and redirects HTTP to HTTPS, with a 3-line config. | In **universe** ([caddy 2.6.2, noble](https://packages.ubuntu.com/noble/caddy)), so not Canonical security-supported, and 2.6.2 is from 2022. Rate limiting isn't in the standard build; it needs a plugin. |
| **C. Node does TLS itself** (as `maxrecall.net` does) | No extra program. | Binding 443 needs `cap_net_bind_service`; certificate renewal and reload become app code; the unit's `IPAddressDeny=any` would block it reaching Let's Encrypt. |

**Recommendation: A.** The program facing the internet should be the
one with Canonical security support, the same reasoning that ruled out
firejail in `docs/plans/sandboxing.md` (option C there). Both A and B
are open source.

### D2. Who can register

Today the typed registration password becomes the account's password, so
just widening the email check would give every invitee the same password.

| Option | What it is | Trade-off |
|---|---|---|
| **A. Email allowlist + shared password** | A root-only list of emails; the form gets a separate "registration password" field next to the person's own new password. | Smallest change. Anyone who learns the shared password can register as any invitee who hasn't yet. |
| **B. One invite code per person** | `make invite EMAIL=…` prints a random single-use code, stored hashed in `auth/invites/`, expiring after (say) 7 days. The form asks for email, code and a new password. | A bit more code (a file per invite, one new field). A leaked code works for one email, once. Re-inviting also works as a password reset, which doesn't exist today. |
| **C. The owner creates accounts** | `make add-user EMAIL=…` sets a password the owner sends. No self-registration. | The owner knows everyone's first password, and there's no way to change it yet. |

**Recommendation: B.** It replaces the shared `MAXRECALL_PASSWORD`
registration with something per person, and gives a password reset for
free. The owner's own account carries on as it is.

### D3. An outer gate while testing is limited

Without one, anyone on the internet reaches the login API (and its 128 MiB
scrypt per attempt) and every page the app serves before sign-in.

| Option | What it is | Trade-off |
|---|---|---|
| **A. Basic auth at nginx, plus rate limiting** | One shared username and password at nginx for the whole site (over HTTPS only), given to testers with their invite. Plus `limit_req` on `/api/auth/`. | Testers sign in twice (browsers remember the Basic one). Strangers reach nothing of the app. Easy to remove later. |
| **B. Rate limiting only** | `limit_req` on `/api/auth/` (by IP), nothing else. | One sign-in. The app's pages and login are public. |
| **C. Neither** | | The scrypt cost above, unlimited. |

**Recommendation: A** for this phase, dropping Basic auth when the app's
own defences (D2, per-IP throttling) are trusted.

### D4. Is the judge ready for other people?

The readme says the remaining sandbox items are "the remaining work before
others are let in". Of those, only #22 (the shared kernel) is about
security, and no namespace sandbox can close it. Hidden test cases being
public matters only if testers would look.

**Recommendation: go ahead with invited testers the owner trusts**, and
record that decision in the readme. Keep the kernel patched: Ubuntu
installs security updates automatically through `unattended-upgrades`,
but a new kernel only runs after a reboot. That's my understanding of
[Ubuntu's automatic updates](https://documentation.ubuntu.com/server/how-to/software/automatic-updates/),
to check on the VPS with `cat /etc/apt/apt.conf.d/20auto-upgrades` and
`ls /var/run/reboot-required`.

### D5. Other people's data

`/srv/maxrecall/data` would hold testers' emails, code, timings and
password hashes. Two things to decide:

- **Backups.** Recommendation: copy `/srv/maxrecall/data/` (users and
  auth) to Kubuntu with `rsync`, as `docs/deploy-vps.md` §9 already does
  for `users/`, kept out of git (`users/` and `auth/` are gitignored).
- **Telling testers.** Recommendation: a short note with the invite saying
  what's stored and that the owner can read it. I'm not giving legal
  advice; whether anything more is needed depends on where testers live.

## Steps (once the decisions are made)

Each is small and can be checked before the next.

1. **App: invites (D2) and `trust proxy`.** In `auth.js`, `server.js`,
   `login.html`, `login-page.js`, with tests. `app.set('trust proxy',
   'loopback')` so `req.secure` and `req.ip` come from nginx's
   `X-Forwarded-Proto` and `X-Forwarded-For`, and only when the request
   came from 127.0.0.1. Check what a brand-new user sees before their
   first Submit. Deployable while the VPS is still loopback-only, so it can
   be tried through the tunnel's port 3000 first.
2. **VPS: firewall.** `ufw` allowing only SSH, 80 and 443
   ([ufw(8)](https://manpages.ubuntu.com/manpages/noble/en/man8/ufw.8.html)).
   SSH is allowed **before** enabling, with a second SSH session left open
   in case of a lockout. Hostinger's panel may have a firewall of its own
   (not checked).
3. **VPS: nginx and the certificate (D1, D3).** A config file kept in
   `deploy/` like the service file: HTTP → HTTPS redirect, proxy to
   `127.0.0.1:3000` only (never 3001), `X-Forwarded-*` headers set by
   nginx, HSTS ([RFC 6797](https://www.rfc-editor.org/rfc/rfc6797)), and
   D3's gate. Then `certbot --nginx -d maxrecall-dsa.net`.
4. **Check from Kubuntu.** The redirect; the certificate; the cookie has
   `Secure` ([RFC 6265 §4.1.2.5](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.2.5));
   ports 3000 and 3001 still unreachable from outside (deploy-vps.md §6);
   the trusted marker never appears through the public address.
5. **A first invite**, to a second email of the owner's, in a private
   window, before anyone else.
6. **Backups and the note to testers (D5)**, then invites.

`docs/deploy-vps.md` and the readme's Environments section say "SSH tunnel
only, nothing exposed". Step 3 makes that untrue, so they're updated in
the same change.

## Also worth doing, not blocking

- SSH: key-only login (`PasswordAuthentication no` in `sshd_config`), if
  it isn't already. SSH is already public, so this isn't new exposure.
- Per-user fairness in the judge queue, if testers end up waiting on each
  other.
- Per-IP login throttling in the app (needs step 1's `trust proxy` for a
  correct `req.ip`).

## Decision log

| Date | Decision |
|---|---|
| 2026-11-04 | Plan written; waiting for the owner on Q1–Q2 and D1–D5. |

# Plan: limited live testing on the VPS

Status: **step 1 done and deployed, 2026-11-04** (invites and `trust
proxy`); **step 2 done, 2026-11-05** (the firewall: only SSH in); **step 3
done, 2026-11-05**: the site is live at `https://maxrecallcode.net`, behind
the shared Basic auth login (`docs/deploy-vps.md` §13); **step 4** (checks
from outside) done the same day. Next: step 5, then step 6 (backups, D5). Q1, Q2
and D1–D4 are answered and decided (below). D5 (the owner's idea of a git
repository per user) is open; it's needed by step 6. Nothing is exposed
to the internet yet. Linked from
`readme.html` → Decisions & plans.

## Goal

The owner's words (2026-11-04): get the VPS "ready for limited live
testing … live, albeit for a very limited target audience", keeping SSH
access as it is.

"Limited" is taken to mean: a handful of people the owner invites, each
with their own account and progress, reaching the app at
`https://DOMAIN` from an ordinary browser. Not open sign-up. `DOMAIN` is
not chosen yet (Q1).

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

## Questions for the owner

- **Q1, updated 2026-11-05 (owner): three domains, `maxrecallcode.com`,
  `maxrecallcode.net` and `maxrecallcode.org`, pointed at the VPS; no
  `www`.** **`maxrecallcode.net` is the site's address** (owner,
  2026-11-05). Before that was decided: which one is the site's address (the other two
  redirect to it with a 301), because the session cookie is host-only and
  changing it later signs everyone out. Recommended: `.com`. One
  certificate covers all three, so the redirects work over HTTPS too. Not
  yet checked from here (the cloud session can't look up DNS).
- **Q1. DNS. Answered 2026-11-04:** `maxrecall-dsa.net` doesn't point at
  the VPS yet, and the name isn't settled; it will probably be
  `maxrecall-code.net` or similar. Written `DOMAIN` below until it is.
  - Nothing in the code uses a domain name. Every `maxrecall-dsa.net` in
    the repo is the repo's or the checkout's folder name
    (`/srv/maxrecall/maxrecall-dsa.net`), which can stay as it is. The name
    is needed only in step 3 (the nginx config and certbot).
  - **Choose it before step 3.** Changing it later signs everyone out: the
    session cookie has no `Domain` attribute (`server.js`, `setSessionCookie`),
    so browsers keep it for that one host name only
    ([RFC 6265 §4.1.2.3](https://www.rfc-editor.org/rfc/rfc6265#section-4.1.2.3)).
    It also needs a new certificate, and HSTS keeps browsers on HTTPS for
    the old name until it expires
    ([RFC 6797 §6.1.1](https://www.rfc-editor.org/rfc/rfc6797#section-6.1.1)).
    Steps 1 and 2 don't need it.
  - Before step 3: register it, add an A record (and AAAA, if the VPS has
    IPv6) with the VPS's address, and wait until `dig +short DOMAIN A`
    on Kubuntu prints that address. certbot's check comes from Let's
    Encrypt's servers over the internet, so it fails until DNS answers.
- **Q2. The old MaxRecall. Answered 2026-11-04:** `pflagerd/maxrecall.net`
  runs on a different VPS. Ports 80 and 443 on this one are free for
  nginx, and the two sites don't share a web server.

## Decisions

### D1. What terminates HTTPS

| Option | For | Against |
|---|---|---|
| **A. nginx + certbot** | nginx is in Ubuntu 24.04's **main** archive, so Canonical issues its security updates ([nginx 1.24.0, noble](https://packages.ubuntu.com/noble/nginx)). Built-in rate limiting ([limit_req](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html)) and Basic auth ([auth_basic](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html)), both used below. certbot edits the nginx config and renews by timer ([certbot docs](https://eff-certbot.readthedocs.io/en/stable/using.html#nginx)). | More configuration to understand. certbot is in **universe** ([certbot 2.9.0, noble](https://packages.ubuntu.com/noble/certbot)), but it only runs at renewal time and isn't in the path of requests. |
| **B. Caddy** | Gets and renews certificates by itself, and redirects HTTP to HTTPS, with a 3-line config. | In **universe** ([caddy 2.6.2, noble](https://packages.ubuntu.com/noble/caddy)), so not Canonical security-supported, and 2.6.2 is from 2022. Rate limiting isn't in the standard build; it needs a plugin. |
| **C. Node does TLS itself** (as `maxrecall.net` does: `https.createServer` on 443 reading `/etc/letsencrypt/live/…`, `setcap` on the `node` binary, certbot hooks that stop and start the service) | No extra program. No `trust proxy` needed: `req.secure` is simply true. Node's TLS is OpenSSL, with Node's security releases, and a renewed certificate can be loaded without a restart ([`server.setSecureContext()`](https://nodejs.org/api/tls.html#serversetsecurecontextoptions)). | **It ends the service's loopback-only containment.** `IPAddressAllow=`/`IPAddressDeny=` filter "both ingress and egress traffic" ([systemd.resource-control(5)](https://manpages.ubuntu.com/manpages/noble/en/man5/systemd.resource-control.5.html)), so serving the internet means allowing any address, and the server (or anything that escaped a sandbox) could then reach out. **Port 443:** `maxrecall.net`'s `setcap` on the binary can't work here, because the unit's `NoNewPrivileges=yes` stops a program gaining file capabilities ([no_new_privs](https://docs.kernel.org/userspace-api/no_new_privs.html)); `AmbientCapabilities=CAP_NET_BIND_SERVICE` would, but ambient capabilities pass on to child programs ([capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)), here bwrap and the compilers, which would need testing. **The key:** certbot keeps it readable by root only (my understanding), so a deploy hook must copy it for `maxrecall` and tell Node to reload, and it then sits in the same process that runs the judge. **Renewal:** certbot's standalone mode, as `maxrecall.net` uses, needs port 80, hence its stop/start hooks and a short outage at each renewal (`--webroot` avoids that). Rate limiting and D3's gate become app code. |

**Recommendation: A.** The program facing the internet should be the
one with Canonical security support, the same reasoning that ruled out
firejail in `docs/plans/sandboxing.md` (option C there). Both A and B
are open source.

**Decided (owner, 2026-11-04): A, nginx + certbot**, after asking why
the app shouldn't do HTTPS itself as `maxrecall.net` does (option C's row
answers that, corrected the same day).

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

**Decided (owner, 2026-11-04): B, one invite code per person.** Its
details are step 1's, below.

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

**Decided (owner, 2026-11-04): A, Basic auth and rate limiting at nginx.**

**Revised (owner, 2026-11-06): remove Basic auth, in two steps** (option
B of infrastructure and security's analysis, 2026-11-06). The condition
above changes: not "per-IP throttling in the app", which would repeat
nginx's per-address limit, but what reading `auth.js` showed Basic auth
was hiding from strangers:

- **Fixed first (pull request 1, `auth.js` and `server.js`).** Every
  failed sign-in kept a throttling entry keyed by the email as typed, up
  to the 100 KB JSON limit, until a restart: measured 108 KiB kept per
  attempt, about 1.5 GiB a day from one address at nginx's limit. A
  well-formed email over 238 characters failed with `ENAMETOOLONG`, and
  the error, with the path of `auth/`, went back to the browser. Now
  malformed or over-long emails are refused at once (no scrypt, no
  entry), at most 10,000 entries are kept (about 4 MiB), and sign-in
  errors go to the log.
- **Then (pull request 2, nginx).** A **site-wide cap of 30 sign-in
  attempts a minute** on `/api/auth/login` and `/api/auth/register`, on
  top of the per-address limit: each login is a 128 MiB scrypt on
  Node's 4-thread pool, shared with file access, so attempts from many
  addresses could stall the site. During a flood, sign-ins get 429;
  signed-in testers carry on (360-day sessions). The site has IPv6
  (decision log, 2026-11-05), so the per-address limit counts **a /64
  as one address, approximately** (a `map` over the address text: with
  `::` shortened in different places one /64 can count as a few). Then
  `auth_basic` comes out, and `NODE_ENV=production` goes in the service
  (Express's default error handler otherwise sends stack traces).
- **Status (2026-11-06).** Part 1 merged (#80). Part 2 is in the repo
  and tested in the cloud (`docs/deploy-vps.md` §13, the 2026-11-06
  tests): nginx's per-visitor key turned out to need three regular
  expressions, not two, after reading how nginx writes an IPv6 address
  (`ngx_inet6_ntop`), or `2001::5:…`-shaped addresses in different /64s
  would share a limit. The owner runs it on the VPS with §13 step 8;
  record the outcome here.
- **Left as accepted**: anyone reaches the code that runs before
  sign-in (`npm audit` on the VPS, 2026-11-06: 0 vulnerabilities); a
  stolen session cookie no longer also needs the shared login (the
  known gap of a deleted account's sessions matters a little more).
  Unchanged: only invited people have accounts, so who can submit code
  is the same (D4).

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

**Decided (owner, 2026-11-04): go ahead with invited testers the owner
trusts.** Recorded in the readme's Known gaps.

### D5. Other people's data

`/srv/maxrecall/data` would hold testers' emails, code, timings and
password hashes.

**The owner's idea (2026-11-04): each user's folder,
`users/<email>/`, a git repository of its own.** Not decided yet.

What was checked, 2026-11-04, with git 2.43.0 (the version in Ubuntu
24.04, and the cloud session's), in a scratch folder:

- **Folder names like `daniel.pflager@gmail.com` are fine.** `git init`,
  commit and clone (by path and by `file://`) all worked. On Linux a file
  name can hold any byte but `/` and NUL, and git doesn't care what the
  repository's own folder is called. `@` matters to git only in revision
  syntax (`@{upstream}`) and in branch names
  ([git-check-ref-format](https://git-scm.com/docs/git-check-ref-format)),
  not in paths.
- **Fetching over SSH works with the `@` in the path.** With a stand-in
  `ssh` that recorded its arguments, both
  `root@VPS_IP:/srv/maxrecall/data/users/daniel.pflager@gmail.com` and the
  `ssh://` form became host `root@VPS_IP` and the command
  `git-upload-pack '/srv/maxrecall/data/users/daniel.pflager@gmail.com'`:
  only the part before the `:` (or before the first `/` after `ssh://`)
  is read as user and host.
- **Ownership gets in the way.** The repositories would belong to
  `maxrecall`. Root running git in one, a fetch included, failed with
  `fatal: detected dubious ownership in repository` (git's `safe.directory`
  check, [git-config](https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory);
  not read from here, the site is blocked). One `safe.directory` entry per
  exact path fixed it; `…/users/*` did **not** in 2.43. So either root's
  `~/.gitconfig` lists every user (or `*`, which turns the check off), or
  the fetch runs git as `maxrecall`, e.g.
  `--upload-pack='sudo -u maxrecall git-upload-pack'`.
- **The app wouldn't trip over `.git`.** It lists `users/` keeping only
  folders named like an email (`users.js`, `listUsers`) and reads
  `submissions/` (`users.js`, `listSubmissions`); nothing reads a user's
  folder as a whole.
- **Two kinds of file shouldn't be committed:** `writeUserFile` writes
  `<file>.tmp-<pid>` and renames it (`users.js`), so each repository needs
  a `.gitignore` with `*.tmp-*`; and `make recalculate-queue` leaves
  `<file>.before-<label>` copies (`backupUserFile`), which history would
  make unnecessary.

Still to decide if this is the way:

- **Who commits, and when.** (a) The server, after each saved Submit
  (exact history, but git becomes part of the request and can fail it);
  or (b) a systemd timer as `maxrecall`, every N minutes, committing any
  changes (recommended: the server is untouched). A commit can catch
  `backlog.json` written and `order.json` not yet; `updateQueue` in
  `server.js` writes them in that order so that state is the safe one,
  and the next start repairs it.
- **Where the copy lives.** A repository on the VPS isn't a backup by
  itself. Kubuntu would fetch every user's repository over SSH (a loop
  over `ls /srv/maxrecall/data/users`). They must never be pushed to
  GitHub: the app's repository is public.
- **`auth/` stays out of git** (recommended): it holds password hashes and
  invites, and git history keeps whatever was ever committed. Copy it with
  `rsync` instead. Sessions are stored only as SHA-256 hashes, so a copy
  holds no usable sign-in.
- **Deleting a tester's data** is then deleting their folder on the VPS
  and their copy on Kubuntu, a plus of one repository per user over one
  for everyone.

The alternative is the earlier recommendation: `rsync` of the whole
`/srv/maxrecall/data/` to Kubuntu (as `docs/deploy-vps.md` §9 does for
`users/`), with git, if wanted, only on the Kubuntu side.

**Telling testers.** Recommendation: a short note with the invite saying
what's stored and that the owner can read it. I'm not giving legal
advice; whether anything more is needed depends on where testers live.

## What spaced-repetition step 13 changes here (2026-11-04)

Step 13 (a chosen backlog, pull request #51) was merged to `master` while
step 1 was being built, and merged into this branch the same day. Three
consequences for live testing:

- **Changing anyone's backlog stops the site for everyone.**
  `make backlog-add` and `backlog-remove` refuse while a server answers
  (a Submit rewrites `backlog.json` too), so each change is stop, change,
  start (`docs/deploy-vps.md` §10). With testers, nginx shows them an error
  for those seconds. Fine for a handful; if it becomes routine, the server
  could make the change itself, under the same no-`await` rule that keeps
  `updateQueue` safe. Not planned yet. **Setting up a new tester
  doesn't** (spaced-repetition step 14, #57): `make learner-create` creates
  a learner who has no files yet, so the server keeps running
  (`docs/deploy-vps.md` §11).
- **What a new tester starts with is a choice (Q3, below).** With no
  `profile.json` a tester gets `"backlog": "all"`: every question in all
  five languages waiting in the backlog. The owner has just started
  themselves on a chosen backlog (Python, Hello World only, §10).
- **D5:** §10 moves a user's folder to `/srv/maxrecall/data/archive/`,
  outside `users/` (the server would count a folder named like an email as
  a user). A git repository per user moves with its folder, so the two fit;
  backups should include `archive/` too. It exists on the VPS since the
  owner's §10 reset (readme, Decisions, "Checked on the VPS", step 13).

- **Q3. How should a new tester start?** (a) As the code does now, every
  question in every language; (b) set up by hand before the invite goes
  out, as §10 does for the owner (a `profile.json`, then `make
  backlog-add` with the server stopped); (c) `make invite` writes a
  starting `profile.json` and backlog as well. Recommendation: **(b)** for
  the first few testers, since the tools exist; (c) once it's tedious.
  **Decided by the owner in another session:** (b) on 2026-11-04 (#54),
  then (c) on 2026-11-05 (spaced-repetition step 14, #57): `make
  learner-create EMAIL=… LANGUAGES=… SLUGS="…"` creates the folder, the
  profile and the backlog in one command, with the server running, then
  `make invite`. Procedure: `docs/deploy-vps.md` §11; details:
  `docs/plans/spaced-repetition.md`, step 14.

## Steps (once the decisions are made)

Each is small and can be checked before the next.

1. **App: invites (D2) and `trust proxy`.** In `auth.js`, `server.js`,
   `login.html`, `login-page.js`, a new `scripts/invite.js` and
   `make invite`, with tests. Deployable while the VPS is still
   loopback-only, so it can be tried through the tunnel's port 3000 first.
   **Done 2026-11-04**, with these details (proposed that day; the owner
   decided 6 and 7, the rest as proposed):
   1. **The invite file**: `auth/invites/<email>.json` with
      `schemaVersion`, `email`, `createdAt`, `expiresAt` and the code's
      SHA-256. A fast hash is enough because the code is random, the
      same reasoning as session tokens (`auth.js`, Sessions). A new invite
      for the same email replaces the old one.
   2. **The code**: 16 random bytes (128 bits) in base64url, 22
      characters, to copy and paste.
   3. **It expires after 7 days**, and is deleted when used.
   4. **`make invite EMAIL=…`** prints the code. On the VPS:
      `sudo -u maxrecall env MAXRECALL_AUTH_DIR=/srv/maxrecall/data/auth make invite EMAIL=…`,
      as `make rename-question` is run (`docs/deploy-vps.md` §8).
   5. **The form**: email, invite code, password, confirm. Every refusal
      gives the same message, as now; throttling stays per email.
   6. **`MAXRECALL_PASSWORD` goes** (owner: go ahead): the owner can
      invite themselves, so there's one way to register, and
      `/etc/maxrecall-dsa/test.env` is no longer needed; the unit file no
      longer reads it. Existing accounts are untouched. The server logs a
      line at startup if the variable is still set.
   7. **Minimum password length: at least 12** (owner's decision), for new
      passwords only, up from 10 (2026-10-30). I had recommended 15, NIST
      SP 800-63B rev. 4's minimum for a password used alone
      ([§3.1.1.2](https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver));
      12 is knowingly below it. Counted in characters (code points), so an
      emoji counts once.
   8. **Password reset**: by hand for now: delete
      `auth/accounts/<email>.json`, then invite again.
   9. **`app.set('trust proxy', 'loopback')`**, so `req.secure` and
      `req.ip` come from nginx's `X-Forwarded-Proto` and `X-Forwarded-For`,
      believed only from 127.0.0.1
      ([Express behind proxies](https://expressjs.com/en/guide/behind-proxies.html)).
      **Corrected 2026-11-04:** I had written that nginx must replace, not
      append to, any `X-Forwarded-For` a visitor sends. Reading Express 4's
      dependencies showed it needn't: `forwarded`'s `parse()` reads the
      header from the right, and `proxy-addr`'s `alladdrs()` stops at the
      first untrusted address, so `req.ip` is nginx's entry for the visitor,
      whatever the visitor put to its left. Either nginx setting is safe.
   10. **A brand-new user**: checked, nothing to fix. Before their first
       Submit, with no `users/<email>/` folder, `GET /api/profile` gives
       every language allowed, `GET /api/queue` lists every pair in the
       backlog, and `GET /api/next` gives `two-sum` in JavaScript. Nothing
       is written until the first Submit (`updateQueue`).

   **How it was checked (cloud, 2026-11-04):** `make test` 177 (10 new in
   `auth.test.js`); each of 4 deliberately broken versions of `auth.js`
   (expiry ignored, any code accepted, length in UTF-16 units, the code
   stored) failed at least one. `make typecheck` and `make doc-check` pass.
   The server, on spare ports with throwaway folders: `make invite`, then
   registering over HTTP (refused the second time, and without `invite`);
   a login from 127.0.0.1 with `X-Forwarded-Proto: https` got a `Secure`
   cookie, the same from the container's other address didn't; the
   Register form in headless Chromium (an 11-character password stopped by
   the browser, then registered and signed in); `make invite` refused with
   no `EMAIL`, a non-email, and a folder owned by another user (writing
   nothing).

   **Found while building:** deleting an account leaves its sessions
   working (`sessionEmail` doesn't check the account), so a reset by hand
   should also delete that email's files in `auth/sessions/`. Listed in
   the readme's Known gaps.
2. **VPS: firewall.** `ufw` allowing only SSH
   ([ufw(8)](https://manpages.ubuntu.com/manpages/noble/en/man8/ufw.8.html)).
   SSH is allowed **before** enabling, with a second SSH session left open
   in case of a lockout. Hostinger's panel may have a firewall of its own
   (not checked). **Written 2026-11-04 as `docs/deploy-vps.md` §12, for
   the owner to run.** Two choices made there: 80 and 443 are opened in
   step 3, with nginx, rather than now (nothing answers on them yet); and
   SSH gets `allow`, not `limit`, since `limit`'s 6 connections in 30 s
   would also stop the owner's `rsync` and D5's fetch per user. Checked
   against Ubuntu 24.04's `ufw` 0.36.2-6 package: loopback (the tunnel) and
   established connections are accepted before any rule.
   **Rebooted 2026-11-05** (owner): the service, `ufw` and the judge's
   sandbox (the AppArmor profile) came back by themselves. The kernel
   stayed `6.8.0-147`: the restart was for another package. It's the
   newest kernel Ubuntu offers this VPS (checked after `apt update`), so
   D4's condition holds.
3. **VPS: nginx and the certificate (D1, D3).** A config file kept in
   `deploy/` like the service file: HTTP → HTTPS redirect, proxy to
   `127.0.0.1:3000` only (never 3001), `X-Forwarded-*` headers set by
   nginx, HSTS ([RFC 6797](https://www.rfc-editor.org/rfc/rfc6797)), and
   D3's gate. Then `certbot --nginx -d DOMAIN` (Q1).
   **Written 2026-11-05 as `docs/deploy-vps.md` §13 and
   `deploy/nginx-maxrecallcode.conf`, for the owner to run.** Choices made
   there (small ones, stated rather than asked):
   - `maxrecallcode.net` is the site (owner); `.com` and `.org` redirect
     to it with a 301, over HTTP and HTTPS; one certificate covers all
     three.
   - `certbot certonly --webroot` rather than `certbot --nginx`, so certbot
     never edits nginx's configuration and the installed file stays the
     repo's. A small HTTP-only site serves the first check; the real
     configuration serves renewals. `--deploy-hook 'systemctl reload
     nginx'` is saved for renewals (`renew_hook`, certbot's
     `_internal/renewal.py`).
   - Rate limiting (D3) only on `/api/auth/login` and `/api/auth/register`,
     10 a minute per address plus a burst of 5: every page asks
     `/api/auth/me` (`account.js`), so limiting all of `/api/auth/` would
     break browsing.
   - HSTS for a day while testing (`max-age=86400`), a year later; no
     `includeSubDomains` or `preload`.
   - TLS 1.2 and 1.3 only (Ubuntu's `nginx.conf` still allows 1.0 and
     1.1); HTTP/2.
   - nginx replaces `X-Forwarded-For` with the visitor's address, and
     doesn't pass the Basic auth password on (`Authorization`).
   - `proxy_read_timeout 300s`: a Submit can wait behind 10 others, 2 at a
     time, each up to about 30 s (`judge/runner.js`, `judge/queue.js`),
     beyond nginx's 60 s default. Worked out from the limits, not measured.
   - No app change was needed: step 1's `trust proxy` makes the cookie
     `Secure` behind nginx. (I had said a small one would be; wrong.)
   **Tested in the cloud** with nginx 1.24.0, a self-signed certificate in
   certbot's path and the real app behind it: the redirects, the 401s,
   HSTS on every answer, HTTP/2, TLS 1.1 refused, the headers the app
   receives, a `Secure` cookie from registering through nginx,
   `trusted: false`, `/api/auth/me` never limited and logins limited after
   the burst. Not testable there: IPv6 `listen` lines and Let's Encrypt.
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
| 2026-11-04 | Q1 (owner): the domain doesn't point at the VPS yet, and its name isn't settled, probably `maxrecall-code.net` or similar. Needed before step 3 only. |
| 2026-11-04 | Q2 (owner): the old MaxRecall runs on a different VPS, so ports 80 and 443 here are free. |
| 2026-11-04 | Correction (owner asked why the app shouldn't do HTTPS itself, as `maxrecall.net` does): D1 option C's "the unit's `IPAddressDeny=any` would block it reaching Let's Encrypt" was wrong, since certbot runs outside the unit. The real conflict is the other way: the filter covers incoming traffic too, so serving the internet directly means dropping the loopback-only containment. Option C's row rewritten. |
| 2026-11-04 | D1–D4 decided (owner): as recommended. nginx + certbot; one invite code per person; Basic auth and rate limiting at nginx while testing is limited; go ahead with invited testers the owner trusts. |
| 2026-11-04 | D5 (owner's idea): a git repository per user folder, asking how git handles names like `daniel.pflager@gmail.com`. Checked: fine; the `safe.directory` ownership check is what needs handling. Details waiting. Step 1's ten details proposed. |
| 2026-11-04 | Step 1 details (owner): 6, drop `MAXRECALL_PASSWORD`, yes; 7, at least 12 characters for new passwords; the rest as proposed. |
| 2026-11-04 | Step 1 done. Correction: detail 9's "nginx must replace `X-Forwarded-For`" was wrong; appending is also safe with Express's `trust proxy`. |
| 2026-11-04 | `master` (spaced-repetition step 13, a chosen backlog) merged into this branch: conflicts only where both added lines (Makefile, server.js imports, tsconfig.json, readme rows); `make test` 195. Its consequences, and Q3 (how a new tester starts), recorded above. |
| 2026-11-04 | `master` `d1d19af` merged (readme only: the owner's VPS check of step 13, so the VPS runs `52ac615` and has `/srv/maxrecall/data/archive/`). Nothing in this plan changes. |
| 2026-11-04 | Q3 (owner): to be dealt with in another session. Step 1 goes to `master` through a pull request. |
| 2026-11-04 | Step 1 merged (#52, `776119d`) and deployed by the owner: the VPS log says `registration by invite only`, with the sandbox working and no `MAXRECALL_PASSWORD` warning. Registration had been closed there before (no `test.env`), so the owner has no port-3000 account on the VPS yet. |
| 2026-11-04 | Step 2 written as `docs/deploy-vps.md` §12 (SSH only; 80 and 443 with nginx in step 3; `allow`, not `limit`). Waiting for the owner to run it. |
| 2026-11-04 | Step 2 run by the owner: `ufw status verbose` says `Status: active`, `Default: deny (incoming), allow (outgoing), deny (routed)`, and only `22/tcp` (IPv4 and v6, `# SSH`) allowed in. Not yet reported: §12's check from a fresh SSH connection, the tunnel, and `curl` to port 3000 failing. |
| 2026-11-05 | Step 2 checked from Kubuntu (owner): `ssh root@srv702017.hstgr.cloud true` printed `ssh ok` (a fresh connection gets in), and `curl --max-time 5 http://srv702017.hstgr.cloud:3000/` timed out rather than being refused, which is `ufw` dropping it (`DEFAULT_INPUT_POLICY="DROP"`). Step 2 done. A first try ran `ssh` from the VPS to its own name, which resolves to 127.0.1.1 there and goes over loopback, so it tested nothing; §12 now says so. Still to do: the reboot the login banner asks for (`System restart required`; D4's patched kernel), then checking the service and `ufw` came back by themselves. |
| 2026-11-05 | The firewall section renumbered §12: pull request #54 (the owner's other session, Q3's option (b)) adds `docs/deploy-vps.md` §11, setting up a new tester before inviting them. |
| 2026-11-05 | #54 merged to `master` and merged into this branch (§11 tester setup, then §12 firewall). The VPS's DNS name, `srv702017.hstgr.cloud` (owner), now replaces the `VPS_IP` placeholder in `docs/deploy-vps.md` and is recorded in the readme. |
| 2026-11-05 | #55 merged (step 2). The owner rebooted the VPS (`System restart required`, D4's patched kernel): afterwards `systemctl is-active maxrecall-dsa.test.service` said `active` and `ufw status` `Status: active` with only 22/tcp, so both come back by themselves. Then this boot's log: `Sandbox: bubblewrap 0.9.0 works (self-test passed)` (the AppArmor profile reloads at boot) and `registration by invite only`. **Correction:** I had said the restart was usually for a new kernel; here it wasn't. `uname -r` still says `6.8.0-147-generic`, with no reboot pending, so another package needed it (`/var/run/reboot-required.pkgs`, gone after the reboot, would have said which). Whether a newer kernel is waiting among the pending updates (201, 10 security, 1 not installed automatically) isn't checked yet, so D4's "kernel kept patched" isn't confirmed. |
| 2026-11-05 | D4's patched kernel confirmed (owner): after `apt update`, no newer `linux-image`/`linux-generic`/`linux-headers` package is waiting, and the installed `linux-image-generic` and `linux-image-virtual` (the packages that follow the newest kernel) are `6.8.0-147`, the running one. `6.8.0-110` is still installed, as the fallback Ubuntu keeps. 187 other updates are waiting (security ones not counted yet); installing them is for a time the owner chooses, with `make sandbox-test` and `make line-numbers-test` afterwards, since they can change g++, OpenJDK, Python or bubblewrap. |
| 2026-11-05 | Security updates are kept up automatically (owner's `/var/log/unattended-upgrades/unattended-upgrades.log`): it runs daily from `noble` and `noble-security`, and each run ends `No packages found that can be upgraded unattended`. The one update the banner said couldn't be installed automatically is `cloud-init`, `marked to be held back`; left held (my guess: the provider holds it; the app doesn't use it). So the 187 waiting updates are ordinary `noble-updates` fixes, not urgent. |
| 2026-11-05 | Q3 settled in the other session: option (c), `make learner-create` (#57), which needs no server stop. Recorded above; the readme's `users.js` row and `users.js`'s comment no longer call `MAXRECALL_USER` the owner allowed to register (it's only the trusted port's owner since #52). |
| 2026-11-05 | Q1 (owner): `maxrecallcode.com`, `.net` and `.org`, pointed at the VPS; no `www`. Which is the site's address is waiting for the owner (recommended `.com`). |
| 2026-11-05 | Q1 (owner): `maxrecallcode.net` is the site; DNS checked by the owner for all three names (A and AAAA, the `.org` AAAA after a cache delay). Step 3 written as `docs/deploy-vps.md` §13 with `deploy/nginx-maxrecallcode.conf`, tested in the cloud; waiting for the owner to run it. |
| 2026-11-05 | Step 3 run by the owner (#62, `docs/deploy-vps.md` §13): `https://maxrecallcode.net` asks for the shared Basic auth login, then the app's Register form; registering with an invite signed the owner in and showed their list. The owner's first account on the public site. §13 step 7 from Kubuntu: `https://maxrecallcode.org/` gave `301 https://maxrecallcode.net/` (so the certificate covers it), `https://maxrecallcode.net/` `HTTP/2 401` with `strict-transport-security: max-age=86400`, and port 3000 timed out. That's step 4 (checks from outside) too. Next: step 5 (a second email of the owner's, `make learner-create` and `make invite`), then step 6 (backups, D5, and the note to testers). |
| 2026-11-05 | `docs/how-to-add-a-new-user.html` (owner's request): steps 5 and 6's procedures in one page, like the problem page. It includes a draft message to testers saying what's stored about them (D5's "telling testers"), and a reset and removal that delete the user's sessions too. D5's backups are still open. |
| 2026-11-05 | D5, partly (owner): each new user's folder becomes a git repository at setup, a step in `docs/how-to-add-a-new-user.html` (step 3). As the owner wrote it, it would fail on the VPS, so it runs every git command as `maxrecall` (root would own `.git`; git refuses root in a `maxrecall`-owned repository), sets a per-repository identity (`maxrecall` has none: "Please tell me who you are"), and adds `.gitignore` `*.tmp-*`; tested on a real `make learner-create` folder owned by a service user, with `make consistency-check` finding nothing. **Still open:** where the remote is (a private GitHub repository per user, Kubuntu pulling over SSH, recommended, or a bare repository on the VPS), and what commits later (a timer, or by hand): the first commit holds only the starting files. |
| 2026-11-05 | D5's remote decided (owner): **option B, Kubuntu pulls** over SSH; nothing pushed from the VPS, no credentials there. Kubuntu clones with `--upload-pack='sudo -u maxrecall git-upload-pack'` and `-c remote.origin.uploadpack=…` (the first alone doesn't last past the clone; tested over `file://` with a repository owned by another user, not yet over SSH), then `git pull --ff-only`. The owner will use git-nested, a tool of their own (unpublished); it must do the same on the VPS side. The periodic commit on the VPS is issue #64. |
| 2026-11-06 | D3 revised (owner): remove Basic auth, in two pull requests: first `auth.js` and `server.js` (malformed and over-long emails refused first, throttling bounded at 10,000 entries, sign-in errors to the log), then nginx (a site-wide cap of 30 sign-in attempts a minute, the per-address limit by IPv6 /64, `auth_basic` removed, `NODE_ENV=production`). |
| 2026-11-06 | D3, part 2 in the repo (infrastructure and security): `auth_basic` removed from `deploy/nginx-maxrecallcode.conf`; sign-in limited per visitor (an IPv6 /64 as one, approximately, by a three-line `map`) and site-wide (30 a minute, burst 10); `NODE_ENV=production` in the service. Tested in the cloud; the VPS steps are `docs/deploy-vps.md` §13 step 8, for the owner. |

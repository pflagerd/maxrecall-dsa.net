.PHONY: all install toolchain-deps sandbox-deps build run dev clean test typecheck doc-check consistency-check delete-question rename-question recalculate-queue backlog-show backlog-add backlog-remove learner-create invite sandbox-test line-numbers-test deploy-server open-ssh-3005

PORT ?= 3000
# Seconds `make run`/`make dev` wait for the server to answer before giving up on opening a browser
OPEN_WAIT ?= 30

# Shell snippet shared by run and dev. In the background, poll the server every
# 0.2s for about OPEN_WAIT seconds (whole-second clock, so +/-1s), then open it
# in the default browser. If it never answers, give up without opening anything.
# Defined with = (not :=) so $@ expands to the target (run or dev) where it's used.
OPEN_BROWSER = ( deadline=$$(( $$(date +%s) + $(OPEN_WAIT) )); \
	  until curl -s -o /dev/null --max-time 1 http://localhost:$(PORT)/; do \
	    if [ $$(date +%s) -ge $$deadline ]; then echo "make $@: no answer on port $(PORT) after $(OPEN_WAIT)s; not opening a browser" >&2; exit 1; fi; \
	    sleep 0.2; \
	  done; \
	  xdg-open http://localhost:$(PORT)/ ) &

all: build

# Install the toolchains from docs/deploy-vps.md §1–§2 if missing: g++, a
# JDK, python3, curl, xz-utils (apt) and Node 22 (nodejs.org, into
# /usr/local). Asks for sudo only when it has something to install; stops
# make if it can't fix things. See scripts/toolchain-deps.sh.
toolchain-deps:
	./scripts/toolchain-deps.sh

# Install dependencies
install: node_modules

# toolchain-deps is order-only (after the |): it runs first, since npm needs
# node, but doesn't make node_modules count as out of date.
node_modules: package.json | toolchain-deps
	npm install

# Install the judge's sandbox (bubblewrap, and Ubuntu's AppArmor profile for
# it if AppArmor is what's in the way) if missing, then check it works. Asks
# for sudo only when it has something to install. See scripts/sandbox-deps.sh.
sandbox-deps: toolchain-deps
	./scripts/sandbox-deps.sh

# "Build" step: just ensure dependencies are installed (static HTML/CSS/JS needs no compile)
build: install sandbox-deps

# Run the server in the foreground (so Ctrl-C stops it) and open it in the browser
run: build
	$(OPEN_BROWSER)
	PORT=$(PORT) node server.js

# Same, but with auto-reload for development (requires nodemon, installed via devDependencies)
dev: build
	$(OPEN_BROWSER)
	PORT=$(PORT) npx nodemon server.js

# Unit tests: every *.test.js in the top folder, with Node's built-in test
# runner. The files are named, not left to node --test's defaults, which
# would also pick up judge/line-numbers-test.js (it matches *-test.js) and so
# need the sandbox and every compiler. Needs no sandbox itself.
TEST_FILES := $(wildcard *.test.js)
test: toolchain-deps
	node --test $(TEST_FILES)

# Checks the JSDoc types with TypeScript (a development dependency, so it
# needs npm install, hence node_modules): the Node files tsconfig.json lists,
# then the browser files tsconfig.browser.json lists, which need the DOM's
# types instead of Node's. Compiles nothing. Fails (make prints an Error
# line) if a type doesn't match.
typecheck: node_modules
	./node_modules/.bin/tsc -p tsconfig.json
	./node_modules/.bin/tsc -p tsconfig.browser.json

# Checks that every function in the files the two tsconfig files list has a
# JSDoc block documenting its signature: a @param for each parameter and a
# @returns (CLAUDE.md, "Documenting code"). make typecheck checks that the
# types written are right; this checks that they're written at all. Uses
# TypeScript 6.0.3's parser (the "typescript6" development dependency).
# Fails, listing each function as file:line, if any isn't documented.
doc-check: node_modules
	node scripts/doc-check.js

# The consistency check (docs/plans/spaced-repetition.md, D5; step 10):
# compares questions/ and questions/renames.json with every user's
# profile.json, order.json, backlog.json and submission records, and lists
# what disagrees. Only reads, so it's safe while the server runs (though a
# Submit landing mid-check can show a pair as missing for a moment). Uses
# MAXRECALL_USERS_DIR like the server. Fails (make's "Error 1") only for an
# error, an invalid file; warnings often have harmless causes. VERBOSE=1
# lists each backlog pair that has records, instead of one summary line.
consistency-check:
	node scripts/consistency-check.js $(if $(VERBOSE),--verbose)

# Deleting and renaming a question (docs/plans/spaced-repetition.md, D5;
# step 11): make delete-question SLUG=two-sum, make rename-question
# FROM=two-sum TO=pair-sum. Each changes the question file with git, staged
# but not committed (unless a git pull already did it), then updates every
# user's order.json and backlog.json; records are never changed. Stop the
# server first: they refuse if one answers on 127.0.0.1:$PORT. DRY_RUN=1
# prints what would change and changes nothing. SLUG, FROM, TO and DRY_RUN
# reach the script through its environment (GNU make puts command-line
# variables there), never pasted into this recipe, so a name can't run as
# shell code; the script checks them.
delete-question:
	node scripts/question-admin.js delete

rename-question:
	node scripts/question-admin.js rename

# Recalculating one learner's queue and backlog from their records
# (docs/plans/spaced-repetition.md, step 12, first part): make
# recalculate-queue EMAIL=owner@example.com. Replays every Submit and Skip,
# oldest first, through the same rule a Submit uses, with a random number
# generator seeded from the email, so DRY_RUN=1 shows exactly what will be
# written. Keeps a copy of both files first (<name>.before-recalculate-<UTC
# time>). Stop the server first. EMAIL and DRY_RUN reach the script through
# its environment, as for rename-question.
recalculate-queue:
	node scripts/recalculate-queue.js

# Inviting someone (docs/plans/limited-live.md, D2): make invite
# EMAIL=learner@example.com prints a code that lets that email register,
# once, within 7 days. Run it as the user who owns the sign-in data (on the
# VPS, the maxrecall user, with MAXRECALL_AUTH_DIR as in the service file);
# it refuses otherwise. The server can keep running. EMAIL reaches the
# script through its environment, as for rename-question.
invite:
	node scripts/invite.js

# Choosing a learner's backlog (docs/plans/spaced-repetition.md, step 13),
# for a profile.json with "backlog": "chosen", where the server adds nothing
# to the backlog by itself. make backlog-show EMAIL=… lists their queue,
# backlog and every question (only reads). make backlog-add EMAIL=…
# SLUGS="hello-world two-sum" adds those questions, in that order, in each
# language turned on, at the end, or from position AT=n (1 is the front).
# make backlog-remove EMAIL=… SLUGS="…" takes them out of the backlog.
# add and remove: stop the server first (they refuse if one answers on
# 127.0.0.1:$PORT); DRY_RUN=1 changes nothing. EMAIL, SLUGS, AT and DRY_RUN
# reach the script through its environment, as for rename-question.
backlog-show:
	node scripts/backlog.js show

backlog-add:
	node scripts/backlog.js add

backlog-remove:
	node scripts/backlog.js remove

# Setting up a new learner before their invite goes out (docs/plans/
# spaced-repetition.md, step 14): make learner-create EMAIL=… LANGUAGES=python
# SLUGS="hello-world two-sum". Writes users/<email>/ (the email lower-cased)
# with profile.json (allowed.languages, "backlog": "chosen"), an empty
# order.json and backlog.json, all at once; refuses if the folder exists.
# The server can keep running. It doesn't make the invite: it prints the
# make invite command. DRY_RUN=1 changes nothing. The values reach the
# script through its environment, as for backlog-add.
learner-create:
	node scripts/learner-create.js

# Escape test for the judge (docs/plans/sandboxing.md step 0): submits hostile
# code and reports each probe as contained, ESCAPED, skipped (this machine
# can't test it) or inconclusive (it didn't run as intended). Fails, with
# make's "Error 1", unless every probe is contained or skipped.
sandbox-test: sandbox-deps
	node judge/sandbox-selftest.js

# Checks that error messages give the editor's line numbers in every
# language and both judging modes, and that correct answers are still
# Accepted (issue #26).
line-numbers-test: sandbox-deps
	node judge/line-numbers-test.js

# Set up, or update, the systemd service on this machine: docs/deploy-vps.md
# done for you (scripts/deploy-server.sh). For the VPS. Needs root (asks for
# sudo), and the first run asks before changing anything (DEPLOY_CONFIRM=yes
# skips that). The prerequisites run with systemd's own PATH, the one the
# service gets, so toolchains in your home folder can't get in the way; a
# target-specific exported variable applies to prerequisites too.
SYSTEMD_PATH := /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
deploy-server: export PATH := $(SYSTEMD_PATH)
deploy-server: toolchain-deps sandbox-deps
	./scripts/deploy-server.sh

# Remove installed dependencies
clean:
	rm -rf node_modules

# Opens the SSH tunnel to the VPS's trusted port (docs/deploy-vps.md §7),
# then browse http://localhost:3005 (opened for you, as run/dev do).
# Ctrl-C closes it. Port 3005 so it doesn't clash with make dev on 3000.
# Override the host with make open-ssh-3005 VPS_HOST=...
# PORT is overridden to 3005 just for this target (a target-specific
# variable), so $(OPEN_BROWSER) polls and opens the tunnel's local port
# instead of the global PORT ?= 3000 default.
VPS_HOST ?= srv702017.hstgr.cloud
open-ssh-3005: PORT := 3005
open-ssh-3005:
	$(OPEN_BROWSER)
	ssh -N -L 3005:127.0.0.1:3001 root@$(VPS_HOST)

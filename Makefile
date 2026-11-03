.PHONY: all install toolchain-deps sandbox-deps build run dev clean test typecheck sandbox-test line-numbers-test deploy-server open-ssh-3005

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

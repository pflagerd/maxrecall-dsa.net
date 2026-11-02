.PHONY: all install toolchain-deps sandbox-deps build run dev clean sandbox-test deploy-server open-ssh-3005

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

# Escape test for the judge (docs/plans/sandboxing.md step 0): submits hostile
# code and reports each probe as contained, ESCAPED, skipped (this machine
# can't test it) or inconclusive (it didn't run as intended). Fails, with
# make's "Error 1", unless every probe is contained or skipped.
sandbox-test: sandbox-deps
	node judge/sandbox-selftest.js

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
# then browse http://localhost:3005. Ctrl-C closes it. Port 3005 so it
# doesn't clash with make dev on 3000. Override the host with
# make open-ssh-3005 VPS_HOST=...
VPS_HOST ?= srv702017.hstgr.cloud
open-ssh-3005:
	ssh -N -L 3005:127.0.0.1:3001 root@$(VPS_HOST)

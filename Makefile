.PHONY: all install build run dev clean

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

# Install dependencies
install: node_modules

node_modules: package.json
	npm install

# "Build" step: just ensure dependencies are installed (static HTML/CSS/JS needs no compile)
build: install

# Run the server in the foreground (so Ctrl-C stops it) and open it in the browser
run: build
	$(OPEN_BROWSER)
	PORT=$(PORT) node server.js

# Same, but with auto-reload for development (requires nodemon, installed via devDependencies)
dev: build
	$(OPEN_BROWSER)
	PORT=$(PORT) npx nodemon server.js

# Remove installed dependencies
clean:
	rm -rf node_modules

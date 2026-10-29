.PHONY: all install build run dev clean

PORT ?= 3000

all: build

# Install dependencies
install: node_modules

node_modules: package.json
	npm install

# "Build" step: just ensure dependencies are installed (static HTML/CSS/JS needs no compile)
build: install

# Run the server in the foreground (so Ctrl-C stops it). In the background,
# wait until it answers, then open it in the default browser.
run: build
	( until curl -s -o /dev/null http://localhost:$(PORT)/; do sleep 0.2; done; xdg-open http://localhost:$(PORT)/ ) &
	PORT=$(PORT) node server.js

# Run with auto-reload for development (requires nodemon, installed via devDependencies)
dev: build
	PORT=$(PORT) npx nodemon server.js

# Remove installed dependencies
clean:
	rm -rf node_modules

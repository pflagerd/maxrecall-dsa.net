.PHONY: all install build run dev clean

PORT ?= 3000

all: build

# Install dependencies
install: node_modules

node_modules: package.json
	npm install

# "Build" step: just ensure dependencies are installed (static HTML/CSS/JS needs no compile)
build: install

# Run the server
run: build
	PORT=$(PORT) node server.js &
	google-chrome http://localhost:$(PORT)

# Run with auto-reload for development (requires nodemon, installed via devDependencies)
dev: build
	PORT=$(PORT) npx nodemon server.js

# Remove installed dependencies
clean:
	rm -rf node_modules

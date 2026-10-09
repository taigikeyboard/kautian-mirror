.PHONY: all init install build serve test clean

all: build

# submodule + only the converter it needs (skips the unused ebird reference)
init:
	git submodule update --init vendor/kautian-extension
	git -C vendor/kautian-extension submodule update --init vendor/taigi-converter

install:
	npm install

# search index (extension build-data) → entry shards → bundle + static files into dist/
build:
	npm run build

# local preview at http://127.0.0.1:8000 (run `make build` first)
serve:
	npm run serve

# entry-data tests (run `make build` first on a fresh tree)
test:
	npm test

clean:
	rm -rf dist

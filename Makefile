.PHONY: all init hooks install audio build serve test bench package clean

all: build

# taigi-converter submodule (index + entry builds need it)
init: hooks
	git submodule update --init vendor/taigi-converter

# gitleaks pre-commit hook (needs `brew install gitleaks`)
hooks:
	git config core.hooksPath .githooks

install:
	npm install

# MOE word audio → dist/audio/ (300 MB download, cached in .cache/); run before `make build`
audio:
	npm run build:audio

# search index → entry shards → site bundle into dist/ → extension bundle into extension/dist/
build:
	npm run build

# local preview at http://127.0.0.1:8000 (run `make build` first)
serve:
	npm run serve

# site + extension tests (run `make build` first on a fresh tree)
test:
	npm test

# search engine benchmark (run `make build` first)
bench:
	npm run bench

# extension store upload zip → extension/kautian-extension.zip (runs a full build first)
package:
	npm run package:ext

clean:
	rm -rf dist extension/data extension/dist extension/kautian-extension.zip

.PHONY: all install build test bench package clean

all: build

install:
	npm install

# everything: kautian.csv + kautian.ods → data/kautian.min.json, then esbuild bundle
build:
	npm run build

# unit + golden tests (run `make build` first on a fresh tree)
test:
	npm test

bench:
	npm run bench

# store upload zip (runs a full build first)
package:
	npm run package

clean:
	rm -rf data dist kautian-extension.zip

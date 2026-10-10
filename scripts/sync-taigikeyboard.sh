#!/usr/bin/env bash
# Fetches kautian.csv + kautian.ods from taigikeyboard's main branch (the cleaned copies this site
# builds from) into extension/, then prints what changed. Run by `make sync-data`.
set -euo pipefail

UPSTREAM_REPO="taigikeyboard/taigikeyboard"
UPSTREAM_DIR="dictionary/sources/official/kautian/data"
FILES=("extension/kautian.csv" "extension/kautian.ods")

# both files from one commit, so a sync never mixes two upstream states
upstream_sha="$(gh api "repos/$UPSTREAM_REPO/commits/main" --jq .sha)"
raw="https://raw.githubusercontent.com/$UPSTREAM_REPO/$upstream_sha/$UPSTREAM_DIR"
curl -fsSL --max-time 300 -o extension/kautian.csv "$raw/kautian.csv"
curl -fsSL --max-time 300 -o extension/kautian.ods "$raw/raw/kautian.ods"
echo "upstream: $UPSTREAM_REPO@${upstream_sha:0:7}"

if git diff --quiet -- "${FILES[@]}"; then
  echo "unchanged"
  exit 0
fi
git diff --stat -- "${FILES[@]}"
echo "next: make build test, then commit (undo: git checkout -- ${FILES[*]})"

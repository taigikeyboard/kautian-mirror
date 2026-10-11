#!/usr/bin/env bash
# Fetches kautian.csv + kautian.ods from taigikeyboard's main branch (the cleaned copies this site
# builds from) into extension/. On a change: bumps the extension patch version, packages + tests,
# opens a PR from a new branch, and attaches the zip to a draft GitHub Release. Run by `make sync-data`.
set -euo pipefail

UPSTREAM_REPO="taigikeyboard/taigikeyboard"
UPSTREAM_DIR="dictionary/sources/official/kautian/data"
FILES=("extension/kautian.csv" "extension/kautian.ods")
MANIFEST="extension/manifest.json"
ZIP="extension/kautian-extension.zip"

# the sync commit must hold only the data + version bump, cut from the published main
if [ -n "$(git status --porcelain)" ]; then
  echo "FAIL: working tree not clean — commit or stash first" >&2
  exit 1
fi
if [ "$(git branch --show-current)" != "main" ]; then
  echo "FAIL: run from main (sync branches are cut from it)" >&2
  exit 1
fi
git pull --ff-only --quiet origin main

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
diff_stat="$(git diff --stat -- "${FILES[@]}")"
echo "$diff_stat"

old_version="$(node -p "require('./$MANIFEST').version")"
new_version="$(node -p "const [a, b, c] = '$old_version'.split('.').map(Number); [a, b, c + 1].join('.')")"
# in-place text edit keeps the manifest's formatting; JSON.stringify would reflow it
sed -i.bak "s/\"version\": \"$old_version\"/\"version\": \"$new_version\"/" "$MANIFEST" && rm "$MANIFEST.bak"
echo "version: $old_version → $new_version"

npm run package:ext
npm test

branch="chore/data-sync-${upstream_sha:0:7}"
tag="ext-v$new_version"
git switch -c "$branch"
git add "${FILES[@]}" "$MANIFEST"
git commit -m "chore(data): sync kautian data taigikeyboard@${upstream_sha:0:7}, ext $new_version"
git push -u origin "$branch"

pr_url="$(gh pr create --base main --head "$branch" \
  --title "chore(data): sync kautian data, ext $new_version" \
  --body "$(cat <<EOF
Upstream: $UPSTREAM_REPO@$upstream_sha

\`\`\`
$diff_stat
\`\`\`

- extension version $old_version → $new_version
- zip: draft release \`$tag\` (publish after merge → upload to Chrome Web Store)
- ODS changed → rerun \`npm run build:comparisons\` if 詞彙比較 pages changed
EOF
)")"
echo "pr: $pr_url"

# draft: no tag exists until the release is published, so it lands on main as merged
gh release create "$tag" "$ZIP" --draft --target main \
  --title "教典鬥搜揣 $new_version" \
  --notes "Data: $UPSTREAM_REPO@${upstream_sha:0:7} · PR: $pr_url"
echo "next: review + merge PR, publish draft release $tag, upload its zip to Chrome Web Store"

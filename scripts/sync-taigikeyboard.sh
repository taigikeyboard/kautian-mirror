#!/usr/bin/env bash
# Pulls kautian.csv + kautian.ods from taigikeyboard (the cleaned copies this site builds from),
# runs build + test, and opens or refreshes one PR when they differ. Run weekly by
# .github/workflows/sync-data.yml. DRY_RUN=1 downloads and diffs only (no build, branch or PR).
set -euo pipefail

UPSTREAM_REPO="taigikeyboard/taigikeyboard"
UPSTREAM_DIR="dictionary/sources/official/kautian/data"
BRANCH="sync/taigikeyboard-data"
PR_TITLE_PREFIX="chore(data): sync kautian data from taigikeyboard"
FILES=("extension/kautian.csv" "extension/kautian.ods")

# both files from one commit, so a sync never mixes two upstream states
upstream_sha="$(gh api "repos/$UPSTREAM_REPO/commits/main" --jq .sha)"
raw="https://raw.githubusercontent.com/$UPSTREAM_REPO/$upstream_sha/$UPSTREAM_DIR"
curl -fsSL --max-time 300 -o extension/kautian.csv "$raw/kautian.csv"
curl -fsSL --max-time 300 -o extension/kautian.ods "$raw/raw/kautian.ods"
echo "upstream.sha=$upstream_sha"

if git diff --quiet -- "${FILES[@]}"; then
  echo "upstream.unchanged"
  exit 0
fi
git diff --stat -- "${FILES[@]}"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "sync.dry_run (working tree now holds the upstream files; git checkout -- extension/ to undo)"
  exit 0
fi

# a failing build still gets a PR, so a schema change upstream is seen rather than silently skipped
log="$(mktemp)"
test_result="pass"
if ! { npm run build && npm test; } > "$log" 2>&1; then
  test_result="FAIL"
fi
tail -40 "$log"

short="${upstream_sha:0:7}"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git switch -C "$BRANCH"
git add -- "${FILES[@]}"
git commit -m "$PR_TITLE_PREFIX@$short"
git push --force origin "$BRANCH"

body="$(cat <<EOF
taigikeyboard 的教典資料跟本網站目前使用的版本不同。

- 來源：[\`$UPSTREAM_REPO@$short\`](https://github.com/$UPSTREAM_REPO/tree/$upstream_sha/$UPSTREAM_DIR)
- build + test：**$test_result**

\`\`\`
$(git diff --stat HEAD~1 -- "${FILES[@]}")
\`\`\`

合併後 \`pages.yml\` 自動部署網站；外掛要另外 \`make package\` 上架。
EOF
)"

# one open PR at a time: the branch is force-pushed, so an open PR already shows the newest data
pr="$(gh pr list --head "$BRANCH" --state open --json number --jq '.[0].number // empty')"
if [ -n "$pr" ]; then
  gh pr edit "$pr" --title "$PR_TITLE_PREFIX@$short" --body "$body"
else
  gh pr create --base main --head "$BRANCH" --title "$PR_TITLE_PREFIX@$short" --body "$body"
fi

[ "$test_result" = "pass" ]

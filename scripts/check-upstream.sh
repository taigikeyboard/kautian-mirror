#!/usr/bin/env bash
# Compares MOE's published kautian.ods with the copy this site builds from and opens one
# GitHub issue when they differ. Run weekly by .github/workflows/upstream-check.yml.
# DRY_RUN=1 prints the issue instead of creating it; LOCAL_ODS overrides the compared file.
set -euo pipefail

UPSTREAM_URL="https://sutian.moe.edu.tw/media/senn/ods/kautian.ods"
LOCAL_ODS="${LOCAL_ODS:-extension/kautian.ods}"
ISSUE_TITLE_PREFIX="教典資料有更新"

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# -k: MOE's TLS certificate lapsed on 2026-10-08. The download is only hashed here to detect a
# change, never built from; the update itself re-downloads and reviews the file.
curl -fsSk --max-time 300 -D "$tmp/headers" -o "$tmp/kautian.ods" "$UPSTREAM_URL"

upstream_sha="$(sha256 "$tmp/kautian.ods")"
current_sha="$(sha256 "$LOCAL_ODS")"
last_modified="$(tr -d '\r' < "$tmp/headers" | sed -n 's/^[Ll]ast-[Mm]odified: //p' | tail -1)"
echo "upstream.sha256=$upstream_sha current.sha256=$current_sha last_modified=${last_modified:-unknown}"

if [ "$upstream_sha" = "$current_sha" ]; then
  echo "upstream.unchanged"
  exit 0
fi

title="${ISSUE_TITLE_PREFIX}（${last_modified:-sha256 ${upstream_sha:0:12}}）"
body="$(cat <<EOF
教育部發布的 \`kautian.ods\` 跟本網站目前使用的版本不同。

| | 官方 | 本網站 |
|---|---|---|
| SHA-256 | \`${upstream_sha}\` | \`${current_sha}\` |
| 大小 | $(wc -c < "$tmp/kautian.ods" | tr -d ' ') bytes | $(wc -c < "$LOCAL_ODS" | tr -d ' ') bytes |
| Last-Modified | ${last_modified:-unknown} | |

來源：${UPSTREAM_URL}

更新方式：在 [taigikeyboard](https://github.com/taigikeyboard/taigikeyboard) 更新 \`dictionary/sources/official/kautian/data/\`（\`raw/kautian.ods\` + 重新產生 \`kautian.csv\`）。本 repo 的 \`sync-data.yml\` 每週一會把新版開成 PR；要立刻同步就跑 \`gh workflow run sync-data.yml\`。
EOF
)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  printf 'issue.dry_run\n--- %s ---\n%s\n' "$title" "$body"
  exit 0
fi

# one open notice at a time: a later run with an even newer file adds nothing new to act on
open_count="$(gh issue list --state open --search "$ISSUE_TITLE_PREFIX in:title" --json number --jq length)"
if [ "$open_count" -gt 0 ]; then
  echo "issue.exists count=$open_count"
  exit 0
fi
gh issue create --title "$title" --body "$body"

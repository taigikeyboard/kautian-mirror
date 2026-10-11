#!/usr/bin/env bash
# Regenerates fonts/*.woff2 (the settings panel's typefaces) from taigikeyboard's
# assets/fonts/font. Keeps only the @font-face unicode-range in src/styles.css (shared by every face),
# so romanization falls through to the system font for every typeface.
# Needs fonttools + brotli (pip install fonttools brotli).
# Usage: scripts/subset-fonts.sh <taigikeyboard>/assets/fonts/font
set -euo pipefail

src="${1:?usage: scripts/subset-fonts.sh <taigikeyboard>/assets/fonts/font}"
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/fonts"
# every @font-face in styles.css repeats one unicode-range (multi-line) → "U+3000-303F,U+3100-312F,…"
ranges="$(tr -d '\n' < "$root/src/styles.css" | grep -o 'unicode-range:[^;]*' | sed 's/unicode-range://; s/ //g' | sort -u)"
[[ "$ranges" == U+* && "$ranges" != *$'\n'* ]] || { echo "FAIL: @font-face unicode-ranges in src/styles.css differ or are missing: $ranges" >&2; exit 1; }

mkdir -p "$out"
for name in iansui_regular.ttf genyomin2tw_r.otf genyogothic2tw_r.otf; do
  pyftsubset "$src/$name" --unicodes="$ranges" --layout-features='*' --flavor=woff2 \
    --output-file="$out/${name%.*}.woff2"
done
ls -la "$out"

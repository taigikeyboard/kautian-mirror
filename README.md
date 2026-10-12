# 教典備援網站｜台語辭典

A clean, standalone search site for the Ministry of Education's
[Dictionary of Frequently-Used Taiwan Taiwanese](https://sutian.moe.edu.tw/) (臺灣台語常用詞辭典).
Search and entry pages run entirely from static files — no dependency on the official site being up.

Live: <https://taigikeyboard.tw/kautian-mirror/>

## Features

- One search box with live suggestions: Hanzi, Tâi-lô (tone marks, tone numbers, or toneless),
  Pe̍h-ōe-jī, Zhuyin keyboard input, Taiwanese Phonetic Symbols, abbreviations, raw regex
- Entry pages: readings (TL + auto-converted POJ and 方音符號), senses, examples, alternative readings,
  variant characters, 又見音 (same-hanzi entries), synonyms and antonyms, 語音差異 (accent readings),
  詞彙比較 (per-accent vocabulary tables; both tables also show converted POJ / 方音符號), word audio
  (fetched only when the speaker button is clicked)
- Entry actions: 收藏 (bookmark), copy the headword (`漢字 台羅`), share the entry link (system share sheet, else
  clipboard), and a word card — a PNG of the headword, readings and definitions with the source
  credit, shared as a file where the browser supports it, otherwise downloaded
- Shareable URLs: `?q=<query>` for a result list, `?id=<entry id>` for an entry (same ids as the
  official site)
- Left sidebar (collapsed by default; the top-left button docks it on wide screens, a drawer on phones):
  外觀 (自動 / 淺色 / 暗色), 字型 (系統, 粉圓, 芫荽, 源樣明體, 源樣烏體 — the taigikeyboard roster,
  CJK-subset by `scripts/subset-fonts.sh`), 白話字 / 方音符號 switches, and the 收藏 list. All of it
  lives in this browser's localStorage only
- SEO: `dist/sitemap.xml` lists home + every entry URL (entry pages are client-rendered, so
  crawlers can't reach them by links); result pages, missing entries and errors get `noindex`

The browser extension 教典鬥搜揣 lives in [`extension/`](extension/) (see its README). Its search
engine, headword index and `extension/kautian.ods` are shared with the site, so one change covers
both; entry pages are built from the same `kautian.ods`.

## Development

```bash
git clone https://github.com/taigikeyboard/kautian-mirror.git
cd kautian-mirror
make init      # taigi-converter submodule
make install
make audio     # optional: MOE word mp3 → dist/audio/ (300 MB download, cached in .cache/)
make sync-data # optional: kautian.csv + kautian.ods + word_unigrams.tsv ← taigikeyboard main
make build     # dist/: search index, entry shards (data/entries/<id/500>.json), sitemap, app bundle;
               # extension/dist/: extension bundle
make test      # site + extension tests
make package   # extension store zip → extension/kautian-extension.zip
make serve     # http://127.0.0.1:8000
```

`make serve` rebuilds the JS bundle on change but copies `index.html` and `styles.css` only at
startup — restart it after editing those.

`dist/` is a plain static site — deploy it to any static host. Run `make audio` before
`make build` so entry pages get play buttons; without it the site works, just silently.
Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml` (with audio).

`extension/kautian.csv` and `extension/kautian.ods` are copies of the cleaned data in
[taigikeyboard](https://github.com/taigikeyboard/taigikeyboard) (`dictionary/sources/official/kautian/data/`).
`extension/word_unigrams.tsv` is its corpus word counts (`dictionary/shared/data/`): search results
rank more used words first.
`make sync-data` fetches the latest from taigikeyboard `main` and prints the diff; then
`make build test` and commit.

## Data updates

taigikeyboard's `Kautian watch` workflow checks the MOE `kautian.ods` weekly and opens an issue
there when its rows change. Once taigikeyboard refreshes its capture: `make sync-data`,
`make build test`, push `main` (deploys the site), then `make package` and upload the zip to the
Chrome Web Store.

The ODS has the 詞彙比較 tables but not which entry shows which table (MOE curates the links,
sometimes across unrelated hanzi), so `npm run build:comparisons` reads them off every official
entry page into `data/comparison-links.json`. Rerun it after an ODS update (delete
`.cache/comparison-pages.json` first to refetch).

## License

The source code is MIT licensed. Dictionary content originates from the Ministry of Education
dictionary (text and word audio; mp3 files are served unmodified) and is redistributed under
[CC BY-ND 3.0 TW](https://creativecommons.org/licenses/by-nd/3.0/tw/).
Han characters use [jf open 粉圓](https://github.com/justfont/open-huninn-font) (SIL OFL 1.1),
the same typeface as [taigi-converter](https://taigikeyboard.tw/taigi-converter/).
This is an unofficial third-party site and is not affiliated with or endorsed by the Ministry of
Education.

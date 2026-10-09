# 教典鬥搜揣

A clean, standalone search site for the Ministry of Education's
[Dictionary of Frequently-Used Taiwan Taiwanese](https://sutian.moe.edu.tw/) (臺灣台語常用詞辭典).
Search and entry pages run entirely from static files — no dependency on the official site being up.

## Features

- One search box with live suggestions: Hanzi, Tâi-lô (tone marks, tone numbers, or toneless),
  Pe̍h-ōe-jī, Zhuyin keyboard input, Taiwanese Phonetic Symbols, abbreviations, raw regex
- Entry pages: readings (TL + auto-converted POJ), senses, examples, alternative readings,
  variant characters, synonyms and antonyms, word audio (fetched only when the speaker button is clicked)
- Shareable URLs: `?q=<query>` for a result list, `?id=<entry id>` for an entry (same ids as the
  official site)

The search engine and headword index come from
[kautian-extension](https://github.com/taigikeyboard/kautian-extension) (git submodule at
`vendor/kautian-extension`); entry pages are built from the same `kautian.ods`.

## Development

```bash
git clone https://github.com/taigikeyboard/kautian-website.git
cd kautian-website
make init      # submodule + its taigi-converter (skips the unused ebird reference)
make install
make audio     # optional: MOE word mp3 → dist/audio/ (300 MB download, cached in .cache/)
make build     # dist/: search index, entry shards (data/entries/<id/500>.json), app bundle
make test
make serve     # http://127.0.0.1:8000
```

`dist/` is a plain static site — deploy it to any static host. Run `make audio` before
`make build` so entry pages get play buttons; without it the site works, just silently.
Pushes to `main` deploy to GitHub Pages via `.github/workflows/pages.yml` (with audio).

## License

The source code is MIT licensed. Dictionary content originates from the Ministry of Education
dictionary (text and word audio; mp3 files are served unmodified) and is redistributed under [CC BY-ND 3.0 TW](https://creativecommons.org/licenses/by-nd/3.0/tw/).
Han characters use [jf open 粉圓](https://github.com/justfont/open-huninn-font) (SIL OFL 1.1),
the same typeface as [taigi-converter](https://taigikeyboard.tw/taigi-converter/).
This is an unofficial third-party site and is not affiliated with or endorsed by the Ministry of
Education.

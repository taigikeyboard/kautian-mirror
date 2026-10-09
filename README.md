# 教典搜揣

A clean, standalone search site for the Ministry of Education's
[Dictionary of Frequently-Used Taiwan Taiwanese](https://sutian.moe.edu.tw/) (臺灣台語常用詞辭典).
Search and entry pages run entirely from static files — no dependency on the official site being up.

## Features

- One search box with live suggestions: Hanzi, Tâi-lô (tone marks, tone numbers, or toneless),
  Pe̍h-ōe-jī, Zhuyin keyboard input, Taiwanese Phonetic Symbols, abbreviations, raw regex
- Entry pages: readings (TL + auto-converted POJ), senses, examples, alternative readings,
  variant characters, synonyms and antonyms
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
make build     # dist/: search index, entry shards (data/entries/<id/500>.json), app bundle
make test
make serve     # http://127.0.0.1:8000
```

`dist/` is a plain static site — deploy it to any static host.

## License

The source code is MIT licensed. Dictionary content originates from the Ministry of Education
dictionary and is redistributed under [CC BY-ND 3.0 TW](https://creativecommons.org/licenses/by-nd/3.0/tw/).
This is an unofficial third-party site and is not affiliated with or endorsed by the Ministry of
Education.

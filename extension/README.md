# 教典鬥搜揣

A zero-permission Chrome MV3 extension that adds enhanced search suggestions to the Ministry of
Education's [Dictionary of Frequently-Used Taiwan Taiwanese](https://sutian.moe.edu.tw/).

## Features

- Tâi-lô with tone marks or tone numbers
- Pe̍h-ōe-jī (POJ), Hanzi, and Taiwanese Phonetic Symbols (TPS)
- Approximate lookup from a standard Zhuyin keyboard
- Case-, tone-, and hyphen-insensitive matching
- Prefix, substring, abbreviation, and typo-tolerant search
- Raw regular expressions compatible with the dictionary, such as `^tshiau`
- Local-only processing with no collection or transmission of search terms

## Development

The extension lives in the `extension/` folder of
[kautian-mirror](https://github.com/taigikeyboard/kautian-mirror) and shares its search engine,
`kautian.ods` and build with the site. Run everything from the repository root:

```bash
git clone https://github.com/taigikeyboard/kautian-mirror.git
cd kautian-mirror
make init
make install
make build     # also builds extension/dist/ and extension/data/
make test
make bench
make package   # extension/kautian-extension.zip for the store
```

To install locally, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
and select the `extension/` folder after running `make build`.

## License and Privacy

The source code is MIT licensed. The bundled headword data originates from the Ministry of
Education dictionary and is redistributed under
[CC BY-ND 3.0 TW](https://creativecommons.org/licenses/by-nd/3.0/tw/).

This is an unofficial third-party extension and is not affiliated with or endorsed by the Ministry
of Education. See the [privacy policy](PRIVACY.md) for data-handling details.

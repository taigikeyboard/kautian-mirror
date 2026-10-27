# Independent dictionary updates

Status: implemented and verified locally; user explicitly authorized push on 2026-10-27.

User schedule decision (2026-10-27): both CI and extension use daily09:00 Asia/Taipei.
Extension checks on use once per window starting at01:00 UTC, including first use after an
inactive period; no separate rolling24-hour interval or browser wake-up timer.

## Scope (grounded in code)

- `extension/scripts/build-data.mjs:31` joins CSV, ODS and shared corpus counts; preserve upstream formats and local comparison links.
- `extension/src/search/engine.js:40` accepts format 6. Publish a format-specific descriptor and content-addressed JSON alongside existing site data.
- `extension/src/content/main.js` currently fetches packaged JSON. Move dataset ownership to the service worker: seed persistent cache from package, check daily, validate before activation, retain current data on update failure.
- `.github/workflows/pages.yml` builds/deploys the site. Add scheduled upstream fetch, pinned to one commit, without commits, tags or extension releases.
- Follow-up approved: scheduled runs compare each source blob SHA and the site commit against the live published descriptor. Skip all data downloads/build/deploy when identical; pushes/manual runs still build. Matching local files are reused individually and downloads verified against their Git blob SHA. Published descriptor, rather than an Actions cache, records successful deployment state so failures retry.

## Best practices alignment

- Shared `rules/planning.md` / grounded code: reuse existing builders and site hosting; no upstream schema changes.
- Shared `rules/code-review-rules.md` sections 1–5: one dataset owner, shared validation, targeted update failure tests and existing site/extension regression suite.
- Chrome network requests documentation: cross-origin requests in service worker with explicit host permission: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- Chrome remote hosted code documentation: fetch dictionary JSON only; package all executable code: https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
- Deliberately not adopted: browser-side ODS parsing, remote JavaScript, upstream generated-file commits, separate backend, automatic store releases. Existing comparison-link capture remains an independent maintained input.

## Verification

Build/package and full existing tests; update tests cover offline seed, cached start, unchanged version, corrupted/incompatible updates, successful activation and retry. Inspect generated metadata, workflow and ZIP. Browser extension real-device dogfood remains user verification.

- 80/80 tests passed. Chrome headless smoke exercised the actual background module with mocked Chrome event registration and real Cache Storage, loading 40,519 rows and persisting an update check. This does not replace testing an installed extension.
- Live fetch script downloaded upstream d2a32afbaa1c2b49155415691a4bd1240447bb50 into an isolated temporary directory; all three inputs exactly match local sources.
- Codex simplification checklist: one owner for cached data; shared build/runtime validation; no remote executable code or extra backend. Project preference skips independent Codex review.
- Follow-up verification: 88/88 tests pass; unchanged/new input, site-code change, manual run, first deploy, failed deployment retry and corrupt download covered. Live upstream check reused all three local files without downloading. Rechecking the real upstream against an isolated published descriptor returned deploy=false with five metadata requests and zero raw downloads. Workflow YAML parses; hosted Actions execution remains unverified until push.
- Audio cache now holds only its ZIP so restoring it cannot overwrite fresh upstream provenance.
- Shared09:00 schedule verification: 90/90 tests pass, including exact boundary and late-use cases; package rebuilt, ZIP integrity checked, and workflow cron asserted as0 1 * * *.

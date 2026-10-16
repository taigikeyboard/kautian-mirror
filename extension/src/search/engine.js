// Search engine: data format v2 (string-pool) + Map-free lazy sorted indexes
// Pure search engine with compact string-pool data and lazy sorted indexes.
// Pure-function module — no DOM, no chrome APIs; testable directly in Node.
import { classify } from "./detect.js";
import { normalizeLatin, foldHanzi, normalizeTps } from "./normalize.js";
import { deriveTlNotone, derivePojNotone, deriveTpsNotone, hasExplicitTpsTone, SYLLABLE_SEP_RE } from "./derive.js";
import { queryFold, dataFold } from "./zhuyin-fold.js";
import { fuzzyScan } from "./fuzzy.js";
import { hasRegexSyntax, parsePattern, regexScan } from "./regex-mode.js";

// Ranking tiers (§6.3)
export const TIER = {
  TONED: 1, // exact with the typed tone
  EXACT: 2, // exact, any tone (toneless input) / Hanzi exact / TPS exact
  PREFIX: 3, // toneless prefix ending on a syllable boundary or inside the first syllable
  SPLIT_PREFIX: 4, // toneless prefix ending partway into a later syllable (guat → guā-tē)
  ABBREV: 5, // abbreviation exact
  ZHUYIN: 6, // Zhuyin approximate sound
  SUBSTR: 7, // substring
  FUZZY: 8, // fuzzy
  REGEX: 9, // raw regular-expression match
};

const CANDIDATE_CAP = 50;
const SUBSTR_CAP = 100;

// Per-row flags bits, written by build-data.mjs
export const FLAG = {
  MAIN: 1, // main entry
  VARIANT: 2, // variant reading/spelling
  ALIAS: 4, // search alias (語音差異 reading / 詞彙比較 word), shown as its entry headword
  COMPARISON: 8, // 詞彙比較 word
  DIALECT: 16, // 語音差異 reading (an ALIAS row without COMPARISON)
  READING: 32, // 又唸作 / 俗唸作 / 合音唸作 reading (a VARIANT row; 異用字 spellings lack it)
};

const STR_COLS = ["tl", "hanzi", "poj", "tps", "tlNum", "tpsNotoneVar", "abTl", "abPoj", "abTps", "gloss"];

function unpack(packed) {
  if (packed?.meta?.format !== 6) {
    throw new Error(`unsupported data format: ${packed?.meta?.format}`);
  }
  const d = { id: packed.id, flags: packed.flags, pop: packed.pop };
  for (const k of STR_COLS) d[k] = packed[k].split("\n");
  return d;
}

// Parallel sorted (keys, idx) arrays: one index serves both exact lookups
// (binary search) and prefix lookups (range scan)
function buildSorted(pairs) {
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const keys = new Array(pairs.length);
  const idx = new Array(pairs.length);
  for (let i = 0; i < pairs.length; i++) {
    keys[i] = pairs[i][0];
    idx[i] = pairs[i][1];
  }
  return { keys, idx };
}

function lowerBound(keys, target) {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// visit(entryIdx): walks only the range where the key is exactly equal
function searchExact(ix, key, visit) {
  if (!key) return;
  let pos = lowerBound(ix.keys, key);
  while (pos < ix.keys.length && ix.keys[pos] === key) visit(ix.idx[pos++]);
}

// visit(entryIdx, key): the whole prefix range, uncapped — popularity ranking needs every candidate
function searchPrefix(ix, prefix, visit) {
  if (!prefix) return;
  for (let pos = lowerBound(ix.keys, prefix); pos < ix.keys.length; pos++) {
    const key = ix.keys[pos];
    if (!key.startsWith(prefix)) break;
    visit(ix.idx[pos], key);
  }
}

// cumulative toneless lengths at each syllable end: guā-tē → [3, 5]
function syllableEnds(roman, deriveNotone) {
  let end = 0;
  return roman.split(SYLLABLE_SEP_RE).map((syllable) => (end += deriveNotone(syllable).length));
}

// Whether a toneless prefix of `length` chars stops partway into a syllable after the first:
// "guat" stops inside tē of guā-tē, while gua̍t-tâi (boundary) and guán (first syllable) do not.
function endsInLaterSyllable(ends, length) {
  const k = ends.findIndex((end) => length <= end);
  return k > 0 && length < ends[k];
}

export function createEngine(packed) {
  const d = unpack(packed);
  const n = d.tl.length;

  // Derived at load time (format v2 no longer ships these columns;
  // correctness is guaranteed by the build's full QA comparison)
  const tlNotone = d.tl.map(deriveTlNotone);
  const pojNotone = d.poj.map(derivePojNotone);
  const tpsNotone = d.tps.map(deriveTpsNotone);
  const hanziFold = d.hanzi.map(foldHanzi);
  const zhu = tpsNotone.map((s) => dataFold(s).key);

  // Lazy indexes: each key-space is sorted on first use
  const lazy = new Map();
  function index(name, build) {
    let ix = lazy.get(name);
    if (!ix) {
      ix = build();
      lazy.set(name, ix);
    }
    return ix;
  }
  const stripJoin = (s) => s.toLowerCase().replace(SYLLABLE_SEP_RE, "").normalize("NFC");

  const ixLatin = () =>
    index("latin", () => {
      const pairs = [];
      for (let i = 0; i < n; i++) {
        pairs.push([tlNotone[i], i]);
        if (pojNotone[i] !== tlNotone[i]) pairs.push([pojNotone[i], i]);
      }
      return buildSorted(pairs);
    });
  const ixToned = () =>
    index("toned", () => {
      const pairs = [];
      for (let i = 0; i < n; i++) {
        const a = stripJoin(d.tl[i]);
        pairs.push([a, i]);
        const b = stripJoin(d.poj[i]);
        if (b !== a) pairs.push([b, i]);
        pairs.push([d.tlNum[i].replace(/\s+/g, ""), i]);
        const t = d.tps[i].trim();
        if (t) pairs.push([t, i]);
      }
      return buildSorted(pairs);
    });
  const ixAbbrev = () =>
    index("abbrev", () => {
      const pairs = [];
      for (let i = 0; i < n; i++) {
        if (d.abTl[i]) pairs.push([d.abTl[i], i]);
        if (d.abPoj[i] && d.abPoj[i] !== d.abTl[i]) pairs.push([d.abPoj[i], i]);
        if (d.abTps[i]) pairs.push([d.abTps[i], i]);
      }
      return buildSorted(pairs);
    });
  const ixHanzi = () => index("hanzi", () => buildSorted(hanziFold.map((k, i) => [k, i])));
  const ixTps = () =>
    index("tps", () => {
      const pairs = [];
      for (let i = 0; i < n; i++) {
        pairs.push([tpsNotone[i], i]);
        if (d.tpsNotoneVar[i]) pairs.push([d.tpsNotoneVar[i], i]);
      }
      return buildSorted(pairs);
    });
  const ixZhu = () => index("zhu", () => buildSorted(zhu.map((k, i) => [k, i])));

  // main entries first, variant readings (and aliases) last
  const formRank = (i) => (d.flags[i] & FLAG.MAIN ? 0 : 2) + (d.flags[i] & FLAG.VARIANT ? 1 : 0);

  // alias and 又唸作-type reading rows never display: a hit on one shows the entry headword
  const HIDDEN_ROW = FLAG.ALIAS | FLAG.READING;
  // 異用字 spelling: a variant row that is neither a 唸作 reading nor an alias
  const isVariantSpelling = (i) => (d.flags[i] & (FLAG.VARIANT | FLAG.READING | FLAG.ALIAS)) === FLAG.VARIANT;
  // entry id → its headword row (best formRank among displayable rows, first wins), built on first use
  let heads = null;
  function entryHead(i) {
    if (!heads) {
      heads = new Map();
      for (let j = 0; j < n; j++) {
        if (d.flags[j] & HIDDEN_ROW) continue;
        const best = heads.get(d.id[j]);
        if (best === undefined || formRank(j) < formRank(best)) heads.set(d.id[j], j);
      }
    }
    return heads.get(d.id[i]) ?? i;
  }
  const headRow = (i) => (d.flags[i] & HIDDEN_ROW ? entryHead(i) : i);

  // match hint for the UI, naming the headword form a typed form replaced: its reading for a
  // 又唸作-type or 語音差異 hit, its hanzi + 台羅 for a 詞彙比較 hit (the page the row opens),
  // the 正字 hanzi for a 異用字 hit; null otherwise
  function matchedVia(i, h) {
    const f = d.flags[i];
    if (f & (FLAG.READING | FLAG.DIALECT)) {
      return { kind: f & FLAG.READING ? "reading" : "dialect", text: d.tl[h], poj: d.poj[h], tps: d.tps[h] };
    }
    if (f & FLAG.COMPARISON) return { kind: "comparison", text: d.hanzi[h], tl: d.tl[h] };
    if (isVariantSpelling(i)) return { kind: "variant", text: d.hanzi[entryHead(i)] };
    return null;
  }

  // Fullwidth clause punctuation in the hanzi form marks proverb-like entries
  // (~470 of ~34k main entries; validated by sampling).
  // ；？ are insurance for future data — today every such entry also has ，。
  // 、and （） stay excluded on purpose: those mark place/station names.
  const PROVERB_RE = /[，。；？]/;

  // i = the matched row; id, gloss and flags come from its head row. A typed 又唸作-type or
  // 語音差異 reading or 詞彙比較 word is shown in place of the headword, hanzi and reading as a
  // pair (去 khìr ㄎㆨ˪, 弓蕉 kin-tsio, 金蕉 kim-tsio)
  function toResult(i, tier, recent) {
    const h = headRow(i);
    const r = d.flags[i] & (FLAG.READING | FLAG.ALIAS) ? i : h;
    return {
      i,
      tier,
      id: d.id[h],
      tl: d.tl[r],
      hanzi: d.hanzi[r],
      poj: d.poj[r],
      tps: d.tps[r],
      gloss: d.gloss[h], // first 華語釋義, cut at build time ("" when the entry has none)
      main: (d.flags[h] & FLAG.MAIN) !== 0,
      variant: (d.flags[h] & FLAG.VARIANT) !== 0,
      recent, // recently opened by the user (drives the clock hint in the UI)
      proverb: PROVERB_RE.test(d.hanzi[h]), // 俗諺 (hidden by the site's 選單顯示 俗語 switch)
      via: matchedVia(i, h),
    };
  }

  // tier → recently opened (never crosses a tier boundary) → 正字 before 異用字 spelling →
  // more used entry (corpus popularity rank) → main entry → non-variant → shorter word;
  // remaining ties keep stable candidate order.
  function finalize(tiers, limit, recencyRank) {
    // [idx, tier, recency]; recency resolved once per candidate (Infinity = not recent)
    const entries = [...tiers].map(([i, tier]) => [i, tier, recencyRank?.(d.id[i]) ?? Infinity]);
    entries.sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
      const va = isVariantSpelling(a[0]);
      if (va !== isVariantSpelling(b[0])) return va ? 1 : -1;
      if (d.pop[a[0]] !== d.pop[b[0]]) return d.pop[a[0]] - d.pop[b[0]];
      const fa = formRank(a[0]);
      const fb = formRank(b[0]);
      if (fa !== fb) return fa - fb;
      return d.tl[a[0]].length - d.tl[b[0]].length;
    });
    // one row per entry id — the best-ranked form represents the entry
    const seen = new Set();
    const results = [];
    for (const [i, tier, recency] of entries) {
      if (seen.has(d.id[i])) continue;
      seen.add(d.id[i]);
      results.push(toResult(i, tier, recency !== Infinity));
      if (results.length >= limit) break;
    }
    return results;
  }

  // Random discovery: pick among main entries only (variant/again readings
  // land on poor pages). `rand` is injectable for deterministic tests.
  function buildPool(keep) {
    const pool = [];
    const seenIds = new Set();
    for (let i = 0; i < n; i++) {
      if (keep(i) && !seenIds.has(d.id[i])) {
        pool.push(i);
        seenIds.add(d.id[i]);
      }
    }
    return pool;
  }

  let mainRows = null;
  function randomMainId(rand = Math.random) {
    if (!mainRows) mainRows = buildPool((i) => (d.flags[i] & FLAG.MAIN) !== 0);
    return d.id[mainRows[Math.floor(rand() * mainRows.length)]];
  }

  let proverbRows = null;
  function randomProverbId(rand = Math.random) {
    if (!proverbRows) {
      proverbRows = buildPool((i) => (d.flags[i] & FLAG.MAIN) !== 0 && PROVERB_RE.test(d.hanzi[i]));
    }
    if (!proverbRows.length) return undefined;
    return d.id[proverbRows[Math.floor(rand() * proverbRows.length)]];
  }

  function add(tiers, i, tier) {
    // 詞彙比較 words are partial matches at best, like the official 部份符合
    if (d.flags[i] & FLAG.COMPARISON && tier < TIER.SUBSTR) tier = TIER.SUBSTR;
    const cur = tiers.get(i);
    if (cur === undefined || tier < cur) tiers.set(i, tier);
  }

  // syllable ends per row, derived on first prefix visit and kept for later keystrokes
  const tlEnds = new Array(n);
  const pojEnds = new Array(n);

  // tier of a latin prefix-index hit; key = the matched index key (row i's TL or POJ notone form)
  function latinPrefixTier(i, key, prefix) {
    if (key === prefix) return TIER.EXACT;
    const ends = key === tlNotone[i]
      ? (tlEnds[i] ??= syllableEnds(d.tl[i], deriveTlNotone))
      : (pojEnds[i] ??= syllableEnds(d.poj[i], derivePojNotone));
    return endsInLaterSyllable(ends, prefix.length) ? TIER.SPLIT_PREFIX : TIER.PREFIX;
  }

  function queryLatin(input, tiers) {
    const { pojKey, tlKey, toned, tonedTl, hasTone } = normalizeLatin(input);
    // Toned-exact: with a typed tone it outranks everything. Unmarked input is
    // also a tone-1 spelling (khuann), but it is just as often toneless typing
    // (khuann → 看 khuànn), so those hits share the EXACT tier and popularity decides.
    // Both the raw key and its POJ→TL-folded twin are tried.
    const tonedTier = hasTone ? TIER.TONED : TIER.EXACT;
    searchExact(ixToned(), toned, (i) => add(tiers, i, tonedTier));
    if (tonedTl !== toned) searchExact(ixToned(), tonedTl, (i) => add(tiers, i, tonedTier));
    if (hasTone) return;
    // the prefix index's exact flag serves the exact and prefix tiers in one pass
    for (const prefix of new Set([tlKey, pojKey])) {
      searchPrefix(ixLatin(), prefix, (i, k) => add(tiers, i, latinPrefixTier(i, k, prefix)));
    }
    searchExact(ixAbbrev(), tlKey, (i) => add(tiers, i, TIER.ABBREV));
    if (pojKey !== tlKey) searchExact(ixAbbrev(), pojKey, (i) => add(tiers, i, TIER.ABBREV));
    if (tiers.size < CANDIDATE_CAP && tlKey.length >= 3) {
      let hits = 0;
      for (let i = 0; i < n && hits < SUBSTR_CAP; i++) {
        if (tlNotone[i].includes(tlKey) || pojNotone[i].includes(pojKey)) {
          add(tiers, i, TIER.SUBSTR);
          hits++;
        }
      }
    }
    if (tiers.size < 20 && tlKey.length >= 3) {
      fuzzyScan(tlNotone, tlKey, (i) => add(tiers, i, TIER.FUZZY));
      if (pojKey !== tlKey) fuzzyScan(pojNotone, pojKey, (i) => add(tiers, i, TIER.FUZZY));
    }
  }

  function queryHanzi(input, tiers) {
    const key = foldHanzi(input.trim());
    searchPrefix(ixHanzi(), key, (i, k) =>
      add(tiers, i, k === key ? TIER.EXACT : TIER.PREFIX));
    let hits = 0;
    for (let i = 0; i < n && hits < SUBSTR_CAP; i++) {
      if (!tiers.has(i) && hanziFold[i].includes(key)) {
        add(tiers, i, TIER.SUBSTR);
        hits++;
      }
    }
  }

  function queryBopomofo(input, tiers) {
    // Toned-exact: TPS with tone marks (or none = tone 1) matches tps_num;
    // unmarked input shares the EXACT tier, as in queryLatin
    const hasTone = hasExplicitTpsTone(input);
    searchExact(ixToned(), input.normalize("NFC").trim(), (i) =>
      add(tiers, i, hasTone ? TIER.TONED : TIER.EXACT));
    if (hasTone) return;
    const tpsKey = normalizeTps(input);
    searchPrefix(ixTps(), tpsKey, (i, k) =>
      add(tiers, i, k === tpsKey ? TIER.EXACT : TIER.PREFIX));
    for (const zhuKey of queryFold(input)) {
      searchPrefix(ixZhu(), zhuKey, (i) => add(tiers, i, TIER.ZHUYIN));
    }
  }

  // Every non-empty input uses both the normalized search path and a guarded
  // raw-regex scan. Ranked normalized hits stay first; regex expands the set.
  // → { mode, results, truncated?, error? }
  function query(input, { limit = 20, recencyRank } = {}) {
    const mode = classify(input);
    if (mode === "empty") return { mode, results: [] };

    const tiers = new Map();
    const isRegex = hasRegexSyntax(input);
    let scanInput = input;
    if (!isRegex) {
      if (mode === "hanzi") queryHanzi(input, tiers);
      else if (mode === "bopomofo") queryBopomofo(input, tiers);
      else {
        queryLatin(input, tiers);
        const normalized = normalizeLatin(input);
        scanInput = normalized.hasTone ? normalized.tonedTlNumber : normalized.tlKey;
      }
    }

    const { re, error } = parsePattern(scanInput);
    if (error) return { mode, results: [], error };
    const { truncated } = regexScan(
      { tl: d.tl, tlNum: d.tlNum, tlNotone, poj: d.poj, tps: d.tps, hanzi: d.hanzi },
      re,
      (i) => add(tiers, i, TIER.REGEX)
    );
    return { mode, truncated, results: finalize(tiers, limit, recencyRank) };
  }

  return { query, randomMainId, randomProverbId, size: n };
}

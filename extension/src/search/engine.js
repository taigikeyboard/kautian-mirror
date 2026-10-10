// Search engine: data format v2 (string-pool) + Map-free lazy sorted indexes
// Pure search engine with compact string-pool data and lazy sorted indexes.
// Pure-function module — no DOM, no chrome APIs; testable directly in Node.
import { classify } from "./detect.js";
import { normalizeLatin, foldHanzi, normalizeTps } from "./normalize.js";
import { deriveTlNotone, derivePojNotone, deriveTpsNotone, hasExplicitTpsTone } from "./derive.js";
import { queryFold, dataFold } from "./zhuyin-fold.js";
import { fuzzyScan } from "./fuzzy.js";
import { hasRegexSyntax, parsePattern, regexScan } from "./regex-mode.js";

// Ranking tiers (§6.3)
export const TIER = {
  TONED: 1, // toned exact
  EXACT: 2, // toneless exact / Hanzi exact / TPS exact
  PREFIX: 3, // toneless prefix
  ABBREV: 4, // abbreviation exact
  ZHUYIN: 5, // Zhuyin approximate sound
  SUBSTR: 6, // substring
  FUZZY: 7, // fuzzy
  REGEX: 8, // raw regular-expression match
};

const CANDIDATE_CAP = 50;
const PREFIX_CAP = 200;
const SUBSTR_CAP = 100;

const STR_COLS = ["tl", "hanzi", "poj", "tps", "tlNum", "tpsNotoneVar", "abTl", "abPoj", "abTps"];

function unpack(packed) {
  if (packed?.meta?.format !== 4) {
    throw new Error(`unsupported data format: ${packed?.meta?.format}`);
  }
  const d = { id: packed.id, flags: packed.flags };
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

// visit(entryIdx, isExact): prefix range (exact hits sort first in the range,
// so they can never be cut off by the cap)
function searchPrefix(ix, prefix, visit) {
  if (!prefix) return;
  let pos = lowerBound(ix.keys, prefix);
  let seen = 0;
  while (pos < ix.keys.length && seen < PREFIX_CAP) {
    const key = ix.keys[pos];
    if (!key.startsWith(prefix)) break;
    visit(ix.idx[pos], key === prefix);
    pos++;
    seen++;
  }
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
  const stripJoin = (s) => s.toLowerCase().replace(/--|[-\s]+/g, "").normalize("NFC");

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

  function toResult(i, tier, recent) {
    return {
      i,
      tier,
      id: d.id[i],
      tl: d.tl[i],
      hanzi: d.hanzi[i],
      poj: d.poj[i],
      tps: d.tps[i],
      main: (d.flags[i] & 1) !== 0,
      variant: (d.flags[i] & 2) !== 0,
      recent, // recently opened by the user (drives the clock hint in the UI)
    };
  }

  // No frequency ranking (by request): tier → recently opened (never crosses
  // a tier boundary) → main entry → non-variant → shorter word; remaining
  // ties keep stable candidate order.
  function finalize(tiers, limit, recencyRank) {
    const entries = [...tiers.entries()]; // [idx, tier]
    entries.sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      if (recencyRank) {
        const ra = recencyRank(d.id[a[0]]);
        const rb = recencyRank(d.id[b[0]]);
        if ((ra !== undefined) !== (rb !== undefined)) return ra !== undefined ? -1 : 1;
        if (ra !== undefined && ra !== rb) return ra - rb;
      }
      const ma = d.flags[a[0]] & 1;
      const mb = d.flags[b[0]] & 1;
      if (ma !== mb) return mb - ma; // main entries first
      const va = d.flags[a[0]] & 2;
      const vb = d.flags[b[0]] & 2;
      if (va !== vb) return va - vb; // variant readings last
      return d.tl[a[0]].length - d.tl[b[0]].length;
    });
    // one row per entry id — the best-ranked form represents the entry
    const seen = new Set();
    const results = [];
    for (const [i, tier] of entries) {
      if (seen.has(d.id[i])) continue;
      seen.add(d.id[i]);
      results.push(toResult(i, tier, recencyRank?.(d.id[i]) !== undefined));
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
    if (!mainRows) mainRows = buildPool((i) => (d.flags[i] & 1) !== 0);
    return d.id[mainRows[Math.floor(rand() * mainRows.length)]];
  }

  // Experimental: fullwidth clause punctuation in the hanzi form marks
  // proverb-like entries (~470 of ~34k main entries; validated by sampling).
  // ；？ are insurance for future data — today every such entry also has ，。
  // 、and （） stay excluded on purpose: those mark place/station names.
  const PROVERB_RE = /[，。；？]/;
  let proverbRows = null;
  function randomProverbId(rand = Math.random) {
    if (!proverbRows) {
      proverbRows = buildPool((i) => (d.flags[i] & 1) !== 0 && PROVERB_RE.test(d.hanzi[i]));
    }
    if (!proverbRows.length) return undefined;
    return d.id[proverbRows[Math.floor(rand() * proverbRows.length)]];
  }

  function add(tiers, i, tier) {
    const cur = tiers.get(i);
    if (cur === undefined || tier < cur) tiers.set(i, tier);
  }

  function queryLatin(input, tiers) {
    const { pojKey, tlKey, toned, tonedTl, hasTone } = normalizeLatin(input);
    // Always try toned-exact: an unmarked romanization is itself a valid
    // tone-1 spelling (khuann ≡ tone 1), so an exact toned hit outranks
    // toneless matches. Both the raw key and its POJ→TL-folded twin are tried.
    searchExact(ixToned(), toned, (i) => add(tiers, i, TIER.TONED));
    if (tonedTl !== toned) searchExact(ixToned(), tonedTl, (i) => add(tiers, i, TIER.TONED));
    if (hasTone) return;
    // the prefix index's exact flag serves tiers 2 and 3 in one pass
    searchPrefix(ixLatin(), tlKey, (i, exact) =>
      add(tiers, i, exact ? TIER.EXACT : TIER.PREFIX));
    if (pojKey !== tlKey) {
      searchPrefix(ixLatin(), pojKey, (i, exact) =>
        add(tiers, i, exact ? TIER.EXACT : TIER.PREFIX));
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
    searchPrefix(ixHanzi(), key, (i, exact) =>
      add(tiers, i, exact ? TIER.EXACT : TIER.PREFIX));
    let hits = 0;
    for (let i = 0; i < n && hits < SUBSTR_CAP; i++) {
      if (!tiers.has(i) && hanziFold[i].includes(key)) {
        add(tiers, i, TIER.SUBSTR);
        hits++;
      }
    }
  }

  function queryBopomofo(input, tiers) {
    // Toned-exact first: TPS with tone marks (or none = tone 1) matches tps_num
    searchExact(ixToned(), input.normalize("NFC").trim(), (i) => add(tiers, i, TIER.TONED));
    if (hasExplicitTpsTone(input)) return;
    const tpsKey = normalizeTps(input);
    searchPrefix(ixTps(), tpsKey, (i, exact) =>
      add(tiers, i, exact ? TIER.EXACT : TIER.PREFIX));
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

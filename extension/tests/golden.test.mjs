// Golden tests: verify end-to-end query behavior against the real built data.
// Requires npm run build:data first.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createEngine, TIER } from "../src/search/engine.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "kautian.min.json");
if (!existsSync(DATA)) {
  throw new Error("missing data/kautian.min.json — run npm run build:data first");
}
const packed = JSON.parse(readFileSync(DATA, "utf8"));
const engine = createEngine(packed);
const tlNums = packed.tlNum.split("\n");

const tls = (r) => r.results.map((x) => x.tl);
const hanzis = (r) => r.results.map((x) => x.hanzi);

test("entry ids: kan-tann / kan-ta / 干焦 all resolve to entry 448", () => {
  for (const q of ["kan-tann", "kan-ta", "kan-na", "干焦"]) {
    const r = engine.query(q);
    assert.ok(r.results.length > 0, `no results for ${q}`);
    assert.equal(r.results[0].id, 448, `top result for ${q} should be entry 448`);
  }
  // variant hanzi spelling (異用字) also resolves to the parent entry
  const v = engine.query("乾焦");
  assert.equal(v.results[0].id, 448);
});

test("entry 16685 (寬/緩 khuann): every input system reaches it", () => {
  // a typed tone 1 → toned-exact puts 16685 on top
  for (const q of ["khoann1", "khoaⁿ1"]) {
    const r = engine.query(q);
    assert.equal(r.results[0]?.id, 16685, `top result for ${JSON.stringify(q)} should be entry 16685`);
  }
  // unmarked input is an exact hit too, behind the more used 看 khuànn (corpus 15048 vs 寬 17)
  for (const q of ["khuaⁿ", "khuann", "ㄎㄨㆩ", "KHUANN"]) {
    const r = engine.query(q);
    assert.equal(r.results[0]?.hanzi, "看", `top result for ${JSON.stringify(q)} should be 看`);
    assert.equal(r.results.find((x) => x.id === 16685)?.tier, TIER.EXACT, q);
  }
  // Hanzi lookups share the surface form with other entries (寬 khuan, 緩 uān)
  // but 16685 must be present
  for (const q of ["寬", "緩"]) {
    const r = engine.query(q);
    assert.ok(r.results.some((x) => x.id === 16685), `${q} should include entry 16685`);
  }
});

test("語音差異 alias: khìr ranks 去 + 課 toned-exact, shown as their headwords", () => {
  // trace: 語音差異 去(1395) 鹿港 khìr, 課(16827) 新竹 khìr → alias rows → headRow → main row
  const r = engine.query("khìr");
  assert.deepEqual(
    r.results.slice(0, 2).map((x) => [x.id, x.hanzi, x.tl, x.tier]),
    [[1395, "去", "khì", TIER.TONED], [16827, "課", "khuè", TIER.TONED]]
  );
});

test("詞彙比較 alias: 人仔書 / lâng-á-tsir find 尪仔冊 as a partial match", () => {
  // trace: 詞彙比較 table 23 漫畫書, 鹿港 人仔書 lâng-á-tsir → linked entry 3073 尪仔冊
  for (const q of ["人仔書", "lâng-á-tsir"]) {
    const r = engine.query(q);
    assert.deepEqual(r.results.map((x) => [x.id, x.hanzi, x.tier]), [[3073, "尪仔冊", TIER.SUBSTR]], q);
  }
});

test("詞彙比較 alias: never outranks the headword it duplicates", () => {
  // 頭路 is its own headword and a word in the 工作 table linked to 工課 / 穡頭
  const r = engine.query("頭路");
  assert.deepEqual([r.results[0].id, r.results[0].tier], [12076, TIER.EXACT]);
  const linked = r.results.filter((x) => x.id === 519 || x.id === 12539);
  assert.deepEqual(linked.map((x) => x.tier), [TIER.SUBSTR, TIER.SUBSTR]);
});

test("via: alias hits say which 語音差異 reading / 詞彙比較 word matched", () => {
  const top = (q) => engine.query(q, { limit: 3 }).results[0];
  // trace: 語音差異 去(1395) 鹿港 khìr; 詞彙比較 人仔書 → 3073 尪仔冊; 去 typed as its own headword has no hint
  assert.deepEqual(top("khìr").via, { kind: "dialect", text: "khìr" });
  assert.deepEqual(top("人仔書").via, { kind: "comparison", text: "人仔書" });
  assert.equal(top("khì").via, null);
});

test("readings: 又唸作-type readings show on the headword row, whichever reading was typed", () => {
  const top = (q) => engine.query(q, { limit: 3 }).results[0];
  // trace: 俗唸作 sheet 避免 phiah-bián; 又唸作 sheet 欲(7469) bueh
  for (const q of ["pī-bián", "phiah-bián"]) {
    assert.deepEqual([top(q).hanzi, top(q).tl, top(q).readings, top(q).via], ["避免", "pī-bián", ["phiah-bián"], null], q);
  }
  assert.deepEqual([top("bueh").id, top("bueh").tl, top("bueh").readings], [7469, "beh", ["bueh"]]);
  assert.deepEqual(top("khì").readings, []);
});

test("shared form: 恩 un / 除 tû reach both the 白 and the 文 entry", () => {
  // trace: 詞目 5952 恩 【白】in/un + 5953 【文】un share key "un恩"; 6794 除 【白】tî/tû + 6795 【文】tû
  for (const [q, want] of [["恩", [5952, 5953]], ["un", [5952, 5953]], ["除", [6794, 6795]], ["tû", [6794, 6795]]]) {
    const ids = engine.query(q).results.map((x) => x.id);
    for (const id of want) assert.ok(ids.includes(id), `${q} should include entry ${id}`);
  }
});

test("gloss: first 華語釋義 tells the five 東區 Tang-khu apart", () => {
  // trace: 義項 21235 "新竹市行政區(附錄－地名－臺灣縣市行政區名)" → first 30 chars; 23465 has no 義項
  const gloss = Object.fromEntries(engine.query("東區").results.map((x) => [x.id, x.gloss]));
  assert.equal(gloss[23465], "");
  assert.equal(gloss[21235], "新竹市行政區(附錄－地名－臺灣縣市行政區名)".slice(0, 30));
  const appendix = [21235, 21240, 21248, 21251].map((id) => gloss[id].slice(0, 3));
  assert.deepEqual(appendix, ["新竹市", "臺中市", "嘉義市", "臺南市"]);
});

test("entry dedup: one row per entry id", () => {
  const r = engine.query("kanna");
  const ids = r.results.map((x) => x.id);
  assert.equal(ids.length, new Set(ids).size);
});

test("toned exact: tone digits / tone diacritics", () => {
  const a = engine.query("si7");
  assert.equal(a.results[0].hanzi, "是");
  assert.equal(a.results[0].tier, TIER.TONED);
  const b = engine.query("sī");
  assert.equal(b.results[0].hanzi, "是");
  const c = engine.query("tong5-ku1");
  assert.ok(hanzis(c).includes("同居"));
});

test("explicit tone does not fall back to toneless search", () => {
  const r = engine.query("tsa2", { limit: 200 });
  assert.ok(r.results.length > 0);
  assert.equal(r.results[0].hanzi, "早");
  assert.ok(r.results.every((x) => tlNums[x.i].includes("tsa2")));
  assert.ok(!hanzis(r).includes("在"));
});

test("case-insensitive + toneless: SI → high-frequency si* words", () => {
  const r = engine.query("SI");
  // every tone of "si" is an exact hit; 是 sī (corpus 59309) outranks 詩 si (698)
  assert.equal(r.results[0].hanzi, "是");
  assert.equal(r.results[0].tier, TIER.EXACT);
  assert.ok(hanzis(r).includes("詩"));
});

test("POJ input: chhiau→tshiau, soa-lak-khu→沙鹿區", () => {
  const a = engine.query("chhiau");
  assert.ok(tls(a).some((t) => t.toLowerCase().startsWith("tshiau")));
  const b = engine.query("soalakkhu");
  assert.ok(hanzis(b).includes("沙鹿區"));
});

test("POJ and TL tone-number equivalents return the same results", () => {
  const poj = engine.query("teng2", { limit: 200 });
  const tl = engine.query("ting2", { limit: 200 });
  assert.deepEqual(poj.results.map((x) => x.id), tl.results.map((x) => x.id));
  const tps = engine.query("ㄉㄧㄥˋ", { limit: 200 });
  assert.deepEqual(tps.results.map((x) => x.id), tl.results.map((x) => x.id));
});

test("POJ, TL, and TPS equivalents preserve nasalization and tone", () => {
  const inputs = ["khuánn", "khuann2", "khóaⁿ", "khoann2", "khoaⁿ2", "ㄎㄨㆩˋ"];
  const expected = engine.query(inputs[0], { limit: 200 }).results.map((x) => x.id);
  for (const input of inputs.slice(1)) {
    const actual = engine.query(input, { limit: 200 }).results.map((x) => x.id);
    assert.deepEqual(actual, expected, `${input} should match ${inputs[0]}`);
  }
});

test("prefix: sutia* completion", () => {
  const r = engine.query("sutia");
  assert.ok(r.results.length > 0);
  assert.ok(r.results.every((x) => x.tier <= TIER.SPLIT_PREFIX || x.tier >= TIER.SUBSTR));
});

test("prefix: stopping on a syllable boundary beats stopping inside a later syllable", () => {
  // trace: guat = gua̍t | -tâi (boundary) vs gua | t·ē (inside the 2nd syllable of guā-tē);
  // POJ goat folds the same way
  for (const q of ["guat", "goat"]) {
    const r = engine.query(q);
    assert.deepEqual(hanzis(r).slice(0, 2), ["月", "月台"], q);
    const lastBoundary = r.results.findLastIndex((x) => x.tier === TIER.PREFIX);
    const firstSplit = r.results.findIndex((x) => x.tier === TIER.SPLIT_PREFIX);
    assert.ok(r.results[firstSplit].tl.startsWith("guā-t"), q);
    assert.ok(lastBoundary < firstSplit, q);
  }
  // stopping inside the first syllable is ordinary typing: gua → 阮 guán stays a PREFIX hit
  const gua = engine.query("gua");
  assert.equal(gua.results.find((x) => x.hanzi === "阮")?.tier, TIER.PREFIX);
});

test("ranking: toneless input puts the most used word first", () => {
  // trace (corpus counts): 食 tsia̍h 7952 > 才 tsiah 6127; 人 lâng 55655 > 籠 lang 9;
  // 一 tsi̍t 31362 > 這 tsit 20493; 予 hōo 26671 > 呼 hoo 141; 看 khuànn 15048 > 寬 khuann 17
  for (const [q, top] of [["tsiah", "食"], ["lang", "人"], ["tsit", "一"], ["hoo", "予"], ["khuann", "看"], ["gua", "我"]]) {
    assert.equal(engine.query(q).results[0].hanzi, top, q);
  }
  // within one tier too: 外面 guā-bīn 573 > 外移 guā-î 3; 出來 tshut-lâi 1568 > 出世 tshut-sì 970
  for (const [q, more, less] of [["gua", "外面", "外移"], ["tshut", "出來", "出世"]]) {
    const list = hanzis(engine.query(q, { limit: 200 }));
    assert.ok(list.indexOf(more) < list.indexOf(less), `${q}: ${more} before ${less}`);
  }
  // short prefixes (tsh, kh) rank their whole key range, not just its alphabetical head
  for (const [q, word] of [["tsh", "出"], ["kh", "去"]]) {
    assert.ok(hanzis(engine.query(q)).slice(0, 3).includes(word), `${q}: ${word} in the top 3`);
  }
});

test("abbreviation: tk (many collisions)", () => {
  const r = engine.query("tk");
  assert.ok(r.results.length > 0);
  assert.equal(r.results[0].tier, TIER.ABBREV);
  // 同居 is in the full abbreviation hit set
  const all = engine.query("tk", { limit: 2000 });
  assert.ok(hanzis(all).includes("同居"));
});

test("Hanzi: exact / prefix / 台→臺 folding", () => {
  const a = engine.query("同居");
  assert.equal(a.results[0].hanzi, "同居");
  // the data itself mixes 台/臺 (臺北 vs 舞台) — verify two-sided folding
  const b = engine.query("台北");
  assert.ok(hanzis(b).includes("臺北"));
  const b2 = engine.query("舞臺");
  assert.ok(hanzis(b2).includes("舞台"));
  const c = engine.query("沙鹿");
  assert.ok(hanzis(c).includes("沙鹿區"));
});

test("Hanzi substring: 早 can find 𠢕早 within the dropdown limit", () => {
  const r = engine.query("早", { limit: 200 });
  assert.ok(hanzis(r).includes("𠢕早"));

  const common = engine.query("人", { limit: 200 });
  const internal = common.results.find((x) => x.hanzi === "世人");
  assert.equal(internal?.tier, TIER.SUBSTR);
});

test("TPS input: ㆠㄨㄣˊ → 文", () => {
  const r = engine.query("ㆠㄨㄣˊ");
  assert.ok(hanzis(r).includes("文"));
  // with the tone mark present this is now a toned-exact hit
  assert.equal(r.results[0].tier, TIER.TONED);
  assert.equal(r.results[0].hanzi, "文");
});

test("Zhuyin approximate sound: ㄙㄨㄉㄧㄚ, ㄒㄧ", () => {
  const a = engine.query("ㄙㄨㄉㄧㄚ");
  assert.ok(tls(a).some((t) => t.toLowerCase().replace(/[-]/g, "").startsWith("su")));
  const b = engine.query("ㄒㄧ");
  assert.ok(hanzis(b).length > 0);
});

test("fuzzy: sualakku (missing h) → 沙鹿區", () => {
  const r = engine.query("sualakku");
  assert.ok(hanzis(r).includes("沙鹿區"));
  const hit = r.results.find((x) => x.hanzi === "沙鹿區");
  assert.equal(hit.tier, TIER.FUZZY);
});

test("raw regex is merged into ordinary search", () => {
  const a = engine.query("^tshiau");
  assert.ok(a.results.length > 0);
  // the engine's regex scan includes tlNotone (toneless AND hyphenless); a 又唸作-type reading
  // hit shows its headword, the matched reading in `readings` (操煩 tshau-huân, 又唸作 tshiau-huân)
  const notone = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-\s]+/g, "");
  const matches = (tl) => /^tshiau/i.test(tl) || /^tshiau/i.test(notone(tl));
  assert.ok(
    a.results.every(
      (x) => matches(x.tl) || /^tshiau/i.test(x.poj) || /^tshiau/i.test(x.hanzi) || x.readings.some(matches)
    )
  );
  const b = engine.query("[");
  assert.equal(b.error, "invalid");
  const c = engine.query("^臺.語$");
  assert.ok(c.results.every((x) => /^臺.語$/.test(x.hanzi)));

  const ordinary = engine.query("tshiau");
  assert.ok(ordinary.results.some((x) => x.tier <= TIER.PREFIX));
});

test("raw regex matches the site's spaced numeric Tâi-lô format", () => {
  const ending = engine.query("iat4$", { limit: 200 });
  assert.ok(ending.results.length > 0);
  assert.ok(hanzis(ending).includes("結"));

  const syllables = engine.query("^si[aptk][14]$", { limit: 200 });
  assert.ok(syllables.results.length > 0);

  const alternatives = engine.query("h(ue|e)2 tshia", { limit: 200 });
  assert.ok(hanzis(alternatives).includes("火車"));
});

test("recency: boosts within a tier, never across tiers", () => {
  // "tk" abbreviation hits share one tier — a recent entry moves to the front
  const base = engine.query("tk", { limit: 50 });
  assert.ok(base.results.length > 5);
  const target = base.results[5];
  const boosted = engine.query("tk", {
    limit: 50,
    recencyRank: (id) => (id === target.id ? 0 : undefined),
  });
  assert.equal(boosted.results[0].id, target.id);
  assert.equal(boosted.results[0].recent, true);
  assert.equal(boosted.results[1].recent, false);

  // a recent prefix-tier hit must not overtake the exact hits (是 sī, 詩 si)
  const si = engine.query("si", { limit: 200 });
  const prefixHit = si.results.find((x) => x.tier === TIER.PREFIX);
  assert.ok(prefixHit);
  const siBoosted = engine.query("si", {
    limit: 200,
    recencyRank: (id) => (id === prefixHit.id ? 0 : undefined),
  });
  assert.equal(siBoosted.results[0].tier, TIER.EXACT);
  const boostedPos = siBoosted.results.findIndex((x) => x.id === prefixHit.id);
  const firstPrefixPos = siBoosted.results.findIndex((x) => x.tier === TIER.PREFIX);
  assert.equal(boostedPos, firstPrefixPos); // first within its own tier
});

test("randomMainId: deterministic with injected rand, main entries only", () => {
  const first = engine.randomMainId(() => 0);
  assert.equal(engine.randomMainId(() => 0), first);
  const last = engine.randomMainId(() => 0.999999);
  assert.notEqual(first, last);
  // both picks must belong to a row flagged as a main entry
  const ids = packed.id;
  const flags = packed.flags;
  for (const id of [first, last]) {
    assert.ok(ids.some((x, i) => x === id && (flags[i] & 1)), `id ${id} should be a main entry`);
  }
});

test("randomProverbId: deterministic, only fullwidth-punctuated main entries", () => {
  const ids = packed.id;
  const flags = packed.flags;
  const hanzi = packed.hanzi.split("\n");
  const first = engine.randomProverbId(() => 0);
  assert.equal(engine.randomProverbId(() => 0), first);
  const last = engine.randomProverbId(() => 0.999999);
  assert.notEqual(first, last);
  for (const id of [first, last]) {
    assert.ok(
      ids.some((x, i) => x === id && (flags[i] & 1) && /[，。；？]/.test(hanzi[i])),
      `id ${id} should be a proverb-like main entry`
    );
  }
});

test("empty input", () => {
  assert.equal(engine.query("").results.length, 0);
  assert.equal(engine.query("   ").results.length, 0);
});

test("ranking: a typed tone puts its toned-exact hit first", () => {
  const r = engine.query("e5");
  assert.ok(r.results.length > 0);
  assert.equal(r.results[0].tier, TIER.TONED);
  assert.equal(r.results[0].tl.toLowerCase(), "ê");
});

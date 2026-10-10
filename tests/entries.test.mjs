// Entry-page data build: fixture-level joins + full-data coverage against the search index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  buildEntries, readSheets, serializeShard, shardEntries, ODS_PATH, SEARCH_INDEX_PATH,
} from "../scripts/build-entries.mjs";
import { bucketOf } from "../src/data-paths.js";
import { FLAG } from "../extension/src/search/engine.js";

const header = ["header"];
const fixture = {
  詞目: [header,
    ["1", "主詞目", "一【替】", "tsi̍t", "數詞、量詞"],
    ["49", "主詞目", "八", "【白】peh/pueh", ""],
    ["50", "近反義詞不單列詞目者", "刀仔", "to-á", ""],
    ["60", "臺華共同詞", "電腦", "tiān-náu", ""],
  ],
  義項: [header, ["1", "100", "數詞", "數目。"], ["1", "101", "形容詞", "全部的。"], ["49", "200", "數詞", "數字。"]],
  例句: [header,
    ["1", "100", "2", "一隻貓", "tsi̍t tsiah niau", "一隻貓"],
    ["1", "100", "1", "一蕊花", "tsi̍t luí hue", "一朵花"],
    ["50", "999", "1", "x", "x", "x"],
  ],
  又唸作: [header, ["49", "八", "pat/pueh"]],
  異用字: [header, ["1", "一", "蜀"], ["1", "一", "蜀"]],
  義項tuì義項近義: [header, ["101", "一", "全部的。", "200", "八", "數字。"]],
  義項tuì詞目反義: [header, ["100", "一", "數目。", "50", "刀仔"]],
  詞目tuì詞目近義: [header, ["1", "一", "49", "八"], ["1", "一", "49", "八"]],
};

test("buildEntries_publishedTypesOnly_skipsUnlistedSynonymEntries", () => {
  const entries = buildEntries(fixture);
  assert.deepEqual([...entries.keys()], [1, 49, 60]);
});

test("buildEntries_markedHeadword_splitsMarksFromTextAndReadings", () => {
  const entries = buildEntries(fixture);
  assert.equal(entries.get(1).hanzi, "一");
  assert.equal(entries.get(1).isSubstitute, true);
  assert.equal(entries.get(49).readingMark, "白");
  assert.deepEqual(entries.get(49).tl, ["peh", "pueh"]);
  // trace: taigi-converter tl→poj: pueh → poeh
  assert.deepEqual(entries.get(49).poj, ["peh", "poeh"]);
  // trace: taigi-converter tl→zhuyin: peh → ㄅㆤㆷ, pueh → ㄅㄨㆤㆷ
  assert.deepEqual(entries.get(49).tps, ["ㄅㆤㆷ", "ㄅㄨㆤㆷ"]);
  assert.deepEqual(entries.get(49).altReadings, [["又唸作", ["pat", "pueh"]]]);
});

test("buildEntries_examples_joinBySenseInListedOrder", () => {
  const [first] = buildEntries(fixture).get(1).senses;
  assert.deepEqual(first.examples, [
    ["一蕊花", "tsi̍t luí hue", "一朵花"],
    ["一隻貓", "tsi̍t tsiah niau", "一隻貓"],
  ]);
});

test("buildEntries_relations_linkPublishedTargetsOnlyAndDeduplicate", () => {
  const entry = buildEntries(fixture).get(1);
  // linked targets use the target's label, marks included (official: 頭 白 thâu)
  assert.deepEqual(entry.senses[1].synonyms, [[49, "八 【白】peh/pueh"]]);
  assert.deepEqual(entry.senses[0].antonyms, [[null, "刀仔"]]);
  assert.deepEqual(entry.synonyms, [[49, "八 【白】peh/pueh"]]);
  assert.deepEqual(entry.variants, ["蜀"]);
});

test("buildEntries_sameHanzi_linkedAsSeeAlsoWithSourceMarks", () => {
  const entries = buildEntries({
    ...fixture,
    詞目: [header,
      ["45", "主詞目", "人", "jîn/lîn", ""],
      ["46", "主詞目", "人【替】", "lâng", ""],
      ["21807", "附錄", "人", "Jîn/Lîn", ""],
      ["42", "主詞目", "九", "【文】kiú", ""],
    ],
  });
  // trace: official 人 jîn page lists 又見音 「人 替 lâng」「人 Jîn/Lîn」
  assert.deepEqual(entries.get(45).seeAlso, [[46, "人【替】 lâng"], [21807, "人 Jîn/Lîn"]]);
  assert.deepEqual(entries.get(46).seeAlso, [[45, "人 jîn/lîn"], [21807, "人 Jîn/Lîn"]]);
  assert.deepEqual(entries.get(42).seeAlso, []);
});

test("buildEntries_dialectSheet_readingsPerAccentInColumnOrder", () => {
  const entries = buildEntries({
    ...fixture,
    語音差異: [["詞目id", "漢字", "鹿港偏泉腔", "宜蘭偏漳腔", "臺中偏漳腔"],
      ["49", "八", "pueh", "moo,mn̂g", ""], ["50", "刀仔", "to", "to", "to"]],
  });
  // trace: official 毛 page splits "moo,mn̂g" into two rows; 頭 omits its empty 臺中偏漳腔
  assert.deepEqual(entries.get(49).dialectReadings, [["鹿港偏泉腔", ["pueh"]], ["宜蘭偏漳腔", ["moo", "mn̂g"]]]);
  assert.deepEqual(entries.get(1).dialectReadings, []);
});

test("buildEntries_comparisonLinks_attachTablesWithRowsInAccentOrder", () => {
  const entries = buildEntries({
    ...fixture,
    語音差異: [["詞目id", "漢字", "鹿港偏泉腔", "臺北偏泉腔", "臺中偏漳腔"]],
    詞彙比較: [header,
      ["16", "一百零一", "臺中偏漳腔", "一百空一", "tsi̍t-pah khòng it"],
      ["16", "一百零一", "鹿港偏泉腔", "一百空一", "tsi̍t-pah khòng tsi̍t"],
      ["118", "工具", "臺北偏泉腔", "家私", "ke-si"],
      ["118", "工具", "臺北偏泉腔", "家私頭仔", "ke-si-thâu-á"],
    ],
  }, { 1: [118, 16], 50: [16] });
  // trace: official 一百空一 page lists 鹿港 before 臺中 though the sheet has 臺中 first
  assert.deepEqual(entries.get(1).comparisons, [
    { mandarin: "工具", rows: [["臺北偏泉腔", "家私", "ke-si"], ["臺北偏泉腔", "家私頭仔", "ke-si-thâu-á"]] },
    { mandarin: "一百零一", rows: [["鹿港偏泉腔", "一百空一", "tsi̍t-pah khòng tsi̍t"], ["臺中偏漳腔", "一百空一", "tsi̍t-pah khòng it"]] },
  ]);
  assert.deepEqual(entries.get(49).comparisons, []);
  assert.throws(() => buildEntries(fixture, { 1: [999] }), /missing 華語詞目id 999/);
});

test("serializeShard_emptyFields_omittedButTupleNullsKept", () => {
  const json = serializeShard(Object.fromEntries(buildEntries(fixture)));
  const shard = JSON.parse(json);
  // poj omitted: identical to tl; trace: tl→zhuyin tiān-náu → "ㄉㄧㄢ˫ ㄋㄠˋ"
  assert.deepEqual(shard[60], { id: 60, type: "臺華共同詞", hanzi: "電腦", tl: ["tiān-náu"], tps: ["ㄉㄧㄢ˫ ㄋㄠˋ"] });
  assert.deepEqual(shard[1].senses[0].antonyms, [[null, "刀仔"]]);
});

test("bucketOf_idsShareShardPer500", () => {
  assert.equal(bucketOf(1), 0);
  assert.equal(bucketOf(499), 0);
  assert.equal(bucketOf(500), 1);
  const buckets = shardEntries(buildEntries(fixture));
  assert.deepEqual(Object.keys(buckets.get(0)), ["1", "49", "60"]);
});

test("fullData_everySearchIndexId_hasAnEntryPage", { skip: !existsSync(SEARCH_INDEX_PATH) && "run `npm run build:index` first" }, () => {
  const entries = buildEntries(readSheets(ODS_PATH));
  const index = JSON.parse(readFileSync(SEARCH_INDEX_PATH, "utf8"));
  const missing = [...new Set(index.id)].filter((id) => !entries.has(id));
  assert.deepEqual(missing, []);
});

// entries sharing a form (恩 【白】in/un + 【文】un, five 附錄 東區) each need their own row
test("fullData_everyEntryPage_hasAnOwnSearchIndexRow", { skip: !existsSync(SEARCH_INDEX_PATH) && "run `npm run build:index` first" }, () => {
  const entries = buildEntries(readSheets(ODS_PATH));
  const index = JSON.parse(readFileSync(SEARCH_INDEX_PATH, "utf8"));
  const indexed = new Set(index.id.filter((_, i) => !(index.flags[i] & FLAG.ALIAS)));
  assert.deepEqual([...entries.keys()].filter((id) => !indexed.has(id)), []);
});

// Entry-page data build: fixture-level joins + full-data coverage against the search index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  buildEntries, readSheets, serializeShard, shardEntries, ODS_PATH, VENDOR_INDEX_PATH,
} from "../scripts/build-entries.mjs";
import { bucketOf } from "../src/data-paths.js";

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
  // linked targets carry the target entry's readings (official: 傷本 siong-pún)
  assert.deepEqual(entry.senses[1].synonyms, [[49, "八", "peh/pueh"]]);
  assert.deepEqual(entry.senses[0].antonyms, [[null, "刀仔"]]);
  assert.deepEqual(entry.synonyms, [[49, "八", "peh/pueh"]]);
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

test("serializeShard_emptyFields_omittedButTupleNullsKept", () => {
  const json = serializeShard(Object.fromEntries(buildEntries(fixture)));
  const shard = JSON.parse(json);
  // poj omitted: identical to tl
  assert.deepEqual(shard[60], { id: 60, type: "臺華共同詞", hanzi: "電腦", tl: ["tiān-náu"] });
  assert.deepEqual(shard[1].senses[0].antonyms, [[null, "刀仔"]]);
});

test("bucketOf_idsShareShardPer500", () => {
  assert.equal(bucketOf(1), 0);
  assert.equal(bucketOf(499), 0);
  assert.equal(bucketOf(500), 1);
  const buckets = shardEntries(buildEntries(fixture));
  assert.deepEqual(Object.keys(buckets.get(0)), ["1", "49", "60"]);
});

test("fullData_everySearchIndexId_hasAnEntryPage", { skip: !existsSync(VENDOR_INDEX_PATH) && "run `npm run build:index` first" }, () => {
  const entries = buildEntries(readSheets(ODS_PATH));
  const index = JSON.parse(readFileSync(VENDOR_INDEX_PATH, "utf8"));
  const missing = [...new Set(index.id)].filter((id) => !entries.has(id));
  assert.deepEqual(missing, []);
});

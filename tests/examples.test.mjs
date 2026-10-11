// 例句 search: build rows from entries + hanzi / 華語 / romanization matching.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntries, exampleRows } from "../scripts/build-entries.mjs";
import { createExampleSearch } from "../src/example-search.js";

const header = ["header"];
const fixture = {
  詞目: [header,
    ["1", "主詞目", "一", "tsi̍t", ""],
    ["50", "近反義詞不單列詞目者", "刀仔", "to-á", ""],
  ],
  義項: [header, ["1", "100", "數詞", "數目。"], ["50", "999", "名詞", "刀子。"]],
  例句: [header,
    ["1", "100", "2", "一隻貓", "tsi̍t tsiah niau", "一隻貓"],
    ["1", "100", "1", "一蕊花", "tsi̍t luí hue", "一朵花"],
    ["50", "999", "1", "x", "x", "x"],
  ],
};

test("exampleRows_publishedEntries_flattenInSenseOrder", () => {
  assert.deepEqual(exampleRows(buildEntries(fixture)), [
    [1, "一蕊花", "tsi̍t luí hue", "一朵花"],
    [1, "一隻貓", "tsi̍t tsiah niau", "一隻貓"],
  ]);
});

const rows = [
  [10, "紅嬰仔哭甲一身軀汗。", "Âng-enn-á khàu kah tsi̍t sin-khu kuānn.", "小嬰兒哭得滿身大汗。"],
  [20, "伊真緊就來矣。", "I tsin kín tō lâi--ah.", "他很快就來了。"],
  [30, "臺灣人", "Tâi-uân-lâng", "台灣人"],
];
const engine = createExampleSearch(rows);
const ids = (query, limit = 5) => engine.search(query, limit).map((hit) => hit.entryId);

test("exampleSearch_hanzi_matchesSentenceOr華語", () => {
  assert.deepEqual(ids("嬰仔"), [10]);
  assert.deepEqual(ids("滿身大汗"), [10]);
  // 台/臺 folded on both sides
  assert.deepEqual(ids("台灣"), [30]);
});

test("exampleSearch_romanization_matchesWholeTonelessSyllables", () => {
  assert.deepEqual(ids("sin-khu"), [10]);
  assert.deepEqual(ids("sin khù"), [10]);
  assert.deepEqual(ids("lâi ah"), [20]);
  // "tsin" must not match inside "tsi̍t sin", nor "in" inside any syllable
  assert.deepEqual(ids("tsin"), [20]);
  assert.deepEqual(ids("in"), []);
});

test("exampleSearch_hit_carriesSentenceFields", () => {
  assert.deepEqual(engine.search("快", 5), [
    { entryId: 20, hanzi: "伊真緊就來矣。", tl: "I tsin kín tō lâi--ah.", mandarin: "他很快就來了。" },
  ]);
});

test("exampleSearch_regexBopomofoOrEmpty_returnsNothing", () => {
  assert.deepEqual(ids("sin.*"), []);
  assert.deepEqual(ids("ㄒㄧㄣ"), []);
  assert.deepEqual(ids("  "), []);
});

test("exampleSearch_limit_capsHitsInRowOrder", () => {
  const twice = createExampleSearch([[1, "一隻貓", "tsi̍t tsiah niau", ""], [2, "一蕊花", "tsi̍t luí hue", ""]]);
  assert.deepEqual(twice.search("一", 1).map((hit) => hit.entryId), [1]);
  assert.deepEqual(twice.search("tsit", 5).map((hit) => hit.entryId), [1, 2]);
});

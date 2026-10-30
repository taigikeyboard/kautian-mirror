import test from "node:test";
import assert from "node:assert/strict";
import { parseMixed, alignMixed, matchMixed } from "../src/search/mixed.js";

const row = (hanzi, tl, poj, num) => alignMixed(hanzi, tl, poj, num);
const match = (input, entry) => matchMixed(parseMixed(input), entry);

test("mixed matching keeps Roman runs at character/syllable boundaries", () => {
  const entry = row("袂赴市", "bē-hù-tshī", "bē-hù-chhī", "be7 hu3 tshi7");
  for (const input of ["bē赴市", "be7赴市", "be赴市", "袂hu3市", "袂hù市", "BE 赴 市", "袂-hu-市"]) {
    assert.equal(match(input, entry), "exact", input);
  }
  for (const input of ["bé赴市", "be2赴市", "b赴市", "袂h市", "赴be市", "袂hu7市", "袂赴sī"]) {
    assert.equal(match(input, entry), null, input);
  }
});

test("mixed matching consumes multiple romanized syllables without enumerating spellings", () => {
  const entry = row("臺北車站", "tâi-pak tshia-tsām", "tâi-pak chhia-chām", "tai5 pak4 tshia1 tsam7");
  for (const input of ["taipak車站", "tai5pak4車站", "tâi-pak車站", "臺pakchhia站", "臺pak車tsam7"]) {
    assert.equal(match(input, entry), "exact", input);
  }
  assert.equal(match("台pak車站", entry), "exact");
  assert.equal(match("臺p車站", entry), null);
});

test("mixed matching lets toned runs leave some syllables toneless", () => {
  const entry = row("臺北車站", "tâi-pak tshia-tsām", "tâi-pak chhia-chām", "tai5 pak4 tshia1 tsam7");
  for (const input of ["tai5pak車站", "taipak4車站", "tâipak4車站", "臺pak4tshia站"]) {
    assert.equal(match(input, entry), "exact", input);
  }
  for (const input of ["tai2pak車站", "tai5pak8車站", "tai5p車站"]) {
    assert.equal(match(input, entry), null, input);
  }
});

test("mixed parsing marks TONED only when every roman run is toned", () => {
  assert.equal(parseMixed("bē赴tshī").allToned, true);
  assert.equal(parseMixed("bē赴tshi").allToned, false);
  assert.equal(parseMixed("be赴").allToned, false);
});

test("mixed matching distinguishes exact, prefix, partial syllable, and substring", () => {
  const entry = row("袂赴市", "bē-hù-tshī", "bē-hù-chhī", "be7 hu3 tshi7");
  assert.equal(match("bē赴", entry), "prefix");
  assert.equal(match("袂hu", entry), "prefix");
  assert.equal(match("袂h", entry), "splitPrefix");
  assert.equal(match("hù市", entry), "substring");
  assert.equal(match("赴tsh", entry), "substring");
});

test("mixed matching handles POJ nasalization, combining marks, and supplementary Hanji", () => {
  const entry = row("看人", "khuànn-lâng", "khòaⁿ-lâng", "khuann3 lang5");
  for (const input of ["khòaⁿ人", "khoaⁿ3人", "khoann3人", "khuànn人".normalize("NFD")]) {
    assert.equal(match(input, entry), "exact", input);
  }
  assert.equal(match("𠢕tsa2", row("𠢕早", "gâu-tsá", "gâu-chá", "gau5 tsa2")), "exact");
});

test("mixed parsing leaves other input modes and unsupported alignments alone", () => {
  for (const input of ["袂赴", "bē-hù", "ㆠㆤ赴", "bē赴!", "bē赴🙂"]) {
    assert.equal(parseMixed(input), null, input);
  }
  assert.equal(row("就按呢", "tsua̋n", "choa̋n", "tsuann9"), null);
  assert.equal(row("甲，乙", "kah-it", "kah-it", "kah4 it4"), null);
});

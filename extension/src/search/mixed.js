// Match Hanji and romanization against the same character/syllable positions.
// Keep alternatives per row; never combine a character from one reading with another.
import { foldHanzi, normalizeLatin } from "./normalize.js";
import { deriveTlNotone, derivePojNotone, SYLLABLE_SEP_RE } from "./derive.js";

const HAN_RE = /\p{Script=Han}/u;
const TOKEN_RE = /\p{Script=Han}+|[\p{Script=Latin}\p{M}0-9ⁿᴺ]+(?:[-\s·'’]+[\p{Script=Latin}\p{M}0-9ⁿᴺ]+)*/gu;
const SEPARATOR_RE = /^[-\s·'’]*$/u;

export function parseMixed(input) {
  const text = foldHanzi(input.trim());
  const tokens = [];
  const hanji = [];
  let end = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    if (!SEPARATOR_RE.test(text.slice(end, match.index))) return null;
    const value = match[0];
    if (HAN_RE.test(value)) {
      hanji.push(value);
      tokens.push(...Array.from(value, (char) => ({ char })));
    } else {
      tokens.push(normalizeLatin(value));
    }
    end = match.index + value.length;
  }
  if (!SEPARATOR_RE.test(text.slice(end)) || !hanji.length || !tokens.some((t) => t.tlKey)) return null;
  return {
    tokens,
    hasTone: tokens.some((t) => t.hasTone),
    anchor: hanji.reduce((a, b) => a.length >= b.length ? a : b),
  };
}

export function alignMixed(hanzi, tl, poj, tlNum) {
  const chars = Array.from(hanzi);
  const split = (s) => s.toLowerCase().normalize("NFC").split(SYLLABLE_SEP_RE).filter(Boolean);
  const tls = split(tl);
  const pojs = split(poj);
  const nums = split(tlNum);
  // Contracted readings and punctuation do not give a reliable one-character/
  // one-syllable alignment. Leave those rows to the existing search paths.
  if (!chars.every((c) => HAN_RE.test(c)) || [tls, pojs, nums].some((s) => s.length !== chars.length)) return null;
  return { chars, tls, pojs, nums, tlKeys: tls.map(deriveTlNotone), pojKeys: pojs.map(derivePojNotone) };
}

// → exact | prefix | splitPrefix | substring | null
export function matchMixed(query, row) {
  if (!row) return null;
  const { chars, tls, pojs, nums, tlKeys, pojKeys } = row;
  let best = null;
  const ranks = { exact: 0, prefix: 1, splitPrefix: 2, substring: 3 };
  function record(start, end, partial = false) {
    const kind = start > 0 ? "substring" : partial ? "splitPrefix" : end === chars.length ? "exact" : "prefix";
    if (best === null || ranks[kind] < ranks[best]) best = kind;
  }
  for (let start = 0; start < chars.length; start++) {
    let positions = new Set([start]);
    for (let t = 0; t < query.tokens.length && positions.size; t++) {
      const token = query.tokens[t];
      const last = t === query.tokens.length - 1;
      const next = new Set();
      for (const pos of positions) {
        if (token.char) {
          if (chars[pos] === token.char) next.add(pos + 1);
          continue;
        }
        let tl = "", poj = "", num = "", tlKey = "", pojKey = "";
        for (let end = pos; end < chars.length; end++) {
          tl += tls[end]; poj += pojs[end]; num += nums[end];
          tlKey += tlKeys[end]; pojKey += pojKeys[end];
          const exact = token.hasTone
            ? [token.toned, token.tonedTl].some((key) => key === tl || key === poj || key === num)
            : token.tlKey === tlKey || token.pojKey === pojKey;
          if (exact) next.add(end + 1);
          // Only the final roman run may stop within a syllable. It cannot
          // hand the remaining letters to the next Hanji character.
          if (last && !token.hasTone && !exact && (tlKey.startsWith(token.tlKey) || pojKey.startsWith(token.pojKey))) {
            record(start, end + 1, true);
          }
        }
      }
      positions = next;
      if (last) for (const end of positions) record(start, end);
    }
    if (best === "exact") break;
  }
  return best;
}

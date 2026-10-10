// Two-sided Zhuyin approximate-sound folding.
//
// Data side:  each tps_notone character goes through DATA_FOLD → zhu_key
//             (derived at load time; see derive.js / engine.js)
// Query side: user's Zhuyin input is tone-stripped, 2-char sequence rules are
//             applied first, then per-character folding; one-to-many mappings
//             expand on the query side (cartesian product capped at MAX_KEYS)
// Both sides land in the same token space (TL-style strings) and are matched
// by exact/prefix comparison.

// Data side: TPS/Bopomofo character → token.
// Covers all 51 characters that appear in kautian.csv tps_notone.
export const DATA_FOLD = {
  // Initials
  "ㄅ": "p", "ㄆ": "ph", "ㄇ": "m", "ㆠ": "b",
  "ㄉ": "t", "ㄊ": "th", "ㄋ": "n", "ㄌ": "l",
  "ㄍ": "k", "ㄎ": "kh", "ㆣ": "g", "ㄏ": "h",
  "ㄗ": "ts", "ㄘ": "tsh", "ㄙ": "s",
  "ㄐ": "ts", "ㄑ": "tsh", "ㄒ": "s", // TPS borrows the Mandarin palatal series for tsi-/tshi-/si-
  "ㆡ": "j", "ㆢ": "j", "ㄫ": "ng",
  // Finals (nasalized vowels fold to oral vowels — recall over precision)
  "ㄚ": "a", "ㆩ": "a",
  "ㄛ": "o", "ㄜ": "o", // TL o → ㄛ; dialectal er/or → ㄜ; both fold to o
  "ㆦ": "oo", "ㆧ": "oo",
  "ㆤ": "e", "ㆥ": "e", "ㄝ": "e",
  "ㄞ": "ai", "ㆮ": "ai",
  "ㄠ": "au", "ㆯ": "au",
  "ㄧ": "i", "ㆪ": "i",
  "ㄨ": "u", "ㆫ": "u",
  "ㆨ": "ir",
  // Codas / syllabic nasals
  "ㄢ": "an", "ㄣ": "n", "ㄤ": "ang", "ㄥ": "ng",
  "ㆰ": "am", "ㆱ": "om", "ㆲ": "ong",
  "ㆬ": "m", "ㆭ": "ng",
  // Checked-tone codas: excluded from approximate-sound matching
  "ㆴ": "", "ㆵ": "", "ㆷ": "", "ㆻ": "",
};

// Query-side 2-char sequence rules (take precedence over the per-char table;
// handle Mandarin compound finals that misalign with Taiwanese finals)
const QUERY_SEQ = {
  "ㄨㄥ": ["ong"],        // Mandarin -ung sound value
  "ㄩㄥ": ["iong"],
  "ㄨㄟ": ["ui", "ue"],
  "ㄧㄡ": ["iu"],
};

// Query-side per-char table → candidate tokens. Only entries that differ from
// DATA_FOLD or are one-to-many are listed; everything else falls back to DATA_FOLD.
const QUERY_FOLD = {
  "ㄇ": ["m", "b"],   // Mandarin m ↔ Taiwanese m/b are cognate
  "ㄈ": ["h"],        // Taiwanese has no f; usually corresponds to h (福 hok)
  "ㄋ": ["n", "l"],
  "ㄖ": ["j", "l"],   // 日 ji̍t/li̍t
  "ㄓ": ["ts"], "ㄔ": ["tsh"], "ㄕ": ["s"], // retroflex folds to dental
  "ㄛ": ["o", "oo"],
  "ㄦ": ["o"],
  "ㄟ": ["e", "ue"],  // 杯 pue
  "ㄡ": ["au", "oo"],
  "ㄢ": ["an", "am"],
  "ㄥ": ["ng", "ong"],
  "ㄨ": ["u", "ir"],
  "ㄩ": ["i", "u"],
};

const MAX_KEYS = 64;

// Zhuyin/TPS tone marks and whitespace (stripped on the query side;
// data-side tps_notone is already toneless)
const TONE_CHARS_RE = /[ˊˇˋ˙ˆ˘˪˫̀-ͯ·\s]/g;

export function isBopomofo(text) {
  return /[㄀-ㄯㆠ-ㆿ]/.test(text);
}

// Data-side fold: tps_notone → zhu_key.
// Returns { key, unknown }: unknown lists unmapped characters (for build QA).
export function dataFold(tps) {
  let key = "";
  const unknown = [];
  for (const ch of tps) {
    const tok = DATA_FOLD[ch];
    if (tok === undefined) unknown.push(ch);
    else key += tok;
  }
  return { key, unknown };
}

// Query-side fold: Zhuyin input → candidate zhu_key array
// (tone-stripped, one-to-many mappings expanded).
export function queryFold(input) {
  const text = input.normalize("NFC").replace(TONE_CHARS_RE, "");
  const alts = []; // each slot is an array of candidate tokens
  let i = 0;
  while (i < text.length) {
    const pair = text.slice(i, i + 2);
    if (QUERY_SEQ[pair]) {
      alts.push(QUERY_SEQ[pair]);
      i += 2;
      continue;
    }
    const ch = text[i];
    const cand = QUERY_FOLD[ch] || (DATA_FOLD[ch] !== undefined ? [DATA_FOLD[ch]] : null);
    if (cand) alts.push(cand.filter((t) => t !== ""));
    // unknown characters (ASCII, punctuation) are skipped
    i += 1;
  }
  // cartesian product, capped at MAX_KEYS
  let keys = [""];
  for (const cand of alts) {
    if (cand.length === 0) continue;
    const next = [];
    for (const prefix of keys) {
      for (const tok of cand) {
        next.push(prefix + tok);
        if (next.length >= MAX_KEYS) break;
      }
      if (next.length >= MAX_KEYS) break;
    }
    keys = next;
  }
  return keys.filter((k) => k.length > 0);
}

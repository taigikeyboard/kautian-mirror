import { toZhuyin } from "../../../vendor/taigi-converter/src/zhuyin.js";

// Load-time derived search columns.
// These functions are the correctness foundation of data format v2: the build
// script does a full comparison of "derived result vs CSV column" as QA and
// fails the build on any mismatch — data or rule drift blows up loudly here
// instead of silently mis-matching at query time.
//
// TPS tone-mark set: ˊˇˋ˙ (tones 2/6/3/neutral), ˆ (tone 9, U+02C6),
// ˘ (U+02D8), ˪˫ (vertical tones 3/7), combining marks (incl. tone 8 U+0307),
// whitespace (tone 1), · (neutral-tone prefix)
export const TPS_TONE_RE = /[ˊˇˋ˙ˆ˘˪˫̀-ͯ\s·]/g;
const TPS_EXPLICIT_TONE_RE = /[ˊˇˋ˙ˆ˘˪˫̀-ͯ·]/;

const COMBINING_RE = /[̀-ͯ]/g;
const JOIN_RE = /--|[-\s]+|[0-9]/g;
// syllable separators of a tl/poj form: hyphen, neutral-tone --, whitespace
export const SYLLABLE_SEP_RE = /--|[-\s]+/g;

// tl (with tones and hyphens) → toneless, hyphenless, lowercase (≡ CSV tl_notone)
export function deriveTlNotone(tl) {
  return tl
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_RE, "")
    .replace(JOIN_RE, "")
    .normalize("NFC");
}

// poj → toneless POJ spelling, lowercase (≡ CSV poj_notone; o͘→oo, ⁿ→nn)
export function derivePojNotone(poj) {
  return poj
    .toLowerCase()
    .normalize("NFD")
    .replaceAll("͘", "o") // U+0358: the right dot of o͘ → completes as oo
    .replaceAll("ⁿ", "nn")
    .replaceAll("ᴺ", "nn")
    .replace(COMBINING_RE, "")
    .replace(JOIN_RE, "")
    .normalize("NFC");
}

// tps (with tones) → toneless (≡ CSV tps_notone)
export function deriveTpsNotone(tps) {
  return tps.normalize("NFC").replace(TPS_TONE_RE, "");
}

export function hasExplicitTpsTone(tps) {
  return TPS_EXPLICIT_TONE_RE.test(tps.normalize("NFD"));
}

// tps (with tones) → toned key without syllable spaces or the neutral-tone ·, so the data's
// fused form (≡ CSV tps_num) and a typed "ㄏㄛˋ ㄙㆤ˪" / "ㄊㄧㆩ ·ㄉㄧㄛㆷ̇" compare equal
export function fuseTps(tps) {
  return tps.normalize("NFC").replace(/[\s·]+/g, "");
}

// converter TPS output → one space between syllables, clause punctuation attached:
// "ㄍㆤ  ， ㄒㄧㄣ" → "ㄍㆤ，ㄒㄧㄣ" (shared with the entry pages, scripts/build-entries.mjs toTps)
export function tidyTps(tps) {
  return tps.replace(/\s*([，。；？！、])\s*/g, "$1").replace(/\s+/g, " ").trim();
}

// fused tps (≡ CSV tps_num) → syllables space-separated, as the entry page writes them:
// "ㄏㄛˋㄙㆤ˪" + tl_num "ho2 se3" → "ㄏㄛˋ ㄙㆤ˪". Unchanged when the tl_num syllables do not
// convert back to exactly the fused form (0 rows of the current data).
export function spaceTps(tps, tlNum) {
  const prefix = tps.startsWith("·") ? "·" : ""; // whole-word neutral tone: --eh → ·ㆤㆷ
  const spaced = prefix + tidyTps(tlNum.split(/\s+/).map((s) => toZhuyin(s)).join(" "));
  return fuseTps(spaced) === fuseTps(tps) ? spaced : tps;
}

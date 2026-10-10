// User-input normalization.
import { normalizeToTl, parseSyllable } from "../../vendor/taigi-converter/src/phonetics.js";
import { toTl } from "../../vendor/taigi-converter/src/tl.js";

const COMBINING_RE = /[̀-ͯ]/g;
const SEG_SPLIT_RE = /--|[-\s·'’]+/;

// Single syllable segment → toneless POJ/TL normal form
function segNotone(seg) {
  return seg
    .toLowerCase()
    .normalize("NFD")
    .replaceAll("͘", "o") // o͘ → oo (must run before combining marks are stripped)
    .replaceAll("ⁿ", "nn")
    .replaceAll("ᴺ", "nn")
    .replace(COMBINING_RE, "")
    .replace(/[0-9]/g, "")
    .normalize("NFC");
}

function segTonedTl(seg) {
  try {
    return toTl(...parseSyllable(seg.toLowerCase()));
  } catch {
    return normalizeToTl(seg.toLowerCase().normalize("NFD")).normalize("NFC");
  }
}

function segTonedTlNumber(seg) {
  try {
    const [initial, final, tone] = parseSyllable(seg.toLowerCase());
    return `${initial}${final}${tone}`;
  } catch {
    return normalizeToTl(segNotone(seg));
  }
}

// Romanized input → match keys.
// pojKey:  toneless, POJ spelling preserved (matched against poj_notone)
// tlKey:   toneless, normalizeToTl applied per segment (matched against tl_notone)
// toned:   toned key (lowercase, hyphens/whitespace removed, tone marks/digits kept)
// tonedTl: toned key with POJ spelling and tone placement folded to TL
//          (khoann2 / khóaⁿ → khuánn)
// tonedTlNumber: the same canonical spelling with numeric tone (→ khuann2),
//                used for broad scans without Unicode combining-mark ambiguity
// hasTone: whether the input carries tone info (diacritics or digits)
export function normalizeLatin(input) {
  const raw = input.trim();
  const segs = raw.split(SEG_SPLIT_RE).filter(Boolean);
  const pojKey = segs.map(segNotone).join("");
  const tlKey = segs.map((s) => normalizeToTl(segNotone(s))).join("");
  const toned = raw.toLowerCase().replace(SEG_SPLIT_RE, "").normalize("NFC");
  const tonedTl = segs.map(segTonedTl).join("");
  const tonedTlNumber = segs.map(segTonedTlNumber).join("");
  const hasTone = /[0-9]/.test(raw) || /[̀-ͯ]/.test(raw.normalize("NFD"));
  return { pojKey, tlKey, toned, tonedTl, tonedTlNumber, hasTone };
}

// Hanzi variant folding (applied on both sides; v1 starts small)
export function foldHanzi(text) {
  return text.normalize("NFC").replaceAll("台", "臺");
}

// TPS input → toneless TPS key (tone-mark set shared with the data side, see derive.js)
export { deriveTpsNotone as normalizeTps } from "./derive.js";

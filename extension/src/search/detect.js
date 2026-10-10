// Input type detection.
import { isBopomofo } from "./zhuyin-fold.js";

// escapes, not literal characters: NFC turns a literal U+F900 (豈) into U+8C48, which once
// silently widened this range over Hangul, Yi and the Private Use Area
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{2ffff}]/u;

// → 'hanzi' | 'bopomofo' | 'latin' | 'empty'
export function classify(input) {
  const text = input.trim();
  if (!text) return "empty";
  if (CJK_RE.test(text)) return "hanzi";
  if (isBopomofo(text)) return "bopomofo";
  // Punctuation-only input may still be a valid raw regular expression.
  return "latin";
}

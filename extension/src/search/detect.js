// Input type detection.
import { isBopomofo } from "./zhuyin-fold.js";

const CJK_RE = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ffff}]/u;

// → 'hanzi' | 'bopomofo' | 'latin' | 'empty'
export function classify(input) {
  const text = input.trim();
  if (!text) return "empty";
  if (CJK_RE.test(text)) return "hanzi";
  if (isBopomofo(text)) return "bopomofo";
  // Punctuation-only input may still be a valid raw regular expression.
  return "latin";
}

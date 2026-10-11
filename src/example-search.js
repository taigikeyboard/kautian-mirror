// 例句 search: hanzi / 華語 substring, or a run of whole toneless TL syllables; no DOM.
import { classify } from "../extension/src/search/detect.js";
import { foldHanzi, tlSyllables } from "../extension/src/search/normalize.js";
import { hasRegexSyntax } from "../extension/src/search/regex-mode.js";

// rows: [entryId, hanzi, tl, mandarin] (data/examples.json)
// → { search(query, limit) → [{ entryId, hanzi, tl, mandarin }] }
export function createExampleSearch(rows) {
  let hanziKeys = null;
  let syllableKeys = null;

  function matchesHanzi(query) {
    hanziKeys ??= rows.map(([, hanzi, , mandarin]) => foldHanzi(`${hanzi}\n${mandarin}`));
    const key = foldHanzi(query);
    return (i) => hanziKeys[i].includes(key);
  }

  // space-padded so "sin khu" matches whole syllables, never "tsin-khuì"
  function matchesSyllables(query) {
    syllableKeys ??= rows.map(([, , tl]) => ` ${tlSyllables(tl).join(" ")} `);
    const syllables = tlSyllables(query);
    if (!syllables.length) return null;
    const key = ` ${syllables.join(" ")} `;
    return (i) => syllableKeys[i].includes(key);
  }

  function search(query, limit) {
    const text = query.trim();
    // regex input belongs to headword search; 例句 have no 注音 to match
    if (!text || hasRegexSyntax(text)) return [];
    const mode = classify(text);
    const isMatch = mode === "hanzi" ? matchesHanzi(text) : mode === "latin" ? matchesSyllables(text) : null;
    if (!isMatch) return [];
    const found = [];
    for (let i = 0; i < rows.length && found.length < limit; i++) {
      if (!isMatch(i)) continue;
      const [entryId, hanzi, tl, mandarin] = rows[i];
      found.push({ entryId, hanzi, tl, mandarin });
    }
    return found;
  }

  return { search };
}

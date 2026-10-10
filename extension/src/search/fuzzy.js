// Fuzzy matching.
// Damerau-Levenshtein (OSA variant), banded DP with early abort.

export function fuzzyThreshold(len) {
  return len <= 5 ? 1 : 2;
}

// Returns the edit distance, or k+1 as soon as it is provably > k (early abort)
export function boundedDistance(a, b, k) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > k) return k + 1;
  if (a === b) return 0;
  // DP with band width 2k+1
  let prev2 = null;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1).fill(k + 1);
    cur[0] = i;
    const from = Math.max(1, i - k);
    const to = Math.min(lb, i + k);
    let rowMin = cur[0];
    for (let j = from; j <= to; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(
        (prev[j] ?? k + 1) + 1,
        (cur[j - 1] ?? k + 1) + 1,
        (prev[j - 1] ?? k + 1) + cost
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, (prev2[j - 2] ?? k + 1) + 1);
      }
      cur[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > k) return k + 1; // whole row above threshold — can never recover
    prev2 = prev;
    prev = cur;
  }
  return Math.min(prev[lb], k + 1);
}

// Fuzzy-scan a keys array; calls add(idx, distance) on each hit
export function fuzzyScan(keys, query, add, maxHits = 100) {
  const k = fuzzyThreshold(query.length);
  let hits = 0;
  for (let i = 0; i < keys.length && hits < maxHits; i++) {
    const key = keys[i];
    if (Math.abs(key.length - query.length) > k) continue;
    const d = boundedDistance(query, key, k);
    if (d <= k && d > 0) {
      add(i, d);
      hits++;
    }
  }
}

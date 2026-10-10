// Recently opened dictionary entries, kept as a small LRU of entry ids in
// chrome.storage.local (device-only — deliberately not synced: lookup history
// is private). The options page clears it by overwriting the same key.
export const RECENT_KEY = "recentEntries";
const MAX_RECENT = 50;

export function createRecency(storageArea) {
  let ids = []; // most recent first
  const rank = new Map(); // entry id → 0-based recency rank

  function rebuild() {
    rank.clear();
    ids.forEach((id, i) => rank.set(id, i));
  }

  if (storageArea?.get) {
    storageArea.get({ [RECENT_KEY]: [] }, (stored) => {
      if (Array.isArray(stored[RECENT_KEY])) {
        ids = stored[RECENT_KEY];
        rebuild();
      }
    });
    // stay in sync when the options page clears the history
    storageArea.onChanged?.addListener((changes) => {
      if (RECENT_KEY in changes) {
        ids = changes[RECENT_KEY].newValue ?? [];
        rebuild();
      }
    });
  }

  return {
    rankOf: (id) => rank.get(id), // lower = more recent; undefined = not recent
    record(id) {
      ids = [id, ...ids.filter((x) => x !== id)].slice(0, MAX_RECENT);
      rebuild();
      storageArea?.set?.({ [RECENT_KEY]: ids });
    },
  };
}

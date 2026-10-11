// 收藏 (bookmarked entries): newest first, kept in this browser's storage only (no sync).
const STORAGE_KEY = "bookmarks";

// bookmark: { id, hanzi, tl } — tl is the entry's readings joined with "/", as in its tab title
export const bookmarkOf = (entry) => ({ id: entry.id, hanzi: entry.hanzi, tl: entry.tl.join("/") });

const isBookmark = (item) =>
  Number.isInteger(item?.id) && typeof item.hanzi === "string" && typeof item.tl === "string";

// storageArea: chrome.storage-shaped { get(defaults, callback), set(items) } (main.js localArea)
// onChange: called after every toggle
export function createBookmarks(storageArea, onChange = () => {}) {
  let items = [];
  storageArea.get({ [STORAGE_KEY]: [] }, (stored) => {
    // stored by an older build or edited by hand: keep only well-formed rows
    if (Array.isArray(stored[STORAGE_KEY])) items = stored[STORAGE_KEY].filter(isBookmark);
  });

  return {
    list: () => items,
    has: (id) => items.some((item) => item.id === id),
    // adds the entry on top, or removes it; returns whether it is bookmarked now
    toggle(entry) {
      const isAdding = !items.some((item) => item.id === entry.id);
      items = isAdding ? [bookmarkOf(entry), ...items] : items.filter((item) => item.id !== entry.id);
      storageArea.set({ [STORAGE_KEY]: items });
      onChange();
      return isAdding;
    },
  };
}

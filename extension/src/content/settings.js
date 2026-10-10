// User-facing display settings, persisted in chrome.storage.sync.
// The options page writes; the content script reads and live-updates.
export const DEFAULT_SETTINGS = {
  showPoj: true, // show 白話字 (POJ) in dropdown rows
  showTps: false, // show 方音符號 (TPS) in dropdown rows
  showRandomWord: true, // show the random-word button beside 「搜尋」
  showRandomProverb: true, // show the random-proverb button beside 「搜尋」
  fontScale: 85, // dropdown font size, percent of the host site's base size
  rememberRecent: true, // rank recently opened entries first (stored locally)
};

// Returns a live settings object plus a getter. `onChange` fires after the
// stored values arrive and whenever the user flips a switch in the options page.
export function watchSettings(storageArea, onChange) {
  const current = { ...DEFAULT_SETTINGS };
  if (storageArea?.get) {
    storageArea.get(DEFAULT_SETTINGS, (stored) => {
      Object.assign(current, stored);
      onChange?.();
    });
    storageArea.onChanged?.addListener((changes) => {
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (key in changes) current[key] = changes[key].newValue;
      }
      onChange?.();
    });
  }
  return () => current;
}

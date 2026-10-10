// Single source of truth for selectors / URL templates / constants
// Centralized selectors, URLs, and search limits.
export const CONFIG = {
  INPUT_ID: "id_tsha",
  LABEL_ID: "label_tsha", // the「搜尋」label — the 🎲 button mounts beside it
  FORM_NAME: "tshiautuann",
  LUI_ENABLED: "tai_su", // enhancement is active only in Taiwanese-word mode
  LOCALES: ["zh-hant", "und-hani"],
  DEFAULT_LOCALE: "zh-hant",
  DATA_URL: "data/kautian.min.json",
  DEBOUNCE_MS: 100,
  LIMIT: 200,
  entryHref(locale, id) {
    return `/${locale}/su/${id}/`;
  },
};

export function extensionResourceUrl(runtime, path) {
  try {
    return typeof runtime?.getURL === "function" ? runtime.getURL(path) : null;
  } catch {
    return null;
  }
}

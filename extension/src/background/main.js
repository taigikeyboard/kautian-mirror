import { createDatasetStore, UPDATE_URL } from "./dataset.js";

// Cache Storage avoids extension storage quotas for the full dictionary snapshot.
const cacheKey = UPDATE_URL;
const store = createDatasetStore({
  seedUrl: chrome.runtime.getURL("data/kautian.min.json"),
  async read() {
    const cache = await caches.open("kautian-dataset-v6");
    const response = await cache.match(cacheKey);
    return response ? response.json() : null;
  },
  async write(value) {
    const cache = await caches.open("kautian-dataset-v6");
    await cache.put(cacheKey, new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" },
    }));
  },
  async fetchJson(url) {
    const response = await fetch(url, { cache: "no-cache", credentials: "omit", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Dictionary request failed: HTTP ${response.status}`);
    return response.json();
  },
  async fetchBytes(url) {
    const response = await fetch(url, { cache: "no-cache", credentials: "omit", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Dictionary request failed: HTTP ${response.status}`);
    return response.arrayBuffer();
  },
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "dictionary.get" || sender.id !== chrome.runtime.id) return;
  store.get().then((data) => {
    sendResponse({ data });
    // Existing pages keep their dataset; the next page receives an activated update.
    void store.check().catch((error) => console.warn("dictionary.load.failed", error.message));
  }, (error) => sendResponse({ error: error.message }));
  return true;
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
chrome.commands.onCommand.addListener((command) => {
  if (command === "open-settings") chrome.runtime.openOptionsPage();
});

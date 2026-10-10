// App entry: URL routing (?q= / ?id=), lazy data loading, search-as-you-type.
import { createEngine } from "../vendor/kautian-extension/src/search/engine.js";
import { createRecency } from "../vendor/kautian-extension/src/content/recency.js";
import { createSuggest } from "./suggest.js";
import { entryView, resultsView, searchHref, statusView } from "./render.js";
import { INDEX_PATH, bucketOf, shardPath } from "./data-paths.js";
import { initThemeToggle } from "./theme.js";

const SUGGEST_LIMIT = 200;
const RESULTS_LIMIT = 200;
const DEBOUNCE_MS = 100;
const SITE_TITLE = "教典備援網站";
const HOME_TITLE = "教典備援網站";

// chrome.storage-shaped adapter over localStorage, so the extension's recency LRU runs
// unchanged; storage may throw (private mode, blocked site data) — recency then lasts the page view
const localArea = {
  get(defaults, callback) {
    const stored = {};
    for (const [key, fallback] of Object.entries(defaults)) {
      try {
        const raw = localStorage.getItem(key);
        stored[key] = raw === null ? fallback : JSON.parse(raw);
      } catch {
        stored[key] = fallback;
      }
    }
    callback(stored);
  },
  set(items) {
    try {
      for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};
const recency = createRecency(localArea);

const input = document.getElementById("q");
const form = input.form;
const view = document.getElementById("view");

// missingAs: value to resolve with on HTTP 404 instead of failing
function fetchJson(url, { missingAs } = {}) {
  return fetch(url).then((response) => {
    if (response.status === 404 && missingAs !== undefined) return missingAs;
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  });
}

// Memoized loaders; a failure clears the memo so the next call retries.
let engine = null;
let enginePromise = null;
function loadEngine() {
  enginePromise ??= fetchJson(INDEX_PATH)
    .then((data) => (engine = createEngine(data)))
    .catch((err) => {
      enginePromise = null;
      throw err;
    });
  return enginePromise;
}

const shardPromises = new Map();
function loadEntry(id) {
  const bucket = bucketOf(id);
  if (!shardPromises.has(bucket)) {
    // ids past the last shard 404 — that is "no such entry", not a load failure
    const promise = fetchJson(shardPath(bucket), { missingAs: {} }).catch((err) => {
      shardPromises.delete(bucket);
      throw err;
    });
    shardPromises.set(bucket, promise);
  }
  return shardPromises.get(bucket).then((shard) => shard[id] ?? null);
}

// --- views; navSeq drops results of a navigation that has been superseded ---
let navSeq = 0;

// only home and entry pages belong in search engines; search results, misses and errors get noindex
const robotsMeta = document.createElement("meta");
robotsMeta.name = "robots";
robotsMeta.content = "noindex";

function show(node, { title = HOME_TITLE, isIndexable = false } = {}) {
  document.title = title;
  if (isIndexable) robotsMeta.remove();
  else document.head.append(robotsMeta);
  view.replaceChildren(...(node ? [node] : []));
}

async function showResults(query) {
  const seq = ++navSeq;
  const title = `${query}｜${SITE_TITLE}`;
  input.value = query;
  show(statusView("載入中…"), { title });
  try {
    const loaded = await loadEngine();
    if (seq !== navSeq) return;
    show(resultsView(query, loaded.query(query, { limit: RESULTS_LIMIT, recencyRank: recency.rankOf })), { title });
  } catch (err) {
    if (seq !== navSeq) return;
    console.warn("index.load.failed", err.message);
    show(statusView("詞典資料載入失敗。", () => showResults(query)));
  }
}

async function showEntry(rawId) {
  const seq = ++navSeq;
  const id = Number(rawId);
  show(statusView("載入中…"));
  try {
    const entry = Number.isInteger(id) && id > 0 ? await loadEntry(id) : null;
    if (seq !== navSeq) return;
    if (!entry) {
      show(statusView("揣無這个詞目。"));
      return;
    }
    recency.record(id);
    show(entryView(entry), { title: `${entry.hanzi} ${entry.tl.join("/")}｜${SITE_TITLE}`, isIndexable: true });
    window.scrollTo(0, 0);
  } catch (err) {
    if (seq !== navSeq) return;
    console.warn("entry.load.failed", id, err.message);
    show(statusView("詞目載入失敗。", () => showEntry(rawId)));
  }
}

function route() {
  suggest.hide();
  const params = new URLSearchParams(location.search);
  if (params.has("id")) return showEntry(params.get("id"));
  const query = params.get("q")?.trim();
  if (query) return showResults(query);
  navSeq++;
  input.value = "";
  show(null, { isIndexable: true });
}

function navigate(href) {
  history.pushState(null, "", href);
  route();
}

// --- search-as-you-type ---
let typingTimer = 0;
let suggestSeq = 0; // bumped on dismiss/typing so a slow index load cannot reopen the list
function cancelSuggestions() {
  clearTimeout(typingTimer);
  suggestSeq++;
}

const suggest = createSuggest({
  input,
  onDismiss: cancelSuggestions,
  box: document.getElementById("suggest"),
  onOpen: (row) => navigate(row.getAttribute("href")),
  onSubmit: () => {
    const query = input.value.trim();
    if (query) navigate(searchHref(query));
  },
});

async function updateSuggestions() {
  const query = input.value.trim();
  if (!query) return suggest.hide();
  const seq = suggestSeq;
  if (!engine) {
    suggest.hint("載入中…");
    try {
      await loadEngine();
    } catch {
      if (seq === suggestSeq) suggest.hint("詞典資料載入失敗。");
      return;
    }
    if (seq !== suggestSeq) return;
  }
  suggest.render(engine.query(query, { limit: SUGGEST_LIMIT, recencyRank: recency.rankOf }));
}

input.addEventListener("focus", () => loadEngine().catch(() => {}));
input.addEventListener("input", () => {
  cancelSuggestions();
  suggest.clearActive();
  typingTimer = setTimeout(updateSuggestions, DEBOUNCE_MS);
});
form.addEventListener("submit", (ev) => ev.preventDefault());

// in-app links (?id= / ?q= / ./) navigate without a page load
document.addEventListener("click", (ev) => {
  const link = ev.target.closest("a[href]");
  if (!link || ev.defaultPrevented || ev.button !== 0) return;
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const href = link.getAttribute("href");
  if (!href.startsWith("?") && !link.hasAttribute("data-nav")) return;
  ev.preventDefault();
  navigate(href);
});

initThemeToggle(document.querySelector(".theme-toggle"));
window.addEventListener("popstate", route);
route();
// warm the search index while the home page sits idle, so the first keystroke is instant
if (!location.search) {
  (window.requestIdleCallback ?? setTimeout)(() => loadEngine().catch(() => {}));
}

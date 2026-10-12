// App entry: URL routing (?q= / ?id=), lazy data loading, search-as-you-type.
import { createEngine } from "../extension/src/search/engine.js";
import { CONFIG } from "../extension/src/content/config.js";
import { createRecency } from "../extension/src/content/recency.js";
import { createSuggest } from "./suggest.js";
import { bookmarkRows, entryView, loadingView, resultsView, searchHref, statusView } from "./render.js";
import { createBookmarks } from "./bookmarks.js";
import { createExampleSearch } from "./example-search.js";
import { EXAMPLES_PATH, INDEX_PATH, bucketOf, shardPath } from "./data-paths.js";
import { initSettings } from "./settings.js";
import { initSidebar } from "./sidebar.js";

const RESULTS_LIMIT = 200;
const EXAMPLES_LIMIT = 5;
const SUGGEST_EXAMPLES_LIMIT = 3;
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

// sidebar 收藏 list: re-rendered on every toggle and navigation (marks the open entry)
const bookmarkNav = document.getElementById("bookmarks");
let currentEntryId = null;
function renderBookmarks() {
  const items = bookmarks.list();
  bookmarkNav.hidden = !items.length;
  bookmarkNav.replaceChildren(...bookmarkRows(items, currentEntryId));
}
const bookmarks = createBookmarks(localArea, renderBookmarks);

const input = document.getElementById("q");
const form = input.form;
const settingsForm = document.getElementById("settings");
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

let exampleSearch = null;
let exampleSearchPromise = null;
function loadExampleSearch() {
  exampleSearchPromise ??= fetchJson(EXAMPLES_PATH)
    .then((rows) => (exampleSearch = createExampleSearch(rows)))
    .catch((err) => {
      exampleSearchPromise = null;
      throw err;
    });
  return exampleSearchPromise;
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
  show(loadingView(), { title });
  // 例句 load alongside the index; headword results show first, 例句 join them once loaded
  loadExampleSearch().catch(() => {});
  let headwords;
  try {
    const loaded = await loadEngine();
    if (seq !== navSeq) return;
    headwords = loaded.query(query, { limit: RESULTS_LIMIT, recencyRank: recency.rankOf });
    show(resultsView(query, headwords), { title });
  } catch (err) {
    if (seq !== navSeq) return;
    console.warn("index.load.failed", err.message);
    show(statusView("詞典資料載入失敗", () => showResults(query)));
    return;
  }
  try {
    const examples = (await loadExampleSearch()).search(query, EXAMPLES_LIMIT);
    if (seq !== navSeq || !examples.length) return;
    show(resultsView(query, headwords, examples), { title });
  } catch (err) {
    // headword results stay; the next search retries the 例句 load
    console.warn("examples.load.failed", err.message);
  }
}

async function showEntry(rawId) {
  const seq = ++navSeq;
  const id = Number(rawId);
  show(loadingView());
  try {
    const entry = Number.isInteger(id) && id > 0 ? await loadEntry(id) : null;
    if (seq !== navSeq) return;
    if (!entry) {
      show(statusView("揣無這个詞目"));
      return;
    }
    recency.record(id);
    show(entryView(entry, bookmarks), { title: `${entry.hanzi} ${entry.tl.join("/")}｜${SITE_TITLE}`, isIndexable: true });
    window.scrollTo(0, 0);
  } catch (err) {
    if (seq !== navSeq) return;
    console.warn("entry.load.failed", id, err.message);
    show(statusView("詞目載入失敗", () => showEntry(rawId)));
  }
}

function route() {
  suggest.hide();
  isPreviewingSettings = false;
  const params = new URLSearchParams(location.search);
  currentEntryId = params.has("id") ? Number(params.get("id")) : null;
  renderBookmarks();
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
  keepOpenWithin: settingsForm,
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
    try {
      await loadEngine();
    } catch {
      return;
    }
    if (seq !== suggestSeq) return;
  }
  const headwords = engine.query(query, { limit: CONFIG.LIMIT, recencyRank: recency.rankOf });
  // 選單顯示 例句 switch (src/settings.js → <html data-*>); the ?q= results page always lists 例句
  if (document.documentElement.dataset.suggestExamples === "off") return suggest.render(headwords);
  if (exampleSearch) return suggest.render(headwords, exampleSearch.search(query, SUGGEST_EXAMPLES_LIMIT));
  // 例句 still loading: headwords show now, the list re-renders once 例句 arrive
  suggest.render(headwords);
  try {
    await loadExampleSearch();
  } catch {
    return;
  }
  const examples = exampleSearch.search(query, SUGGEST_EXAMPLES_LIMIT);
  if (seq !== suggestSeq || !examples.length) return;
  suggest.render(headwords, examples);
}

// the 例句 file loads only once someone starts searching, never on the bare home page
input.addEventListener("focus", () => {
  loadEngine().catch(() => {});
  loadExampleSearch().catch(() => {});
});
input.addEventListener("input", () => {
  cancelSuggestions();
  suggest.clearActive();
  typingTimer = setTimeout(updateSuggestions, CONFIG.DEBOUNCE_MS);
});
form.addEventListener("submit", (ev) => ev.preventDefault());

// "/" jumps to the search field from anywhere outside a text field (hint: .search-hint)
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "/" || ev.metaKey || ev.ctrlKey || ev.altKey || ev.isComposing) return;
  const target = ev.target;
  if (target.isContentEditable || target.closest("input, textarea, select")) return;
  ev.preventDefault();
  input.focus();
  input.select();
});

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

initSettings(settingsForm, localArea);
// 選單顯示 changes re-render an open dropdown in place; the flag keeps that going after a filter
// empties (and so hides) the list, until the reader clicks elsewhere or types
let isPreviewingSettings = false;
settingsForm.addEventListener("change", () => {
  if (!isPreviewingSettings && !suggest.isOpen()) return;
  isPreviewingSettings = true;
  updateSuggestions();
});
document.addEventListener("pointerdown", (ev) => {
  if (!settingsForm.contains(ev.target)) isPreviewingSettings = false;
});
input.addEventListener("keydown", () => (isPreviewingSettings = false));
initSidebar(document.querySelector(".sidebar-toggle"), document.getElementById("sidebar"), localArea);
window.addEventListener("popstate", route);
route();
// warm the search index while the home page sits idle, so the first keystroke is instant
if (!location.search) {
  (window.requestIdleCallback ?? setTimeout)(() => loadEngine().catch(() => {}));
}

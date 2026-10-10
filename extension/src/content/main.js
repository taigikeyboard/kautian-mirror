// Content-script entry: mounting, lazy data loading, query routing
// Mounts the enhanced search UI on the dictionary search form.
import { CONFIG, extensionResourceUrl } from "./config.js";
import { createEngine } from "../search/engine.js";
import { createUI } from "./ui.js";
import { watchSettings } from "./settings.js";
import { createRecency } from "./recency.js";

function getLocale() {
  const seg = window.location.pathname.split("/")[1];
  return CONFIG.LOCALES.includes(seg) ? seg : CONFIG.DEFAULT_LOCALE;
}

function init() {
  const input = document.getElementById(CONFIG.INPUT_ID);
  const form = document.forms[CONFIG.FORM_NAME];
  if (!input || !form) return; // not a search page — stay fully idle

  const dataUrl = extensionResourceUrl(globalThis.chrome?.runtime, CONFIG.DATA_URL);
  if (!dataUrl) {
    console.warn("[kautian-extension] extension context unavailable; reload the page");
    return;
  }

  const locale = getLocale();
  const luiEnabled = () => form.elements.lui?.value === CONFIG.LUI_ENABLED;

  let engine = null;
  let loading = false;
  let pending = ""; // query to re-run once loading finishes
  let pendingRandom = null; // id-picker queued when a click beats data loading
  let timer = 0;
  const randomBtns = [];

  // re-render open results when the user changes display settings
  const getSettings = watchSettings(globalThis.chrome?.storage?.sync, () => {
    syncRandomButtonVisibility();
    if (engine && ui.visible()) run(input.value);
  });
  const recency = createRecency(globalThis.chrome?.storage?.local);

  const ui = createUI({
    input,
    getSettings,
    buildHref: (res) => CONFIG.entryHref(locale, res.id),
    onSelect: (res) => {
      if (getSettings().rememberRecent) recency.record(res.id);
    },
    onFill: (res) => {
      input.value = res.tl;
      // hand control back to the host page (synthetic input event)
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    },
  });

  function ensureData() {
    if (engine || loading) return;
    loading = true;
    fetch(dataUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        engine = createEngine(data);
        loading = false;
        if (pendingRandom) {
          const pick = pendingRandom;
          pendingRandom = null;
          goRandom(pick); // opens a new tab — this page keeps working
        }
        if (pending) run(pending);
      })
      .catch((err) => {
        loading = false;
        pendingRandom = null;
        setRandomDisabled(false);
        console.warn("[kautian-extension] failed to load lexicon:", err.message);
        ui.hide();
      });
  }

  function setRandomDisabled(disabled) {
    for (const btn of randomBtns) btn.disabled = disabled;
  }

  function goRandom(pickId) {
    if (!engine) {
      pendingRandom = pickId;
      setRandomDisabled(true); // block double-clicks while loading
      ensureData();
      return;
    }
    const id = pickId(engine);
    if (id !== undefined) {
      window.open(CONFIG.entryHref(locale, id), "_blank", "noopener");
    }
    setRandomDisabled(false); // page stays — make it clickable again
  }

  // Random-discovery buttons beside the「搜尋」label:
  // 🎲 any main entry;📜 proverb-like entries (experimental)
  {
    let anchor = document.getElementById(CONFIG.LABEL_ID);
    const defs = [
      ["🎲", "Open a random word", "showRandomWord", (eng) => eng.randomMainId()],
      ["📜", "Open a random proverb", "showRandomProverb", (eng) => eng.randomProverbId()],
    ];
    for (const [glyph, titleText, settingKey, pickId] of defs) {
      if (!anchor) break;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stnp-random";
      btn.textContent = glyph;
      btn.title = titleText;
      btn.setAttribute("aria-label", titleText);
      btn.dataset.settingKey = settingKey;
      btn.addEventListener("click", () => goRandom(pickId));
      anchor.insertAdjacentElement("afterend", btn);
      anchor = btn;
      randomBtns.push(btn);
    }
    syncRandomButtonVisibility();
  }

  function syncRandomButtonVisibility() {
    const settings = getSettings();
    for (const btn of randomBtns) {
      btn.hidden = !settings[btn.dataset.settingKey];
    }
  }

  function run(value) {
    const q = value.trim();
    if (!q || !luiEnabled()) {
      ui.hide();
      return;
    }
    if (!engine) {
      pending = q;
      ui.render({ type: "loading" });
      ensureData();
      return;
    }
    pending = "";
    const out = engine.query(q, {
      limit: CONFIG.LIMIT,
      recencyRank: getSettings().rememberRecent ? recency.rankOf : undefined,
    });
    ui.render({ type: "results", ...out });
  }

  input.addEventListener("focus", ensureData);
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(input.value), CONFIG.DEBOUNCE_MS);
  });
  for (const radio of form.elements.lui || []) {
    radio.addEventListener("change", () => {
      if (!luiEnabled()) ui.hide();
      else run(input.value);
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}

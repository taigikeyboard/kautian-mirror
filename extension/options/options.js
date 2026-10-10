// Options page: read/write display settings in chrome.storage.sync.
// Keys and defaults must stay in sync with src/content/settings.js.
const DEFAULT_SETTINGS = {
  showPoj: true,
  showTps: false,
  showRandomWord: true,
  showRandomProverb: true,
  fontScale: 85,
};

const TOGGLE_KEYS = ["showPoj", "showTps", "showRandomWord", "showRandomProverb"];
const scaleRadios = [...document.querySelectorAll('input[name="fontScale"]')];

chrome.storage.sync.get(DEFAULT_SETTINGS, (stored) => {
  for (const key of TOGGLE_KEYS) {
    document.getElementById(key).checked = stored[key];
  }
  const match = scaleRadios.find((r) => Number(r.value) === Number(stored.fontScale));
  if (match) {
    match.checked = true;
  } else {
    // stored value no longer offered (e.g. removed 特大/130) — reset to default
    scaleRadios.find((r) => Number(r.value) === DEFAULT_SETTINGS.fontScale).checked = true;
    chrome.storage.sync.set({ fontScale: DEFAULT_SETTINGS.fontScale });
  }
});

for (const key of TOGGLE_KEYS) {
  document.getElementById(key).addEventListener("change", (ev) => {
    chrome.storage.sync.set({ [key]: ev.target.checked });
  });
}

for (const radio of scaleRadios) {
  radio.addEventListener("change", () => {
    chrome.storage.sync.set({ fontScale: Number(radio.value) });
  });
}

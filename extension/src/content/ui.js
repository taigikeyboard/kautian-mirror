// Accessible dropdown UI.
// Principles: <a href> result rows, textContent instead of innerHTML,
// keydown/pointerdown each bound exactly once at init, full ARIA combobox pattern.
// Keep status messages brief and clear in English.

const MAX_DROPDOWN_HEIGHT = 420;
const VIEWPORT_GAP = 8;

export function dropdownMaxHeight(inputBottom, viewportHeight) {
  return Math.max(0, Math.min(MAX_DROPDOWN_HEIGHT, viewportHeight - inputBottom - VIEWPORT_GAP));
}

export function createUI({
  input,
  buildHref,
  onFill,
  onSelect = () => {},
  getSettings = () => ({ showPoj: true, showTps: false, fontScale: 85 }),
}) {
  const listId = "stnp-listbox";
  const box = document.createElement("div");
  box.className = "stnp-dropdown";
  box.id = listId;
  box.setAttribute("role", "listbox");
  box.hidden = true;
  document.body.appendChild(box);

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";

  let rows = []; // currently rendered <a> rows
  let results = [];
  let active = -1;

  function position() {
    const r = input.getBoundingClientRect();
    box.style.left = `${r.left + window.scrollX}px`;
    box.style.top = `${r.bottom + window.scrollY + 2}px`;
    // lock to the input's width — long entries (proverbs) must not widen the box
    box.style.width = `${r.width}px`;
    box.style.maxHeight = `${dropdownMaxHeight(r.bottom, window.innerHeight)}px`;
  }

  function hide() {
    if (box.hidden) return;
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function show() {
    position();
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function setActive(idx) {
    if (active >= 0 && rows[active]) rows[active].classList.remove("stnp-active");
    active = idx;
    if (active >= 0 && rows[active]) {
      const row = rows[active];
      row.classList.add("stnp-active");
      input.setAttribute("aria-activedescendant", row.id);
      row.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function addHint(text) {
    const hint = document.createElement("div");
    hint.className = "stnp-hint";
    hint.textContent = text;
    box.appendChild(hint);
  }

  function applyFontScale() {
    const scale = Number(getSettings().fontScale) || 100;
    // scale relative to the host site's base size (styles.css default)
    box.style.fontSize = scale === 100
      ? ""
      : `calc(var(--bs-body-font-size, 1.3rem) * ${scale / 100})`;
  }

  // state: { type: 'loading' } | { type: 'results', results, mode, truncated, error }
  function render(state) {
    // Replace the whole content; listeners live on `box` (event delegation),
    // so nothing accumulates
    applyFontScale();
    box.replaceChildren();
    rows = [];
    results = [];
    active = -1;

    if (state.type === "loading") {
      addHint("Loading dictionary…");
      show();
      return;
    }
    if (state.error) {
      addHint(state.error === "too-long" ? "Regex too long (max 64 characters)." : "Invalid regex.");
      show();
      return;
    }
    if (!state.results.length) {
      hide();
      return;
    }
    results = state.results;
    const settings = getSettings();
    state.results.forEach((res, idx) => {
      const row = document.createElement("a");
      row.className = "stnp-row";
      row.id = `stnp-option-${idx}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      row.href = buildHref(res);
      row.dataset.idx = String(idx);

      const hanzi = document.createElement("span");
      hanzi.className = "stnp-hanzi";
      hanzi.textContent = res.hanzi;
      const tl = document.createElement("span");
      tl.className = "stnp-tl";
      tl.textContent = res.tl;
      row.append(hanzi, tl);
      if (settings.showPoj) {
        const poj = document.createElement("span");
        poj.className = "stnp-sub";
        poj.textContent = res.poj !== res.tl ? res.poj : "";
        row.append(poj);
      }
      if (settings.showTps) {
        const tps = document.createElement("span");
        tps.className = "stnp-sub";
        tps.textContent = res.tps;
        row.append(tps);
      }

      box.appendChild(row);
      rows.push(row);
    });
    if (state.truncated) {
      addHint("Results may be incomplete.");
    }
    show();
  }

  // --- events (each bound once) ---
  input.addEventListener("keydown", (ev) => {
    // Let an in-progress IME composition (e.g. selecting Zhuyin/Pinyin candidates)
    // own the arrow/Enter keys; only act once the candidate is committed.
    if (ev.isComposing || ev.keyCode === 229) return;
    if (box.hidden || !rows.length) return;
    switch (ev.key) {
      case "ArrowDown":
        ev.preventDefault();
        setActive((active + 1) % rows.length);
        break;
      case "ArrowUp":
        ev.preventDefault();
        setActive((active - 1 + rows.length) % rows.length);
        break;
      case "Enter":
        if (active >= 0) {
          ev.preventDefault(); // block form submit; open the selected row instead
          onSelect(results[active]);
          if (ev.shiftKey) {
            onFill(results[active]);
            hide();
          } else {
            window.location.href = rows[active].href;
          }
        }
        // no row selected → let the host form submit normally
        break;
      case "Escape":
        hide();
        break;
      case "Tab":
        hide();
        break;
    }
  });

  box.addEventListener("mousemove", (ev) => {
    const row = ev.target.closest(".stnp-row");
    if (row) setActive(Number(row.dataset.idx));
  });

  box.addEventListener("click", (ev) => {
    const row = ev.target.closest(".stnp-row");
    if (!row) return;
    onSelect(results[Number(row.dataset.idx)]);
    if (ev.shiftKey) {
      ev.preventDefault();
      onFill(results[Number(row.dataset.idx)]);
      hide();
    }
    // plain click follows the <a> native navigation
  });

  document.addEventListener("pointerdown", (ev) => {
    if (ev.target !== input && !box.contains(ev.target)) hide();
  });

  window.addEventListener("resize", () => {
    if (!box.hidden) position();
  }, { passive: true });

  document.addEventListener("scroll", () => {
    if (!box.hidden) position();
  }, { capture: true, passive: true });

  return { render, hide, visible: () => !box.hidden };
}

// Accessible suggestion dropdown (ARIA combobox), adapted from the extension's
// content/ui.js: <a href> rows, textContent only, listeners bound once,
// IME-safe keyboard handling. Positioned by CSS inside the search form.
import { dropdownMaxHeight } from "../extension/src/content/ui.js";
import { resultRow } from "./render.js";

const BOX_GAP = 8; // matches .suggest top: calc(100% + 8px)

// onDismiss runs on every hide (Escape, outside click, navigation) so the caller
// can cancel pending suggestion updates that would otherwise reopen the list.
export function createSuggest({ input, box, onOpen, onSubmit, onDismiss }) {
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", box.id);
  input.setAttribute("aria-expanded", "false");

  let rows = [];
  let active = -1;

  function setActive(idx, { scroll = false } = {}) {
    rows[active]?.classList.remove("active");
    rows[active]?.setAttribute("aria-selected", "false");
    active = idx;
    const row = rows[active];
    if (!row) {
      input.removeAttribute("aria-activedescendant");
      return;
    }
    row.classList.add("active");
    row.setAttribute("aria-selected", "true");
    input.setAttribute("aria-activedescendant", row.id);
    if (scroll) row.scrollIntoView({ block: "nearest" });
  }

  function clear() {
    setActive(-1);
    box.replaceChildren();
    rows = [];
  }

  function hide() {
    onDismiss();
    if (box.hidden) return;
    box.hidden = true;
    input.setAttribute("aria-expanded", "false");
    setActive(-1);
  }

  function show() {
    // shrink to the viewport space below the input, like the extension
    box.style.maxHeight = `${dropdownMaxHeight(input.getBoundingClientRect().bottom + BOX_GAP, window.innerHeight)}px`;
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  // out: engine query() result { results, error }; errors show on the results page only
  function render({ results, error }) {
    clear();
    if (error || !results.length) return hide();
    results.forEach((res, idx) => {
      const row = resultRow(res);
      row.id = `suggest-${idx}`;
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", "false");
      box.append(row);
      rows.push(row);
    });
    show();
  }

  input.addEventListener("keydown", (ev) => {
    // let an in-progress IME composition own arrows/Enter
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === "Escape") return hide();
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (!box.hidden && rows[active]) onOpen(rows[active]);
      else onSubmit();
      hide();
      return;
    }
    if (box.hidden || !rows.length) return;
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActive((active + 1) % rows.length, { scroll: true });
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((active - 1 + rows.length) % rows.length, { scroll: true });
    }
  });

  box.addEventListener("mousemove", (ev) => {
    const idx = rows.indexOf(ev.target.closest(".row"));
    if (idx >= 0 && idx !== active) setActive(idx);
  });
  // row clicks are plain <a href> links; the app's link router handles them
  box.addEventListener("click", hide);

  document.addEventListener("pointerdown", (ev) => {
    if (ev.target !== input && !box.contains(ev.target)) hide();
  });

  // clearActive: typing invalidates the highlighted row before new results arrive
  return { render, hide, clearActive: () => setActive(-1) };
}

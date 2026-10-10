// Entry header actions: copy the headword, share the entry link (Web Share, else clipboard), word card.
import { shareWordCard } from "./word-card.js";

const COPY_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <rect x="7" y="7" width="9.5" height="9.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <path d="M13 4.5V4a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 4v6.5A1.5 1.5 0 0 0 5 12h.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;
const SHARE_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <path d="M10 12.5V2.75M6.5 6 10 2.5 13.5 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M7 8.5H5.5a1.5 1.5 0 0 0-1.5 1.5v6a1.5 1.5 0 0 0 1.5 1.5h9a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>`;
const CARD_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <circle cx="7" cy="8" r="1.25" fill="currentColor"/>
  <path d="M3.5 14.5l4-3.75 2.75 2.5 2.75-3.25 4 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
</svg>`;
const DONE_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true">
  <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const FEEDBACK_MS = 1500;

function iconButton(svg, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "entry-action";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = svg;
  button.addEventListener("click", () => onClick(button));
  return button;
}

// swap the icon to a check mark for a moment, then restore it
function flashDone(button, svg, label, doneLabel) {
  button.innerHTML = DONE_SVG;
  button.title = doneLabel;
  setTimeout(() => {
    button.innerHTML = svg;
    button.title = label;
  }, FEEDBACK_MS);
}

function copyText(text, button, svg, label, doneLabel) {
  navigator.clipboard.writeText(text).then(
    () => flashDone(button, svg, label, doneLabel),
    (err) => console.warn("clipboard.write.failed", err.name),
  );
}

// entry: { id, hanzi, tl }
export function entryActions(entry) {
  const box = document.createElement("div");
  box.className = "entry-actions";
  // same "漢字 台羅" shape as the entry's tab title
  const headword = `${entry.hanzi} ${entry.tl.join("/")}`;
  box.append(
    iconButton(COPY_SVG, "複製詞目", (button) => copyText(headword, button, COPY_SVG, "複製詞目", "已複製")),
    iconButton(SHARE_SVG, "分享連結", (button) => {
      const url = `${location.origin}${location.pathname}?id=${entry.id}`;
      if (!navigator.share) return copyText(url, button, SHARE_SVG, "分享連結", "連結已複製");
      navigator.share({ title: document.title, url }).catch((err) => {
        // AbortError: the user closed the share sheet
        if (err.name !== "AbortError") console.warn("share.failed", err.name);
      });
    }),
    iconButton(CARD_SVG, "字卡圖片", (button) => {
      // disabled while drawing so a double click doesn't open two share sheets
      button.disabled = true;
      shareWordCard(entry)
        .catch((err) => console.warn("word-card.failed", entry.id, err.name, err.message))
        .finally(() => (button.disabled = false));
    }),
  );
  return box;
}
